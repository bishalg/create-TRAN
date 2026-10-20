//! Writes platform design-token artifacts from `rust-core` brand tokens.
//!
//! Destinations and Android package names come from
//! `tooling/design-tokens/codegen.json` (ADR-0025).

use rust_core::tokens::{
    ColorScheme, SpacingTokens, ThemeJson, TokensJsonSnapshot, TypographyTokens,
};
use rust_core::tokens_json_snapshot;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use tran_tokens_codegen::{render_design_md, render_rules_ts, CodegenConfig};

/// Base language under `locales/`. Other locales fall back to it at runtime: web in `t()`,
/// iOS through the String Catalog development language, Android through the default `values/`.
const BASE_LOCALE: &str = "en";

/// One locale's dictionaries: module name → module-relative flat keys (`welcome.title`).
type ModuleKeys = BTreeMap<String, String>;

struct Dictionary {
    locale: String,
    modules: BTreeMap<String, ModuleKeys>,
}

type Locales = Vec<Dictionary>;

fn main() {
    if let Err(err) = run() {
        eprintln!("tran-tokens-codegen: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let root = workspace_root()?;
    let config = CodegenConfig::load_for_workspace(&root)?;
    let paths = config.resolve(&root);
    let snapshot = tokens_json_snapshot();

    fs::create_dir_all(&paths.core_generated_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&paths.web_generated_dir).map_err(|e| e.to_string())?;

    let json_path = paths.core_generated_dir.join("tokens.json");
    let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
    write_file(&json_path, format!("{json}\n"))?;

    let ts_path = paths.core_generated_dir.join("tokens.ts");
    write_file(&ts_path, render_tokens_ts(&snapshot))?;

    let rules_path = paths.core_generated_dir.join("rules.ts");
    write_file(&rules_path, render_rules_ts())?;

    let css_path = paths.web_generated_dir.join("theme.css");
    write_file(&css_path, render_theme_css(&snapshot))?;

    fs::create_dir_all(&paths.ios_generated_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(&paths.android_kotlin_generated_dir).map_err(|e| e.to_string())?;

    let swift_path = paths.ios_generated_dir.join("BrandTokens.swift");
    write_file(&swift_path, render_swift_tokens(&snapshot))?;

    let kotlin_path = paths.android_kotlin_generated_dir.join("BrandTokens.kt");
    write_file(
        &kotlin_path,
        render_kotlin_tokens(&snapshot, &paths.android_kotlin_package),
    )?;

    if let Some(parent) = paths.design_md_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_file(&paths.design_md_path, render_design_md(&snapshot))?;

    let kotlin_strings_path = paths.android_kotlin_generated_dir.join("TranStrings.kt");

    println!("tran-tokens-codegen: wrote {}", json_path.display());
    println!("tran-tokens-codegen: wrote {}", ts_path.display());
    println!("tran-tokens-codegen: wrote {}", rules_path.display());
    println!("tran-tokens-codegen: wrote {}", css_path.display());
    println!("tran-tokens-codegen: wrote {}", swift_path.display());
    println!("tran-tokens-codegen: wrote {}", kotlin_path.display());
    println!(
        "tran-tokens-codegen: wrote {}",
        paths.design_md_path.display()
    );

    let dictionaries = load_locales(&paths.locales_dir)?;
    let base = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?;
    verify_no_duplicate_values(base)?;
    verify_generated_names(base)?;
    verify_theme_labels(base, &snapshot)?;

    let strings_path = paths.core_generated_dir.join("strings.json");
    write_file(&strings_path, render_translations_json(&dictionaries)?)?;

    let keys_path = paths.core_generated_dir.join("keys.ts");
    write_file(&keys_path, render_ts_keys(&dictionaries))?;

    let ios_strings = paths.ios_generated_dir.join("Strings");
    fs::create_dir_all(&ios_strings).map_err(|e| e.to_string())?;
    let mut ios_kept = BTreeSet::new();
    for module in base.modules.keys() {
        let table = pascal_case(module);
        let catalog_path = ios_strings.join(format!("{table}.xcstrings"));
        write_file(&catalog_path, render_xcstrings(&dictionaries, module)?)?;
        ios_kept.insert(catalog_path);
    }
    for stale in prune_files(&ios_strings, &ios_kept, &|name| {
        name.ends_with(".xcstrings")
    })? {
        println!("tran-tokens-codegen: removed stale {stale}");
    }
    // The pre-module layout lived in a single `Generated/Localizable.xcstrings`.
    for stale in prune_files(&paths.ios_generated_dir, &BTreeSet::new(), &|name| {
        name.ends_with(".xcstrings")
    })? {
        println!("tran-tokens-codegen: removed stale {stale}");
    }
    write_file(
        &paths.ios_generated_dir.join("L10n.swift"),
        render_l10n_swift(base, &snapshot)?,
    )?;

    let mut android_kept = BTreeSet::new();
    for dictionary in &dictionaries {
        let directory = paths
            .android_res_dir
            .join(android_resource_dir(&dictionary.locale)?);
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        for (module, keys) in &dictionary.modules {
            let path = directory.join(format!("strings_{module}.xml"));
            write_file(&path, render_android_module_strings(module, keys))?;
            android_kept.insert(path);
        }
    }
    for stale in prune_android_resources(&paths.android_res_dir, &android_kept)? {
        println!("tran-tokens-codegen: removed stale {stale}");
    }
    write_file(
        &kotlin_strings_path,
        render_kotlin_strings(
            base,
            &snapshot,
            &paths.android_kotlin_package,
            &paths.android_app_package,
        )?,
    )?;

    println!(
        "tran-tokens-codegen: wrote {} String Catalogs and L10n.swift (iOS)",
        ios_kept.len()
    );
    println!(
        "tran-tokens-codegen: wrote {} string resource files and TranStrings.kt (Android)",
        android_kept.len()
    );
    println!(
        "tran-tokens-codegen: wrote {} and {}",
        strings_path.display(),
        keys_path.display()
    );
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
        "/** Palette applied before the user (or OS) has chosen one. */\nexport const defaultTheme: ThemeMode = '{}';\n\nexport interface ThemeTokens {{\n  mode: ThemeMode;\n  colorScheme: 'light' | 'dark';\n  glass: {{\n    background: {{\n      subtle: string;\n      standard: string;\n      prominent: string;\n      dark: string;\n    }};\n    border: {{\n      subtle: string;\n      standard: string;\n      highlight: string;\n    }};\n    blur: {{\n      sm: string;\n      md: string;\n      lg: string;\n      xl: string;\n    }};\n    shadow: {{\n      ambient: string;\n      raised: string;\n      insetGlow: string;\n    }};\n  }};\n  radii: typeof snapshot.radii;\n  palette: {{\n    primary: string;\n    action: string;\n    onAction: string;\n    primaryGlow: string;\n    accent: string;\n    success: string;\n    warning: string;\n    danger: string;\n    surface: string;\n    background: string;\n    eligibility: {{\n      canVote: string;\n      cannotVote: string;\n      neutral: string;\n    }};\n    text: {{\n      primary: string;\n      secondary: string;\n      muted: string;\n    }};\n  }};\n}}\n\nexport type LiquidGlassTokens = ThemeTokens;\n\n",
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
        "  --tran-color-primary: {primary};\n  --tran-color-action: {action};\n  --tran-color-on-action: {on_action};\n  --tran-color-accent: {accent};\n  --tran-color-success: {success};\n  --tran-color-warning: {warning};\n  --tran-color-danger: {danger};\n  --tran-color-surface: {surface};\n  --tran-color-background: {background};\n  --tran-color-text-primary: {text_primary};\n  --tran-color-text-secondary: {text_secondary};\n  --tran-color-text-muted: {text_muted};\n  --tran-color-eligible: {eligible};\n  --tran-color-ineligible: {ineligible};\n  --tran-color-eligibility-neutral: {neutral};\n  --tran-glass-bg-standard: {glass_std};\n  --tran-glass-border-standard: {glass_border};\n  --tran-glass-shadow-ambient: {shadow_ambient};\n  --tran-glass-shadow-raised: {shadow_raised};\n",
        primary = p.primary,
        action = p.action,
        on_action = p.onAction,
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
        "struct TranPalette {\n    let primary: Color\n    let action: Color\n    let onAction: Color\n    let accent: Color\n    let success: Color\n    let danger: Color\n    let surface: Color\n    let background: Color\n    let eligibilityCanVote: Color\n    let eligibilityCannotVote: Color\n    let textPrimary: Color\n    let colorScheme: ColorScheme\n}\n\nenum TranBrandTokens {\n",
    );
    for theme in &snapshot.themes {
        let p = &theme.palette;
        out.push_str(&format!(
            "    static let {name} = TranPalette(\n        primary: Color(tranHex: \"{primary}\"),\n        action: Color(tranHex: \"{action}\"),\n        onAction: Color(tranHex: \"{on_action}\"),\n        accent: Color(tranHex: \"{accent}\"),\n        success: Color(tranHex: \"{success}\"),\n        danger: Color(tranHex: \"{danger}\"),\n        surface: Color(tranHex: \"{surface}\"),\n        background: Color(tranHex: \"{background}\"),\n        eligibilityCanVote: Color(tranHex: \"{can_vote}\"),\n        eligibilityCannotVote: Color(tranHex: \"{cannot_vote}\"),\n        textPrimary: Color(tranHex: \"{text_primary}\"),\n        colorScheme: {scheme}\n    )\n\n",
            name = theme.mode,
            primary = p.primary,
            action = p.action,
            on_action = p.onAction,
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
    out.push_str(&render_swift_scale(snapshot));
    out
}

fn swift_color_scheme(theme: &ThemeJson) -> &'static str {
    match theme.color_scheme {
        ColorScheme::Light => ".light",
        ColorScheme::Dark => ".dark",
    }
}

fn render_kotlin_tokens(snapshot: &TokensJsonSnapshot, kotlin_package: &str) -> String {
    let mut out = format!(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm tokens:sync` after changing rust-core tokens.\n\npackage {kotlin_package}\n\nimport androidx.compose.material3.ColorScheme\nimport androidx.compose.material3.darkColorScheme\nimport androidx.compose.material3.lightColorScheme\nimport androidx.compose.ui.graphics.Color\nimport androidx.compose.ui.unit.Dp\nimport androidx.compose.ui.unit.dp\n\n",
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
        "/** Semantic palette implemented by every theme; screens receive a palette, never a theme name. */\ninterface BrandPalette {\n    val primary: Color\n    val action: Color\n    val onAction: Color\n    val accent: Color\n    val success: Color\n    val danger: Color\n    val surface: Color\n    val background: Color\n    val eligibilityCanVote: Color\n    val eligibilityCannotVote: Color\n    val textPrimary: Color\n    val isLight: Boolean\n}\n\nobject TranBrandTokens {\n",
    );
    for theme in &snapshot.themes {
        let p = &theme.palette;
        out.push_str(&format!(
            "    object {object_name} : BrandPalette {{\n        override val primary = tranColor(\"{primary}\")\n        override val action = tranColor(\"{action}\")\n        override val onAction = tranColor(\"{on_action}\")\n        override val accent = tranColor(\"{accent}\")\n        override val success = tranColor(\"{success}\")\n        override val danger = tranColor(\"{danger}\")\n        override val surface = tranColor(\"{surface}\")\n        override val background = tranColor(\"{background}\")\n        override val eligibilityCanVote = tranColor(\"{can_vote}\")\n        override val eligibilityCannotVote = tranColor(\"{cannot_vote}\")\n        override val textPrimary = tranColor(\"{text_primary}\")\n        override val isLight = {is_light}\n    }}\n\n",
            object_name = pascal_case(&theme.mode),
            primary = p.primary,
            action = p.action,
            on_action = p.onAction,
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
        "/** Material shell colours derived from the palette's own light/dark metadata. Actions use the\n * palette's AA-safe action pair, so every Material button inherits readable fill and label. */\nfun tranColorScheme(palette: BrandPalette): ColorScheme =\n    if (palette.isLight) {\n        lightColorScheme(\n            primary = palette.action,\n            onPrimary = palette.onAction,\n            background = palette.background,\n            surface = palette.surface,\n            onBackground = palette.textPrimary,\n        )\n    } else {\n        darkColorScheme(\n            primary = palette.action,\n            onPrimary = palette.onAction,\n            background = palette.background,\n            surface = palette.surface,\n            onBackground = palette.textPrimary,\n        )\n    }\n",
    );
    out.push_str(&render_kotlin_scale(snapshot));
    out
}

/// Typed Android accessors: Kotlin cannot build `R.string` names dynamically, so every
/// dictionary key becomes a `@StringRes` constant grouped by module, plus the registry
/// theme → label-resource mapping the theme pickers need.
fn render_kotlin_strings(
    base: &Dictionary,
    snapshot: &TokensJsonSnapshot,
    kotlin_package: &str,
    app_package: &str,
) -> Result<String, String> {
    let mut out = format!(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm i18n:sync` after changing `locales/`.\n\npackage {kotlin_package}\n\nimport androidx.annotation.StringRes\nimport {app_package}.R\n\n/** Typed string resources generated from `locales/`; English is the base language. */\nobject TranStrings {{\n",
    );
    for (module, keys) in &base.modules {
        out.push_str(&format!("    object {} {{\n", pascal_case(module)));
        for relative in keys.keys() {
            let full = full_key(module, relative);
            out.push_str(&format!(
                "        @StringRes\n        val {}: Int = R.string.{} // {full}\n",
                member_name(relative),
                android_resource_name(&full),
            ));
        }
        out.push_str("    }\n\n");
    }
    out.push_str("}\n");
    out.push_str(
        "\n/** Localized display label for every registry theme, backed by the `shell.theme.*` keys. */\nval TranTheme.labelRes: Int\n    get() = when (this) {\n",
    );
    for theme in &snapshot.themes {
        out.push_str(&format!(
            "        TranTheme.{} -> R.string.{}\n",
            pascal_case(&theme.mode).to_uppercase(),
            android_resource_name(&format!("shell.theme.{}", theme.mode)),
        ));
    }
    out.push_str("    }\n");
    Ok(out)
}

/// Typed Swift accessors: one enum per module, one member per key, resolved through the
/// generated String Catalog table for that module.
fn render_l10n_swift(base: &Dictionary, snapshot: &TokensJsonSnapshot) -> Result<String, String> {
    let mut out = String::from(
        "// @generated by tran-tokens-codegen — do not edit by hand.\n// Run `pnpm i18n:sync` after changing `locales/`.\n\nimport Foundation\n\n/// Typed accessors for every string in `locales/`; English is the base language and\n/// missing translations fall back to it through the String Catalogs.\nenum L10n {\n",
    );
    for (module, keys) in &base.modules {
        let table = pascal_case(module);
        out.push_str(&format!("    enum {table} {{\n"));
        for (relative, value) in keys {
            let full = full_key(module, relative);
            let member = member_name(relative);
            let names = placeholders(value);
            if names.is_empty() {
                out.push_str(&format!(
                    "        static var {member}: String {{ String(localized: \"{full}\", table: \"{table}\") }}\n"
                ));
            } else {
                let parameters: Vec<String> = names
                    .iter()
                    .map(|name| format!("_ {name}: String"))
                    .collect();
                out.push_str(&format!(
                    "        static func {member}({}) -> String {{\n            String(format: String(localized: \"{full}\", table: \"{table}\"), {})\n        }}\n",
                    parameters.join(", "),
                    names.join(", "),
                ));
            }
        }
        out.push_str("    }\n\n");
    }
    out.push_str("}\n");
    out.push_str(
        "\nextension TranTheme {\n    /// Localized display label backed by the `shell.theme.*` dictionary keys.\n    var label: String {\n        switch self {\n",
    );
    for theme in &snapshot.themes {
        out.push_str(&format!(
            "        case .{mode}: return L10n.Shell.theme{label}\n",
            mode = theme.mode,
            label = pascal_case(&theme.mode),
        ));
    }
    out.push_str("        }\n    }\n}\n");
    Ok(out)
}

/// Reads `locales/<locale>/<module>.json`. Module set, key set and placeholder sets must be
/// identical across locales, and values must be non-empty `{name}`-placeholder templates.
fn load_locales(dir: &Path) -> Result<Locales, String> {
    let mut locale_ids = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("read {}: {e}", dir.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path().is_dir() {
            locale_ids.push(entry.file_name().to_string_lossy().into_owned());
        }
    }
    if !locale_ids.iter().any(|id| id == BASE_LOCALE) {
        return Err(format!(
            "`locales/{BASE_LOCALE}` is the base language and must exist"
        ));
    }
    locale_ids.sort();
    locale_ids.sort_by_key(|id| id != BASE_LOCALE);

    let mut dictionaries: Locales = Vec::new();
    for locale in locale_ids {
        let locale_dir = dir.join(&locale);
        let mut module_names = Vec::new();
        for entry in fs::read_dir(&locale_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if path
                .extension()
                .is_some_and(|extension| extension == "json")
            {
                module_names.push(
                    path.file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .into_owned(),
                );
            }
        }
        module_names.sort();
        if module_names.is_empty() {
            return Err(format!("`locales/{locale}` has no module files"));
        }
        let mut modules = BTreeMap::new();
        for module in module_names {
            let path = locale_dir.join(format!("{module}.json"));
            let raw =
                fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
            let document: serde_json::Value =
                serde_json::from_str(&raw).map_err(|e| format!("parse {}: {e}", path.display()))?;
            let mut keys = BTreeMap::new();
            flatten_module(&document, "", &mut keys)?;
            for (relative, value) in &keys {
                let full = full_key(&module, relative);
                if value.trim().is_empty() {
                    return Err(format!(
                        "`locales/{locale}/{module}.json`: `{full}` is empty"
                    ));
                }
                if value.contains('%') {
                    return Err(format!(
                        "`locales/{locale}/{module}.json`: `{full}` must use named placeholders (`{{name}}`), not `%`"
                    ));
                }
                validate_placeholders(&full, value)?;
            }
            modules.insert(module, keys);
        }
        dictionaries.push(Dictionary { locale, modules });
    }

    let base = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?;
    for dictionary in &dictionaries[1..] {
        for module in base.modules.keys() {
            if !dictionary.modules.contains_key(module) {
                return Err(format!(
                    "`locales/{}/{module}.json` is missing (the base language `{BASE_LOCALE}` defines it)",
                    dictionary.locale
                ));
            }
        }
        for (module, keys) in &dictionary.modules {
            let base_keys = base.modules.get(module).ok_or_else(|| {
                format!(
                    "`locales/{}/{module}.json` has no `{BASE_LOCALE}` counterpart",
                    dictionary.locale
                )
            })?;
            for (relative, value) in keys {
                let full = full_key(module, relative);
                let base_value = base_keys.get(relative).ok_or_else(|| {
                    format!(
                        "`locales/{}/{module}.json` has a key `{full}` that `{BASE_LOCALE}` does not define",
                        dictionary.locale
                    )
                })?;
                if placeholders(value) != placeholders(base_value) {
                    return Err(format!(
                        "`{full}` placeholders must match `{BASE_LOCALE}`: `{value}` vs `{base_value}`"
                    ));
                }
            }
            for relative in base_keys.keys() {
                if !keys.contains_key(relative) {
                    return Err(format!(
                        "`locales/{}/{module}.json` is missing `{}`",
                        dictionary.locale,
                        full_key(module, relative)
                    ));
                }
            }
        }
    }
    Ok(dictionaries)
}

/// Flattens one module file into module-relative dotted keys (`welcome.title`).
fn flatten_module(
    value: &serde_json::Value,
    prefix: &str,
    out: &mut ModuleKeys,
) -> Result<(), String> {
    match value {
        serde_json::Value::Object(entries) => {
            for (key, child) in entries {
                let path = if prefix.is_empty() {
                    key.clone()
                } else {
                    format!("{prefix}.{key}")
                };
                flatten_module(child, &path, out)?;
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

/// Named `{placeholder}` tokens in order of first appearance; repeated names keep one entry.
fn placeholders(value: &str) -> Vec<String> {
    let mut names: Vec<String> = Vec::new();
    let mut rest = value;
    while let Some(start) = rest.find('{') {
        let after = &rest[start + 1..];
        let Some(end) = after.find('}') else { break };
        let name = &after[..end];
        if !names.iter().any(|seen| seen == name) {
            names.push(name.to_string());
        }
        rest = &after[end + 1..];
    }
    names
}

/// Rejects braces that are not a single `{name}` token and names that are not identifiers.
fn validate_placeholders(key: &str, value: &str) -> Result<(), String> {
    let mut stripped = value.to_string();
    for name in placeholders(value) {
        let valid = name.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
            && name.chars().all(|c| c.is_ascii_alphanumeric());
        if !valid {
            return Err(format!(
                "`{key}`: placeholder `{{{name}}}` must be a camelCase identifier"
            ));
        }
        stripped = stripped.replace(&format!("{{{name}}}"), "");
    }
    if stripped.contains('{') || stripped.contains('}') {
        return Err(format!("`{key}`: unbalanced braces in `{value}`"));
    }
    Ok(())
}

/// `TRAN / {platform}` → `TRAN / %1$@` (iOS) or `%1$s` (Android); repeated names reuse the index.
fn positional_template(value: &str, conversion: char) -> String {
    let mut out = value.to_string();
    for (index, name) in placeholders(value).iter().enumerate() {
        out = out.replace(
            &format!("{{{name}}}"),
            &format!("%{}${conversion}", index + 1),
        );
    }
    out
}

fn full_key(module: &str, relative: &str) -> String {
    format!("{module}.{relative}")
}

/// `welcome.title` → `welcomeTitle`; the member name shared by the Swift and Kotlin accessors.
fn member_name(relative: &str) -> String {
    let mut out = String::new();
    for (index, part) in relative.split('.').enumerate() {
        if index == 0 {
            out.push_str(part);
        } else {
            out.push_str(&pascal_case(part));
        }
    }
    out
}

/// English is the base language: a value shared by two modules belongs in `common`.
fn verify_no_duplicate_values(base: &Dictionary) -> Result<(), String> {
    let mut seen: BTreeMap<&str, (String, String)> = BTreeMap::new();
    for (module, keys) in &base.modules {
        for (relative, value) in keys {
            let full = full_key(module, relative);
            match seen.get(value.as_str()) {
                Some((other_module, other_key)) if other_module != module => {
                    return Err(format!(
                        "`{value}` is defined in both `{other_key}` and `{full}`; keep one shared key in `common`"
                    ));
                }
                Some(_) => {}
                None => {
                    seen.insert(value, (module.clone(), full));
                }
            }
        }
    }
    Ok(())
}

/// Android resource names and Swift/Kotlin member names must be unique after key folding.
fn verify_generated_names(base: &Dictionary) -> Result<(), String> {
    let mut resources: BTreeMap<String, String> = BTreeMap::new();
    for (module, keys) in &base.modules {
        let mut members: BTreeMap<String, String> = BTreeMap::new();
        for relative in keys.keys() {
            let full = full_key(module, relative);
            let resource = android_resource_name(&full);
            if let Some(existing) = resources.insert(resource.clone(), full.clone()) {
                return Err(format!(
                    "Android resource `{resource}` would be generated twice (`{existing}` and `{full}`)"
                ));
            }
            let member = member_name(relative);
            if let Some(existing) = members.insert(member.clone(), full.clone()) {
                return Err(format!(
                    "member `{module}.{member}` would be generated twice (`{existing}` and `{full}`)"
                ));
            }
        }
    }
    Ok(())
}

/// Every registry theme needs a `shell.theme.<mode>` label key so the pickers can localize.
fn verify_theme_labels(base: &Dictionary, snapshot: &TokensJsonSnapshot) -> Result<(), String> {
    let shell = base
        .modules
        .get("shell")
        .ok_or_else(|| "`locales/<locale>/shell.json` is required for theme labels".to_string())?;
    for theme in &snapshot.themes {
        let relative = format!("theme.{}", theme.mode);
        if !shell.contains_key(&relative) {
            return Err(format!(
                "theme `{}` needs `shell.{relative}` in `locales/{BASE_LOCALE}/shell.json`",
                theme.mode
            ));
        }
    }
    Ok(())
}

/// One iOS String Catalog per module; `{name}` placeholders become positional `%n$@` templates.
fn render_xcstrings(dictionaries: &Locales, module: &str) -> Result<String, String> {
    let base = dictionaries
        .first()
        .ok_or_else(|| "no locale dictionaries loaded".to_string())?;
    let base_keys = base
        .modules
        .get(module)
        .ok_or_else(|| format!("`{BASE_LOCALE}` has no `{module}` module"))?;
    let mut strings = serde_json::Map::new();
    for relative in base_keys.keys() {
        let full = full_key(module, relative);
        let mut localizations = serde_json::Map::new();
        for dictionary in dictionaries {
            let value = dictionary
                .modules
                .get(module)
                .and_then(|keys| keys.get(relative))
                .ok_or_else(|| format!("locale `{}` is missing `{full}`", dictionary.locale))?;
            localizations.insert(
                dictionary.locale.clone(),
                serde_json::json!({
                    "stringUnit": { "state": "translated", "value": positional_template(value, '@') }
                }),
            );
        }
        strings.insert(full, serde_json::json!({ "localizations": localizations }));
    }
    let catalog = serde_json::json!({
        "sourceLanguage": BASE_LOCALE,
        "strings": strings,
        "version": "1.0",
    });
    let mut json = serde_json::to_string_pretty(&catalog).map_err(|e| e.to_string())?;
    json.push('\n');
    Ok(json)
}

/// `packages/core-ts/src/generated/strings.json`: locale → full key → value.
fn render_translations_json(locales: &Locales) -> Result<String, String> {
    let mut document = serde_json::Map::new();
    for dictionary in locales {
        let mut entries = serde_json::Map::new();
        for (module, keys) in &dictionary.modules {
            for (relative, value) in keys {
                entries.insert(
                    full_key(module, relative),
                    serde_json::Value::String(value.clone()),
                );
            }
        }
        document.insert(
            dictionary.locale.clone(),
            serde_json::Value::Object(entries),
        );
    }
    let mut json = serde_json::to_string_pretty(&serde_json::Value::Object(document))
        .map_err(|e| e.to_string())?;
    json.push('\n');
    Ok(json)
}

/// `packages/core-ts/src/generated/keys.ts`: the locale list plus the `TranStringKey` union.
/// Typed keys keep web/RN call sites honest — an invented key is a compile error.
fn render_ts_keys(locales: &Locales) -> String {
    let mut out = String::from(
        "/**\n * @generated by tran-tokens-codegen — do not edit by hand.\n * Run `pnpm i18n:sync` after changing `locales/`.\n */\n\n",
    );
    let ids: Vec<String> = locales
        .iter()
        .map(|dictionary| format!("'{}'", dictionary.locale))
        .collect();
    out.push_str(&format!(
        "export const TRAN_LOCALES = [{}] as const;\n\n",
        ids.join(", ")
    ));
    out.push_str("export type SupportedLocale = (typeof TRAN_LOCALES)[number];\n\n");
    let base = &locales[0];
    let keys: Vec<String> = base
        .modules
        .iter()
        .flat_map(|(module, keys)| {
            let module = module.clone();
            keys.keys()
                .map(move |relative| full_key(&module, relative))
                .collect::<Vec<_>>()
        })
        .collect();
    out.push_str(
        "/** Every key in `locales/<locale>/*.json`: `<module>.<group>.<name>`. */\nexport type TranStringKey =\n",
    );
    for (index, key) in keys.iter().enumerate() {
        let terminator = if index + 1 == keys.len() { ";" } else { "" };
        out.push_str(&format!("  | '{key}'{terminator}\n"));
    }
    out
}

/// Android resource folder name: `en` → `values`, `ne` → `values-ne`, `en-GB` → `values-b+en+GB`.
fn android_resource_dir(locale: &str) -> Result<String, String> {
    let mut parts = locale.split('-');
    let language = parts.next().unwrap_or_default();
    let region = parts.next();
    let invalid =
        || format!("`locales/{locale}` is not a valid locale folder name (use `en` or `en-GB`)");
    if parts.next().is_some()
        || language.len() != 2
        || !language.chars().all(|c| c.is_ascii_lowercase())
    {
        return Err(invalid());
    }
    match region {
        None => Ok(if locale == BASE_LOCALE {
            "values".to_string()
        } else {
            format!("values-{locale}")
        }),
        Some(region) if region.len() == 2 && region.chars().all(|c| c.is_ascii_uppercase()) => {
            Ok(format!("values-b+{}", locale.replace('-', "+")))
        }
        Some(_) => Err(invalid()),
    }
}

/// Deletes files this generator used to write and no longer does (stale locales/modules),
/// then removes the folder when nothing is left in it.
fn prune_files(
    dir: &Path,
    keep: &BTreeSet<PathBuf>,
    matches: &dyn Fn(&str) -> bool,
) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    if !dir.exists() {
        return Ok(removed);
    }
    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() && matches(&entry.file_name().to_string_lossy()) && !keep.contains(&path)
        {
            fs::remove_file(&path).map_err(|e| format!("remove {}: {e}", path.display()))?;
            removed.push(path.display().to_string());
        }
    }
    if fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .next()
        .is_none()
    {
        fs::remove_dir(dir).map_err(|e| format!("remove {}: {e}", dir.display()))?;
    }
    Ok(removed)
}

/// Prunes `strings*.xml` files in every `res/values*` folder that this run did not write.
fn prune_android_resources(res: &Path, keep: &BTreeSet<PathBuf>) -> Result<Vec<String>, String> {
    let mut removed = Vec::new();
    for entry in fs::read_dir(res).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.path().is_dir() || !name.starts_with("values") {
            continue;
        }
        removed.extend(prune_files(&entry.path(), keep, &|file| {
            file.starts_with("strings") && file.ends_with(".xml")
        })?);
    }
    Ok(removed)
}

/// One Android resource file per module; `{name}` placeholders become positional `%n$s`.
fn render_android_module_strings(module: &str, keys: &ModuleKeys) -> String {
    let mut out = String::from(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<!-- @generated by tran-tokens-codegen — do not edit by hand. Run `pnpm i18n:sync`. -->\n<resources>\n",
    );
    for (relative, value) in keys {
        out.push_str(&format!(
            "    <string name=\"{}\">{}</string>\n",
            android_resource_name(&full_key(module, relative)),
            android_escape(&positional_template(value, 's')),
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

/// Spacing and radius scale entries as `(member, points)`, in the order they are declared.
/// Points equal CSS px at the 16px root, and dp on Android.
fn scale_entries(snapshot: &TokensJsonSnapshot) -> Result<Vec<(&'static str, f64)>, String> {
    let sp = &snapshot.spacing;
    let raw = [
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
    ];
    raw.into_iter()
        .map(|(name, value)| Ok((name, css_length_to_points(value)?)))
        .collect()
}

fn radius_entries(snapshot: &TokensJsonSnapshot) -> Result<Vec<(&'static str, f64)>, String> {
    let r = &snapshot.radii;
    [("sm", &r.sm), ("md", &r.md), ("lg", &r.lg)]
        .into_iter()
        .map(|(name, value)| Ok((name, css_length_to_points(value)?)))
        .collect()
}

/// `0.5rem` → 8, `10px` → 10 (16px root font size).
fn css_length_to_points(value: &str) -> Result<f64, String> {
    let parsed = if let Some(rem) = value.strip_suffix("rem") {
        rem.parse::<f64>().map(|v| v * 16.0)
    } else if let Some(px) = value.strip_suffix("px") {
        px.parse::<f64>()
    } else {
        return Err(format!("unsupported length `{value}` (use rem or px)"));
    };
    parsed.map_err(|e| format!("invalid length `{value}`: {e}"))
}

fn format_points(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{value:.0}")
    } else {
        format!("{value}")
    }
}

fn render_swift_scale(snapshot: &TokensJsonSnapshot) -> String {
    let mut out = String::from(
        "\n/// Spacing scale from rust-core (`tokens.rs`), in points. Feature code never uses numeric literals.\nenum TranSpace {\n",
    );
    for (name, points) in scale_entries(snapshot).expect("valid spacing tokens") {
        out.push_str(&format!(
            "    static let {name}: CGFloat = {}\n",
            format_points(points)
        ));
    }
    out.push_str("}\n\n/// Corner radii from rust-core, in points.\nenum TranRadius {\n");
    for (name, points) in radius_entries(snapshot).expect("valid radius tokens") {
        out.push_str(&format!(
            "    static let {name}: CGFloat = {}\n",
            format_points(points)
        ));
    }
    out.push_str("}\n");
    out
}

fn render_kotlin_scale(snapshot: &TokensJsonSnapshot) -> String {
    let mut out = String::from(
        "\n/** Spacing scale from rust-core (`tokens.rs`), in dp. Feature code never uses numeric literals. */\nobject TranSpace {\n",
    );
    for (name, points) in scale_entries(snapshot).expect("valid spacing tokens") {
        out.push_str(&format!(
            "    val {name}: Dp = {}.dp\n",
            format_points(points)
        ));
    }
    out.push_str("}\n\n/** Corner radii from rust-core, in dp. */\nobject TranRadius {\n");
    for (name, points) in radius_entries(snapshot).expect("valid radius tokens") {
        out.push_str(&format!(
            "    val {name}: Dp = {}.dp\n",
            format_points(points)
        ));
    }
    out.push_str("}\n");
    out
}

#[cfg(test)]
mod tests {
    use super::*;

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
    fn android_resource_names_are_lowercase_snake_case() {
        assert_eq!(
            android_resource_name("eligibility.age.label"),
            "eligibility_age_label"
        );
        assert_eq!(
            android_resource_name("shell.theme.sepia"),
            "shell_theme_sepia"
        );
        assert_eq!(android_resource_name("common.appName"), "common_app_name");
    }

    #[test]
    fn android_escaping_covers_aapt_specials() {
        assert_eq!(
            android_escape("Global Rules & Parity Verification"),
            "Global Rules &amp; Parity Verification"
        );
        assert_eq!(android_escape("%1$s years"), "%1$s years");
        assert_eq!(android_escape("it's fine"), "it\\'s fine");
        assert_eq!(android_escape("@launch"), "\\@launch");
        assert_eq!(android_escape("ready?"), "ready?");
    }

    #[test]
    fn flattening_uses_module_relative_dotted_keys() {
        let document: serde_json::Value = serde_json::json!({
            "theme": { "light": "Light" },
            "title": "TRAN"
        });
        let mut flat = BTreeMap::new();
        flatten_module(&document, "", &mut flat).expect("flatten");
        assert_eq!(flat.len(), 2);
        assert_eq!(flat.get("theme.light").map(String::as_str), Some("Light"));
        assert_eq!(flat.get("title").map(String::as_str), Some("TRAN"));
    }

    #[test]
    fn flattening_rejects_non_string_leaves() {
        let document: serde_json::Value = serde_json::json!({ "form": { "count": 3 } });
        let mut flat = BTreeMap::new();
        assert!(flatten_module(&document, "", &mut flat).is_err());
    }

    #[test]
    fn member_names_fold_paths_to_camel_case() {
        assert_eq!(member_name("welcome.title"), "welcomeTitle");
        assert_eq!(member_name("table.countryCode"), "tableCountryCode");
        assert_eq!(member_name("theme.light"), "themeLight");
        assert_eq!(member_name("title"), "title");
    }

    #[test]
    fn positional_templates_convert_named_placeholders() {
        assert_eq!(positional_template("TRAN / {platform}", '@'), "TRAN / %1$@");
        assert_eq!(positional_template("{years} years", 's'), "%1$s years");
        assert_eq!(
            positional_template("{a} and {a}: {b}", '@'),
            "%1$@ and %1$@: %2$@"
        );
    }

    #[test]
    fn placeholders_are_validated() {
        assert_eq!(placeholders("{years} years"), vec!["years".to_string()]);
        assert!(validate_placeholders("a", "{years} years").is_ok());
        assert!(validate_placeholders("a", "{bad").is_err());
        assert!(validate_placeholders("a", "{}").is_err());
        assert!(validate_placeholders("a", "{3x}").is_err());
    }

    #[test]
    fn android_resource_dirs_follow_locale_folder_names() {
        assert_eq!(android_resource_dir("en").expect("en"), "values");
        assert_eq!(android_resource_dir("ne").expect("ne"), "values-ne");
        assert_eq!(
            android_resource_dir("en-GB").expect("en-GB"),
            "values-b+en+GB"
        );
        assert!(android_resource_dir("english").is_err());
        assert!(android_resource_dir("en-gb").is_err());
    }
}
