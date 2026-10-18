//! Hex parsing for generated Kotlin Compose colors (#RRGGBBAA → AARRGGBB).

/// Parses brand hex into Android Compose `Color` ARGB bits (signed i32-compatible u32).
pub fn kotlin_tran_color_argb(hex: &str) -> u32 {
    let raw = hex.trim_start_matches('#');
    let value = u64::from_str_radix(raw, 16).unwrap_or(0);
    let argb = match raw.len() {
        3 => {
            let r = ((value >> 8) & 0xF) * 17;
            let g = ((value >> 4) & 0xF) * 17;
            let b = (value & 0xF) * 17;
            (0xFF_u64 << 24) | (r << 16) | (g << 8) | b
        }
        6 => 0xFF000000_u64 | value,
        // #RRGGBBAA (CSS) → AARRGGBB (Compose)
        8 => ((value & 0xFF) << 24) | ((value >> 8) & 0xFFFFFF),
        _ => 0xFF000000,
    };
    argb as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rrggbb_is_opaque() {
        assert_eq!(kotlin_tran_color_argb("#112233"), 0xFF112233);
    }

    #[test]
    fn rrggbbaa_swaps_alpha_to_front() {
        // #RRGGBBAA = 11 22 33 80 → AARRGGBB = 80 11 22 33
        assert_eq!(kotlin_tran_color_argb("#11223380"), 0x80112233);
    }

    #[test]
    fn rgb_shorthand_expands() {
        assert_eq!(kotlin_tran_color_argb("#F00"), 0xFFFF0000);
    }
}
