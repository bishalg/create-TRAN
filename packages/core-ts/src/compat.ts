/**
 * API versioning and client compatibility for TypeScript clients (spec 028, ADR-0047).
 * Mirrors `crates/rust-core/src/compat.rs`; pinned by `fixtures/compat.json`. The base path, the
 * header names and the wire-enum fallbacks arrive from Rust through `@tran/api`'s generated file.
 *
 * Verifies: REQ-VER-004 REQ-VER-005 REQ-VER-006 REQ-VER-008 REQ-VER-010
 */
import {
  CLIENT_HEADER,
  RECOMMENDED_VERSION_HEADER,
  UPDATE_HEADER,
  UPDATE_RECOMMENDED,
  WIRE_ENUMS,
} from '@tran/api';

export {
  API_BASE_PATH,
  CLIENT_HEADER,
  COUNTRY_SOURCE,
  HEALTH_PATH,
  RECOMMENDED_VERSION_HEADER,
  UPDATE_HEADER,
  UPDATE_RECOMMENDED,
  USER_ROLE,
  WIRE_ENUMS,
  apiPath,
  type WireEnum,
} from '@tran/api';

export type ClientPlatform = 'ios' | 'android' | 'web' | 'unknown';

/** A parsed `X-Tran-Client`: a known platform always has a version, an unknown one never does. */
export interface Client {
  platform: ClientPlatform;
  version: string | null;
}

export type ClientStanding = 'supported' | 'update_recommended' | 'upgrade_required';

const VERSION_MAX_LEN = 32;
const APP_PLATFORMS: readonly ClientPlatform[] = ['ios', 'android', 'web'];
const CORE = /^\d{1,9}(\.\d{1,9}){0,3}$/;
const SUFFIX = /^[0-9A-Za-z.-]+$/;

/** `1.4.0-beta+7` → [`1.4.0`, `beta+7`]. */
function splitSuffix(value: string): [string, string | null] {
  const at = value.search(/[-+]/);
  return at < 0 ? [value, null] : [value.slice(0, at), value.slice(at + 1)];
}

/** 1 to 4 numeric parts of at most 9 digits, an optional `-`/`+` suffix, at most 32 characters. */
export function isVersion(value: string): boolean {
  if (value.length === 0 || value.length > VERSION_MAX_LEN) return false;
  const [core, suffix] = splitSuffix(value);
  return CORE.test(core) && (suffix === null || SUFFIX.test(suffix));
}

/** Reads `X-Tran-Client`; anything malformed is `unknown`, never an error (REQ-VER-004). */
export function parseClient(header: string | null | undefined): Client {
  const slash = header?.trim().split('/') ?? [];
  const [platform, version] = slash as [ClientPlatform, string | undefined];
  if (slash.length === 2 && APP_PLATFORMS.includes(platform) && isVersion(version!)) {
    return { platform, version: version! };
  }
  return { platform: 'unknown', version: null };
}

/** The header value a client sends: `web/1.4.0`. */
export function formatClient(platform: ClientPlatform, version: string): string {
  return `${platform}/${version}`;
}

function numericParts(version: string): number[] {
  return splitSuffix(version.trim())[0]
    .split('.')
    .map((part) => (/^\d+$/.test(part) ? Number(part) : 0));
}

/** -1, 0 or 1: numeric by part, missing parts are zero, a suffix is ignored (REQ-VER-005). */
export function compareVersions(a: string, b: string): -1 | 0 | 1 {
  const [x, y] = [numericParts(a), numericParts(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/** The decision of REQ-VER-005 and REQ-VER-006 for the client's own platform's thresholds. */
export function clientStanding(
  client: Client,
  minimum: string | null,
  recommended: string | null
): ClientStanding {
  const { version } = client;
  if (version === null) return 'supported';
  const below = (threshold: string | null) =>
    threshold !== null && compareVersions(version, threshold) < 0;
  if (below(minimum)) return 'upgrade_required';
  return below(recommended) ? 'update_recommended' : 'supported';
}

export interface UpdatePromptState {
  standing: ClientStanding;
  /** `X-Tran-Recommended-Version` of the answer, if it carried one. */
  recommendedVersion: string | null;
  /** The recommended version the prompt was last dismissed for, if any. */
  dismissedVersion: string | null;
}

/** Whether the dismissible update prompt shows: once per recommended version (REQ-VER-010). */
export function updatePrompt(state: UpdatePromptState): boolean {
  const { standing, recommendedVersion, dismissedVersion } = state;
  const dismissed =
    dismissedVersion !== null &&
    (recommendedVersion === null || compareVersions(dismissedVersion, recommendedVersion) === 0);
  return standing === 'update_recommended' && !dismissed;
}

/** A wire enum value read tolerantly; `undefined` only for an enum the catalogue does not declare. */
export function decodeWireEnum(name: string, raw: string): string | undefined {
  const wire = WIRE_ENUMS.find((candidate) => candidate.name === name);
  if (!wire) return undefined;
  return wire.values.includes(raw) ? raw : wire.fallback;
}

/** What an answer said about this client's version: blocked, nudged, or nothing. */
export interface StandingSignal {
  standing: Exclude<ClientStanding, 'supported'>;
  /** The recommended version, when the server named it. */
  recommendedVersion: string | null;
}

/** `426` is a blocked version; `X-Tran-Update: recommended` a nudge; anything else says nothing. */
export function standingFromResponse(
  response: Pick<Response, 'status'> & { headers?: Headers }
): StandingSignal | null {
  if (response.status === 426) return { standing: 'upgrade_required', recommendedVersion: null };
  if (response.headers?.get(UPDATE_HEADER) !== UPDATE_RECOMMENDED) return null;
  return {
    standing: 'update_recommended',
    recommendedVersion: response.headers.get(RECOMMENDED_VERSION_HEADER),
  };
}

export interface ClientFetchOptions {
  /** The `X-Tran-Client` value, `formatClient('web', version)`. */
  client?: string;
  /** Told what every answer said about this version (REQ-VER-005, REQ-VER-006). */
  onStanding?: (signal: StandingSignal) => void;
}

/**
 * `fetchFn` that names the client on every request and reports the answer's standing, so one
 * place sees a `426` or a nudge whichever call met it. Failures pass through untouched.
 */
export function clientFetch(
  fetchFn: typeof fetch,
  { client, onStanding }: ClientFetchOptions
): typeof fetch {
  return async (url, init) => {
    const headers = client ? { ...init?.headers, [CLIENT_HEADER]: client } : init?.headers;
    const response = await fetchFn(url, { ...init, headers });
    const signal = standingFromResponse(response);
    if (signal) onStanding?.(signal);
    return response;
  };
}
