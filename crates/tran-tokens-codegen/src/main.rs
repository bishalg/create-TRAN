//! Writes platform design-token artifacts from `rust-core` brand tokens.

use rust_core::tokens::{
    ColorScheme, SpacingTokens, ThemeJson, TokensJsonSnapshot, TypographyTokens,
};
use rust_core::tokens_json_snapshot;
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

/// Shared locale dictionaries and the Android `res/` folder each one feeds.
const LOCALES: [(&str, &str); 3] = [("en", "values"), ("ne", "values-ne"), ("hi", "values-hi")];

type Dictionaries = Vec<(String, BTreeMap<String, String>)>;

fn main() {
    if let Err(err) = run() {
        eprintln!("tran-tokens-codegen: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let root = workspace_root()?;
    let snapshot = tokens_json_snapshot();

    let core_generated = root.join("packages/core-ts/src/generated");
    let web_generated = root.join("apps/web/src/styles/generated");
    let native_generated = root.join("apps/native/src/generated");

    fs::create_dir_all(&core_generated).map_err(|e| e.to_string())?;
    fs::create_dir_all(&web_generated).map_err(|e| e.to_string())?;
    fs::create_dir_all(&native_generated).map_err(|e| e.to_string())?;

    let json_path = core_generated.join("tokens.json");
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    write_file(&json_path, format!("{json}\n"))?;

    let ts_path = core_generated.join("tokens.ts");
    write_file(&ts_path, render_tokens_ts(&snapshot))?;

    let css_path = web_generated.join("theme.css");
    write_file(&css_path, render_theme_css(&snapshot))?;

    let native_path = native_generated.join("brandTokens.ts");
    write_file(&native_path, render_native_stub())?;

    let ios_generated = root.join("apps/ios/Sources/TranVotingDemo/Generated");
    let android_generated = root.join("apps/android/app/src/main/kotlin/com/tran/voting/generated");
    fs::create_dir_all(&ios_generated).map_err(|e| e.to_string())?;
    fs::create_dir_all(&android_generated).map_err(|e| e.to_string())?;

    let swift_path = ios_generated.join("BrandTokens.swift");
    write_file(&swift_path, render_swift_tokens(&snapshot))?;

    let kotlin_path = android_generated.join("BrandTokens.kt");
    write_file(&kotlin_path, render_kotlin_tokens(&snapshot))?;

    let kotlin_strings_path = android_generated.join("TranStrings.kt");
    write_file(&kotlin_strings_path, render_kotlin_strings(&snapshot))?;

    let dictionaries = load_dictionaries(&root.join("packages/core-ts/src/locales"))?;
    let reference = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?;
    verify_android_resource_names(&reference.1)?;

    let xcstrings_path = ios_generated.join("Localizable.xcstrings");
    write_file(&xcstrings_path, render_xcstrings(&dictionaries)?)?;

    println!("tran-tokens-codegen: wrote {}", json_path.display());
    println!("tran-tokens-codegen: wrote {}", ts_path.display());
    println!("tran-tokens-codegen: wrote {}", css_path.display());
    println!("tran-tokens-codegen: wrote {}", native_path.display());
    println!("tran-tokens-codegen: wrote {}", swift_path.display());
    println!("tran-tokens-codegen: wrote {}", kotlin_path.display());
    println!(
        "tran-tokens-codegen: wrote {}",
        kotlin_strings_path.display()
    );
    println!("tran-tokens-codegen: wrote {}", xcstrings_path.display());

    let android_res = root.join("apps/android/app/src/main/res");
    for (locale, res_dir) in LOCALES {
        let dictionary = dictionaries
            .iter()
            .find(|(candidate, _)| candidate == locale)
            .map(|(_, dictionary)| dictionary)
            .ok_or_else(|| format!("no dictionary loaded for locale `{locale}`"))?;
        let directory = android_res.join(res_dir);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let strings_path = directory.join("strings.xml");
        write_file(&strings_path, render_android_strings(dictionary))?;
        println!("tran-tokens-codegen: wrote {}", strings_path.display());
    }
    Ok(())
}

fn workspace_root() -> Result<PathBuf, String> {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let root = manifest
        .parent()
        .and_then(|p| p.parent())
        .ok_or_else(|| "could not resolve workspace root".to_string())?;
    Ok(root.to_path_buf())
}

fn write_file(path: &Path, contents: String) -> Result<(), String> {
    fs::write(path, contents).map_err(|e| format!("write {}: {e}", path.display()))
}

fn render_tokens_ts(snapshot: &TokensJsonSnapshot) -> String {
    let names: Vec<&str> = snapshot
        .themes
        .iter()
        .map(|theme| theme.mode.as_str())
        .collect();
    let quoted: Vec<String> = names.iter().map(|name| format!("'{name}'")).collect();
    let entries: Vec<String> = names
        .iter()
        .enumerate()
        .map(|(index, name)| format!("  {name}: snapshot.themes[{index}] as ThemeTokens,"))
        .collect();

    let mut out = String::from(
        "/**\n * @generated by tran-tokens-codegen — do not edit by hand.\n * Run `pnpm tokens:sync` after changing rust-core tokens.\n */\n\nimport snapshot from './tokens.json' with { type: 'json' };\n\n",
    );
    out.push_str(&format!(
        "export type ThemeMode = {};\n\n",
        quoted.join(" | ")
    ));
    out.push_str(&format!(
        "/** Every palette in the rust-core registry, in picker order. */\nexport const themeNames: readonly ThemeMode[] = [{}];\n\n",
        quoted.join(", ")
    ));
    out.push_str(&format!(
        "/** Palette applied before the user (or OS) has chosen one. */\nexport const defaultTheme: ThemeMode = '{}';\n\nexport interface ThemeTokens {{\n  mode: ThemeMode;\n  colorScheme: 'light' | 'dark';\n  glass: {{\n    background: {{\n      subtle: string;\n      standard: string;\n      prominent: string;\n      dark: string;\n    }};\n    border: {{\n      subtle: string;\n      standard: string;\n      highlight: string;\n    }};\n    blur: {{\n      sm: string;\n      md: string;\n      lg: string;\n      xl: string;\n    }};\n    shadow: {{\n      ambient: string;\n      raised: string;\n      insetGlow: string;\n    }};\n  }};\n  radii: typeof snapshot.radii;\n  palette: {{\n    primary: string;\n    primaryGlow: string;\n    accent: string;\n    success: string;\n    warning: string;\n    danger: string;\n    surface: string;\n    background: string;\n    eligibility: {{\n      canVote: string;\n      cannotVote: string;\n      neutral: string;\n    }};\n    text: {{\n      primary: string;\n      secondary: string;\n      muted: string;\n    }};\n  }};\n}}\n\nexport type LiquidGlassTokens = ThemeTokens;\n\n",
        snapshot.default_theme
    ));
    out.push_str(&format!(
        "export const themeTokens: Record<ThemeMode, ThemeTokens> = {{\n{}\n}};\n\n",
        entries.join("\n")
    ));
    out.push_str(&format!(
        "export function getThemeTokens(mode: ThemeMode = defaultTheme): ThemeTokens {{\n  return themeTokens[mode];\n}}\n\n/** Default export for backward compatibility — the `{mode}` palette. */\nexport const liquidGlassTokens = themeTokens.{mode};\n\nexport const designTypography = snapshot.typography;\nexport const designSpacing = snapshot.spacing;\n",
        mode = snapshot.default_theme
    ));
    out
}

fn render_theme_css(snapshot: &TokensJsonSnapshot) -> String {
    let default_theme = snapshot
        .themes
        .iter()
        .find(|theme| theme.mode == snapshot.default_theme)
        .expect("default theme must exist in snapshot");

    let mut css =
        String::from("/* @generated by tran-tokens-codegen — do not edit by hand. */\n\n");
    css.push_str(":root {\n");
    css.push_str(&render_shared_token_vars(snapshot));
    css.push('\n');
    css.push_str(&theme_vars(default_theme));
    css.push_str(&format!(
        "  color-scheme: {};\n}}\n",
        color_scheme_name(default_theme)
    ));
    for theme in &snapshot.themes {
        css.push_str(&format!("\n[data-theme=\"{}\"] {{\n", theme.mode));
        css.push_str(&theme_vars(theme));
        css.push_str(&format!(
            "  color-scheme: {};\n}}\n",
            color_scheme_name(theme)
        ));
    }
    css
}

fn render_shared_token_vars(snapshot: &TokensJsonSnapshot) -> String {
    let ty = &snapshot.typography;
    let sp = &snapshot.spacing;
    let r = &snapshot.radii;
    format!(
        "  {typography}\n  {spacing}\n  {radii}\n",
        typography = render_typography_vars(ty),
        spacing = render_spacing_vars(sp),
        radii = render_radii_vars(r),
    )
}

fn render_typography_vars(ty: &TypographyTokens) -> String {
    format!(
        "--tran-font-family: {sans};\n  --tran-font-size-sm: {sm};\n  --tran-font-size-md: {md};\n  --tran-font-size-lg: {lg};\n  --tran-font-size-xl: {xl};\n  --tran-font-size-display: {display};\n  --tran-line-height-display: {lh_display};\n  --tran-font-size-title: {title};\n  --tran-line-height-title: {lh_title};\n  --tran-font-size-body: {body};\n  --tran-line-height-body: {lh_body};\n  --tran-font-size-caption: {caption};\n  --tran-line-height-caption: {lh_caption};\n  --tran-font-weight-normal: {wn};\n  --tran-font-weight-semibold: {ws};\n  --tran-font-weight-bold: {wb};\n  --tran-line-height-tight: {tight};\n  --tran-line-height-normal: {normal};\n  --tran-layout-shell-max: {shell_max};\n  --tran-breakpoint-narrow: {breakpoint_narrow};",
        sans = ty.font_family_sans,
        sm = ty.font_size_sm,
        md = ty.font_size_md,
        lg = ty.font_size_lg,
        xl = ty.font_size_xl,
        display = ty.font_size_display,
        lh_display = ty.line_height_display,
        title = ty.font_size_title,
        lh_title = ty.line_height_title,
        body = ty.font_size_body,
        lh_body = ty.line_height_body,
        caption = ty.font_size_caption,
        lh_caption = ty.line_height_caption,
        wn = ty.font_weight_normal,
        ws = ty.font_weight_semibold,
        wb = ty.font_weight_bold,
        tight = ty.line_height_tight,
        normal = ty.line_height_normal,
        shell_max = ty.shell_max_width,
        breakpoint_narrow = ty.breakpoint_narrow,
    )
}

fn render_spacing_vars(sp: &SpacingTokens) -> String {
    format!(
        "--tran-spacing-xxs: {xxs};\n  --tran-spacing-xs: {xs};\n  --tran-spacing-sm: {sm};\n  --tran-spacing-base: {base};\n  --tran-spacing-md: {md};\n  --tran-spacing-lg: {lg};\n  --tran-spacing-xl: {xl};\n  --tran-spacing-2xl: {two_xl};\n  --tran-spacing-touch: {touch};\n  --tran-spacing-nudge: {nudge};",
        xxs = sp.xxs,
        xs = sp.xs,
        sm = sp.sm,
        base = sp.base,
        md = sp.md,
        lg = sp.lg,
        xl = sp.xl,
        two_xl = sp.two_xl,
        touch = sp.touch,
        nudge = sp.nudge,
    )
}

fn render_radii_vars(r: &rust_core::tokens::RadiiTokens) -> String {
    format!(
        "--tran-radius-sm: {sm};\n  --tran-radius-md: {md};\n  --tran-radius-lg: {lg};\n  --tran-radius-pill: {pill};\n  --tran-border-width: {border};\n  --tran-outline-width: {outline};",
        sm = r.sm,
        md = r.md,
        lg = r.lg,
        pill = r.pill,
        border = r.border_width,
        outline = r.outline_width,
    )
}

fn theme_vars(theme: &ThemeJson) -> String {
    let p = &theme.palette;
    format!(
        "  --tran-color-primary: {primary};\n  --tran-color-accent: {accent};\n  --tran-color-success: {success};\n  --tran-color-warning: {warning};\n  --tran-color-danger: {danger};\n  --tran-color-surface: {surface};\n  --tran-color-background: {background};\n  --tran-color-text-primary: {text_primary};\n  --tran-color-text-secondary: {text_secondary};\n  --tran-color-text-muted: {text_muted};\n  --tran-color-eligible: {eligible};\n  --tran-color-ineligible: {ineligible};\n  --tran-color-eligibility-neutral: {neutral};\n  --tran-glass-bg-standard: {glass_std};\n  --tran-glass-border-standard: {glass_border};\n  --tran-glass-shadow-ambient: {shadow_ambient};\n  --tran-glass-shadow-raised: {shadow_raised};\n",
        primary = p.primary,
        accent = p.accent,
        success = p.success,
        warning = p.warning,
        danger = p.danger,
        surface = p.surface,
        background = p.background,
        text_primary = p.text.primary,
        text_secondary = p.text.secondary,
        text_muted = p.text.muted,
        eligible = p.eligibility.canVote,
        ineligible = p.eligibility.cannotVote,
        neutral = p.eligibility.neutral,
        glass_std = theme.glass.background.standard,
        glass_border = theme.glass.border.standard,
        shadow_ambient = theme.glass.shadow.ambient,
        shadow_raised = theme.glass.shadow.raised,
    )
}

fn color_scheme_name(theme: &ThemeJson) -> &'static str {
    match theme.color_scheme {
        ColorScheme::Light => "light",
        ColorScheme::Dark => "dark",
    }
}

fn render_native_stub() -> String {
    r"/**
 * @generated by tran-tokens-codegen — do not edit by hand.
 * Legacy Expo/RN client re-exports @tran/core. Platform-native tokens:
 * apps/ios (SwiftUI) and apps/android (Compose) via `pnpm tokens:sync`.
 */

export {
  getThemeTokens,
  liquidGlassTokens,
  themeTokens,
  type LiquidGlassTokens,
  type ThemeMode,
  type ThemeTokens,
} from '@tran/core';
"
    .to_string()
}

fn render_swift_tokens(snapshot: &TokensJsonSnapshot) -> String {
    let mut out = String::from(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm tokens:sync` after changing rust-core tokens.\n\nimport SwiftUI\n\n",
    );
    out.push_str(
        "extension Color {\n    /// Parses `#RGB`, `#RRGGBB`, or `#RRGGBBAA` brand hex from rust-core.\n    init(tranHex: String) {\n        let hex = tranHex.trimmingCharacters(in: CharacterSet(charactersIn: \"#\"))\n        var value: UInt64 = 0\n        Scanner(string: hex).scanHexInt64(&value)\n        let r, g, b, a: Double\n        switch hex.count {\n        case 3:\n            r = Double((value >> 8) & 0xF) / 15.0\n            g = Double((value >> 4) & 0xF) / 15.0\n            b = Double(value & 0xF) / 15.0\n            a = 1.0\n        case 6:\n            r = Double((value >> 16) & 0xFF) / 255.0\n            g = Double((value >> 8) & 0xFF) / 255.0\n            b = Double(value & 0xFF) / 255.0\n            a = 1.0\n        case 8:\n            r = Double((value >> 24) & 0xFF) / 255.0\n            g = Double((value >> 16) & 0xFF) / 255.0\n            b = Double((value >> 8) & 0xFF) / 255.0\n            a = Double(value & 0xFF) / 255.0\n        default:\n            r = 0; g = 0; b = 0; a = 1.0\n        }\n        self.init(.sRGB, red: r, green: g, blue: b, opacity: a)\n    }\n}\n\n",
    );
    out.push_str(
        "/// Theme ids come from the rust-core registry (`tokens.rs`); screens receive a\n/// palette and never branch on the theme name.\nenum TranTheme: String, CaseIterable, Identifiable {\n",
    );
    for theme in &snapshot.themes {
        out.push_str(&format!("    case {}\n", theme.mode));
    }
    out.push_str("\n    var id: String { rawValue }\n}\n\n");
    out.push_str(
        "struct TranPalette {\n    let primary: Color\n    let accent: Color\n    let success: Color\n    let danger: Color\n    let surface: Color\n    let background: Color\n    let eligibilityCanVote: Color\n    let eligibilityCannotVote: Color\n    let textPrimary: Color\n    let colorScheme: ColorScheme\n}\n\nenum TranBrandTokens {\n",
    );
    for theme in &snapshot.themes {
        let p = &theme.palette;
        out.push_str(&format!(
            "    static let {name} = TranPalette(\n        primary: Color(tranHex: \"{primary}\"),\n        accent: Color(tranHex: \"{accent}\"),\n        success: Color(tranHex: \"{success}\"),\n        danger: Color(tranHex: \"{danger}\"),\n        surface: Color(tranHex: \"{surface}\"),\n        background: Color(tranHex: \"{background}\"),\n        eligibilityCanVote: Color(tranHex: \"{can_vote}\"),\n        eligibilityCannotVote: Color(tranHex: \"{cannot_vote}\"),\n        textPrimary: Color(tranHex: \"{text_primary}\"),\n        colorScheme: {scheme}\n    )\n\n",
            name = theme.mode,
            primary = p.primary,
            accent = p.accent,
            success = p.success,
            danger = p.danger,
            surface = p.surface,
            background = p.background,
            can_vote = p.eligibility.canVote,
            cannot_vote = p.eligibility.cannotVote,
            text_primary = p.text.primary,
            scheme = swift_color_scheme(theme),
        ));
    }
    out.push_str("    static let themes: [TranTheme: TranPalette] = [\n");
    for theme in &snapshot.themes {
        out.push_str(&format!("        .{}: {},\n", theme.mode, theme.mode));
    }
    out.push_str(&format!(
        "    ]\n\n    static func palette(for theme: TranTheme) -> TranPalette {{\n        themes[theme] ?? {}\n    }}\n}}\n",
        snapshot.default_theme
    ));
    out
}

fn swift_color_scheme(theme: &ThemeJson) -> &'static str {
    match theme.color_scheme {
        ColorScheme::Light => ".light",
        ColorScheme::Dark => ".dark",
    }
}

