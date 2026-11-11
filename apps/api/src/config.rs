use std::env;

use rust_core::rate::{ClassPolicy, RatePolicy};

use crate::client_versions::ClientVersionSettings;
use crate::db::Location;
use crate::geo::Cidr;
use crate::push::providers::PushSettings;
use crate::secret::Secret;

/// How the API writes its logs (REQ-ROB-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogFormat {
    /// Multi-line and coloured, for a developer's terminal.
    Pretty,
    /// One JSON object per line, for log shippers and agents that grep.
    Json,
}

/// Browser origins allowed when `CORS_ALLOWED_ORIGINS` is unset, in `development` and `test` only:
/// the Vite dev server (both spellings) and Expo web.
pub const LOCAL_DEV_ORIGINS: [&str; 3] = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:8081",
];

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub environment: String,
    /// `CORS_ALLOWED_ORIGINS`, split on commas; `None` when unset or blank.
    pub cors_allowed_origins: Option<Vec<String>>,
    /// The APNs and FCM credentials; a provider without them is off (ADR-0046).
    pub push: PushSettings,
    /// `CLIENT_MIN_VERSION_*` and `CLIENT_RECOMMENDED_VERSION_*`, as read (REQ-VER-005).
    pub client_versions: ClientVersionSettings,
    /// `DATABASE_URL`: it may carry a password, so it is a [`Secret`] (REQ-DB-001).
    pub database_url: Option<Secret>,
    /// `MIGRATE_ON_START`, as read (REQ-DB-003).
    pub migrate_on_start: Option<String>,
    /// `TRUSTED_PROXIES`, as read (REQ-RL-003).
    pub trusted_proxies: Option<String>,
    /// `RATE_LIMIT_AUTH`, as read (REQ-RL-001).
    pub rate_limit_auth: Option<String>,
    /// `RATE_LIMIT_WRITE`, as read (REQ-RL-001).
    pub rate_limit_write: Option<String>,
    /// `RATE_LIMIT_READ`, as read (REQ-RL-001).
    pub rate_limit_read: Option<String>,
    /// `RATE_MAX_IN_FLIGHT`, as read (REQ-RL-007).
    pub rate_max_in_flight: Option<usize>,
    /// `METRICS_ADDR`, private metrics listener address (REQ-OBS-006).
    pub metrics_addr: Option<String>,
    /// `SHUTDOWN_GRACE_MS`, drain window in ms on shutdown (REQ-OBS-008).
    pub shutdown_grace_ms: u64,
    /// `REMOTE_CONFIG_PATH`, path to dynamic JSON feature flag rules file (REQ-CFG-004).
    pub remote_config_path: Option<String>,
}

impl AppConfig {
    /// Reads the process environment.
    pub fn from_env() -> Self {
        Self::from_lookup(|key| env::var(key).ok())
    }

