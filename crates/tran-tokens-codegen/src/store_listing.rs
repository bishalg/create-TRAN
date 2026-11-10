//! Store listing text for fastlane: `deliver` on iOS, `supply` on Android (REQ-MOB-011, ADR-0042).
//!
//! The words come from the `store` module of `locales/` (and the app name from `common.appName`, so
//! the listing and the home screen never disagree); the addresses, the app-to-store language map
//! and the App Review notes come from `tooling/mobile-release/store-listing.json`, the one file a
//! fork edits. Every store limit is checked here, so a field that is too long fails
//! `pnpm tokens:sync` instead of an upload. The `store` module is listing copy, not app copy: it is
//! never rendered into an app bundle.

use crate::files::{read_file, GeneratedFile};
use crate::locales::{placeholders, Dictionary, Locales};
use crate::release_notes::{trim_to_limit, Release};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

/// The locale module that holds listing copy. Only this generator reads it.
pub const STORE_MODULE: &str = "store";

/// Every key of the `store` module. Each one is rendered below and any other key fails the run, so
/// the module cannot carry a dead key.
pub const STORE_KEYS: [&str; 5] = [
    "subtitle",
    "shortDescription",
    "description",
    "keywords",
    "promotionalText",
];

/// One listing file, the locale key it is rendered from and its store limit in characters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Field {
    pub file: &'static str,
    pub key: &'static str,
    pub limit: usize,
}

/// `deliver` files and App Store Connect limits ("Platform version information" and "App
/// information" in the App Store Connect Help reference).
pub const APP_STORE_FIELDS: [Field; 5] = [
    Field {
        file: "name.txt",
        key: "common.appName",
        limit: 30,
    },
    Field {
        file: "subtitle.txt",
        key: "store.subtitle",
        limit: 30,
    },
    Field {
        file: "description.txt",
        key: "store.description",
        limit: 4000,
    },
    Field {
        file: "keywords.txt",
        key: "store.keywords",
        limit: 100,
    },
    Field {
        file: "promotional_text.txt",
        key: "store.promotionalText",
        limit: 170,
    },
];

/// `supply` files and Google Play limits (Play Console Help, "Create and set up your app").
pub const GOOGLE_PLAY_FIELDS: [Field; 3] = [
    Field {
        file: "title.txt",
        key: "common.appName",
        limit: 30,
    },
    Field {
        file: "short_description.txt",
        key: "store.shortDescription",
        limit: 80,
    },
    Field {
        file: "full_description.txt",
        key: "store.description",
        limit: 4000,
    },
];

/// "What's New in This Version" on the App Store.
pub const APP_STORE_RELEASE_NOTES_LIMIT: usize = 4000;
/// "Release notes" of a Play release.
pub const GOOGLE_PLAY_RELEASE_NOTES_LIMIT: usize = 500;
/// App Review notes in App Store Connect.
pub const APP_REVIEW_NOTES_LIMIT: usize = 4000;

/// `deliver` URL files, each filled from one address of the configuration.
pub const APP_STORE_URL_FILES: [(&str, &str); 3] = [
    ("support_url.txt", "supportUrl"),
    ("marketing_url.txt", "marketingUrl"),
    ("privacy_url.txt", "privacyPolicyUrl"),
];

/// Where `deliver` reads the App Review notes: a folder beside the language folders.
pub const APP_REVIEW_FOLDER: &str = "review_information";
pub const APP_REVIEW_NOTES: &str = "notes.txt";

/// The path every account-deletion address ends with: the public page of REQ-ACC-007.
pub const ACCOUNT_DELETION_PAGE: &str = "/account-deletion.html";

/// The languages App Store Connect accepts for metadata, from Apple's "Managing metadata in your
/// app by using locale shortcodes" (App Store Connect API documentation, checked 2026-11-10). A
/// locale outside this list must be skipped for the App Store with a reason.
pub const APP_STORE_LANGUAGES: [&str; 50] = [
    "ar-SA", "bn-BD", "ca", "zh-Hans", "zh-Hant", "hr", "cs", "da", "nl-NL", "en-AU", "en-CA",
    "en-GB", "en-US", "fi", "fr-FR", "fr-CA", "de-DE", "el", "gu-IN", "he", "hi", "hu", "id", "it",
    "ja", "kn-IN", "ko", "ms", "ml-IN", "mr-IN", "no", "or-IN", "pl", "pt-BR", "pt-PT", "pa-IN",
    "ro", "ru", "sk", "sl-SI", "es-MX", "es-ES", "sv", "ta-IN", "te-IN", "th", "tr", "uk", "ur-PK",
    "vi",
];