fn render_kotlin_tokens(snapshot: &TokensJsonSnapshot) -> String {
    let mut out = String::from(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm tokens:sync` after changing rust-core tokens.\n\npackage com.tran.voting.generated\n\nimport androidx.compose.material3.ColorScheme\nimport androidx.compose.material3.darkColorScheme\nimport androidx.compose.material3.lightColorScheme\nimport androidx.compose.ui.graphics.Color\n\n",
    );
    out.push_str(
        "private fun tranColor(hex: String): Color {\n    val raw = hex.removePrefix(\"#\")\n    val value = raw.toLong(16)\n    val argb = when (raw.length) {\n        3 -> {\n            val r = ((value shr 8) and 0xF) * 17\n            val g = ((value shr 4) and 0xF) * 17\n            val b = (value and 0xF) * 17\n            (0xFFL shl 24) or (r shl 16) or (g shl 8) or b\n        }\n        6 -> 0xFF000000L or value\n        8 -> ((value and 0xFF) shl 24) or ((value shr 8) and 0xFFFFFF)\n        else -> 0xFF000000L\n    }\n    return Color(argb.toInt())\n}\n\n",
    );
    out.push_str(
        "/** Theme ids come from the rust-core registry (`tokens.rs`); `id` is the source of truth. */\nenum class TranTheme(val id: String) {\n",
    );
    for (index, theme) in snapshot.themes.iter().enumerate() {
        let terminator = if index + 1 == snapshot.themes.len() {
            ""
        } else {
            ","
        };
        out.push_str(&format!(
            "    {}(\"{}\"){}\n",
            pascal_case(&theme.mode).to_uppercase(),
            theme.mode,
            terminator
        ));
    }
    out.push_str("}\n\n");
    out.push_str(
        "/** Semantic palette implemented by every theme; screens receive a palette, never a theme name. */\ninterface BrandPalette {\n    val primary: Color\n    val accent: Color\n    val success: Color\n    val danger: Color\n    val surface: Color\n    val background: Color\n    val eligibilityCanVote: Color\n    val eligibilityCannotVote: Color\n    val textPrimary: Color\n    val isLight: Boolean\n}\n\nobject TranBrandTokens {\n",
    );
    for theme in &snapshot.themes {
        let p = &theme.palette;
        out.push_str(&format!(
            "    object {object_name} : BrandPalette {{\n        override val primary = tranColor(\"{primary}\")\n        override val accent = tranColor(\"{accent}\")\n        override val success = tranColor(\"{success}\")\n        override val danger = tranColor(\"{danger}\")\n        override val surface = tranColor(\"{surface}\")\n        override val background = tranColor(\"{background}\")\n        override val eligibilityCanVote = tranColor(\"{can_vote}\")\n        override val eligibilityCannotVote = tranColor(\"{cannot_vote}\")\n        override val textPrimary = tranColor(\"{text_primary}\")\n        override val isLight = {is_light}\n    }}\n\n",
            object_name = pascal_case(&theme.mode),
            primary = p.primary,
            accent = p.accent,
            success = p.success,
            danger = p.danger,
            surface = p.surface,
            background = p.background,
            can_vote = p.eligibility.canVote,
            cannot_vote = p.eligibility.cannotVote,
            text_primary = p.text.primary,
            is_light = matches!(theme.color_scheme, ColorScheme::Light),
        ));
    }
    out.push_str("    val themes: Map<TranTheme, BrandPalette> = mapOf(\n");
    for theme in &snapshot.themes {
        out.push_str(&format!(
            "        TranTheme.{constant} to {object_name},\n",
            constant = pascal_case(&theme.mode).to_uppercase(),
            object_name = pascal_case(&theme.mode),
        ));
    }
    out.push_str(
        "    )\n\n    fun palette(theme: TranTheme): BrandPalette = themes.getValue(theme)\n}\n\n",
    );
    out.push_str(
        "/** Material shell colours derived from the palette's own light/dark metadata. */\nfun tranColorScheme(palette: BrandPalette): ColorScheme =\n    if (palette.isLight) {\n        lightColorScheme(\n            primary = palette.primary,\n            background = palette.background,\n            surface = palette.surface,\n            onBackground = palette.textPrimary,\n        )\n    } else {\n        darkColorScheme(\n            primary = palette.primary,\n            background = palette.background,\n            surface = palette.surface,\n            onBackground = palette.textPrimary,\n        )\n    }\n",
    );
    out
}

/// Localized theme labels: Kotlin cannot build `R.string` names dynamically, so the
/// generator maps every registry theme to the resource created from its `app.themes.<mode>` key.
fn render_kotlin_strings(snapshot: &TokensJsonSnapshot) -> String {
    let mut out = String::from(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm tokens:sync` after changing the locale dictionaries or themes.\n\npackage com.tran.voting.generated\n\nimport com.tran.voting.R\n\n/** Localized display label for every registry theme, backed by the shared `app.themes.*` keys. */\nval TranTheme.labelRes: Int\n    get() = when (this) {\n",
    );
    for theme in &snapshot.themes {
        out.push_str(&format!(
            "        TranTheme.{} -> R.string.{}\n",
            pascal_case(&theme.mode).to_uppercase(),
            android_resource_name(&format!("app.themes.{}", theme.mode)),
        ));
    }
    out.push_str("    }\n");
    out
}

fn load_dictionaries(dir: &Path) -> Result<Dictionaries, String> {
    let mut dictionaries: Dictionaries = Vec::new();
    for (locale, _) in LOCALES {
        let path = dir.join(format!("{locale}.json"));
        let raw = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
        let document: serde_json::Value =
            serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", path.display()))?;
        let mut flat = BTreeMap::new();
        flatten_dictionary(&document, "", &mut flat)?;
        dictionaries.push((locale.to_string(), flat));
    }

    let reference = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?
        .1
        .clone();
    for (locale, dictionary) in &dictionaries {
        if !dictionary.keys().eq(reference.keys()) {
            return Err(format!(
                "locale `{locale}` does not expose the same keys as the reference locale"
            ));
        }
    }
    Ok(dictionaries)
}

fn flatten_dictionary(
    value: &serde_json::Value,
    prefix: &str,
    out: &mut BTreeMap<String, String>,
) -> Result<(), String> {
    match value {
        serde_json::Value::Object(entries) => {
            for (key, child) in entries {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_dictionary(child, &path, out)?;
            }
            Ok(())
        }
        serde_json::Value::String(text) => {
            out.insert(prefix.to_string(), text.clone());
            Ok(())
        }
        other => Err(format!(
            "locale entry `{prefix}` must be a string, found {other}"
        )),
    }
}

/// iOS String Catalog: one `Localizable.xcstrings` carrying every locale the dictionaries ship.
fn render_xcstrings(dictionaries: &Dictionaries) -> Result<String, String> {
    let reference = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?
        .1
        .clone();
    let mut strings = serde_json::Map::new();
    for key in reference.keys() {
        let mut localizations = serde_json::Map::new();
        for (locale, dictionary) in dictionaries {
            let value = dictionary
                .get(key)
                .ok_or_else(|| format!("locale `{locale}` is missing `{key}`"))?;
            localizations.insert(
                locale.clone(),
                serde_json::json!({ "stringUnit": { "state": "translated", "value": value } }),
            );
        }
        strings.insert(
            key.clone(),
            serde_json::json!({ "localizations": localizations }),
        );
    }
    let catalog = serde_json::json!({
        "sourceLanguage": "en",
        "strings": strings,
        "version": "1.0",
    });
    let mut json = serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?;
    json.push('\n');
    Ok(json)
}

fn verify_android_resource_names(dictionary: &BTreeMap<String, String>) -> Result<(), String> {
    let mut seen: BTreeMap<String, String> = BTreeMap::new();
    for key in dictionary.keys() {
        let name = android_resource_name(key);
        if let Some(existing) = seen.insert(name.clone(), key.clone()) {
            return Err(format!(
                "Android resource `{name}` would be generated twice (`{existing}` and `{key}`)"
            ));
        }
    }
    Ok(())
}

fn render_android_strings(dictionary: &BTreeMap<String, String>) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!-- @generated by tran-tokens-codegen — do not edit by hand. -->\n<resources>\n",
    );
    for (key, value) in dictionary {
        out.push_str(&format!(
            "    <string name=\"{}\">{}</string>\n",
            android_resource_name(key),
            android_escape(value)
        ));
    }
    out.push_str("</resources>\n");
    out
}

