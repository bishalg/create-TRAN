use std::env;

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
        }
    }

    /// `development` and `test`: a developer's machine or CI, not a deployment.
    fn is_local(&self) -> bool {
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

    #[test]
    fn from_env_produces_a_usable_address() {
        assert!(AppConfig::from_env().socket_addr().contains(':'));
    }
}
