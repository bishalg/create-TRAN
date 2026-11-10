//! A value that must never be printed by accident (REQ-SEC-004).
//!
//! Every token and any future configuration secret lives in a [`Secret`]: `{:?}` and `{}` print
//! `[redacted]`, it is deliberately not `Serialize`, and the value is reachable only through
//! [`Secret::expose`], so every place that uses it is easy to find in review.

use std::fmt;

/// What a [`Secret`] prints instead of its value.
pub const REDACTED: &str = "[redacted]";

#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The value itself. Call it only where the value must leave the process (a response body,
    /// a `Set-Cookie` header) or be hashed.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-SEC-004
    #[test]
    fn debug_and_display_print_redacted() {
        let secret = Secret::new("tok-SENTINEL");
        assert_eq!(format!("{secret:?}"), "[redacted]");
        assert_eq!(format!("{secret}"), "[redacted]");
        assert_eq!(format!("{:?}", Some(secret.clone())), "Some([redacted])");
        let mut logged = String::new();
        fmt::Write::write_fmt(&mut logged, format_args!("{secret} {secret:#?}")).unwrap();
        assert!(!logged.contains("SENTINEL"), "{logged}");
    }

    // Verifies: REQ-SEC-004
    #[test]
    fn the_value_is_reachable_only_through_expose() {
        let secret = Secret::new(String::from("tok-1"));
        assert_eq!(secret.expose(), "tok-1");
        assert_eq!(secret, Secret::new("tok-1"));
    }

    /// Compile-time proof that `Secret` is not `Serialize`: if it were, both impls below would
    /// apply and `<Secret as NotSerialize<_>>` would be ambiguous, which does not compile.
    trait NotSerialize<Marker> {
        fn check() -> bool {
            true
        }
    }
    impl<T: ?Sized> NotSerialize<()> for T {}
    struct IsSerialize;
    impl<T: ?Sized + serde::Serialize> NotSerialize<IsSerialize> for T {}

    // Verifies: REQ-SEC-004
    #[test]
    fn secret_does_not_implement_serialize() {
        assert!(<Secret as NotSerialize<_>>::check());
        // The probe itself works: a `String` is `Serialize`, so it needs the marker spelled out.
        assert!(<String as NotSerialize<IsSerialize>>::check());
    }
}
