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
