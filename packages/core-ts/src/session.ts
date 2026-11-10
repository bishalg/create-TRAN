/**
 * What a client does after an auth failure (spec 022, ADR-0039).
 * Mirrors `crates/rust-core/src/session.rs`; pinned by `fixtures/session.json`. The policy numbers
 * arrive from Rust through `./generated/rules.ts`.
 *
 * Verifies: REQ-SEC-005 REQ-SEC-015
 */

export { SESSION_POLICY } from './generated/rules.js';

/** What just went wrong with the session, as a client sees it. */
export type SessionEvent =
  | {
      /** An API call answered `401`. */
      kind: 'unauthorized';
      /** The client holds a refresh token (the web's cookie counts). */
      hasRefreshCredential: boolean;
      /** This call was already repeated once after a refresh. */
      alreadyRetried: boolean;
    }
  /** The refresh call was refused: the credential is dead. */
  | { kind: 'refresh_rejected' }
  /** The refresh call got no usable answer: offline, timeout, rate limit, server error. */
  | { kind: 'refresh_failed' };

/** Refresh once then repeat the call; clear the session; or keep it and retry later. */
export type SessionAction = 'refresh' | 'sign_out' | 'keep';

/** The recovery table of REQ-SEC-015. */
export function sessionRecovery(event: SessionEvent): SessionAction {
  if (event.kind === 'unauthorized') {
    return event.hasRefreshCredential && !event.alreadyRetried ? 'refresh' : 'sign_out';
  }
  return event.kind === 'refresh_rejected' ? 'sign_out' : 'keep';
}

/**
 * Classifies the answer to `POST /api/auth/refresh`: `status` is `null` when no HTTP answer
 * arrived. `null` means the refresh succeeded; only `401` and `403` reject the credential.
 */
export function refreshEvent(status: number | null): SessionEvent | null {
  if (status !== null && status >= 200 && status <= 299) return null;
  if (status === 401 || status === 403) return { kind: 'refresh_rejected' };
  return { kind: 'refresh_failed' };
}
