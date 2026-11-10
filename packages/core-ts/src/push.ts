/**
 * What an app does with its push token (spec 027, ADR-0044). The web has no push; this mirror of
 * `push_sync` in `crates/rust-core/src/push.rs` keeps the policy numbers and the table honest
 * against `fixtures/push.json`, as every other shared table is mirrored here. The policy arrives
 * from Rust through `./generated/rules.ts`.
 *
 * Verifies: REQ-PSH-005 REQ-PSH-009
 */
import { DEVICE_POLICY, type PushAction } from './generated/rules.js';

export { DEVICE_POLICY, type PushAction } from './generated/rules.js';

const SECONDS_PER_DAY = 86_400;

/** The registration an app recorded: the token and when the API answered, in Unix seconds. */
export interface LastRegistration {
  token: string;
  registeredAtUnixS: number;
}

/** What an app knows when it runs the sync. */
export interface PushState {
  /** The build can receive push (APNs entitlement, FCM values). */
  pushAvailable: boolean;
  /** The platform lets the app show notifications now. */
  permissionGranted: boolean;
  /** The app holds an API session. */
  hasSession: boolean;
  /** The token the platform last delivered; `null` until it delivers one. */
  currentToken: string | null;
  lastRegistration: LastRegistration | null;
  nowUnixS: number;
}

/**
 * The sync table (REQ-PSH-009): a new, changed or week-old token is registered; without push,
 * permission or a session a recorded registration is unregistered; otherwise nothing.
 */
export function pushSync(state: PushState): PushAction {
  const ready = state.pushAvailable && state.permissionGranted && state.hasSession;
  const last = state.lastRegistration;
  if (!ready) return last === null ? 'nothing' : 'unregister';
  if (state.currentToken === null) return 'nothing';
  if (last === null || last.token !== state.currentToken) return 'register';
  const age = state.nowUnixS - last.registeredAtUnixS;
  const fresh = age >= 0 && age < DEVICE_POLICY.refreshAfterDays * SECONDS_PER_DAY;
  return fresh ? 'nothing' : 'register';
}