/// `tooling/mobile-release/store-listing.json`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StoreListingConfig {
    /// What the file is, for the person who opens it.
    #[serde(rename = "$comment", default)]
    pub comment: String,
    pub urls: StoreUrls,
    /// English notes for Apple's reviewers; may name any address as a `{placeholder}`.
    pub app_review_notes: String,
    /// One entry per app locale, in listing order.
    pub locales: Vec<LocaleMapping>,
}

/// The addresses a listing names. They are configuration, not translations.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct StoreUrls {
    pub support_url: String,
    pub marketing_url: String,
    pub privacy_policy_url: String,
    pub account_deletion_url: String,
}

impl StoreUrls {
    /// Placeholder name → address. Store copy may use any of these as `{name}`.
    pub fn by_placeholder(&self) -> BTreeMap<&'static str, &str> {
        BTreeMap::from([
            ("supportUrl", self.support_url.as_str()),
            ("marketingUrl", self.marketing_url.as_str()),
            ("privacyPolicyUrl", self.privacy_policy_url.as_str()),
            ("accountDeletionUrl", self.account_deletion_url.as_str()),
        ])
    }
}

/// An app locale and its language on each store.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct LocaleMapping {
    pub locale: String,
    pub app_store: StoreLanguage,
    pub google_play: StoreLanguage,
}

/// A store language code, or an explicit skip with the reason (never a silent gap).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum StoreLanguage {
    Code(String),
    Skipped(Skip),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Skip {
    pub skip: String,
}

impl StoreLanguage {
    fn code(&self) -> Option<&str> {
        match self {
            Self::Code(code) => Some(code),
            Self::Skipped(_) => None,
        }
    }
}

impl StoreListingConfig {
    pub fn load(path: &Path) -> Result<Self, String> {
        serde_json::from_str(&read_file(path)?)
            .map_err(|e| format!("parse {}: {e}", path.display()))
    }
}

/// Checks the configuration and the `store` module against every locale, then renders each mapped
/// locale's files under `ios_dir` (`deliver`) and `android_dir` (`supply`).
pub fn render_store_metadata(
    config: &StoreListingConfig,
    locales: &Locales,
    release: &Release,
    ios_dir: &Path,
    android_dir: &Path,
) -> Result<Vec<GeneratedFile>, String> {
    verify_store_keys(&locales[0])?;
    verify_urls(&config.urls)?;
    verify_mapping(config, locales)?;
    let urls = config.urls.by_placeholder();
    let mut files = Vec::new();
    for mapping in &config.locales {
        let dictionary = locales
            .iter()
            .find(|dictionary| dictionary.locale == mapping.locale)
            .expect("verify_mapping checked every entry names a locale");
        if let Some(code) = mapping.app_store.code() {
            let folder = ios_dir.join(code);
            for field in &APP_STORE_FIELDS {
                let text = field_text(dictionary, field, "the App Store", &urls)?;
                if field.key == "store.keywords" {
                    verify_keywords(&dictionary.locale, &text)?;
                }
                files.push(file(&folder.join(field.file), text));
            }
            for (name, placeholder) in APP_STORE_URL_FILES {
                files.push(file(&folder.join(name), urls[placeholder].to_string()));
            }
            if let Some(notes) = &release.notes {
                let notes = trim_to_limit(notes, APP_STORE_RELEASE_NOTES_LIMIT);
                files.push(file(&folder.join("release_notes.txt"), notes));
            }
        }
        if let Some(code) = mapping.google_play.code() {
            let folder = android_dir.join(code);
            for field in &GOOGLE_PLAY_FIELDS {
                let text = field_text(dictionary, field, "Google Play", &urls)?;
                files.push(file(&folder.join(field.file), text));
            }
            if let Some(notes) = &release.notes {
                let notes = trim_to_limit(notes, GOOGLE_PLAY_RELEASE_NOTES_LIMIT);
                let name = format!("changelogs/{}.txt", release.build_number);
                files.push(file(&folder.join(name), notes));
            }
        }
    }
    let review = substitute("appReviewNotes", &config.app_review_notes, &urls)?;
    check_limit(
        "App Store Connect",
        APP_REVIEW_NOTES,
        "appReviewNotes",
        "store-listing.json",
        &review,
        APP_REVIEW_NOTES_LIMIT,
    )?;
    let notes = ios_dir.join(APP_REVIEW_FOLDER).join(APP_REVIEW_NOTES);
    files.push(file(&notes, review));
    Ok(files)
}