/// `native.checkOffline` → `native_check_offline` (Android resource names are lowercase snake_case).
fn android_resource_name(key: &str) -> String {
    let mut out = String::with_capacity(key.len() + 8);
    for character in key.chars() {
        match character {
            '.' => out.push('_'),
            'A'..='Z' => {
                out.push('_');
                out.push(character.to_ascii_lowercase());
            }
            other => out.push(other),
        }
    }
    out
}

/// Escapes the characters Android treats specially inside `<string>` values.
fn android_escape(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for (index, character) in value.chars().enumerate() {
        match character {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\'' => out.push_str("\\'"),
            '"' => out.push_str("\\\""),
            '@' | '?' if index == 0 => {
                out.push('\\');
                out.push(character);
            }
            other => out.push(other),
        }
    }
    out
}

fn pascal_case(mode: &str) -> String {
    mode.split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            let first = chars
                .next()
                .unwrap_or_default()
                .to_uppercase()
                .collect::<String>();
            first + chars.as_str()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn android_resource_names_are_lowercase_snake_case() {
        assert_eq!(
            android_resource_name("native.checkOffline"),
            "native_check_offline"
        );
        assert_eq!(
            android_resource_name("app.themes.sepia"),
            "app_themes_sepia"
        );
        assert_eq!(android_resource_name("layers.tanstack"), "layers_tanstack");
    }

    #[test]
    fn android_escaping_covers_aapt_specials() {
        assert_eq!(
            android_escape("Global Rules & Parity Verification"),
            "Global Rules &amp; Parity Verification"
        );
        assert_eq!(android_escape("%1$d years"), "%1$d years");
        assert_eq!(android_escape("it's fine"), "it\\'s fine");
        assert_eq!(android_escape("@launch"), "\\@launch");
        assert_eq!(android_escape("ready?"), "ready?");
    }

    #[test]
    fn flattening_uses_dotted_keys() {
        let document: serde_json::Value = serde_json::json!({
            "app": { "themes": { "light": "Light" }, "title": "TRAN" }
        });
        let mut flat = BTreeMap::new();
        flatten_dictionary(&document, "", &mut flat).expect("flatten");
        assert_eq!(flat.len(), 2);
        assert_eq!(
            flat.get("app.themes.light").map(String::as_str),
            Some("Light")
        );
    }

    #[test]
    fn flattening_rejects_non_string_leaves() {
        let document: serde_json::Value = serde_json::json!({ "app": { "count": 3 } });
        let mut flat = BTreeMap::new();
        assert!(flatten_dictionary(&document, "", &mut flat).is_err());
    }
}
