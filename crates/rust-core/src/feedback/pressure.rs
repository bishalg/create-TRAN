//! How many toasts may be up at once, and how a connectivity banner recovers by itself
//! (ADR-0036, REQ-ERR-012, REQ-ERR-013). Platforms run the timers; these functions decide.

use super::Tone;

/// Limits on visible toasts (REQ-ERR-012).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToastPolicy {
    /// A new toast beyond this evicts the oldest.
    pub max_visible: usize,
}

pub const TOAST_POLICY: ToastPolicy = ToastPolicy { max_visible: 3 };

/// What makes two toasts "the same": the message they show and their tone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ToastKey<'a> {
    pub message_key: &'a str,
    pub tone: Tone,
}

/// What to do with an incoming toast.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastAdmission {
    /// The same toast is already visible at `index` (oldest first): restart its timer instead.
    Refresh { index: usize },
    /// Show it at the end after dismissing this many of the oldest toasts.
    Append { evict_oldest: usize },
}

/// Decides how `incoming` joins `visible` (oldest first).
pub fn admit_toast(visible: &[ToastKey<'_>], incoming: ToastKey<'_>) -> ToastAdmission {
    match visible.iter().position(|toast| *toast == incoming) {
        Some(index) => ToastAdmission::Refresh { index },
        None => ToastAdmission::Append {
            evict_oldest: (visible.len() + 1).saturating_sub(TOAST_POLICY.max_visible),
        },
    }
}

/// When a banner failure is up, how often the app asks the server whether it is back
/// (REQ-ERR-013).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RecoveryPolicy {
    /// Wait before the first probe.
    pub first_probe_ms: u64,
    /// The wait doubles per probe up to this.
    pub max_probe_ms: u64,
}

pub const RECOVERY_POLICY: RecoveryPolicy = RecoveryPolicy {
    first_probe_ms: 5_000,
    max_probe_ms: 60_000,
};

/// Wait before probe number `probe` (1 = the first; 0 is treated as 1):
/// `min(max, first × 2^(probe−1))`. No jitter: one client probing per minute needs none.
pub fn recovery_probe_delay_ms(probe: u32) -> u64 {
    RECOVERY_POLICY
        .first_probe_ms
        .saturating_mul(1u64 << probe.saturating_sub(1).min(16))
        .min(RECOVERY_POLICY.max_probe_ms)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_cap_is_never_exceeded_after_admission() {
        // `a.three` twice: a duplicate refreshes instead of appending (REQ-ERR-012).
        let keys = ["a.one", "a.two", "a.three", "a.three", "a.four", "a.five"];
        let mut visible: Vec<ToastKey> = Vec::new();
        for key in keys {
            let incoming = ToastKey {
                message_key: key,
                tone: Tone::Info,
            };
            if let ToastAdmission::Append { evict_oldest } = admit_toast(&visible, incoming) {
                visible.drain(..evict_oldest);
                visible.push(incoming);
            }
            assert!(visible.len() <= TOAST_POLICY.max_visible);
        }
        assert_eq!(visible.first().map(|t| t.message_key), Some("a.three"));
    }
}
