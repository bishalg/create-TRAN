use std::fmt;

use chrono::{DateTime, NaiveDate, Utc};
use serde::{de, Deserialize, Deserializer, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct VoteEligibilityRequest {
    /// Whole years; preferred when birth date is unknown on the client.
    pub age: u16,
    /// Optional ISO birth date (`YYYY-MM-DD`) — server derives age when present.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub birthdate: Option<NaiveDate>,
}

/// The wire shape. Deserialized only from a map: serde's derive would also accept a sequence, so
/// `[20]` would be read as `{ "age": 20 }` (REQ-ROB-010, `FM-S09`).
#[derive(Deserialize)]
struct VoteEligibilityRequestWire {
    age: u16,
    #[serde(default, deserialize_with = "strict_iso_date")]
    birthdate: Option<NaiveDate>,
}

impl<'de> Deserialize<'de> for VoteEligibilityRequest {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectOnly;

        impl<'de> de::Visitor<'de> for ObjectOnly {
            type Value = VoteEligibilityRequest;

            fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
                formatter.write_str("a JSON object")
            }

            fn visit_map<A: de::MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
                let wire = VoteEligibilityRequestWire::deserialize(
                    de::value::MapAccessDeserializer::new(map),
                )?;
                Ok(VoteEligibilityRequest {
                    age: wire.age,
                    birthdate: wire.birthdate,
                })
            }
        }

        deserializer.deserialize_map(ObjectOnly)
    }
}

/// `birthdate` through [`crate::voting::parse_iso_date`], so the wire accepts exactly what every
/// client sends: `YYYY-MM-DD`, nothing chrono is lenient about.
fn strict_iso_date<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<NaiveDate>, D::Error> {
    Option::<String>::deserialize(deserializer)?
        .map(|raw| {
            crate::voting::parse_iso_date(&raw)
                .ok_or_else(|| de::Error::custom("birthdate must be a YYYY-MM-DD calendar date"))
        })
        .transpose()
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

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-ROB-010 — the developer message says what shape was expected.
    #[test]
    fn a_non_object_body_is_rejected_as_not_an_object() {
        let err = serde_json::from_str::<VoteEligibilityRequest>("[20]").unwrap_err();
        assert!(err.to_string().contains("a JSON object"), "{err}");
    }
}