/// `locales` without the `store` module: what the apps ship.
pub fn app_locales(locales: &Locales) -> Locales {
    locales
        .iter()
        .map(|dictionary| {
            let mut dictionary = dictionary.clone();
            dictionary.modules.remove(STORE_MODULE);
            dictionary
        })
        .collect()
}

/// Listing files are uploaded verbatim (`supply` does not trim), so they carry no final newline.
fn file(path: &Path, contents: String) -> GeneratedFile {
    GeneratedFile {
        path: path.to_path_buf(),
        contents,
    }
}

fn verify_store_keys(base: &Dictionary) -> Result<(), String> {
    let Some(store) = base.modules.get(STORE_MODULE) else {
        return Err(format!(
            "`locales/{}/{STORE_MODULE}.json` is required for the store listing (REQ-MOB-011)",
            base.locale
        ));
    };
    if let Some(extra) = store.keys().find(|key| !STORE_KEYS.contains(&key.as_str())) {
        return Err(format!(
            "`{STORE_MODULE}.{extra}` is not a store listing field; the fields are {}",
            STORE_KEYS.join(", ")
        ));
    }
    match STORE_KEYS.iter().find(|key| !store.contains_key(**key)) {
        Some(missing) => Err(format!(
            "`{STORE_MODULE}.{missing}` is missing from `locales/{}/{STORE_MODULE}.json`",
            base.locale
        )),
        None => Ok(()),
    }
}

fn verify_urls(urls: &StoreUrls) -> Result<(), String> {
    for (name, url) in urls.by_placeholder() {
        if !url.starts_with("https://") || url.contains(char::is_whitespace) {
            return Err(format!(
                "store-listing.json `urls.{name}` must be an https:// address, not `{url}`"
            ));
        }
    }
    if !urls.account_deletion_url.ends_with(ACCOUNT_DELETION_PAGE) {
        return Err(format!(
            "store-listing.json `urls.accountDeletionUrl` must end with `{ACCOUNT_DELETION_PAGE}`, the public page of REQ-ACC-007"
        ));
    }
    Ok(())
}

/// Every app locale has exactly one entry, every entry names an app locale, every skip says why,
/// no store language is used twice and every App Store code is one App Store Connect accepts.
fn verify_mapping(config: &StoreListingConfig, locales: &Locales) -> Result<(), String> {
    let known: BTreeSet<&str> = locales.iter().map(|d| d.locale.as_str()).collect();
    let mut seen = BTreeSet::new();
    let mut codes: BTreeSet<(&str, &str)> = BTreeSet::new();
    for mapping in &config.locales {
        let locale = mapping.locale.as_str();
        if !known.contains(locale) {
            return Err(format!(
                "store-listing.json maps `{locale}`, which is not a folder under locales/"
            ));
        }
        if !seen.insert(locale) {
            return Err(format!("store-listing.json maps `{locale}` twice"));
        }
        for (store, language) in [
            ("appStore", &mapping.app_store),
            ("googlePlay", &mapping.google_play),
        ] {
            match language {
                StoreLanguage::Skipped(Skip { skip }) if skip.trim().is_empty() => {
                    return Err(format!(
                        "store-listing.json skips `{locale}` on `{store}` without a reason"
                    ));
                }
                StoreLanguage::Skipped(_) => {}
                StoreLanguage::Code(code) => {
                    if store == "appStore" && !APP_STORE_LANGUAGES.contains(&code.as_str()) {
                        return Err(format!(
                            "store-listing.json maps `{locale}` to `{code}`, which App Store Connect does not accept; use one of its languages or {{\"skip\": \"<why>\"}}"
                        ));
                    }
                    if code.is_empty() || !codes.insert((store, code)) {
                        return Err(format!(
                            "store-listing.json uses `{store}` language `{code}` twice or empty"
                        ));
                    }
                }
            }
        }
    }
    match known.iter().find(|locale| !seen.contains(**locale)) {
        Some(missing) => Err(format!(
            "`locales/{missing}` has no entry in store-listing.json `locales`: map it to an App Store and a Google Play language, or skip a store with {{\"skip\": \"<why>\"}}"
        )),
        None => Ok(()),
    }
}

