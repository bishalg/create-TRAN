//! The screen contract (ADR-0038, spec 021): what each screen is for, which elements it must offer
//! and the scenarios that prove it, declared once and generated to every platform by
//! `pnpm tokens:sync`. It says what and why; the platforms decide how it looks.
//!
//! Verifies: REQ-SCR-001 REQ-SCR-003 REQ-SCR-004

mod catalogue;
mod model;
mod scenarios;

pub use catalogue::{state, SCREENS, UNREACHED_STATES};
pub use model::{
    Arg, Element, ElementKind, Given, Platform, PlatformMinimum, Presence, Scenario, Screen,
    ScreensJsonSnapshot, SessionKind, TextScale, Then, TouchClass, UnreachedState, When,
    PLATFORM_MINIMUMS, SCENARIO_BOUND_MS,
};

/// The whole contract as one serializable value; the codegen renders it for every platform.
pub fn screens_json_snapshot() -> ScreensJsonSnapshot {
    ScreensJsonSnapshot {
        screens: &SCREENS,
        platform_minimums: &PLATFORM_MINIMUMS,
        scenario_bound_ms: SCENARIO_BOUND_MS,
        unreached_states: &UNREACHED_STATES,
    }
}

/// Every distinct element, in first-declared order (a shared element appears once).
pub fn unique_elements() -> Vec<Element> {
    let mut out: Vec<Element> = Vec::new();
    for element in SCREENS.iter().flat_map(|screen| screen.elements) {
        if !out.iter().any(|seen| seen.id == element.id) {
            out.push(*element);
        }
    }
    out
}

/// The minimums of one platform.
pub fn platform_minimum(platform: Platform) -> PlatformMinimum {
    match platform {
        Platform::Web => PLATFORM_MINIMUMS[0],
        Platform::Ios => PLATFORM_MINIMUMS[1],
        Platform::Android => PLATFORM_MINIMUMS[2],
    }
}

#[cfg(test)]
mod tests;
