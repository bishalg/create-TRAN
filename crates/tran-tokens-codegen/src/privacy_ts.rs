//! The privacy part of `packages/core-ts/src/generated/rules.ts`: the permission catalogue and the
//! personal questions from `rust-core` (spec 026, ADR-0027). Locale keys are typed as
//! `TranStringKey` and controls as `ElementId`, so an entry naming a missing string or element
//! fails `tsc`. `permissionStep` itself is a TypeScript mirror pinned by `fixtures/permissions.json`.

use rust_core::permissions::{
    PermissionFallback, PermissionId, PermissionStatus, PermissionStep, PERMISSIONS,
};
use rust_core::personal_questions::{AnswerKind, PERSONAL_QUESTIONS};

fn union(names: impl IntoIterator<Item = &'static str>) -> String {
    let quoted: Vec<String> = names.into_iter().map(|n| format!("'{n}'")).collect();
    quoted.join(" | ")
}

fn list(names: impl IntoIterator<Item = &'static str>) -> String {
    let quoted: Vec<String> = names.into_iter().map(|n| format!("'{n}'")).collect();
    format!("[{}]", quoted.join(", "))
}

fn pretty(value: &serde_json::Value) -> String {
    serde_json::to_string_pretty(value).expect("plain data always serializes")
}

pub fn render_privacy_ts() -> String {
    let permissions: Vec<serde_json::Value> = PERMISSIONS
        .iter()
        .map(|p| {
            serde_json::json!({
                "id": p.id.as_str(),
                "feature": p.feature,
                "control": p.control,
                "primingTitle": p.priming_title,
                "primingBody": p.priming_body,
                "purpose": p.purpose,
                "settingsNote": p.settings_note,
                "fallback": p.fallback.as_str(),
                "androidPermissions": p.android_permissions,
                "iosUsageDescriptions": p.ios_usage_descriptions,
            })
        })
        .collect();
    let questions: Vec<serde_json::Value> = PERSONAL_QUESTIONS
        .iter()
        .map(|q| {
            let answers: Vec<serde_json::Value> = q
                .answers
                .iter()
                .map(|a| serde_json::json!({ "id": a.id, "kind": a.kind.as_str(), "label": a.label }))
                .collect();
            serde_json::json!({
                "id": q.id,
                "feature": q.feature,
                "label": q.label,
                "answers": answers,
                "required": q.required,
            })
        })
        .collect();
    format!(
        "/** A permission the apps may ask for (REQ-PRV-001). */\n\
export type PermissionId = {ids};\n\n\
/** What the platform reports for a permission (REQ-PRV-002). */\n\
export type PermissionStatus = {statuses};\n\n\
/** What the app does next after a tap on the control that needs the permission. */\n\
export type PermissionStep = {steps};\n\n\
/** What the feature does without the permission; never an error (REQ-PRV-004). */\n\
export type PermissionFallback = {fallbacks};\n\n\
export const PERMISSION_STATUSES: readonly PermissionStatus[] = {status_list};\n\n\
export interface PermissionEntry {{\n  readonly id: PermissionId;\n  readonly feature: string;\n  /** The only control that may ask (REQ-PRV-003). */\n  readonly control: ElementId;\n  readonly primingTitle: TranStringKey;\n  readonly primingBody: TranStringKey;\n  /** The system prompt's purpose string. */\n  readonly purpose: TranStringKey;\n  readonly settingsNote: TranStringKey;\n  readonly fallback: PermissionFallback;\n  readonly androidPermissions: readonly string[];\n  readonly iosUsageDescriptions: readonly string[];\n}}\n\n\
/** Every permission the apps may ask for (REQ-PRV-001). */\n\
export const PERMISSIONS: readonly PermissionEntry[] = {permissions};\n\n\
/** What an answer to a personal question means (REQ-PRV-008). */\n\
export type AnswerKind = {kinds};\n\n\
export interface PersonalAnswer {{\n  readonly id: string;\n  readonly kind: AnswerKind;\n  readonly label: TranStringKey;\n}}\n\n\
export interface PersonalQuestion {{\n  readonly id: string;\n  readonly feature: string;\n  readonly label: TranStringKey;\n  readonly answers: readonly PersonalAnswer[];\n  /** The requirement that makes an answer necessary; `null` means skippable. */\n  readonly required: string | null;\n}}\n\n\
/** Every personal question the apps may ask: optional, with \"Prefer not to say\" (REQ-PRV-008). */\n\
export const PERSONAL_QUESTIONS: readonly PersonalQuestion[] = {questions};\n",
        ids = union(PermissionId::ALL.map(PermissionId::as_str)),
        statuses = union(PermissionStatus::ALL.map(PermissionStatus::as_str)),
        steps = union(PermissionStep::ALL.map(PermissionStep::as_str)),
        fallbacks = union(PermissionFallback::ALL.map(PermissionFallback::as_str)),
        status_list = list(PermissionStatus::ALL.map(PermissionStatus::as_str)),
        permissions = pretty(&serde_json::Value::Array(permissions)),
        kinds = union(AnswerKind::ALL.map(AnswerKind::as_str)),
        questions = pretty(&serde_json::Value::Array(questions)),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    // Verifies: REQ-PRV-001 REQ-PRV-008
    #[test]
    fn the_catalogues_reach_typescript_typed() {
        let ts = render_privacy_ts();
        assert!(ts.contains("export type PermissionId = 'location_approximate' | 'notifications';"));
        assert!(ts.contains("export type PermissionStep = 'show_priming' | 'request_system' | 'use_feature' | 'offer_settings';"));
        assert!(ts.contains("\"purpose\": \"eligibility.location.purpose\""));
        assert!(ts.contains("readonly control: ElementId;"));
        assert!(ts.contains("\"required\": null"));
        assert!(ts.contains("\"kind\": \"prefer_not_to_say\""));
        assert_eq!(ts.matches("\"control\": ").count(), PERMISSIONS.len());
    }
}
