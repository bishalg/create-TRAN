//! API versioning and client compatibility for native apps (spec 028, ADR-0047).
//!
//! Swift and Kotlin send [`format_client`] as `X-Tran-Client` on every request (the constant
//! names are in the generated `ApiContract`), act on a `426 client.upgrade_required` and on
//! `X-Tran-Update: recommended`, and ask [`update_prompt`] whether the dismissible prompt shows.
//! [`decode_wire_enum`] reads an enum value this build does not know as its declared fallback.
//! `fixtures/compat.json` pins every function here.

use rust_core::compat::{self, Client, ClientPlatform, ClientStanding, UpdatePromptState};

/// Who sent a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranClientPlatform {
    /// The iOS app.
    Ios,
    /// The Android app.
    Android,
    /// The web app.
    Web,
    /// No header, or one that does not parse. Served like any other client.
    Unknown,
}

impl From<ClientPlatform> for TranClientPlatform {
    fn from(platform: ClientPlatform) -> Self {
        match platform {
            ClientPlatform::Ios => Self::Ios,
            ClientPlatform::Android => Self::Android,
            ClientPlatform::Web => Self::Web,
            ClientPlatform::Unknown => Self::Unknown,
        }
    }
}

impl From<TranClientPlatform> for ClientPlatform {
    fn from(platform: TranClientPlatform) -> Self {
        match platform {
            TranClientPlatform::Ios => Self::Ios,
            TranClientPlatform::Android => Self::Android,
            TranClientPlatform::Web => Self::Web,
            TranClientPlatform::Unknown => Self::Unknown,
        }
    }
}

/// A parsed `X-Tran-Client` header.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranClient {
    /// The platform; [`TranClientPlatform::Unknown`] when the header did not parse.
    pub platform: TranClientPlatform,
    /// The app version; always present for a known platform, never for an unknown one.
    pub version: Option<String>,
}

impl From<Client> for TranClient {
    fn from(client: Client) -> Self {
        Self {
            platform: client.platform.into(),
            version: client.version,
        }
    }
}

impl From<TranClient> for Client {
    fn from(client: TranClient) -> Self {
        Self {
            platform: client.platform.into(),
            version: client.version,
        }
    }
}

/// Where an app version stands against its platform's thresholds.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, uniffi::Enum)]
pub enum TranClientStanding {
    /// Served as usual.
    Supported,
    /// Served; offer the dismissible update prompt (REQ-VER-006).
    UpdateRecommended,
    /// Not served: the API answers `426`; show the blocking update screen (REQ-VER-005).
    UpgradeRequired,
}

impl From<ClientStanding> for TranClientStanding {
    fn from(standing: ClientStanding) -> Self {
        match standing {
            ClientStanding::Supported => Self::Supported,
            ClientStanding::UpdateRecommended => Self::UpdateRecommended,
            ClientStanding::UpgradeRequired => Self::UpgradeRequired,
        }
    }
}

impl From<TranClientStanding> for ClientStanding {
    fn from(standing: TranClientStanding) -> Self {
        match standing {
            TranClientStanding::Supported => Self::Supported,
            TranClientStanding::UpdateRecommended => Self::UpdateRecommended,
            TranClientStanding::UpgradeRequired => Self::UpgradeRequired,
        }
    }
}

/// What the app knows when an answer arrives, for [`update_prompt`].
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct TranUpdatePromptState {
    /// [`TranClientStanding::UpdateRecommended`] when the answer carried
    /// `X-Tran-Update: recommended`; [`TranClientStanding::Supported`] otherwise.
    pub standing: TranClientStanding,
    /// `X-Tran-Recommended-Version` of the answer, if present.
    pub recommended_version: Option<String>,
    /// The recommended version the person last dismissed the prompt for, as the app stored it.
    pub dismissed_version: Option<String>,
}

/// Reads an `X-Tran-Client` header value (REQ-VER-004).
///
/// # Arguments
///
/// * `header` — the value, or `None` when the header is absent.
///
/// # Returns
///
/// The platform and version; anything malformed is [`TranClientPlatform::Unknown`], never an error.
#[uniffi::export]
pub fn parse_client(header: Option<String>) -> TranClient {
    compat::parse_client(header.as_deref()).into()
}

/// The `X-Tran-Client` value an app sends: `ios/1.4.0`.
///
/// # Arguments
///
/// * `platform` — the app's platform.
/// * `version` — the app's product version (`CFBundleShortVersionString`, `versionName`), the one
///   `pnpm release` writes.
#[uniffi::export]
pub fn format_client(platform: TranClientPlatform, version: String) -> String {
    compat::format_client(platform.into(), &version)
}

/// Compares two versions numerically by part; missing parts are zero and a pre-release or build
/// suffix is ignored (REQ-VER-005).
///
/// # Returns
///
/// `-1`, `0` or `1` when `a` is below, equal to or above `b`.
#[uniffi::export]
pub fn compare_versions(a: String, b: String) -> i8 {
    compat::compare_versions(&a, &b) as i8
}

/// Where `client` stands against its platform's thresholds (REQ-VER-005, REQ-VER-006).
///
/// # Arguments
///
/// * `client` — usually [`parse_client`] of the app's own header.
/// * `minimum`, `recommended` — the platform's thresholds; `None` when there is none.
#[uniffi::export]
pub fn client_standing(
    client: TranClient,
    minimum: Option<String>,
    recommended: Option<String>,
) -> TranClientStanding {
    compat::client_standing(&client.into(), minimum.as_deref(), recommended.as_deref()).into()
}

/// Whether to show the dismissible update prompt (REQ-VER-010).
///
/// # Returns
///
/// `true` only when an update is recommended and the prompt was not already dismissed for this
/// recommended version. Store the recommended version when the person taps "Not now".
#[uniffi::export]
pub fn update_prompt(state: TranUpdatePromptState) -> bool {
    compat::update_prompt(UpdatePromptState {
        standing: state.standing.into(),
        recommended_version: state.recommended_version.as_deref(),
        dismissed_version: state.dismissed_version.as_deref(),
    })
}

/// Decodes a wire enum value tolerantly (REQ-VER-008).
///
/// # Arguments
///
/// * `name` — the enum's name in `fixtures/compat.json` (`user_role`, `country_source`).
/// * `raw` — the value the server sent.
///
/// # Returns
///
/// `raw` when this build knows it, else the enum's declared fallback; `None` only for an enum name
/// the catalogue does not declare.
#[uniffi::export]
pub fn decode_wire_enum(name: String, raw: String) -> Option<String> {
    compat::wire_enum(&name).map(|wire| wire.decode(&raw).to_string())
}
