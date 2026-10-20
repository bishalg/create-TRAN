// Verifies: REQ-GEN-001 REQ-I18N-005
//! The committed generated files are the snapshots (ADR-0030): rendering everything in memory must
//! reproduce each one byte for byte, and leave nothing stale behind.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tran_tokens_codegen::{generate, stale_files, CodegenConfig};

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

#[test]
fn every_generated_file_matches_the_committed_one() {
    let root = workspace_root();
    let paths = CodegenConfig::load_for_workspace(&root)
        .unwrap()
        .resolve(&root);
    let files = generate(&paths).unwrap();

    let stale: Vec<String> = files
        .iter()
        .filter(|file| fs::read_to_string(&file.path).ok().as_deref() != Some(&file.contents))
        .map(|file| file.path.strip_prefix(&root).unwrap().display().to_string())
        .collect();
    assert!(
        stale.is_empty(),
        "stale generated files — run `pnpm tokens:sync` and commit the result:\n  {}",
        stale.join("\n  ")
    );

    let written: BTreeSet<PathBuf> = files.into_iter().map(|file| file.path).collect();
    let leftovers = stale_files(&paths, &written).unwrap();
    assert!(
        leftovers.is_empty(),
        "generated files nothing renders any more — run `pnpm tokens:sync` to remove them:\n  {}",
        leftovers
            .iter()
            .map(|path| path.strip_prefix(&root).unwrap().display().to_string())
            .collect::<Vec<_>>()
            .join("\n  ")
    );
}

#[test]
fn every_target_is_generated() {
    let root = workspace_root();
    let paths = CodegenConfig::sample_defaults().resolve(&root);
    let names: BTreeSet<String> = generate(&paths)
        .unwrap()
        .iter()
        .map(|file| {
            file.path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    for expected in [
        "tokens.json",
        "tokens.ts",
        "rules.ts",
        "feedback.ts",
        "strings.json",
        "keys.ts",
        "theme.css",
        "BrandTokens.swift",
        "L10n.swift",
        "Shell.xcstrings",
        "BrandTokens.kt",
        "TranStrings.kt",
        "strings_shell.xml",
        "DESIGN.md",
    ] {
        assert!(names.contains(expected), "{expected} is not generated");
    }
}
