//! Every artifact of one run, rendered in memory (ADR-0030). The binary writes them; the drift test
//! compares them with the committed files.

use crate::config::CodegenPaths;
use crate::files::GeneratedFile;
use crate::kotlin::{render_kotlin_strings, render_kotlin_tokens};
use crate::locales::{
    feedback_message_keys, load_locales, verify_generated_names, verify_no_duplicate_values,
    verify_theme_labels,
};
use crate::names::pascal_case;
use crate::scale::Scale;
use crate::strings::{
    android_resource_dir, render_android_module_strings, render_translations_json, render_ts_keys,
    render_xcstrings,
};
use crate::swift::{render_l10n_swift, render_swift_tokens};
use crate::theme_css::render_theme_css;
use crate::tokens_ts::{render_tokens_json, render_tokens_ts};
use crate::{render_design_md, render_feedback_ts, render_rules_ts};
use rust_core::tokens::TokensJsonSnapshot;
use rust_core::tokens_json_snapshot;
use std::path::PathBuf;

/// Renders everything from the `rust-core` tokens and `paths.locales_dir`.
pub fn generate(paths: &CodegenPaths) -> Result<Vec<GeneratedFile>, String> {
    generate_from(paths, &tokens_json_snapshot())
}

/// [`generate`] for a given token snapshot. Validates everything before rendering anything, so a
/// failed run never leaves half the platforms updated.
pub fn generate_from(
    paths: &CodegenPaths,
    snapshot: &TokensJsonSnapshot,
) -> Result<Vec<GeneratedFile>, String> {
    let scale = Scale::from_snapshot(snapshot)?;
    let locales = load_locales(&paths.locales_dir)?;
    let base = &locales[0];
    verify_no_duplicate_values(base)?;
    verify_generated_names(base)?;
    verify_theme_labels(base, snapshot)?;
    let feedback_keys = feedback_message_keys(base)?;

    let core = &paths.core_generated_dir;
    let ios = &paths.ios_generated_dir;
    let kotlin = &paths.android_kotlin_generated_dir;
    let kotlin_package = &paths.android_kotlin_package;
    let mut files = vec![
        file(core.join("tokens.json"), render_tokens_json(snapshot)),
        file(core.join("tokens.ts"), render_tokens_ts(snapshot)),
        file(core.join("rules.ts"), render_rules_ts()),
        file(core.join("feedback.ts"), render_feedback_ts()),
        file(
            core.join("strings.json"),
            render_translations_json(&locales),
        ),
        file(core.join("keys.ts"), render_ts_keys(&locales)),
        file(
            paths.web_generated_dir.join("theme.css"),
            render_theme_css(snapshot),
        ),
        file(
            ios.join("BrandTokens.swift"),
            render_swift_tokens(snapshot, &scale),
        ),
        file(
            ios.join("L10n.swift"),
            render_l10n_swift(base, snapshot, &feedback_keys),
        ),
        file(
            kotlin.join("BrandTokens.kt"),
            render_kotlin_tokens(snapshot, &scale, kotlin_package),
        ),
        file(
            kotlin.join("TranStrings.kt"),
            render_kotlin_strings(
                base,
                snapshot,
                &feedback_keys,
                kotlin_package,
                &paths.android_app_package,
            ),
        ),
        file(paths.design_md_path.clone(), render_design_md(snapshot)),
    ];
    for module in base.modules.keys() {
        let catalog = ios
            .join("Strings")
            .join(format!("{}.xcstrings", pascal_case(module)));
        files.push(file(catalog, render_xcstrings(&locales, module)));
    }
    for dictionary in &locales {
        let folder = paths
            .android_res_dir
            .join(android_resource_dir(&dictionary.locale)?);
        for (module, keys) in &dictionary.modules {
            let path = folder.join(format!("strings_{module}.xml"));
            files.push(file(path, render_android_module_strings(module, keys)));
        }
    }
    Ok(files)
}

