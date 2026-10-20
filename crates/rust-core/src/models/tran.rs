use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A component the API process can observe from inside itself (REQ-API-012).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum StackLayer {
    RustCore,
    AxumApi,
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