/// The value of `field.key` in `dictionary`, with addresses filled in, within the store's limit.
fn field_text(
    dictionary: &Dictionary,
    field: &Field,
    store: &str,
    urls: &BTreeMap<&'static str, &str>,
) -> Result<String, String> {
    let value = field
        .key
        .split_once('.')
        .and_then(|(module, relative)| dictionary.modules.get(module)?.get(relative))
        .ok_or_else(|| {
            format!(
                "store listing field `{}` is missing from locales/",
                field.key
            )
        })?;
    let text = substitute(field.key, value, urls)?;
    check_limit(
        store,
        field.file,
        field.key,
        &format!("locales/{}", dictionary.locale),
        &text,
        field.limit,
    )?;
    Ok(text)
}

fn substitute(
    key: &str,
    value: &str,
    urls: &BTreeMap<&'static str, &str>,
) -> Result<String, String> {
    let mut text = value.to_string();
    for name in placeholders(value) {
        let Some(url) = urls.get(name.as_str()) else {
            let known: Vec<&str> = urls.keys().copied().collect();
            return Err(format!(
                "`{key}` uses `{{{name}}}`; a store listing can only name {}",
                known.join(", ")
            ));
        };
        text = text.replace(&format!("{{{name}}}"), url);
    }
    Ok(text)
}

fn check_limit(
    store: &str,
    file: &str,
    key: &str,
    source: &str,
    text: &str,
    limit: usize,
) -> Result<(), String> {
    let count = text.chars().count();
    if count > limit {
        return Err(format!(
            "`{key}` in `{source}` is {count} characters; {store} allows {limit} for `{file}`"
        ));
    }
    Ok(())
}