    /// Pure core of config loading: `lookup` is injected so tests never touch the real environment.
    pub fn from_lookup(lookup: impl Fn(&str) -> Option<String>) -> Self {
        Self {
            host: lookup("HOST").unwrap_or_else(|| "0.0.0.0".to_string()),
            port: lookup("PORT")
                .and_then(|p| p.parse::<u16>().ok())
                .unwrap_or(3001),
            environment: lookup("APP_ENV").unwrap_or_else(|| "development".to_string()),
            cors_allowed_origins: lookup("CORS_ALLOWED_ORIGINS")
                .map(|raw| {
                    raw.split(',')
                        .map(str::trim)
                        .filter(|origin| !origin.is_empty())
                        .map(str::to_owned)
                        .collect::<Vec<_>>()
                })
                .filter(|origins| !origins.is_empty()),
            push: PushSettings::from_lookup(&lookup),
            client_versions: ClientVersionSettings::from_lookup(&lookup),
            database_url: lookup("DATABASE_URL")
                .filter(|url| !url.trim().is_empty())
                .map(Secret::new),
            migrate_on_start: lookup("MIGRATE_ON_START"),
            trusted_proxies: lookup("TRUSTED_PROXIES"),
            rate_limit_auth: lookup("RATE_LIMIT_AUTH"),
            rate_limit_write: lookup("RATE_LIMIT_WRITE"),
            rate_limit_read: lookup("RATE_LIMIT_READ"),
            rate_max_in_flight: lookup("RATE_MAX_IN_FLIGHT").and_then(|s| s.trim().parse().ok()),
            metrics_addr: lookup("METRICS_ADDR").filter(|s| !s.trim().is_empty()),
            shutdown_grace_ms: lookup("SHUTDOWN_GRACE_MS")
                .and_then(|s| s.trim().parse().ok())
                .unwrap_or(10_000),
            remote_config_path: lookup("REMOTE_CONFIG_PATH")
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty()),
        }
    }

    /// Private metrics listener address if configured (REQ-OBS-006).
    pub fn metrics_addr(&self) -> Option<&str> {
        self.metrics_addr.as_deref()
    }

    /// Shutdown grace period in ms (REQ-OBS-008).
    pub fn shutdown_grace_ms(&self) -> u64 {
        self.shutdown_grace_ms
    }

    /// Where the database is (REQ-DB-001): `DATABASE_URL`, else `data/api.sqlite3`.
    pub fn database(&self) -> Result<Location, String> {
        Location::parse(self.database_url.as_ref())
    }

    /// Whether the server applies pending migrations when it starts (REQ-DB-003): `true` or
    /// `false`; unset or empty, only in `development` and `test`.
    pub fn migrate_on_start(&self) -> Result<bool, String> {
        match self.migrate_on_start.as_deref().map(str::trim) {
            None | Some("") => Ok(self.is_local()),
            Some("true") => Ok(true),
            Some("false") => Ok(false),
            Some(_) => Err("MIGRATE_ON_START must be true or false".to_string()),
        }
    }

    /// Trusted proxies for client IP extraction (REQ-RL-003): `TRUSTED_PROXIES`.
    pub fn trusted_proxies(&self) -> Result<Vec<Cidr>, String> {
        let Some(raw) = self.trusted_proxies.as_deref().map(str::trim) else {
            return Ok(Vec::new());
        };
        if raw.is_empty() {
            return Ok(Vec::new());
        }
        raw.split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(|s| Cidr::parse(s).map_err(|e| format!("TRUSTED_PROXIES: {e}")))
            .collect()
    }

    /// Rate limiting policy, with overrides from `RATE_LIMIT_<CLASS>` (REQ-RL-001).
    pub fn rate_policy(&self) -> Result<RatePolicy, String> {
        let mut policy = rust_core::rate::RATE_POLICY;
        if let Some(auth) = parse_class_policy(
            self.rate_limit_auth.as_deref(),
            policy.auth,
            "RATE_LIMIT_AUTH",
        )? {
            policy.auth = auth;
        }
        if let Some(write) = parse_class_policy(
            self.rate_limit_write.as_deref(),
            policy.write,
            "RATE_LIMIT_WRITE",
        )? {
            policy.write = write;
        }
        if let Some(read) = parse_class_policy(
            self.rate_limit_read.as_deref(),
            policy.read,
            "RATE_LIMIT_READ",
        )? {
            policy.read = read;
        }
        if let Some(max) = self.rate_max_in_flight {
            policy.max_in_flight = max;
        }
        Ok(policy)
    }

    /// `development` and `test`: a developer's machine or CI, not a deployment.
    pub fn is_local(&self) -> bool {
        matches!(self.environment.as_str(), "development" | "test")
    }

    /// Debug-only request headers (`X-Debug-Country`) are trusted only in `development` and `test`.
    pub fn allows_debug_headers(&self) -> bool {
        self.is_local()
    }

    /// Every other environment is served over HTTPS: cookies get `Secure` (REQ-SEC-007) and
    /// responses get `Strict-Transport-Security` (REQ-SEC-013).
    pub fn requires_https(&self) -> bool {
        !self.is_local()
    }

    /// The browser origins allowed to call the API with credentials (REQ-API-007): the configured
    /// list, else the local dev origins on a local machine, else none.
    pub fn allowed_origins(&self) -> Vec<String> {
        match &self.cors_allowed_origins {
            Some(origins) => origins.clone(),
            None if self.is_local() => LOCAL_DEV_ORIGINS.map(str::to_owned).to_vec(),
            None => Vec::new(),
        }
    }

    fn is_development(&self) -> bool {
        self.environment == "development"
    }

    /// Pretty in `development`, JSON everywhere else.
    pub fn log_format(&self) -> LogFormat {
        if self.is_development() {
            LogFormat::Pretty
        } else {
            LogFormat::Json
        }
    }

    /// Used when `RUST_LOG` is unset: every request's completion in `development`, only failures
    /// worth a look (`info` and up) elsewhere.
    pub fn default_log_filter(&self) -> &'static str {
        if self.is_development() {
            "api=debug"
        } else {
            "api=info"
        }
    }

    pub fn socket_addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn parse_class_policy(
    raw: Option<&str>,
    fallback: ClassPolicy,
    var_name: &str,
) -> Result<Option<ClassPolicy>, String> {
    let Some(raw) = raw.map(str::trim) else {
        return Ok(None);
    };
    if raw.is_empty() {
        return Ok(None);
    }
    let (sustained_str, burst_str) = match raw.split_once('/') {
        Some((s, b)) => (s.trim(), Some(b.trim())),
        None => (raw, None),
    };
    let sustained = sustained_str
        .parse::<u32>()
        .map_err(|_| format!("{var_name} must specify a positive integer for sustained rate"))?;
    let burst = if let Some(b) = burst_str {
        b.parse::<u32>()
            .map_err(|_| format!("{var_name} must specify a positive integer for burst"))?
    } else {
        fallback.burst
    };
    Ok(Some(ClassPolicy::new(sustained, burst)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn config_from(pairs: &[(&str, &str)]) -> AppConfig {
        let vars: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        AppConfig::from_lookup(|key| vars.get(key).cloned())
    }

    #[test]
    fn defaults_apply_when_nothing_is_set() {
        let cfg = config_from(&[]);
        assert_eq!(cfg.socket_addr(), "0.0.0.0:3001");
        assert_eq!(cfg.environment, "development");
    }

    #[test]
    fn values_are_read_from_the_lookup() {
        let cfg = config_from(&[("HOST", "127.0.0.1"), ("PORT", "4000"), ("APP_ENV", "test")]);
        assert_eq!(cfg.socket_addr(), "127.0.0.1:4000");
        assert_eq!(cfg.environment, "test");
    }

    #[test]
    fn an_unparsable_port_falls_back_to_the_default() {
        assert_eq!(config_from(&[("PORT", "not-a-port")]).port, 3001);
        assert_eq!(config_from(&[("PORT", "99999")]).port, 3001);
    }

    // Verifies: REQ-API-006
    #[test]
    fn debug_headers_are_allowed_only_in_development_and_test() {
        assert!(config_from(&[]).allows_debug_headers());
        assert!(config_from(&[("APP_ENV", "test")]).allows_debug_headers());
        assert!(!config_from(&[("APP_ENV", "production")]).allows_debug_headers());
        assert!(!config_from(&[("APP_ENV", "staging")]).allows_debug_headers());
    }

    // Verifies: REQ-ROB-007
    #[test]
    fn logs_are_pretty_and_verbose_only_in_development() {
        let dev = config_from(&[]);
        assert_eq!(dev.log_format(), LogFormat::Pretty);
        assert_eq!(dev.default_log_filter(), "api=debug");
        for env in ["test", "staging", "production"] {
            let cfg = config_from(&[("APP_ENV", env)]);
            assert_eq!(cfg.log_format(), LogFormat::Json, "{env}");
            assert_eq!(cfg.default_log_filter(), "api=info", "{env}");
        }
    }

    // Verifies: REQ-API-007
    #[test]
    fn cors_origins_come_from_configuration() {
        let cfg = config_from(&[(
            "CORS_ALLOWED_ORIGINS",
            " https://app.example.com, ,https://admin.example.com ",
        )]);
        assert_eq!(
            cfg.allowed_origins(),
            ["https://app.example.com", "https://admin.example.com"]
        );
        let prod = config_from(&[
            ("APP_ENV", "production"),
            ("CORS_ALLOWED_ORIGINS", "https://app.example.com"),
        ]);
        assert_eq!(prod.allowed_origins(), ["https://app.example.com"]);
    }

    // Verifies: REQ-API-007
    #[test]
    fn unset_cors_origins_allow_local_dev_only_on_a_local_machine() {
        for env in ["development", "test"] {
            let cfg = config_from(&[("APP_ENV", env), ("CORS_ALLOWED_ORIGINS", " , ")]);
            assert_eq!(cfg.allowed_origins(), LOCAL_DEV_ORIGINS, "{env}");
        }
        for env in ["staging", "production"] {
            assert!(config_from(&[("APP_ENV", env)])
                .allowed_origins()
                .is_empty());
        }
    }

    // Verifies: REQ-SEC-007 REQ-SEC-013
    #[test]
    fn https_is_required_outside_development_and_test() {
        assert!(!config_from(&[]).requires_https());
        assert!(!config_from(&[("APP_ENV", "test")]).requires_https());
        assert!(config_from(&[("APP_ENV", "production")]).requires_https());
    }

    // Verifies: REQ-DB-001
    #[test]
    fn the_database_is_a_file_under_data_unless_database_url_names_one() {
        assert_eq!(
            config_from(&[]).database(),
            Ok(Location::File("data/api.sqlite3".into()))
        );
        assert_eq!(
            config_from(&[("DATABASE_URL", " ")]).database(),
            Ok(Location::File("data/api.sqlite3".into()))
        );
        let memory = config_from(&[("DATABASE_URL", "sqlite::memory:")]);
        assert_eq!(memory.database(), Ok(Location::Memory));
        assert_eq!(format!("{:?}", memory.database_url), "Some([redacted])");
        assert!(config_from(&[("DATABASE_URL", "mysql://x")])
            .database()
            .is_err());
    }

    // Verifies: REQ-DB-003
    #[test]
    fn migrating_on_start_is_the_default_only_in_development_and_test() {
        assert_eq!(config_from(&[]).migrate_on_start(), Ok(true));
        assert_eq!(
            config_from(&[("APP_ENV", "test")]).migrate_on_start(),
            Ok(true)
        );
        for env in ["staging", "production"] {
            let cfg = config_from(&[("APP_ENV", env), ("MIGRATE_ON_START", "")]);
            assert_eq!(cfg.migrate_on_start(), Ok(false), "{env}");
        }
        let forced = config_from(&[("APP_ENV", "production"), ("MIGRATE_ON_START", "true")]);
        assert_eq!(forced.migrate_on_start(), Ok(true));
        let off = config_from(&[("MIGRATE_ON_START", " false ")]);
        assert_eq!(off.migrate_on_start(), Ok(false));
        assert_eq!(
            config_from(&[("MIGRATE_ON_START", "yes")]).migrate_on_start(),
            Err("MIGRATE_ON_START must be true or false".to_string())
        );
    }

    #[test]
    fn from_env_produces_a_usable_address() {
        assert!(AppConfig::from_env().socket_addr().contains(':'));
    }

    // Verifies: REQ-RL-003
    #[test]
    fn trusted_proxies_parses_comma_separated_cidrs_or_empty() {
        assert_eq!(config_from(&[]).trusted_proxies().unwrap(), Vec::new());
        assert_eq!(
            config_from(&[("TRUSTED_PROXIES", " ")])
                .trusted_proxies()
                .unwrap(),
            Vec::new()
        );
        let parsed = config_from(&[("TRUSTED_PROXIES", "127.0.0.1/32, 10.0.0.0/8")])
            .trusted_proxies()
            .unwrap();
        assert_eq!(parsed.len(), 2);
        assert!(parsed[0].contains(&"127.0.0.1".parse().unwrap()));
        assert!(parsed[1].contains(&"10.2.3.4".parse().unwrap()));

        assert!(config_from(&[("TRUSTED_PROXIES", "invalid-cidr")])
            .trusted_proxies()
            .is_err());
    }

    // Verifies: REQ-RL-001
    #[test]
    fn rate_policy_reads_defaults_and_overrides() {
        let defaults = config_from(&[]).rate_policy().unwrap();
        assert_eq!(defaults.auth.sustained_per_minute, 10);
        assert_eq!(defaults.auth.burst, 5);

        let overridden = config_from(&[
            ("RATE_LIMIT_AUTH", "20/10"),
            ("RATE_LIMIT_WRITE", "80"),
            ("RATE_LIMIT_READ", "400/100"),
        ])
        .rate_policy()
        .unwrap();

        assert_eq!(overridden.auth.sustained_per_minute, 20);
        assert_eq!(overridden.auth.burst, 10);
        assert_eq!(overridden.write.sustained_per_minute, 80);
        assert_eq!(overridden.write.burst, 20); // Fallback burst
        assert_eq!(overridden.read.sustained_per_minute, 400);
        assert_eq!(overridden.read.burst, 100);

        assert_eq!(
            config_from(&[("RATE_LIMIT_AUTH", "   ")])
                .rate_policy()
                .unwrap()
                .auth
                .sustained_per_minute,
            10
        );
        assert!(config_from(&[("RATE_LIMIT_AUTH", "bad")])
            .rate_policy()
            .is_err());
        assert!(config_from(&[("RATE_LIMIT_AUTH", "20/bad")])
            .rate_policy()
            .is_err());
        assert!(config_from(&[("RATE_LIMIT_WRITE", "bad")])
            .rate_policy()
            .is_err());
        assert!(config_from(&[("RATE_LIMIT_READ", "bad")])
            .rate_policy()
            .is_err());

        let with_max = config_from(&[("RATE_MAX_IN_FLIGHT", "50")])
            .rate_policy()
            .unwrap();
        assert_eq!(with_max.max_in_flight, 50);
    }

    #[test]
    fn metrics_addr_and_shutdown_grace_ms() {
        let cfg = config_from(&[
            ("METRICS_ADDR", "127.0.0.1:9090"),
            ("SHUTDOWN_GRACE_MS", "5000"),
        ]);
        assert_eq!(cfg.metrics_addr(), Some("127.0.0.1:9090"));
        assert_eq!(cfg.shutdown_grace_ms(), 5000);

        let empty = config_from(&[("METRICS_ADDR", "   ")]);
        assert_eq!(empty.metrics_addr(), None);
        assert_eq!(empty.shutdown_grace_ms(), 10_000);

        let remote_cfg = config_from(&[("REMOTE_CONFIG_PATH", " /etc/tran/flags.json ")]);
        assert_eq!(
            remote_cfg.remote_config_path.as_deref(),
            Some("/etc/tran/flags.json")
        );
        let empty_remote = config_from(&[("REMOTE_CONFIG_PATH", "   ")]);
        assert_eq!(empty_remote.remote_config_path, None);
    }
}
