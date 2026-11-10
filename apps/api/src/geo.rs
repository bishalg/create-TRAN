// Verifies: REQ-RL-003 REQ-API-004
//! Client address resolution and geo mapping (spec 002, spec 031, ADR-0050).

use std::net::IpAddr;

/// An IPv4 or IPv6 CIDR block for matching trusted proxies (REQ-RL-003).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cidr {
    V4 { addr: u32, mask: u32 },
    V6 { addr: u128, mask: u128 },
}

impl Cidr {
    /// Parses an IP address or CIDR notation (`10.0.0.0/8`, `192.168.1.1`, `::1/128`).
    pub fn parse(s: &str) -> Result<Self, String> {
        let trimmed = s.trim();
        if trimmed.is_empty() {
            return Err("CIDR block cannot be empty".to_string());
        }
        let (ip_str, prefix_len) = match trimmed.split_once('/') {
            Some((ip, prefix)) => {
                let len = prefix
                    .parse::<u8>()
                    .map_err(|e| format!("invalid CIDR prefix in '{trimmed}': {e}"))?;
                (ip, Some(len))
            }
            None => (trimmed, None),
        };
        let ip: IpAddr = ip_str
            .parse()
            .map_err(|e| format!("invalid IP address in '{trimmed}': {e}"))?;
        match ip {
            IpAddr::V4(v4) => {
                let prefix = prefix_len.unwrap_or(32);
                if prefix > 32 {
                    return Err(format!("IPv4 prefix must be <= 32 in '{trimmed}'"));
                }
                let mask = if prefix == 0 {
                    0
                } else {
                    (!0u32) << (32 - prefix)
                };
                let addr = u32::from(v4) & mask;
                Ok(Self::V4 { addr, mask })
            }
            IpAddr::V6(v6) => {
                let prefix = prefix_len.unwrap_or(128);
                if prefix > 128 {
                    return Err(format!("IPv6 prefix must be <= 128 in '{trimmed}'"));
                }
                let mask = if prefix == 0 {
                    0
                } else {
                    (!0u128) << (128 - prefix)
                };
                let addr = u128::from(v6) & mask;
                Ok(Self::V6 { addr, mask })
            }
        }
    }

    /// Whether this CIDR contains the given IP address.
    pub fn contains(&self, ip: &IpAddr) -> bool {
        match (self, ip) {
            (Self::V4 { addr, mask }, IpAddr::V4(v4)) => (u32::from(*v4) & mask) == *addr,
            (Self::V6 { addr, mask }, IpAddr::V6(v6)) => (u128::from(*v6) & mask) == *addr,
            _ => false,
        }
    }
}

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

