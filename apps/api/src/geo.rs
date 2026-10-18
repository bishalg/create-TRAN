/// Stub geo resolution for the template (no external API).
/// Prefer `X-Debug-Country` in development; map loopback IPs to US.
pub fn country_from_client_ip(ip: &str, debug_country: Option<&str>) -> (String, String) {
    if let Some(code) = debug_country {
        let trimmed = code.trim();
        if !trimmed.is_empty() {
            return (trimmed.to_uppercase(), "x-debug-country".to_string());
        }
    }

    let normalized = ip.trim();
    if normalized == "127.0.0.1" || normalized == "::1" || normalized == "localhost" {
        return ("US".to_string(), "loopback-default".to_string());
    }

    // Template stub: pretend private ranges are India for demo variety.
    if normalized.starts_with("10.") || normalized.starts_with("192.168.") {
        return ("IN".to_string(), "private-range-stub".to_string());
    }

    ("US".to_string(), "default".to_string())
}

pub fn extract_client_ip(forwarded_for: Option<&str>, direct: Option<&str>) -> String {
    if let Some(ff) = forwarded_for {
        let first = ff.split(',').next().unwrap_or(ff).trim();
        if !first.is_empty() {
            return first.to_string();
        }
    }
    direct
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_country_wins_and_is_uppercased() {
        assert_eq!(
            country_from_client_ip("8.8.8.8", Some(" np ")),
            ("NP".to_string(), "x-debug-country".to_string())
        );
    }

    #[test]
    fn blank_debug_country_is_ignored() {
        assert_eq!(country_from_client_ip("8.8.8.8", Some("   ")).1, "default");
    }

    #[test]
    fn loopback_addresses_default_to_us() {
        for ip in ["127.0.0.1", "::1", "localhost", " 127.0.0.1 "] {
            assert_eq!(
                country_from_client_ip(ip, None),
                ("US".to_string(), "loopback-default".to_string()),
                "{ip}"
            );
        }
    }

    #[test]
    fn private_ranges_stub_to_india() {
        for ip in ["10.1.2.3", "192.168.0.10"] {
            assert_eq!(country_from_client_ip(ip, None).0, "IN", "{ip}");
        }
    }

    #[test]
    fn public_addresses_use_the_default() {
        assert_eq!(
            country_from_client_ip("8.8.8.8", None),
            ("US".to_string(), "default".to_string())
        );
    }

    #[test]
    fn forwarded_for_uses_first_hop_trimmed() {
        assert_eq!(
            extract_client_ip(Some(" 1.1.1.1 , 2.2.2.2"), None),
            "1.1.1.1"
        );
    }

    #[test]
    fn empty_forwarded_for_falls_through_to_real_ip() {
        assert_eq!(extract_client_ip(Some("  "), Some("3.3.3.3")), "3.3.3.3");
    }

    #[test]
    fn no_headers_defaults_to_loopback() {
        assert_eq!(extract_client_ip(None, None), "127.0.0.1");
        assert_eq!(extract_client_ip(None, Some("  ")), "127.0.0.1");
    }
}
