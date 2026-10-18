use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StackLayer {
    TanStackStart,
    RustCore,
    AxumApi,
    NativeMobile,
}

impl StackLayer {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::TanStackStart => "TanStack Start (Web)",
            Self::RustCore => "Rust Core (Domain/Engine)",
            Self::AxumApi => "Axum (API Gateway)",
            Self::NativeMobile => "Native Mobile (iOS & Android)",
        }
    }

    pub fn code(&self) -> char {
        match self {
            Self::TanStackStart => 'T',
            Self::RustCore => 'R',
            Self::AxumApi => 'A',
            Self::NativeMobile => 'N',
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StackComponentStatus {
    pub layer: StackLayer,
    pub name: String,
    pub version: String,
    pub healthy: bool,
    pub uptime_seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TranHealthReport {
    pub report_id: Uuid,
    pub timestamp: DateTime<Utc>,
    pub overall_status: String,
    pub components: Vec<StackComponentStatus>,
}
