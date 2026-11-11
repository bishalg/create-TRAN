// Verifies: REQ-CFG-005 REQ-CFG-006 REQ-CFG-008 REQ-DB-011 REQ-DB-012
/**
 * The web's remote configuration store (spec 029, ADR-0048): it starts on the compiled defaults or
 * the last answer it stored, never blocks, and fetches in the background with `If-None-Match`.
 *
 * Nothing here is spelled by hand: the flags, their defaults and which are `live` come from the
 * generated catalogue (`readFlags`), the header from `BUCKET_HEADER`, the record schema from
 * `STORED_RECORD_SCHEMAS` and the stored-record decision from `storedRecord` (ADR-0027).
 */

import {
  apiPath,
  CLIENT_HEADER,
  ClientThresholdsSchema,
  RemoteConfigResponseSchema,
  type ClientThresholdsResponse,
} from '@tran/api';
import {
  BUCKET_HEADER,
  readFlags,
  type FlagsCatalogue,
  type FlagValues,
} from './generated/flags.js';
import { STORED_RECORD_SCHEMAS } from './generated/rules.js';
import { storedRecord, storedSchema } from './stored-records.js';

export const CONFIG_PATH = apiPath('/config');
/** One versioned record: the last answer, its ETag and the schema stamp (REQ-DB-011). */
export const STORAGE_KEY_CONFIG = 'tran:remote_config';

export interface ConfigStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryConfigStorage implements ConfigStorage {
  private readonly data = new Map<string, string>();

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }
}

export interface ClientThresholds {
  minimum_version: string | null;
  recommended_version: string | null;
}

/** What the store keeps between launches. */
interface ConfigRecord {
  flags: Record<string, unknown>;
  client: ClientThresholds;
  configVersion: number;
  /** The ETag of the answer these flags came from: only it may revalidate them. */
  etag: string | null;
}

const NO_THRESHOLDS: ClientThresholds = { minimum_version: null, recommended_version: null };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function thresholds(raw: ClientThresholdsResponse | undefined): ClientThresholds {
  return {
    minimum_version: raw?.minimum_version ?? null,
    recommended_version: raw?.recommended_version ?? null,
  };
}

/** A stored record this build reads, one it must leave for a newer build, or one to delete. */
type StoredConfig = ConfigRecord | 'newer' | 'unreadable';

/**
 * The stored record (REQ-DB-011, REQ-DB-012): the schema rule and decision of every platform
 * (`storedSchema`, `storedRecord`); a newer version is left in place unread; a record this build
 * should read but cannot (bad JSON, flags, or `config_version`) is unreadable. Unreadable
 * thresholds are dropped alone.
 */
function readRecord(raw: string): StoredConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return 'unreadable';
  }
  if (!isObject(parsed)) return 'unreadable';
  const schema = storedSchema(parsed.schema);
  if (schema === null) return 'unreadable';
  if (storedRecord(schema, STORED_RECORD_SCHEMAS.config) === 'discard') return 'newer';
  const { flags, config_version: configVersion, etag } = parsed;
  if (!isObject(flags) || !Number.isSafeInteger(configVersion)) return 'unreadable';
  return {
    flags,
    client: thresholds(ClientThresholdsSchema.safeParse(parsed.client).data),
    configVersion: configVersion as number,
    etag: typeof etag === 'string' ? etag : null,
  };
}

export interface RemoteConfigStoreOptions<T> {
  baseUrl: string;
  storage?: ConfigStorage;
  fetch?: typeof globalThis.fetch;
  /** `X-Tran-Client` (REQ-VER-004). */
  clientHeader?: string;
  /** From `deriveBucket`; the installation id itself is never sent (REQ-CFG-006). */
  bucket?: number | null;
  /** The generated `readFlags`; injected only to observe launch and latest values in tests. */
  readFlags?: (launch: FlagValues, latest: FlagValues) => T;
}

/**
 * Flags and client thresholds (REQ-CFG-005, REQ-CFG-008). A flag read at launch keeps its value for
 * the run; a `live` flag follows the latest answer.
 */