/// App Store keywords are separated by commas; an empty entry is a typo that wastes characters.
fn verify_keywords(locale: &str, text: &str) -> Result<(), String> {
    if text.split(',').any(|keyword| keyword.trim().is_empty()) {
        return Err(format!(
            "`store.keywords` in `locales/{locale}` has an empty entry: separate keywords with single commas"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::locales::load_locales;

    fn root() -> &'static Path {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap()
    }

    fn real_config() -> StoreListingConfig {
        StoreListingConfig::load(&root().join("tooling/mobile-release/store-listing.json")).unwrap()
    }

    fn real_locales() -> Locales {
        load_locales(&root().join("locales")).unwrap()
    }

    fn first_release() -> Release {
        Release {
            version: "0.1.0".into(),
            build_number: 1000,
            notes: None,
        }
    }

    fn render(
        config: &StoreListingConfig,
        locales: &Locales,
        release: &Release,
    ) -> Result<BTreeMap<String, String>, String> {
        let files = render_store_metadata(
            config,
            locales,
            release,
            Path::new("/ios"),
            Path::new("/android"),
        )?;
        Ok(files
            .into_iter()
            .map(|file| (file.path.display().to_string(), file.contents))
            .collect())
    }

    fn render_error(config: &StoreListingConfig, locales: &Locales) -> String {
        render(config, locales, &first_release()).unwrap_err()
    }

    fn set(locales: &mut Locales, locale: &str, key: &str, value: &str) {
        let (module, relative) = key.split_once('.').unwrap();
        let dictionary = locales.iter_mut().find(|d| d.locale == locale).unwrap();
        dictionary
            .modules
            .get_mut(module)
            .unwrap()
            .insert(relative.into(), value.into());
    }

    // Verifies: REQ-MOB-011 — deliver's and supply's layouts, for every mapped locale.
    #[test]
    fn renders_each_store_language_folder() {
        let files = render(&real_config(), &real_locales(), &first_release()).unwrap();
        assert_eq!(files["/ios/en-US/name.txt"], "TRAN Voting");
        assert_eq!(files["/android/en-US/title.txt"], "TRAN Voting");
        assert_eq!(files["/android/hi-IN/title.txt"], "TRAN वोटिंग");
        assert_eq!(
            files["/ios/hi/privacy_url.txt"],
            "https://tran.example/privacy.html"
        );
        assert!(files["/ios/en-US/description.txt"]
            .contains("https://tran.example/account-deletion.html"));
        assert!(files["/ios/review_information/notes.txt"]
            .contains("https://tran.example/account-deletion.html"));
        // Nepali is skipped for the App Store on purpose, and present on Google Play.
        assert!(!files.keys().any(|path| path.starts_with("/ios/ne")));
        assert!(files.contains_key("/android/ne-NP/full_description.txt"));
        // A first version has no release notes.
        assert!(!files
            .keys()
            .any(|path| path.contains("release_notes") || path.contains("changelogs")));
        assert_eq!(files.len(), 2 * 8 + 3 * 3 + 1);
        assert!(files.values().all(|text| !text.ends_with('\n')));

        // A locale can be skipped on Google Play too.
        let mut config = real_config();
        config.locales[0].google_play = skip("not on Play yet");
        let files = render(&config, &real_locales(), &first_release()).unwrap();
        assert!(!files.contains_key("/android/en-US/title.txt"));
        assert!(files.contains_key("/ios/en-US/name.txt"));
    }

    #[test]
    fn release_notes_are_trimmed_to_each_store_limit() {
        let line = format!("- {}", "x".repeat(97));
        let notes = vec![line; 60].join("\n");
        let release = Release {
            version: "1.2.3".into(),
            build_number: 1_002_003,
            notes: Some(notes.clone()),
        };
        let files = render(&real_config(), &real_locales(), &release).unwrap();
        let ios = &files["/ios/en-US/release_notes.txt"];
        let play = &files["/android/ne-NP/changelogs/1002003.txt"];
        assert_eq!(ios.chars().count(), 3999);
        assert_eq!(play.chars().count(), 499);
        assert!(notes.starts_with(ios.as_str()) && notes.starts_with(play.as_str()));
    }

    // Verifies: REQ-MOB-011 — a field over its limit fails the run, naming key, locale and limit.
    #[test]
    fn a_field_over_its_store_limit_fails_the_run() {
        let mut locales = real_locales();
        set(&mut locales, "hi", "store.subtitle", &"अ".repeat(31));
        assert_eq!(
            render_error(&real_config(), &locales),
            "`store.subtitle` in `locales/hi` is 31 characters; the App Store allows 30 for `subtitle.txt`"
        );
        let mut locales = real_locales();
        set(
            &mut locales,
            "ne",
            "store.shortDescription",
            &"x".repeat(81),
        );
        let err = render_error(&real_config(), &locales);
        assert!(
            err.contains(
                "`store.shortDescription` in `locales/ne` is 81 characters; Google Play allows 80"
            ),
            "{err}"
        );
        let mut config = real_config();
        config.app_review_notes = "x".repeat(4001);
        assert!(render_error(&config, &real_locales()).contains("allows 4000 for `notes.txt`"));
    }

    #[test]
    fn listing_copy_is_checked_before_it_is_rendered() {
        let cases = [
            ("store.keywords", "vote,,age", "has an empty entry"),
            (
                "store.description",
                "See {homeUrl}",
                "`store.description` uses `{homeUrl}`",
            ),
        ];
        for (key, value, needle) in cases {
            let mut locales = real_locales();
            set(&mut locales, "en", key, value);
            let err = render_error(&real_config(), &locales);
            assert!(err.contains(needle), "{err}");
        }
        let mut locales = real_locales();
        locales[1]
            .modules
            .get_mut("common")
            .unwrap()
            .remove("appName");
        assert!(render_error(&real_config(), &locales)
            .contains("`common.appName` is missing from locales/"));
        let mut locales = real_locales();
        locales[1].modules.remove("common");
        assert!(render_error(&real_config(), &locales)
            .contains("`common.appName` is missing from locales/"));
        let mut config = real_config();
        config.app_review_notes = "Write to {email}".into();
        assert!(render_error(&config, &real_locales()).contains("`appReviewNotes` uses `{email}`"));
    }

    #[test]
    fn the_store_module_has_exactly_the_listing_fields() {
        let mut locales = real_locales();
        locales[0].modules.remove(STORE_MODULE);
        assert!(
            render_error(&real_config(), &locales).contains("`locales/en/store.json` is required")
        );
        let mut locales = real_locales();
        set(&mut locales, "en", "store.tagline", "x");
        assert!(render_error(&real_config(), &locales)
            .contains("`store.tagline` is not a store listing field"));
        let mut locales = real_locales();
        locales[0]
            .modules
            .get_mut(STORE_MODULE)
            .unwrap()
            .remove("keywords");
        assert!(render_error(&real_config(), &locales)
            .contains("`store.keywords` is missing from `locales/en/store.json`"));
    }

    // Verifies: REQ-MOB-011 — the addresses are https, and the deletion page is REQ-ACC-007's.
    #[test]
    fn addresses_are_https_and_name_the_deletion_page() {
        let mut config = real_config();
        config.urls.support_url = "http://tran.example/support".into();
        assert!(render_error(&config, &real_locales())
            .contains("`urls.supportUrl` must be an https://"));
        let mut config = real_config();
        config.urls.marketing_url = "https://tran.example/a b".into();
        assert!(render_error(&config, &real_locales()).contains("`urls.marketingUrl`"));
        let mut config = real_config();
        config.urls.account_deletion_url = "https://tran.example/delete".into();
        assert!(render_error(&config, &real_locales())
            .contains("must end with `/account-deletion.html`"));
    }

    fn mapping(
        locale: &str,
        app_store: StoreLanguage,
        google_play: StoreLanguage,
    ) -> LocaleMapping {
        LocaleMapping {
            locale: locale.into(),
            app_store,
            google_play,
        }
    }

    fn code(code: &str) -> StoreLanguage {
        StoreLanguage::Code(code.into())
    }

    fn skip(reason: &str) -> StoreLanguage {
        StoreLanguage::Skipped(Skip {
            skip: reason.into(),
        })
    }

    // Verifies: REQ-MOB-011 — every locale is mapped or skipped with a reason, never silently.
    #[test]
    fn every_locale_is_mapped_or_skipped_explicitly() {
        let base = real_config().locales;
        let cases: Vec<(Vec<LocaleMapping>, &str)> = vec![
            (base[..2].to_vec(), "`locales/ne` has no entry"),
            (
                [
                    base.clone(),
                    vec![mapping("fr", code("fr-FR"), code("fr-FR"))],
                ]
                .concat(),
                "maps `fr`, which is not a folder",
            ),
            (
                [base.clone(), base[..1].to_vec()].concat(),
                "maps `en` twice",
            ),
            (
                vec![
                    base[0].clone(),
                    base[1].clone(),
                    mapping("ne", skip(" "), code("ne-NP")),
                ],
                "skips `ne` on `appStore` without a reason",
            ),
            (
                vec![
                    base[0].clone(),
                    base[1].clone(),
                    mapping("ne", code("ne"), code("ne-NP")),
                ],
                "`ne`, which App Store Connect does not accept",
            ),
            (
                vec![
                    base[0].clone(),
                    base[1].clone(),
                    mapping("ne", skip("x"), code("hi-IN")),
                ],
                "`googlePlay` language `hi-IN` twice",
            ),
            (
                vec![
                    base[0].clone(),
                    base[1].clone(),
                    mapping("ne", skip("x"), code("")),
                ],
                "language `` twice or empty",
            ),
        ];
        for (locales, needle) in cases {
            let mut config = real_config();
            config.locales = locales;
            let err = render_error(&config, &real_locales());
            assert!(err.contains(needle), "expected `{needle}` in `{err}`");
        }
    }

    #[test]
    fn the_configuration_file_is_strict() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store-listing.json");
        assert!(StoreListingConfig::load(&path)
            .unwrap_err()
            .starts_with("read "));
        std::fs::write(&path, r#"{"urls": {}, "extra": 1}"#).unwrap();
        assert!(StoreListingConfig::load(&path)
            .unwrap_err()
            .starts_with("parse "));
        assert_eq!(real_config().locales[2].app_store.code(), None);
        assert!(!real_config().comment.is_empty());
    }

    #[test]
    fn apps_never_ship_the_store_module() {
        let locales = real_locales();
        assert!(locales[0].modules.contains_key(STORE_MODULE));
        let apps = app_locales(&locales);
        assert!(apps.iter().all(|d| !d.modules.contains_key(STORE_MODULE)));
        assert_eq!(apps[0].modules.len() + 1, locales[0].modules.len());
    }
}
