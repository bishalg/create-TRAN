//! `locales/<locale>/<module>.json` → validated dictionaries (REQ-I18N-003). Every rule here fails
//! the run with a message naming the file or key, so a broken translation never reaches an app.

use crate::files::{list_dir, read_file};
use crate::names::{android_resource_name, full_key, member_name};
use rust_core::feedback::{ErrorCode, UserAction, VerdictSource, LOADING_POLICY};
use rust_core::tokens::TokensJsonSnapshot;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// Base language under `locales/`. Other locales fall back to it at runtime: web in `t()`,
/// iOS through the String Catalog development language, Android through the default `values/`.
pub const BASE_LOCALE: &str = "en";

/// One locale's dictionaries: module name → module-relative flat keys (`welcome.title`).
pub type ModuleKeys = BTreeMap<String, String>;

#[derive(Debug, Clone, PartialEq)]
pub struct Dictionary {
    pub locale: String,
    pub modules: BTreeMap<String, ModuleKeys>,
}

/// Every locale, base language first. Non-empty, with identical modules, keys and placeholders.
pub type Locales = Vec<Dictionary>;

/// Reads `locales/<locale>/<module>.json`. Module set, key set and placeholder sets must be
/// identical across locales, and values must be non-empty `{name}`-placeholder templates.
pub fn load_locales(dir: &Path) -> Result<Locales, String> {
    let mut locale_ids: Vec<String> = list_dir(dir)?
        .iter()
        .filter(|path| path.is_dir())
        .map(|path| file_name(path))
        .collect();
    if !locale_ids.iter().any(|id| id == BASE_LOCALE) {
        return Err(format!(
            "`locales/{BASE_LOCALE}` is the base language and must exist"
        ));
    }
    locale_ids.sort_by_key(|id| id != BASE_LOCALE);

    let mut dictionaries: Locales = Vec::new();
    for locale in locale_ids {
        let modules = load_modules(&dir.join(&locale), &locale)?;
        dictionaries.push(Dictionary { locale, modules });
    }
    verify_parity(&dictionaries)?;
    Ok(dictionaries)
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}

fn load_modules(locale_dir: &Path, locale: &str) -> Result<BTreeMap<String, ModuleKeys>, String> {
    let module_files: Vec<_> = list_dir(locale_dir)?
        .into_iter()
        .filter(|path| {
            path.extension()
                .is_some_and(|extension| extension == "json")
        })
        .collect();
    if module_files.is_empty() {
        return Err(format!("`locales/{locale}` has no module files"));
    }
    let mut modules = BTreeMap::new();
    for path in module_files {
        let module = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let document: serde_json::Value = serde_json::from_str(&read_file(&path)?)
            .map_err(|e| format!("parse {}: {e}", path.display()))?;
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
    Ok(modules)
}

/// Every other locale has exactly the base language's modules, keys and placeholders.
fn verify_parity(dictionaries: &[Dictionary]) -> Result<(), String> {
    let (base, others) = dictionaries
        .split_first()
        .expect("load_locales requires the base locale");
    for dictionary in others {
        let locale = &dictionary.locale;
        for module in base.modules.keys() {
            if !dictionary.modules.contains_key(module) {
                return Err(format!(
                    "`locales/{locale}/{module}.json` is missing (the base language `{BASE_LOCALE}` defines it)"
                ));
            }
        }
        for (module, keys) in &dictionary.modules {
            let Some(base_keys) = base.modules.get(module) else {
                return Err(format!(
                    "`locales/{locale}/{module}.json` has no `{BASE_LOCALE}` counterpart"
                ));
            };
            for (relative, value) in keys {
                let full = full_key(module, relative);
                let Some(base_value) = base_keys.get(relative) else {
                    return Err(format!(
                        "`locales/{locale}/{module}.json` has a key `{full}` that `{BASE_LOCALE}` does not define"
                    ));
                };
                if placeholders(value) != placeholders(base_value) {
                    return Err(format!(
                        "`{full}` placeholders must match `{BASE_LOCALE}`: `{value}` vs `{base_value}`"
                    ));
                }
            }
            if let Some(relative) = base_keys
                .keys()
                .find(|relative| !keys.contains_key(*relative))
            {
                return Err(format!(
                    "`locales/{locale}/{module}.json` is missing `{}`",
                    full_key(module, relative)
                ));
            }
        }
    }
    Ok(())
}

/// Flattens one module file into module-relative dotted keys (`welcome.title`).
pub fn flatten_module(
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
pub fn placeholders(value: &str) -> Vec<String> {
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
pub fn validate_placeholders(key: &str, value: &str) -> Result<(), String> {
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
pub fn positional_template(value: &str, conversion: char) -> String {
    let mut out = value.to_string();
    for (index, name) in placeholders(value).iter().enumerate() {
        out = out.replace(
            &format!("{{{name}}}"),
            &format!("%{}${conversion}", index + 1),
        );
    }
    out
}

/// English is the base language: a value shared by two modules belongs in `common`.
pub fn verify_no_duplicate_values(base: &Dictionary) -> Result<(), String> {
    let mut seen: BTreeMap<&str, (&str, String)> = BTreeMap::new();
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
                    seen.insert(value, (module, full));
                }
            }
        }
    }
    Ok(())
}

