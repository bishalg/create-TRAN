//! Spacing and radius scales in points (= CSS px at the 16px root, = dp on Android), and motion
//! durations in milliseconds.

use rust_core::tokens::TokensJsonSnapshot;

/// `(member, value)` pairs, in the order the tokens declare them.
pub type Entries = Vec<(&'static str, f64)>;

/// Both scales, converted once so every native target renders the same numbers.
#[derive(Debug, PartialEq)]
pub struct Scale {
    pub spacing: Entries,
    pub radii: Entries,
    /// Milliseconds.
    pub motion: Entries,
}

impl Scale {
    /// Fails on a length the native targets cannot express (anything but `rem` or `px`), or a
    /// duration that is not whole milliseconds.
    pub fn from_snapshot(snapshot: &TokensJsonSnapshot) -> Result<Self, String> {
        let sp = &snapshot.spacing;
        let r = &snapshot.radii;
        let m = &snapshot.motion;
        Ok(Self {
            spacing: convert(&[
                ("xxs", &sp.xxs),
                ("xs", &sp.xs),
                ("sm", &sp.sm),
                ("base", &sp.base),
                ("md", &sp.md),
                ("lg", &sp.lg),
                ("xl", &sp.xl),
                ("xxl", &sp.two_xl),
                ("touch", &sp.touch),
                ("nudge", &sp.nudge),
            ])?,
            radii: convert(&[("sm", &r.sm), ("md", &r.md), ("lg", &r.lg)])?,
            motion: [("fast", &m.fast), ("base", &m.base)]
                .iter()
                .map(|(name, value)| css_duration_to_millis(value).map(|ms| (*name, ms)))
                .collect::<Result<_, _>>()?,
        })
    }
}

fn convert(raw: &[(&'static str, &String)]) -> Result<Entries, String> {
    raw.iter()
        .map(|(name, value)| css_length_to_points(value).map(|points| (*name, points)))
        .collect()
}

/// `0.5rem` → 8, `10px` → 10 (16px root font size).
pub fn css_length_to_points(value: &str) -> Result<f64, String> {
    let parsed = if let Some(rem) = value.strip_suffix("rem") {
        rem.parse::<f64>().map(|v| v * 16.0)
    } else if let Some(px) = value.strip_suffix("px") {
        px.parse::<f64>()
    } else {
        return Err(format!("unsupported length `{value}` (use rem or px)"));
    };
    parsed.map_err(|e| format!("invalid length `{value}`: {e}"))
}

/// `150ms` → 150. Seconds are rejected so every platform reads one unit.
pub fn css_duration_to_millis(value: &str) -> Result<f64, String> {
    let digits = value
        .strip_suffix("ms")
        .ok_or_else(|| format!("unsupported duration `{value}` (use whole ms)"))?;
    digits
        .parse::<u32>()
        .map(f64::from)
        .map_err(|e| format!("invalid duration `{value}`: {e}"))
}

/// `2.0` → `2`, `6.5` → `6.5`.
pub fn format_points(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::tokens_json_snapshot;

    #[test]
    fn css_lengths_convert_to_points_at_a_16px_root() {
        assert_eq!(css_length_to_points("0.5rem"), Ok(8.0));
        assert_eq!(css_length_to_points("10px"), Ok(10.0));
        assert!(css_length_to_points("2em").is_err());
        assert!(css_length_to_points("abcrem").is_err());
        assert_eq!(format_points(2.0), "2");
        assert_eq!(format_points(6.5), "6.5");
    }

    #[test]
    fn the_real_scale_converts_in_declaration_order() {
        let scale = Scale::from_snapshot(&tokens_json_snapshot()).unwrap();
        assert_eq!(scale.spacing.len(), 10);
        assert_eq!(scale.spacing[0].0, "xxs");
        assert_eq!(
            scale.radii.iter().map(|e| e.0).collect::<Vec<_>>(),
            ["sm", "md", "lg"]
        );
    }

    #[test]
    fn an_unsupported_length_fails_the_run() {
        let mut snapshot = tokens_json_snapshot();
        snapshot.spacing.md = "1em".into();
        assert!(Scale::from_snapshot(&snapshot).unwrap_err().contains("1em"));

        let mut snapshot = tokens_json_snapshot();
        snapshot.radii.lg = "calc(1px)".into();
        assert!(Scale::from_snapshot(&snapshot)
            .unwrap_err()
            .contains("calc(1px)"));
    }

    // Verifies: REQ-LOAD-006
    #[test]
    fn motion_converts_to_milliseconds_and_rejects_other_units() {
        let scale = Scale::from_snapshot(&tokens_json_snapshot()).unwrap();
        assert_eq!(scale.motion, [("fast", 150.0), ("base", 250.0)]);
        assert_eq!(
            css_duration_to_millis("0.2s").unwrap_err(),
            "unsupported duration `0.2s` (use whole ms)"
        );
        assert!(css_duration_to_millis("fastms")
            .unwrap_err()
            .contains("fastms"));

        let mut snapshot = tokens_json_snapshot();
        snapshot.motion.base = "1s".into();
        assert!(Scale::from_snapshot(&snapshot)
            .unwrap_err()
            .contains("`1s`"));
    }
}
