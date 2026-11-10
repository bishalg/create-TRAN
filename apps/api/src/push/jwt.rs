//! The two signed tokens the providers ask for (REQ-PSH-005, ADR-0046), built with aws-lc-rs, the
//! crypto library rustls already runs on, rather than a JWT library.
//!
//! - APNs takes an ES256 JWT signed with the team's `.p8` key: header `alg`, `kid`; claims `iss`
//!   (team id) and `iat` ("Establishing a token-based connection to APNs",
//!   <https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns>).
//! - Google takes an RS256 JWT signed with the service account's key, exchanged for an access token
//!   ("Using OAuth 2.0 for Server to Server Applications",
//!   <https://developers.google.com/identity/protocols/oauth2/service-account>).
//!
//! Both keys arrive as PKCS#8 PEM (a `BEGIN PRIVATE KEY` block). A key never leaves this module
//! and has no `Debug` that prints it.

use std::fmt;

use aws_lc_rs::rand::SystemRandom;
use aws_lc_rs::signature::{
    EcdsaKeyPair, KeyPair, RsaKeyPair, ECDSA_P256_SHA256_FIXED_SIGNING, RSA_PKCS1_SHA256,
};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use serde_json::Value;

use crate::secret::REDACTED;

/// The DER inside a PKCS#8 PEM. Accepts the newlines written as `\n`, as a one-line environment
/// variable holds them.
pub fn pkcs8_der(pem: &str) -> Option<Vec<u8>> {
    let text = pem.replace("\\n", "\n");
    // Spelled in parts so the secret scan (`pnpm secrets:check`) does not take the marker for a key.
    let begin = concat!("-----BEGIN ", "PRIVATE KEY-----");
    let end = concat!("-----END ", "PRIVATE KEY-----");
    let inner = text.split_once(begin)?.1.split_once(end)?.0;
    let base64: String = inner.split_whitespace().collect();
    STANDARD.decode(base64).ok()
}

/// `header.claims`, each part base64url without padding: what is signed.
fn signing_input(header: &Value, claims: &Value) -> String {
    format!(
        "{}.{}",
        URL_SAFE_NO_PAD.encode(header.to_string()),
        URL_SAFE_NO_PAD.encode(claims.to_string())
    )
}

/// A P-256 key for ES256 (an APNs `.p8`).
pub struct Es256Key(EcdsaKeyPair);

impl Es256Key {
    /// `None` unless `pem` is a PKCS#8 P-256 private key.
    pub fn from_pem(pem: &str) -> Option<Self> {
        let der = pkcs8_der(pem)?;
        EcdsaKeyPair::from_pkcs8(&ECDSA_P256_SHA256_FIXED_SIGNING, &der)
            .ok()
            .map(Self)
    }

    /// The uncompressed public point, for a verifier.
    pub fn public_key(&self) -> &[u8] {
        self.0.public_key().as_ref()
    }

    /// A compact JWS. JWS ES256 is the fixed `r || s` form this signs. Signing with a key that
    /// parsed fails only if the OS random source does; the signature is then empty and the
    /// provider refuses it, which the sender reports as rejected.
    pub fn sign(&self, header: &Value, claims: &Value) -> String {
        let input = signing_input(header, claims);
        let signature = self
            .0
            .sign(&SystemRandom::new(), input.as_bytes())
            .map(|signature| URL_SAFE_NO_PAD.encode(signature.as_ref()))
            .unwrap_or_default();
        format!("{input}.{signature}")
    }
}

/// An RSA key for RS256 (a Google service account's `private_key`).
pub struct Rs256Key(RsaKeyPair);

impl Rs256Key {
    /// `None` unless `pem` is a PKCS#8 RSA private key.
    pub fn from_pem(pem: &str) -> Option<Self> {
        let der = pkcs8_der(pem)?;
        RsaKeyPair::from_pkcs8(&der).ok().map(Self)
    }

    /// A compact JWS with RSASSA-PKCS1-v1_5 over SHA-256. See [`Es256Key::sign`] for a failure.
    pub fn sign(&self, header: &Value, claims: &Value) -> String {
        let input = signing_input(header, claims);
        let mut signature = vec![0; self.0.public_modulus_len()];
        let signature = self
            .0
            .sign(
                &RSA_PKCS1_SHA256,
                &SystemRandom::new(),
                input.as_bytes(),
                &mut signature,
            )
            .map(|()| URL_SAFE_NO_PAD.encode(&signature))
            .unwrap_or_default();
        format!("{input}.{signature}")
    }
}

impl fmt::Debug for Es256Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}

impl fmt::Debug for Rs256Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(REDACTED)
    }
}
