//! What the unit tests of several catalogues read from the repository: the locale dictionaries and
//! the requirement ids of `docs/specs`.
#![allow(clippy::unwrap_used, clippy::expect_used, reason = "test code")]

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

pub fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

/// `locales/<locale>/<module>.json`, flattened to `module.key` → value, per locale.
pub fn locales() -> BTreeMap<String, BTreeMap<String, String>> {
    fn flatten(value: &serde_json::Value, prefix: &str, out: &mut BTreeMap<String, String>) {
        match value {
            serde_json::Value::Object(entries) => {
                for (key, child) in entries {
                    flatten(child, &format!("{prefix}.{key}"), out);
                }
            }
            other => {
                out.insert(prefix.to_string(), other.as_str().unwrap().to_string());
            }
        }
    }
    let mut out = BTreeMap::new();
    let folders = fs::read_dir(workspace_root().join("locales"))
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.is_dir());
    for locale in folders {
        let mut keys = BTreeMap::new();
        for module in fs::read_dir(&locale).unwrap() {
            let module = module.unwrap().path();
            let name = module.file_stem().unwrap().to_string_lossy().into_owned();
            let json: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&module).unwrap()).unwrap();
            flatten(&json, &name, &mut keys);
        }
        let name = locale.file_name().unwrap().to_string_lossy().into_owned();
        out.insert(name, keys);
    }
    out
}

/// `(locale, key)` for every key of `keys` some locale lacks.
pub fn missing_in_locales<'a>(keys: impl IntoIterator<Item = &'a str>) -> Vec<(String, String)> {
    let locales = locales();
    assert!(locales.len() >= 3);
    let mut missing = Vec::new();
    for key in keys {
        for (locale, dictionary) in &locales {
            if !dictionary.contains_key(key) {
                missing.push((locale.clone(), key.to_string()));
            }
        }
    }
    missing
}

/// Every requirement id a heading of `docs/specs/NNN-*.md` defines, as `pnpm spec:check` reads them.
pub fn spec_requirement_ids() -> BTreeSet<String> {
    fs::read_dir(workspace_root().join("docs/specs"))
        .unwrap()
        .map(|entry| fs::read_to_string(entry.unwrap().path()).unwrap())
        .flat_map(|text| {
            text.lines()
                .filter_map(|line| line.strip_prefix("### "))
                .filter_map(|rest| rest.split_whitespace().next())
                .filter(|id| id.starts_with("REQ-"))
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .collect()
}
