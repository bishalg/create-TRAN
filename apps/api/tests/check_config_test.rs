// Verifies: REQ-DEP-003
//! Configuration pre-flight validation (spec 032): `api check-config`.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use api::commands::check_config;
use api::config::AppConfig;

#[test]
fn valid_development_config_passes() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let result = check_config(&config);
    assert!(result.is_ok());
    let msg = result.unwrap();
    assert!(msg.contains("development"));
}

#[test]
fn valid_production_config_with_cors_and_db_passes() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("production".to_string()),
        "CORS_ALLOWED_ORIGINS" => Some("https://example.com".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let result = check_config(&config);
    assert!(result.is_ok());
    let msg = result.unwrap();
    assert!(msg.contains("production"));
}

#[test]
fn production_without_cors_allowed_origins_fails_naming_the_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("production".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("CORS_ALLOWED_ORIGINS"));
}

#[test]
fn malformed_database_path_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("invalid-scheme://db".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("DATABASE_URL"));
    assert!(!err.message.contains("invalid-scheme://db"));
}

#[test]
fn malformed_client_versions_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        "CLIENT_MIN_VERSION_IOS" => Some("not-semver".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("CLIENT_MIN_VERSION_IOS"));
    assert!(!err.message.contains("not-semver"));
}

#[test]
fn malformed_push_settings_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        "APNS_KEY_ID" => Some("KEY123".to_string()),
        // Missing APNS_TEAM_ID, APNS_TOPIC, APNS_KEY_P8
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("APNS"));
}

#[test]
fn malformed_trusted_proxies_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        "TRUSTED_PROXIES" => Some("not-a-cidr".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("TRUSTED_PROXIES"));
}

#[test]
fn malformed_rate_policy_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        "RATE_LIMIT_AUTH" => Some("bad/format".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("RATE_LIMIT_AUTH"));
}

#[test]
fn malformed_migrate_on_start_fails_naming_variable() {
    let lookup = |key: &str| match key {
        "APP_ENV" => Some("development".to_string()),
        "DATABASE_URL" => Some("sqlite::memory:".to_string()),
        "MIGRATE_ON_START" => Some("maybe".to_string()),
        _ => None,
    };
    let config = AppConfig::from_lookup(lookup);
    let err = check_config(&config).unwrap_err();
    assert_eq!(err.exit_code, 2);
    assert!(err.message.contains("MIGRATE_ON_START"));
}

fn check(pairs: &'static [(&'static str, &'static str)]) -> Result<String, api::commands::Failure> {
    check_config(&AppConfig::from_lookup(|key| {
        pairs
            .iter()
            .chain([("DATABASE_URL", "sqlite::memory:")].iter())
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.to_string())
    }))
}

// Verifies: REQ-DEP-003 REQ-OBS-006 REQ-OBS-008 REQ-RL-001 REQ-RL-007
#[test]
fn malformed_server_settings_fail_naming_the_variable_only() {
    let cases: [&'static [(&str, &str)]; 6] = [
        &[("PORT", "abc")],
        &[("METRICS_ADDR", "off")],
        &[("SHUTDOWN_GRACE_MS", "15s")],
        &[("RATE_LIMIT_AUTH", "0")],
        &[("RATE_LIMIT_READ", "10/0")],
        &[("RATE_MAX_IN_FLIGHT", "many")],
    ];
    for pairs in cases {
        let (name, value) = pairs[0];
        let err = check(pairs).unwrap_err();
        assert_eq!(err.exit_code, 2);
        assert!(err.message.contains(name), "{name}: {}", err.message);
        assert!(!err.message.contains(value), "{name}: {}", err.message);
    }
}

// Verifies: REQ-DEP-003 REQ-CFG-004
#[test]
fn remote_config_path_must_exist_and_parse_when_set() {
    let dir = std::env::temp_dir().join(format!("tran-check-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("flags.json");
    let leaked: &'static str = Box::leak(path.display().to_string().into_boxed_str());
    let pairs: &'static [(&str, &str)] = Box::leak(Box::new([("REMOTE_CONFIG_PATH", leaked)]));

    let missing = check(pairs).unwrap_err();
    assert!(missing.message.contains("REMOTE_CONFIG_PATH"));
    assert!(!missing.message.contains(leaked));

    std::fs::write(&path, "{ not json").unwrap();
    assert!(check(pairs)
        .unwrap_err()
        .message
        .contains("REMOTE_CONFIG_PATH"));

    std::fs::write(
        &path,
        r#"{ "flags": { "notify_me": [ { "rollout": 5, "value": true } ] } }"#,
    )
    .unwrap();
    assert!(check(pairs).is_ok());
}
