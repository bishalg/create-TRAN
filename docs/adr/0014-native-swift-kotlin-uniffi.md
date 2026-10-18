# ADR-0014 Native means Swift and Kotlin with UniFFI

Status: accepted

## Context

Cross-platform mobile could mean React Native or native.

## Decision

iOS is SwiftUI, Android is Jetpack Compose; both bind the Rust core through UniFFI. `apps/native` (Expo) is legacy.

## Consequences

Real platform accessibility APIs; one extra binding layer to maintain.