fn file(path: PathBuf, contents: String) -> GeneratedFile {
    GeneratedFile { path, contents }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::CodegenConfig;
    use std::fs;
    use std::path::Path;

    fn workspace_root() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap()
    }

    /// Sample paths under `dir`, whose `locales/` holds `files`.
    fn run_with_locales(files: &[(&str, String)]) -> Result<Vec<GeneratedFile>, String> {
        let dir = tempfile::tempdir().unwrap();
        for (relative, contents) in files {
            let path = dir.path().join("locales").join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
        generate(&CodegenConfig::sample_defaults().resolve(dir.path()))
    }

    /// `shell.json` with a label for every registry theme, plus `extra` keys.
    fn shell_with_theme_labels(extra: &str) -> String {
        let labels: Vec<String> = tokens_json_snapshot()
            .themes
            .iter()
            .map(|theme| format!("\"{}\": \"{} label\"", theme.mode, theme.mode))
            .collect();
        format!("{{ \"theme\": {{ {} }} {extra} }}", labels.join(", "))
    }

    fn copy_tree(from: &Path, to: &Path) {
        fs::create_dir_all(to).unwrap();
        for entry in fs::read_dir(from).unwrap() {
            let path = entry.unwrap().path();
            let target = to.join(path.file_name().unwrap());
            if path.is_dir() {
                copy_tree(&path, &target);
            } else {
                fs::copy(&path, &target).unwrap();
            }
        }
    }

    // Verifies: REQ-GEN-002 — a run validates everything first and names the first problem.
    #[test]
    fn a_broken_input_fails_the_whole_run() {
        let cases: Vec<(Vec<(&str, String)>, &str)> = vec![
            (vec![], "read "),
            (
                vec![
                    ("en/a.json", r#"{"x": "same"}"#.into()),
                    ("en/b.json", r#"{"y": "same"}"#.into()),
                ],
                "keep one shared key in `common`",
            ),
            (
                vec![
                    ("en/a.json", r#"{"bC": "1"}"#.into()),
                    ("en/a_b.json", r#"{"c": "2"}"#.into()),
                ],
                "would be generated twice",
            ),
            (
                vec![("en/a.json", r#"{"x": "1"}"#.into())],
                "required for theme labels",
            ),
            (
                vec![("en/shell.json", shell_with_theme_labels(""))],
                "missing from locales/",
            ),
        ];
        for (files, needle) in cases {
            let err = run_with_locales(&files).unwrap_err();
            assert!(err.contains(needle), "expected `{needle}` in `{err}`");
        }
    }

    #[test]
    fn an_unsupported_token_length_fails_before_any_rendering() {
        let mut snapshot = tokens_json_snapshot();
        snapshot.spacing.sm = "1vh".into();
        let paths = CodegenConfig::sample_defaults().resolve(workspace_root());
        assert!(generate_from(&paths, &snapshot)
            .unwrap_err()
            .contains("1vh"));
    }

    #[test]
    fn a_locale_folder_android_cannot_name_fails_the_run() {
        let dir = tempfile::tempdir().unwrap();
        copy_tree(
            &workspace_root().join("locales"),
            &dir.path().join("locales"),
        );
        copy_tree(
            &dir.path().join("locales/en"),
            &dir.path().join("locales/english"),
        );
        let err = generate(&CodegenConfig::sample_defaults().resolve(dir.path())).unwrap_err();
        assert!(
            err.contains("`locales/english` is not a valid locale folder name"),
            "{err}"
        );
    }

    #[test]
    fn every_path_is_under_its_configured_destination() {
        let paths = CodegenConfig::sample_defaults().resolve(workspace_root());
        let files = generate(&paths).unwrap();
        let roots = [
            &paths.core_generated_dir,
            &paths.web_generated_dir,
            &paths.ios_generated_dir,
            &paths.android_kotlin_generated_dir,
            &paths.android_res_dir,
        ];
        for file in &files {
            let inside = roots.iter().any(|root| file.path.starts_with(root));
            assert_eq!(
                (
                    inside || file.path == paths.design_md_path,
                    file.contents.ends_with('\n')
                ),
                (true, true),
                "{file:?}"
            );
        }
    }
}
