//! `pnpm tokens:sync` / `pnpm i18n:sync`: writes what [`generate`] renders and removes generated
//! files it no longer renders. Everything else lives in the library and is tested there (ADR-0030).
//!
//! Destinations and Android package names come from `tooling/design-tokens/codegen.json` (ADR-0025).
#![allow(
    clippy::print_stdout,
    clippy::print_stderr,
    reason = "build-time CLI: it reports what it wrote, and failing loudly is its error handling (ADR-0029)"
)]

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use tran_tokens_codegen::{generate, remove_stale, stale_files, CodegenConfig};

fn main() {
    if let Err(err) = run() {
        eprintln!("tran-tokens-codegen: {err}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), String> {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .ok_or("could not resolve the workspace root")?;
    let paths = CodegenConfig::load_for_workspace(root)?.resolve(root);
    let files = generate(&paths)?;

    for file in &files {
        if let Some(parent) = file.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        }
        fs::write(&file.path, &file.contents)
            .map_err(|e| format!("write {}: {e}", file.path.display()))?;
    }
    let written: BTreeSet<PathBuf> = files.into_iter().map(|file| file.path).collect();
    let stale = stale_files(&paths, &written)?;
    remove_stale(&stale)?;

    for path in &stale {
        println!(
            "tran-tokens-codegen: removed stale {}",
            relative(root, path)
        );
    }
    println!(
        "tran-tokens-codegen: wrote {} files (tokens, rules, feedback, strings, DESIGN.md)",
        written.len()
    );
    Ok(())
}

fn relative(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .display()
        .to_string()
}
