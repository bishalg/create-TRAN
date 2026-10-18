use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoteEligibilityRequest {
    /// Whole years; preferred when birth date is unknown on the client.
    pub age: u16,
    /// Optional ISO birth date (`YYYY-MM-DD`) — server derives age when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub birthdate: Option<NaiveDate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct VoteEligibilityResponse {
    pub eligibility_id: Uuid,
    pub eligible: bool,
    pub age: u16,
    pub minimum_age: u16,
    pub country_code: String,
    pub country_source: String,
    pub client_ip: String,
    pub reason: String,
    pub evaluated_at: DateTime<Utc>,
}
