//! Motion durations (REQ-LOAD-006, ADR-0035). Two steps, no easing token: every platform animates
//! with one `ease-out`, and reduced motion turns the animation off, not shorter.

use serde::{Deserialize, Serialize};

/// CSS durations in whole milliseconds (`"150ms"`); Swift receives seconds, Kotlin milliseconds.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct MotionTokens {
    /// Small state changes: a hover, a chip, a caption swap.
    pub fast: String,
    /// A panel or a result appearing.
    pub base: String,
}

pub(super) fn default_motion_tokens() -> MotionTokens {
    MotionTokens {
        fast: "150ms".into(),
        base: "250ms".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-LOAD-006
    #[test]
    fn motion_tokens_are_whole_milliseconds() {
        let motion = default_motion_tokens();
        let millis: Vec<Option<u64>> = [&motion.fast, &motion.base]
            .iter()
            .map(|value| value.strip_suffix("ms").and_then(|n| n.parse().ok()))
            .collect();
        assert_eq!(millis, [Some(150), Some(250)]);
    }
}
