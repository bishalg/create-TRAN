//! Emit [Google DESIGN.md](https://github.com/google-labs-code/design.md) from rust-core tokens.
//!
//! Rust remains the source of truth; this file is a generated agent / Stitch mirror.

use rust_core::tokens::{ThemeJson, TokensJsonSnapshot};

/// YAML-escape a double-quoted string.
fn yaml_str(value: &str) -> String {
    format!(
        "\"{}\"",
        value
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('\n', "\\n")
    )
}

fn theme_by_mode<'a>(snapshot: &'a TokensJsonSnapshot, mode: &str) -> Option<&'a ThemeJson> {
    snapshot.themes.iter().find(|t| t.mode == mode)
}

fn default_palette(snapshot: &TokensJsonSnapshot) -> &ThemeJson {
    theme_by_mode(snapshot, &snapshot.default_theme)
        .or_else(|| snapshot.themes.first())
        .expect("tokens snapshot always has at least one theme")
}

/// Render a root `DESIGN.md` (Google Labs / Stitch format) from the token snapshot.
pub fn render_design_md(snapshot: &TokensJsonSnapshot) -> String {
    let palette_theme = default_palette(snapshot);
    let p = &palette_theme.palette;
    let ty = &snapshot.typography;
    let sp = &snapshot.spacing;
    let rd = &snapshot.radii;

    let theme_list = snapshot
        .themes
        .iter()
        .map(|t| t.mode.as_str())
        .collect::<Vec<_>>()
        .join(", ");

    // Front matter MUST start at byte 0 for `@google/design.md` lint / Stitch parsers.
    let mut out = String::new();
    out.push_str("---\n");
    out.push_str("version: alpha\n");
    out.push_str("name: TRAN\n");
    out.push_str(&format!(
        "description: {}\n",
        yaml_str(&format!(
            "TRAN voting sample — semantic tokens from rust-core (default theme: {}). Upload this file to Stitch or point coding agents at it for brand-driven UI.",
            snapshot.default_theme
        ))
    ));
    out.push_str("colors:\n");
    out.push_str(&format!("  primary: {}\n", yaml_str(&p.primary)));
    out.push_str(&format!("  secondary: {}\n", yaml_str(&p.accent)));
    out.push_str(&format!("  tertiary: {}\n", yaml_str(&p.action)));
    out.push_str(&format!("  neutral: {}\n", yaml_str(&p.background)));
    out.push_str(&format!("  surface: {}\n", yaml_str(&p.surface)));
    out.push_str(&format!("  on-surface: {}\n", yaml_str(&p.text.primary)));
    out.push_str(&format!(
        "  on-surface-secondary: {}\n",
        yaml_str(&p.text.secondary)
    ));
    out.push_str(&format!(
        "  on-surface-muted: {}\n",
        yaml_str(&p.text.muted)
    ));
    out.push_str(&format!("  on-primary: {}\n", yaml_str(&p.onAction)));
    out.push_str(&format!("  action: {}\n", yaml_str(&p.action)));
    out.push_str(&format!("  success: {}\n", yaml_str(&p.success)));
    out.push_str(&format!("  warning: {}\n", yaml_str(&p.warning)));
    out.push_str(&format!("  error: {}\n", yaml_str(&p.danger)));
    out.push_str(&format!(
        "  eligibility-can-vote: {}\n",
        yaml_str(&p.eligibility.canVote)
    ));
    out.push_str(&format!(
        "  eligibility-cannot-vote: {}\n",
        yaml_str(&p.eligibility.cannotVote)
    ));
    out.push_str(&format!(
        "  eligibility-neutral: {}\n",
        yaml_str(&p.eligibility.neutral)
    ));

    out.push_str("typography:\n");
    out.push_str("  headline-display:\n");
    out.push_str(&format!(
        "    fontFamily: {}\n",
        yaml_str(&ty.font_family_sans)
    ));
    // clamp() is not a DESIGN.md Dimension — use the xl step (agents get a concrete size).
    out.push_str(&format!("    fontSize: {}\n", yaml_str(&ty.font_size_xl)));
    out.push_str(&format!("    fontWeight: {}\n", ty.font_weight_bold));
    out.push_str(&format!(
        "    lineHeight: {}\n",
        yaml_str(&ty.line_height_display)
    ));
    out.push_str("  headline-md:\n");
    out.push_str(&format!(
        "    fontFamily: {}\n",
        yaml_str(&ty.font_family_sans)
    ));
    out.push_str(&format!(
        "    fontSize: {}\n",
        yaml_str(&ty.font_size_title)
    ));
    out.push_str(&format!("    fontWeight: {}\n", ty.font_weight_semibold));
    out.push_str(&format!(
        "    lineHeight: {}\n",
        yaml_str(&ty.line_height_title)
    ));
    out.push_str("  body-md:\n");
    out.push_str(&format!(
        "    fontFamily: {}\n",
        yaml_str(&ty.font_family_sans)
    ));
    out.push_str(&format!("    fontSize: {}\n", yaml_str(&ty.font_size_body)));
    out.push_str(&format!("    fontWeight: {}\n", ty.font_weight_normal));
    out.push_str(&format!(
        "    lineHeight: {}\n",
        yaml_str(&ty.line_height_body)
    ));
    out.push_str("  body-sm:\n");
    out.push_str(&format!(
        "    fontFamily: {}\n",
        yaml_str(&ty.font_family_sans)
    ));
    out.push_str(&format!("    fontSize: {}\n", yaml_str(&ty.font_size_sm)));
    out.push_str(&format!("    fontWeight: {}\n", ty.font_weight_normal));
    out.push_str(&format!(
        "    lineHeight: {}\n",
        yaml_str(&ty.line_height_normal)
    ));
    out.push_str("  label-md:\n");
    out.push_str(&format!(
        "    fontFamily: {}\n",
        yaml_str(&ty.font_family_sans)
    ));
    out.push_str(&format!(
        "    fontSize: {}\n",
        yaml_str(&ty.font_size_caption)
    ));
    out.push_str(&format!("    fontWeight: {}\n", ty.font_weight_semibold));
    out.push_str(&format!(
        "    lineHeight: {}\n",
        yaml_str(&ty.line_height_caption)
    ));

    out.push_str("spacing:\n");
    out.push_str(&format!("  xxs: {}\n", yaml_str(&sp.xxs)));
    out.push_str(&format!("  xs: {}\n", yaml_str(&sp.xs)));
    out.push_str(&format!("  sm: {}\n", yaml_str(&sp.sm)));
    out.push_str(&format!("  base: {}\n", yaml_str(&sp.base)));
    out.push_str(&format!("  md: {}\n", yaml_str(&sp.md)));
    out.push_str(&format!("  lg: {}\n", yaml_str(&sp.lg)));
    out.push_str(&format!("  xl: {}\n", yaml_str(&sp.xl)));
    out.push_str(&format!("  2xl: {}\n", yaml_str(&sp.two_xl)));
    out.push_str(&format!("  touch: {}\n", yaml_str(&sp.touch)));
    out.push_str(&format!("  nudge: {}\n", yaml_str(&sp.nudge)));

    out.push_str("rounded:\n");
    out.push_str(&format!("  sm: {}\n", yaml_str(&rd.sm)));
    out.push_str(&format!("  md: {}\n", yaml_str(&rd.md)));
    out.push_str(&format!("  lg: {}\n", yaml_str(&rd.lg)));
    out.push_str(&format!("  full: {}\n", yaml_str(&rd.pill)));

    out.push_str("components:\n");
    out.push_str("  button-primary:\n");
    out.push_str("    backgroundColor: \"{colors.action}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.md}\"\n");
    out.push_str("    typography: \"{typography.label-md}\"\n");
    out.push_str("  button-danger:\n");
    out.push_str("    backgroundColor: \"{colors.error}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.md}\"\n");
    out.push_str("  surface-card:\n");
    out.push_str("    backgroundColor: \"{colors.surface}\"\n");
    out.push_str("    textColor: \"{colors.on-surface}\"\n");
    out.push_str("    rounded: \"{rounded.lg}\"\n");
    out.push_str("  page-shell:\n");
    out.push_str("    backgroundColor: \"{colors.neutral}\"\n");
    out.push_str("    textColor: \"{colors.on-surface}\"\n");
    out.push_str("  text-secondary:\n");
    out.push_str("    textColor: \"{colors.on-surface-secondary}\"\n");
    out.push_str("    typography: \"{typography.body-sm}\"\n");
    out.push_str("  text-muted:\n");
    out.push_str("    textColor: \"{colors.on-surface-muted}\"\n");
    out.push_str("    typography: \"{typography.label-md}\"\n");
    out.push_str("  badge-success:\n");
    out.push_str("    backgroundColor: \"{colors.success}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.full}\"\n");
    out.push_str("  badge-warning:\n");
    out.push_str("    backgroundColor: \"{colors.warning}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.full}\"\n");
    out.push_str("  eligibility-can-vote:\n");
    out.push_str("    backgroundColor: \"{colors.eligibility-can-vote}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.md}\"\n");
    out.push_str("  eligibility-cannot-vote:\n");
    out.push_str("    backgroundColor: \"{colors.eligibility-cannot-vote}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.md}\"\n");
    out.push_str("  eligibility-neutral:\n");
    out.push_str("    backgroundColor: \"{colors.eligibility-neutral}\"\n");
    out.push_str("    textColor: \"{colors.on-primary}\"\n");
    out.push_str("    rounded: \"{rounded.md}\"\n");
    out.push_str("---\n\n");

    out.push_str("<!--\n");
    out.push_str("  @generated by tran-tokens-codegen — do not edit by hand.\n");
    out.push_str("  Source of truth: crates/rust-core/src/tokens.rs\n");
    out.push_str("  Regenerate: pnpm tokens:sync\n");
    out.push_str(
        "  Format: https://github.com/google-labs-code/design.md (Stitch / coding agents)\n",
    );
    out.push_str("-->\n\n");

    out.push_str("# TRAN Design System\n\n");
    out.push_str("## Overview\n\n");
    out.push_str(
        "TRAN is a cross-platform voting eligibility sample (web + iOS + Android) with a **Rust-first** brand contract. Colors, type, spacing, and radii live in `crates/rust-core/src/tokens.rs` and are projected to CSS, TypeScript, Swift, Kotlin, and this file via `pnpm tokens:sync`.\n\n",
    );
    out.push_str(&format!(
        "The UI should feel **native on each OS**, calm, and trustworthy — platform chrome (SwiftUI / Compose / web atoms) with one shared semantic palette. Default theme mode: **{}**. Registered themes: {}.\n\n",
        snapshot.default_theme, theme_list
    ));
    out.push_str(
        "Upload this `DESIGN.md` to [Google Stitch](https://stitch.withgoogle.com) or keep it in-repo so coding agents apply the same brand without inventing hex values.\n\n",
    );

    out.push_str("## Colors\n\n");
    out.push_str(&format!(
        "Values below mirror the **{}** theme palette (the runtime default). Other themes (`{}`) keep the same token *roles* with different hex values in Rust — switch theme in-app; do not invent parallel palettes in UI code.\n\n",
        snapshot.default_theme, theme_list
    ));
    out.push_str(&format!(
        "- **Primary ({})**: Brand signal and key highlights.\n",
        p.primary
    ));
    out.push_str(&format!(
        "- **Secondary / accent ({})**: Supporting emphasis.\n",
        p.accent
    ));
    out.push_str(&format!(
        "- **Tertiary / action ({})**: AA-safe interactive fill; pair with on-primary ({}).\n",
        p.action, p.onAction
    ));
    out.push_str(&format!(
        "- **Neutral / background ({})** and **surface ({})**: Page and card grounds.\n",
        p.background, p.surface
    ));
    out.push_str(&format!(
        "- **Success ({})** / **error ({})**: Eligibility can-vote / cannot-vote align with these.\n\n",
        p.success, p.danger
    ));

    out.push_str("## Typography\n\n");
    out.push_str(
        "System / SF Pro–first stack with Devanagari fallbacks for en / ne / hi. Prefer semantic roles (`headline-*`, `body-*`, `label-*`) over ad-hoc sizes. Display marketing sizes may use fluid `clamp()` on web; agents should use the concrete `headline-display` token size from YAML.\n\n",
    );

    out.push_str("## Layout\n\n");
    out.push_str(&format!(
        "Spacing is a rem scale (16px root). Touch targets use the **touch** step ({}). Shell content max width is {} with a narrow breakpoint at {}.\n\n",
        sp.touch, ty.shell_max_width, ty.breakpoint_narrow
    ));

    out.push_str("## Elevation & Depth\n\n");
    out.push_str(
        "Depth leans on **Liquid Glass** semantics from Rust (blur + ambient/raised shadows) rather than heavy Material elevation. Prefer tonal layers (background → surface) and soft glass borders over stacked drop shadows.\n\n",
    );

    out.push_str("## Shapes\n\n");
    out.push_str(&format!(
        "Corners are soft-product: sm {}, md {}, lg {}, pill/full {}. Interactive controls default to **md**; cards and sheets to **lg**.\n\n",
        rd.sm, rd.md, rd.lg, rd.pill
    ));

    out.push_str("## Components\n\n");
    out.push_str(
        "- **Primary button**: action fill + on-primary label, md radius — never raw primary hex if action differs.\n",
    );
    out.push_str(
        "- **Danger / cannot-vote**: error fill; eligibility chrome uses eligibility-* tokens.\n",
    );
    out.push_str("- **Cards / panels**: surface background, on-surface text, lg radius.\n");
    out.push_str(
        "- Web: use Tran* atoms and `--tran-*` CSS variables only ([docs/ATOMIC.md](docs/ATOMIC.md)).\n",
    );
    out.push_str(
        "- Native: consume generated BrandTokens / L10n — do not hard-code hex in SwiftUI or Compose.\n\n",
    );

    out.push_str("## Do's and Don'ts\n\n");
    out.push_str("- **Do** change brand values only in `crates/rust-core/src/tokens.rs`, then run `pnpm tokens:sync`.\n");
    out.push_str("- **Do** use semantic roles (action, success, error, eligibility-*) instead of one-off hex.\n");
    out.push_str("- **Do** keep WCAG AA contrast for action fills (enforced in Rust tests).\n");
    out.push_str("- **Don't** hand-edit this file, `theme.css`, or `*/generated/*` BrandTokens.\n");
    out.push_str(
        "- **Don't** branch UI on theme *name* for colors — look up the palette by registry key.\n",
    );
    out.push_str("- **Don't** invent a second design system in Stitch that diverges from these tokens; re-upload after `tokens:sync`.\n");

    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::tokens_json_snapshot;

    #[test]
    fn design_md_includes_required_sections_and_default_palette() {
        let snapshot = tokens_json_snapshot();
        let doc = render_design_md(&snapshot);
        assert!(doc.contains("version: alpha"));
        assert!(doc.contains("name: TRAN"));
        assert!(doc.contains("## Overview"));
        assert!(doc.contains("## Colors"));
        assert!(doc.contains("## Typography"));
        assert!(doc.contains("## Layout"));
        assert!(doc.contains("## Elevation & Depth"));
        assert!(doc.contains("## Shapes"));
        assert!(doc.contains("## Components"));
        assert!(doc.contains("## Do's and Don'ts"));
        assert!(doc.contains("colors:"));
        assert!(doc.contains("typography:"));
        assert!(doc.contains("spacing:"));
        assert!(doc.contains("rounded:"));
        assert!(doc.contains("button-primary:"));
        assert!(doc.contains("@generated by tran-tokens-codegen"));
        let default = default_palette(&snapshot);
        assert!(doc.contains(&default.palette.primary));
    }
}
