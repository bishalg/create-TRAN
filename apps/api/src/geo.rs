// Verifies: REQ-RL-003 REQ-API-004
//! Client address resolution and geo mapping (spec 002, spec 031, ADR-0050).

use std::net::{IpAddr, SocketAddr};

use axum::http::HeaderMap;

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

/// The address a request without a socket peer is counted as: only an in-process caller (a test
/// driving the router directly) has none, and it is never treated as a trusted proxy.
pub const NO_PEER: IpAddr = IpAddr::V4(std::net::Ipv4Addr::LOCALHOST);

/// The client's address (REQ-RL-003, replacing the first-hop rule of REQ-API-004).
///
/// `peer` is the socket's remote address. Only when it is in `trusted_proxies` is
/// `X-Forwarded-For` read: every header line in order, as one list, walked from the right past
/// trusted proxies to the first address that is not one. A hop that does not parse (anything but
/// an IP address, `ip:port`, `[ipv6]` or `[ipv6]:port`) makes the whole header ignored, so a
/// caller can never steer the scan into values it wrote itself. No other header is consulted.
pub fn client_address(
    headers: &HeaderMap,
    peer: Option<IpAddr>,
    trusted_proxies: &[Cidr],
) -> IpAddr {
    let Some(peer) = peer.map(|ip| ip.to_canonical()) else {
        return NO_PEER;
    };
    let trusted = |ip: &IpAddr| trusted_proxies.iter().any(|cidr| cidr.contains(ip));
    if !trusted(&peer) {
        return peer;
    }
    let Some(lines) = headers
        .get_all(X_FORWARDED_FOR)
        .iter()
        .map(|value| value.to_str().ok())
        .collect::<Option<Vec<&str>>>()
    else {
        return peer;
    };
    let hops: Vec<&str> = lines.iter().flat_map(|line| line.split(',')).collect();
    for hop in hops.into_iter().rev() {
        let Some(ip) = parse_hop(hop) else {
            return peer;
        };
        if !trusted(&ip) {
            return ip;
        }
    }
    peer
}

const X_FORWARDED_FOR: &str = "x-forwarded-for";

/// One `X-Forwarded-For` entry: an address, optionally with a port as some proxies append it.
fn parse_hop(hop: &str) -> Option<IpAddr> {
    let hop = hop.trim();
    let ip = hop
        .parse::<IpAddr>()
        .ok()
        .or_else(|| hop.parse::<SocketAddr>().ok().map(|socket| socket.ip()))
        .or_else(|| {
            hop.strip_prefix('[')?
                .strip_suffix(']')?
                .parse::<std::net::Ipv6Addr>()
                .ok()
                .map(IpAddr::V6)
        })?;
    Some(ip.to_canonical())
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

    fn xff(lines: &[&str]) -> HeaderMap {
        let mut headers = HeaderMap::new();
        for line in lines {
            headers.append(X_FORWARDED_FOR, line.parse().unwrap());
        }
        headers
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    // Verifies: REQ-RL-003
    #[test]
    fn untrusted_peer_ignores_forwarded_for() {
        let headers = xff(&["1.1.1.1, 2.2.2.2"]);
        assert_eq!(
            client_address(&headers, Some(ip("192.0.2.1")), &[]),
            ip("192.0.2.1")
        );
        let lb = [Cidr::parse("10.0.0.0/8").unwrap()];
        assert_eq!(
            client_address(&headers, Some(ip("192.0.2.1")), &lb),
            ip("192.0.2.1")
        );
    }

    // Verifies: REQ-RL-003
    #[test]
    fn no_peer_is_never_a_trusted_proxy() {
        let loopback = [Cidr::parse("127.0.0.1/32").unwrap()];
        let headers = xff(&["203.0.113.7"]);
        assert_eq!(client_address(&headers, None, &loopback), NO_PEER);
    }

    // Verifies: REQ-RL-003
    #[test]
    fn trusted_proxy_reads_rightmost_untrusted_address() {
        let proxies = [
            Cidr::parse("10.0.0.0/8").unwrap(),
            Cidr::parse("172.16.0.0/12").unwrap(),
        ];
        let peer = Some(ip("10.0.0.1"));
        let headers = xff(&["1.1.1.1, 203.0.113.195, 172.16.0.5"]);
        assert_eq!(
            client_address(&headers, peer, &proxies),
            ip("203.0.113.195")
        );
        // Several header lines are one list, in order: the last line holds the nearest hops.
        let split = xff(&["1.1.1.1, 203.0.113.195", "172.16.0.5"]);
        assert_eq!(client_address(&split, peer, &proxies), ip("203.0.113.195"));
        let later = xff(&["6.6.6.6", "203.0.113.9, 172.16.0.5"]);
        assert_eq!(client_address(&later, peer, &proxies), ip("203.0.113.9"));
    }

    // Verifies: REQ-RL-003
    #[test]
    fn an_unparsable_hop_ignores_the_header_instead_of_walking_into_caller_values() {
        let proxy = [Cidr::parse("10.0.0.0/8").unwrap()];
        let peer = Some(ip("10.0.0.1"));
        for header in [
            "6.6.6.6, not-an-ip",
            "6.6.6.6, 203.0.113.7:51234:9",
            "6.6.6.6, unknown, 10.0.0.2",
            "6.6.6.6,,10.0.0.2",
            "6.6.6.6, [::1",
            "6.6.6.6, []",
        ] {
            assert_eq!(
                client_address(&xff(&[header]), peer, &proxy),
                ip("10.0.0.1"),
                "{header}"
            );
        }
        let mut binary = HeaderMap::new();
        binary.append(
            X_FORWARDED_FOR,
            axum::http::HeaderValue::from_bytes(b"\xff6.6.6.6").unwrap(),
        );
        assert_eq!(client_address(&binary, peer, &proxy), ip("10.0.0.1"));
    }

    // Verifies: REQ-RL-003
    #[test]
    fn hops_with_ports_and_mapped_addresses_parse() {
        let proxy = [Cidr::parse("10.0.0.0/8").unwrap()];
        let peer = Some(ip("::ffff:10.0.0.1"));
        let cases = [
            ("6.6.6.6, 203.0.113.7:51234", "203.0.113.7"),
            ("[2001:db8::7]:443", "2001:db8::7"),
            ("[2001:db8::8]", "2001:db8::8"),
            ("::ffff:203.0.113.8", "203.0.113.8"),
            ("203.0.113.9, ::ffff:10.0.0.3", "203.0.113.9"),
        ];
        for (header, want) in cases {
            assert_eq!(
                client_address(&xff(&[header]), peer, &proxy),
                ip(want),
                "{header}"
            );
        }
    }

    // Verifies: REQ-RL-003
    #[test]
    fn trusted_proxy_falls_back_to_the_peer_when_every_hop_is_trusted_or_absent() {
        let proxy = [Cidr::parse("10.0.0.0/8").unwrap()];
        let peer = Some(ip("10.0.0.1"));
        assert_eq!(
            client_address(&xff(&["10.0.0.2, 10.0.0.3"]), peer, &proxy),
            ip("10.0.0.1")
        );
        assert_eq!(
            client_address(&HeaderMap::new(), peer, &proxy),
            ip("10.0.0.1")
        );
        let mut real_ip = HeaderMap::new();
        real_ip.insert("x-real-ip", "8.8.4.4".parse().unwrap());
        assert_eq!(client_address(&real_ip, peer, &proxy), ip("10.0.0.1"));
    }
}