/// Android resource names and Swift/Kotlin member names must be unique after key folding.
pub fn verify_generated_names(base: &Dictionary) -> Result<(), String> {
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
pub fn verify_theme_labels(base: &Dictionary, snapshot: &TokensJsonSnapshot) -> Result<(), String> {
    let Some(shell) = base.modules.get("shell") else {
        return Err("`locales/<locale>/shell.json` is required for theme labels".to_string());
    };
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

/// Every `message_key` in the Rust feedback catalogue and the waiting policy (`VerdictSource`,
/// `LOADING_POLICY`), checked to exist without placeholders, so native apps can look copy up by the
/// key the table returns (ADR-0028, ADR-0035).
pub fn feedback_message_keys(base: &Dictionary) -> Result<BTreeSet<String>, String> {
    let keys: BTreeSet<String> = ErrorCode::ALL
        .iter()
        .map(|code| code.spec().message_key)
        .chain(
            UserAction::ALL
                .iter()
                .map(|action| action.spec().message_key),
        )
        .chain(VerdictSource::ALL.iter().map(|source| source.message_key()))
        .chain([LOADING_POLICY.pending_message_key])
        .map(str::to_string)
        .collect();
    for key in &keys {
        let value = key
            .split_once('.')
            .and_then(|(module, relative)| base.modules.get(module)?.get(relative));
        match value {
            None => {
                return Err(format!(
                    "feedback catalogue names `{key}`, missing from locales/"
                ))
            }
            Some(value) if !placeholders(value).is_empty() => {
                return Err(format!(
                    "feedback message `{key}` must not take placeholders"
                ))
            }
            Some(_) => {}
        }
    }
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_core::tokens_json_snapshot;
    use std::fs;

    /// A `locales/` tree in a temporary directory: `("en/shell.json", "{…}")` pairs.
    fn tree(files: &[(&str, &str)]) -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        for (relative, contents) in files {
            let path = dir.path().join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, contents).unwrap();
        }
        dir
    }

    fn load_error(files: &[(&str, &str)]) -> String {
        load_locales(tree(files).path()).unwrap_err()
    }

    fn dictionary(modules: &[(&str, &[(&str, &str)])]) -> Dictionary {
        Dictionary {
            locale: "en".into(),
            modules: modules
                .iter()
                .map(|(module, keys)| {
                    let keys = keys.iter().map(|(k, v)| (k.to_string(), v.to_string()));
                    (module.to_string(), keys.collect())
                })
                .collect(),
        }
    }

    fn real_base() -> Dictionary {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap();
        load_locales(&root.join("locales")).unwrap().remove(0)
    }

    #[test]
    fn loads_the_base_language_first_then_the_rest_sorted() {
        let dir = tree(&[
            ("ne/shell.json", r#"{"title": "TRAN ne"}"#),
            (
                "en/shell.json",
                r#"{"title": "TRAN", "theme": {"light": "Light"}}"#,
            ),
            ("en/README.md", "not a module"),
            ("hi/shell.json", r#"{"title": "TRAN hi"}"#),
        ]);
        let err = load_locales(dir.path()).unwrap_err();
        assert!(
            err.contains("locales/hi/shell.json` is missing `shell.theme.light`"),
            "{err}"
        );

        fs::write(
            dir.path().join("hi/shell.json"),
            r#"{"title":"hi","theme":{"light":"L"}}"#,
        )
        .unwrap();
        fs::write(
            dir.path().join("ne/shell.json"),
            r#"{"title":"ne","theme":{"light":"L"}}"#,
        )
        .unwrap();
        let locales = load_locales(dir.path()).unwrap();
        let ids: Vec<&str> = locales.iter().map(|d| d.locale.as_str()).collect();
        assert_eq!(ids, ["en", "hi", "ne"]);
        assert_eq!(locales[0].modules["shell"]["theme.light"], "Light");
    }

    // Verifies: REQ-GEN-002 REQ-I18N-003 — each broken tree fails with a message naming the problem.
    #[test]
    fn rejects_every_broken_tree_with_a_named_error() {
        let base = ("en/shell.json", r#"{"title": "Hello {name}"}"#);
        let cases: &[(&[(&str, &str)], &str)] = &[
            (
                &[("ne/shell.json", "{}")],
                "`locales/en` is the base language",
            ),
            (&[("en/notes.txt", "x")], "`locales/en` has no module files"),
            (&[("en/shell.json", "{")], "parse "),
            (&[("en/shell.json", r#"{"n": 3}"#)], "`n` must be a string"),
            (&[("en/shell.json", r#"{"t": "  "}"#)], "`shell.t` is empty"),
            (
                &[("en/shell.json", r#"{"t": "50%"}"#)],
                "named placeholders",
            ),
            (
                &[("en/shell.json", r#"{"t": "{3d}"}"#)],
                "camelCase identifier",
            ),
            (
                &[base, ("ne/other.json", r#"{"t": "x"}"#)],
                "`locales/ne/shell.json` is missing",
            ),
            (
                &[
                    base,
                    ("ne/shell.json", r#"{"title": "{name}"}"#),
                    ("ne/extra.json", r#"{"t": "x"}"#),
                ],
                "`locales/ne/extra.json` has no `en` counterpart",
            ),
            (
                &[
                    base,
                    ("ne/shell.json", r#"{"title": "{name}", "new": "x"}"#),
                ],
                "a key `shell.new` that `en` does not define",
            ),
            (
                &[base, ("ne/shell.json", r#"{"title": "{other}"}"#)],
                "`shell.title` placeholders must match `en`",
            ),
        ];
        for (files, needle) in cases {
            let err = load_error(files);
            assert!(
                err.contains(needle),
                "{files:?}: expected `{needle}` in `{err}`"
            );
        }
        assert!(load_locales(Path::new("/no/such/locales"))
            .unwrap_err()
            .contains("read /no/such"));
        // A directory named like a module cannot be read as one.
        let dir = tree(&[("en/shell.json", "{}")]);
        fs::create_dir(dir.path().join("en/broken.json")).unwrap();
        assert!(load_locales(dir.path())
            .unwrap_err()
            .contains("broken.json"));
    }

    #[cfg(unix)]
    #[test]
    fn an_unreadable_locale_folder_fails_the_run() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tree(&[("en/shell.json", "{}")]);
        let locked = dir.path().join("en");
        let enforced = crate::files::tests::make_unreadable(&locked);
        let result = load_locales(dir.path());
        assert!(!enforced || result.unwrap_err().contains("read "));
        fs::set_permissions(&locked, fs::Permissions::from_mode(0o755)).unwrap();
    }

    #[test]
    fn flattening_uses_module_relative_dotted_keys() {
        let document = serde_json::json!({ "theme": { "light": "Light" }, "title": "TRAN" });
        let mut flat = BTreeMap::new();
        flatten_module(&document, "", &mut flat).unwrap();
        assert_eq!(flat.len(), 2);
        assert_eq!(flat["theme.light"], "Light");
        assert_eq!(flat["title"], "TRAN");
    }

    #[test]
    fn placeholders_are_validated() {
        assert_eq!(placeholders("{a} {b} {a}"), ["a", "b"]);
        assert_eq!(placeholders("{open"), Vec::<String>::new());
        assert!(validate_placeholders("a", "{years} years").is_ok());
        assert!(validate_placeholders("a", "{bad")
            .unwrap_err()
            .contains("unbalanced"));
        assert!(validate_placeholders("a", "bad}")
            .unwrap_err()
            .contains("unbalanced"));
        assert!(validate_placeholders("a", "{}").is_err());
        assert!(validate_placeholders("a", "{x-y}").is_err());
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
    fn a_value_shared_by_two_modules_belongs_in_common() {
        let same_module = dictionary(&[("auth", &[("a", "Sign in"), ("b", "Sign in")])]);
        assert!(verify_no_duplicate_values(&same_module).is_ok());
        let two_modules = dictionary(&[
            ("auth", &[("a", "Sign in")]),
            ("shell", &[("b", "Sign in")]),
        ]);
        let err = verify_no_duplicate_values(&two_modules).unwrap_err();
        assert!(err.contains("`auth.a` and `shell.b`"), "{err}");
    }

    #[test]
    fn generated_names_must_not_collide() {
        // `a.bC` and `a_b.c` both fold to the resource `a_b_c`.
        let resource = dictionary(&[("a", &[("bC", "1")]), ("a_b", &[("c", "2")])]);
        let err = verify_generated_names(&resource).unwrap_err();
        assert!(err.contains("Android resource `a_b_c`"), "{err}");
        // `b.-c` and `bC` are different resources but the same Swift/Kotlin member `bC`.
        let member = dictionary(&[("a", &[("b.-c", "1"), ("bC", "2")])]);
        let err = verify_generated_names(&member).unwrap_err();
        assert!(
            err.contains("member `a.bC` would be generated twice"),
            "{err}"
        );
        assert!(verify_generated_names(&real_base()).is_ok());
    }

    #[test]
    fn every_theme_needs_a_label() {
        let snapshot = tokens_json_snapshot();
        let err =
            verify_theme_labels(&dictionary(&[("auth", &[("a", "x")])]), &snapshot).unwrap_err();
        assert!(err.contains("shell.json` is required"), "{err}");
        let err = verify_theme_labels(
            &dictionary(&[("shell", &[("theme.light", "x")])]),
            &snapshot,
        )
        .unwrap_err();
        assert!(
            err.contains("theme `dark` needs `shell.theme.dark`"),
            "{err}"
        );
        assert!(verify_theme_labels(&real_base(), &snapshot).is_ok());
    }

    #[test]
    fn feedback_keys_must_exist_without_placeholders() {
        let missing =
            feedback_message_keys(&dictionary(&[("errors", &[("timeout", "x")])])).unwrap_err();
        assert!(missing.contains("missing from locales/"), "{missing}");

        let keys = feedback_message_keys(&real_base()).unwrap();
        assert!(keys.contains("errors.serverInternal"));
        assert!(keys.contains("auth.signOutConfirm.title"));
        // Verifies: REQ-LOAD-001 — the waiting policy's keys are checked and exported too.
        assert!(keys.contains("eligibility.result.updating"));
        assert!(keys.contains("eligibility.result.sourceFallback"));

        let mut base = real_base();
        base.modules
            .get_mut("errors")
            .unwrap()
            .insert("serverInternal".into(), "{code}".into());
        let err = feedback_message_keys(&base).unwrap_err();
        assert!(
            err.contains("`errors.serverInternal` must not take placeholders"),
            "{err}"
        );
    }
}