export class RemoteConfigStore<T = FlagsCatalogue> {
  private readonly baseUrl: string;
  private readonly storage: ConfigStorage;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly clientHeader?: string;
  private readonly bucket?: number | null;
  private readonly read: (launch: FlagValues, latest: FlagValues) => T;
  private readonly launch: FlagValues;
  private latest: FlagValues;
  private etag: string | null;
  private clientThresholds: ClientThresholds;
  private configVersion: number;
  private readonly listeners = new Set<(flags: T) => void>();
  private fetchInProgress: Promise<boolean> | null = null;

  constructor(options: RemoteConfigStoreOptions<T>) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.storage = options.storage ?? new MemoryConfigStorage();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.clientHeader = options.clientHeader;
    this.bucket = options.bucket;
    this.read =
      options.readFlags ?? (readFlags as unknown as (launch: FlagValues, latest: FlagValues) => T);

    const raw = this.storage.getItem(STORAGE_KEY_CONFIG);
    const stored = raw === null ? null : readRecord(raw);
    if (stored === 'unreadable') this.storage.removeItem(STORAGE_KEY_CONFIG);
    // Only a record in use lends its ETag: revalidating anything else could only answer 304 and
    // keep this build on its defaults.
    const record = typeof stored === 'object' ? stored : null;
    this.launch = record?.flags;
    this.latest = record?.flags;
    this.etag = record?.etag ?? null;
    this.clientThresholds = record?.client ?? NO_THRESHOLDS;
    this.configVersion = record?.configVersion ?? 1;
  }

  /** Every flag, typed, through the generated accessors (REQ-CFG-001). */
  get flags(): T {
    return this.read(this.launch, this.latest);
  }

  /** Client minimum and recommended versions (REQ-CFG-008). */
  getClientThresholds(): ClientThresholds {
    return { ...this.clientThresholds };
  }

  getConfigVersion(): number {
    return this.configVersion;
  }

  /** Told after every answer that changed the configuration. */
  subscribe(listener: (flags: T) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** A non-blocking fetch; resolves whether it applied a new answer, never rejects. */
  fetchInBackground(): Promise<boolean> {
    this.fetchInProgress ??= this.performFetch().finally(() => {
      this.fetchInProgress = null;
    });
    return this.fetchInProgress;
  }

  private async performFetch(): Promise<boolean> {
    const headers: Record<string, string> = {};
    if (this.clientHeader) headers[CLIENT_HEADER] = this.clientHeader;
    if (typeof this.bucket === 'number') headers[BUCKET_HEADER] = String(this.bucket);
    if (this.etag) headers['If-None-Match'] = this.etag;
    let body: unknown;
    let etag: string | null;
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${CONFIG_PATH}`, {
        method: 'GET',
        headers,
        // Public configuration: no cookie (REQ-SEC-018, REQ-CFG-010).
        credentials: 'omit',
      });
      // 304: what is stored is current. Anything else: keep it and show nothing (REQ-CFG-005).
      if (response.status !== 200) return false;
      etag = response.headers.get('etag');
      body = await response.json();
    } catch {
      return false;
    }
    // Validated, unknown fields dropped; a wrong-typed flag is left to its accessor's default.
    const parsed = RemoteConfigResponseSchema.safeParse(body);
    if (!parsed.success) return false;
    const { flags, client, config_version } = parsed.data;

    this.latest = flags;
    this.etag = etag;
    this.clientThresholds = thresholds(client);
    this.configVersion = config_version;
    this.save({ flags, client, config_version, etag });
    const current = this.flags;
    for (const listener of this.listeners) {
      try {
        listener(current);
      } catch {
        // A listener must not fail the store.
      }
    }
    return true;
  }

  /** The schema stamp goes last, so no field of the answer can overwrite it. */
  private save(answer: Record<string, unknown>): void {
    try {
      this.storage.setItem(
        STORAGE_KEY_CONFIG,
        JSON.stringify({ ...answer, schema: STORED_RECORD_SCHEMAS.config })
      );
    } catch {
      // Storage full or blocked: the answer still applies for this run.
    }
  }
}