/// Extracts the client IP address (REQ-RL-003, REQ-API-004).
///
/// If direct peer is in `trusted_proxies`, reads `X-Forwarded-For` from right to left,
/// selecting the right-most address that is not itself a trusted proxy.
/// If peer is not a trusted proxy, `X-Forwarded-For` is ignored.
pub fn extract_client_ip(
    forwarded_for: Option<&str>,
    direct: Option<&str>,
    peer_addr: Option<IpAddr>,
    trusted_proxies: &[Cidr],
) -> String {
    let peer = peer_addr
        .or_else(|| direct.and_then(|d| d.trim().parse::<IpAddr>().ok()))
        .unwrap_or_else(|| IpAddr::V4(std::net::Ipv4Addr::new(127, 0, 0, 1)));

    let is_peer_trusted = trusted_proxies.iter().any(|cidr| cidr.contains(&peer));
    if !is_peer_trusted {
        return peer.to_string();
    }

    if let Some(ff) = forwarded_for {
        let hops: Vec<&str> = ff
            .split(',')
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        for hop in hops.into_iter().rev() {
            if let Ok(ip) = hop.parse::<IpAddr>() {
                if !trusted_proxies.iter().any(|cidr| cidr.contains(&ip)) {
                    return ip.to_string();
                }
            }
        }
    }

    peer.to_string()
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

    // Verifies: REQ-RL-003 REQ-API-004
    #[test]
    fn cidr_parsing_and_matching() {
        let v4 = Cidr::parse("10.0.0.0/8").unwrap();
        assert!(v4.contains(&"10.1.2.3".parse().unwrap()));
        assert!(!v4.contains(&"192.168.1.1".parse().unwrap()));

        let single_ip = Cidr::parse("192.168.1.50").unwrap();
        assert!(single_ip.contains(&"192.168.1.50".parse().unwrap()));
        assert!(!single_ip.contains(&"192.168.1.51".parse().unwrap()));

        let v6 = Cidr::parse("2001:db8::/32").unwrap();
        assert!(v6.contains(&"2001:db8:ffff::1".parse().unwrap()));
        assert!(!v6.contains(&"2001:db9::1".parse().unwrap()));
        assert!(!v6.contains(&"10.0.0.1".parse().unwrap()));
        assert!(!v4.contains(&"::1".parse().unwrap()));

        let all_v4 = Cidr::parse("0.0.0.0/0").unwrap();
        assert!(all_v4.contains(&"1.2.3.4".parse().unwrap()));

        let all_v6 = Cidr::parse("::/0").unwrap();
        assert!(all_v6.contains(&"2001:db8::1".parse().unwrap()));

        assert!(Cidr::parse("").is_err());
        assert!(Cidr::parse("not-an-ip").is_err());
        assert!(Cidr::parse("10.0.0.1/bad").is_err());
        assert!(Cidr::parse("::1/bad").is_err());
        assert!(Cidr::parse("10.0.0.1/33").is_err());
        assert!(Cidr::parse("::1/129").is_err());
    }

    // Verifies: REQ-RL-003 REQ-API-004
    #[test]
    fn untrusted_peer_ignores_forwarded_for() {
        let peer: IpAddr = "192.0.2.1".parse().unwrap();
        let res = extract_client_ip(Some("1.1.1.1, 2.2.2.2"), None, Some(peer), &[]);
        assert_eq!(res, "192.0.2.1");

        // Direct fallback when peer_addr is None
        assert_eq!(
            extract_client_ip(None, Some("198.51.100.1"), None, &[]),
            "198.51.100.1"
        );
        assert_eq!(
            extract_client_ip(None, Some("not-an-ip"), None, &[]),
            "127.0.0.1"
        );
    }

    // Verifies: REQ-RL-003 REQ-API-004
    #[test]
    fn trusted_proxy_reads_rightmost_untrusted_address() {
        let proxy1 = Cidr::parse("10.0.0.0/8").unwrap();
        let proxy2 = Cidr::parse("172.16.0.0/12").unwrap();
        let proxies = [proxy1, proxy2];

        let peer: IpAddr = "10.0.0.1".parse().unwrap();
        // Client: 203.0.113.195, Intermediate proxy: 172.16.0.5, Peer proxy: 10.0.0.1
        let res = extract_client_ip(
            Some("1.1.1.1, 203.0.113.195, 172.16.0.5"),
            None,
            Some(peer),
            &proxies,
        );
        assert_eq!(res, "203.0.113.195");
    }

    // Verifies: REQ-RL-003 REQ-API-004
    #[test]
    fn trusted_proxy_falls_back_when_all_trusted_or_invalid() {
        let proxy = Cidr::parse("10.0.0.0/8").unwrap();
        let peer: IpAddr = "10.0.0.1".parse().unwrap();

        let all_trusted = extract_client_ip(
            Some("10.0.0.2, 10.0.0.3"),
            None,
            Some(peer),
            std::slice::from_ref(&proxy),
        );
        assert_eq!(all_trusted, "10.0.0.1");

        let invalid = extract_client_ip(
            Some("invalid-ip, another-bad"),
            None,
            Some(peer),
            std::slice::from_ref(&proxy),
        );
        assert_eq!(invalid, "10.0.0.1");

        let none_ff = extract_client_ip(None, None, Some(peer), std::slice::from_ref(&proxy));
        assert_eq!(none_ff, "10.0.0.1");
    }

    #[test]
    fn extract_client_ip_falls_back_to_loopback_when_nothing_provided() {
        assert_eq!(extract_client_ip(None, None, None, &[]), "127.0.0.1");
    }
}
