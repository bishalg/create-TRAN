/**
 * What the app does after a tap on a control that needs a permission (spec 026, ADR-0043).
 * Mirrors `permission_step` in `crates/rust-core/src/permissions.rs`; pinned by
 * `fixtures/permissions.json`. The catalogues arrive from Rust through `./generated/rules.ts`.
 *
 * Verifies: REQ-PRV-001 REQ-PRV-002 REQ-PRV-008
 */
import type { PermissionStatus, PermissionStep } from './generated/rules.js';

export {
  PERMISSIONS,
  PERMISSION_STATUSES,
  PERSONAL_QUESTIONS,
  type AnswerKind,
  type PermissionEntry,
  type PermissionFallback,
  type PermissionId,
  type PermissionStatus,
  type PermissionStep,
  type PersonalAnswer,
  type PersonalQuestion,
} from './generated/rules.js';

/**
 * The next step (REQ-PRV-002). `primed` is whether the person has just chosen "Continue" on the
 * priming. A refusal the system can still ask about is explained again before asking again.
 */
export function permissionStep(status: PermissionStatus, primed: boolean): PermissionStep {
  switch (status) {
    case 'not_determined':
    case 'denied':
      return primed ? 'request_system' : 'show_priming';
    case 'granted':
    case 'granted_approximate':
      return 'use_feature';
    case 'denied_permanently':
    case 'restricted':
      return 'offer_settings';
  }
}
