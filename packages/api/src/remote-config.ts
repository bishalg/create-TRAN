// Verifies: REQ-CFG-002 REQ-CFG-005 REQ-CFG-006 REQ-CFG-007 REQ-CFG-008
//! Remote configuration client store with background fetch and offline fallback (spec 029, ADR-0048).

import { API_BASE_PATH, CLIENT_HEADER } from './generated/compat.js';
import type { ClientThresholdsResponse, RemoteConfigResponse } from './schemas/config.js';

export { ClientThresholdsResponse, RemoteConfigResponse };

export const CONFIG_PATH = `${API_BASE_PATH}/config`;
export const BUCKET_HEADER = 'X-Tran-Bucket';

export const STORAGE_KEY_CONFIG = 'tran:remote_config';
export const STORAGE_KEY_ETAG = 'tran:remote_config_etag';

export interface ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export class MemoryConfigStorage implements ConfigStorage {
  private data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
}

export interface RemoteConfigStoreOptions {
  baseUrl: string;
  storage?: ConfigStorage;
  fetch?: typeof globalThis.fetch;
  clientHeader?: string;
  bucket?: number;
  defaults?: Record<string, boolean | number | string>;
  liveFlags?: readonly string[];
}

/**
 * Client store managing feature flags and client version thresholds (REQ-CFG-005).
 * Starts with compiled defaults or stored configuration, never blocks, and fetches in the background.
 */
export class RemoteConfigStore {
  private readonly baseUrl: string;
  private readonly storage: ConfigStorage;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clientHeader?: string;
  private readonly bucket?: number;
  private readonly defaults: Record<string, boolean | number | string>;
  private readonly liveFlagSet: Set<string>;

  private launchFlags: Record<string, boolean | number | string>;
  private liveFlags: Record<string, boolean | number | string>;
  private clientThresholds: ClientThresholdsResponse;
  private configVersion: number;
  private listeners: Set<(flags: Record<string, boolean | number | string>) => void> = new Set();
  private fetchInProgress: Promise<boolean> | null = null;

  constructor(options: RemoteConfigStoreOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.storage = options.storage ?? new MemoryConfigStorage();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clientHeader = options.clientHeader;
    this.bucket = options.bucket;
    this.defaults = { notify_me: false, ...options.defaults };
    this.liveFlagSet = new Set(options.liveFlags ?? ['notify_me']);

    const stored = this.loadStoredConfig();
    const initialFlags = stored ? { ...this.defaults, ...stored.flags } : { ...this.defaults };

    this.launchFlags = { ...initialFlags };
    this.liveFlags = { ...initialFlags };
    this.clientThresholds = stored?.client ?? { minimum_version: null, recommended_version: null };
    this.configVersion = stored?.config_version ?? 1;
  }

  private loadStoredConfig(): RemoteConfigResponse | null {
    try {
      const raw = this.storage.getItem(STORAGE_KEY_CONFIG);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  /**
   * Retrieves a flag's current value.
   * A flag read at launch keeps its value for the whole run; a `live` flag reflects the latest fetch.
   */
  public getFlag<T extends boolean | number | string = boolean>(id: string): T {
    if (this.liveFlagSet.has(id)) {
      return this.liveFlags[id] as T;
    }
    return this.launchFlags[id] as T;
  }

  /** Convenience accessor for the notify_me reminder flag (REQ-CFG-007). */
  public isNotifyMe(): boolean {
    return this.getFlag<boolean>('notify_me');
  }

  /** Client minimum and recommended version thresholds (REQ-CFG-008). */
  public getClientThresholds(): ClientThresholdsResponse {
    return { ...this.clientThresholds };
  }

  /** Current configuration version. */
  public getConfigVersion(): number {
    return this.configVersion;
  }

  /** Subscribes to live flag updates. */
  public subscribe(
    listener: (flags: Record<string, boolean | number | string>) => void
  ): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Initiates a non-blocking background fetch (REQ-CFG-005). */
  public fetchInBackground(): Promise<boolean> {
    if (this.fetchInProgress) {
      return this.fetchInProgress;
    }
    const promise = this.performFetch().finally(() => {
      this.fetchInProgress = null;
    });
    this.fetchInProgress = promise;
    return promise;
  }

  private async performFetch(): Promise<boolean> {
    try {
      const headers: Record<string, string> = {};
      if (this.clientHeader) {
        headers[CLIENT_HEADER] = this.clientHeader;
      }
      if (typeof this.bucket === 'number') {
        headers[BUCKET_HEADER] = String(this.bucket);
      }
      const storedEtag = this.storage.getItem(STORAGE_KEY_ETAG);
      if (storedEtag) {
        headers['If-None-Match'] = storedEtag;
      }

      const url = `${this.baseUrl}${CONFIG_PATH}`;
      const response = await this.fetchImpl(url, { method: 'GET', headers });

      if (response.status === 304) {
        return false;
      }

      if (!response.ok) {
        return false;
      }

      const data = (await response.json()) as RemoteConfigResponse;
      const etag = response.headers.get('etag');

      this.storage.setItem(STORAGE_KEY_CONFIG, JSON.stringify(data));
      if (etag) {
        this.storage.setItem(STORAGE_KEY_ETAG, etag);
      }

      this.configVersion = data.config_version;
      this.clientThresholds = data.client;
      this.liveFlags = { ...this.defaults, ...data.flags };

      for (const listener of this.listeners) {
        try {
          listener(this.liveFlags);
        } catch {
          // Listeners must not fail the store
        }
      }

      return true;
    } catch {
      // Failed fetch leaves stored configuration in use and shows nothing (REQ-CFG-005)
      return false;
    }
  }
}
