use std::env;

#[derive(Debug, Clone)]
pub struct AppConfig {
    pub host: String,
    pub port: u16,
    pub environment: String,
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
        }
    }

    /// Debug-only request headers (`X-Debug-Country`) are trusted only in `development` and `test`.
    pub fn allows_debug_headers(&self) -> bool {
        matches!(self.environment.as_str(), "development" | "test")
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

    #[test]
    fn from_env_produces_a_usable_address() {
        assert!(AppConfig::from_env().socket_addr().contains(':'));
    }
}
