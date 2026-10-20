# 010 — Native FFI surface

The boundary between `rust-core` and the Swift/Kotlin apps is a product surface: native developers only see the
generated bindings and the docstrings that cross UniFFI. These requirements keep that surface documented, typed and
in sync with the crate ([ADR-0024](../adr/0024-ffi-surface.md)).

### REQ-FFI-001 [verified] Documented FFI surface

Every `#[uniffi::export]` function and every exported record, enum, field and variant MUST carry a rustdoc
(`///`) comment that UniFFI copies into Swift Quick Help and Kotlin KDoc; `tran-uniffi` MUST deny `missing_docs`.
**Verified by:** `ffi-surface.test.ts` (source and generated-binding doc guards) and the crate's
`#![deny(missing_docs)]` lint.

### REQ-FFI-002 [verified] Domain enums instead of magic strings

The FFI MUST model validation failures and eligibility reasons as typed enums. Native code MUST receive stable
variants (for example `InvalidCountryCode`, `BelowMinimumAge`) and MUST NOT receive English prose (`detail`,
`reason` strings) to parse or display.
**Verified by:** Rust tests for each error/reason variant, the native parity suites reading `reasonCode`/`code`
from `fixtures/vote-eligibility.json`, and the generated-binding guard in `ffi-surface.test.ts`.

### REQ-FFI-003 [verified] Extend generated types, never redeclare them

Native code MUST consume the generated record/error types directly and add behaviour with Swift `extension`s and
Kotlin extension functions; it MUST NOT declare a parallel struct, class or enum with the same name.
**Verified by:** the no-shadowing guard in `ffi-surface.test.ts` plus iOS and Android unit tests for the
`VoteEligibilityOfflineResult` copy and `TranValidationError` copy extensions.

### REQ-FFI-004 [verified] Bindings stay in contract

Generated Swift and Kotlin bindings MUST be regenerated from `tran-uniffi` and checked in; CI MUST fail when the
checked-in bindings drift, and the iOS and Android suites MUST load the bridge without UniFFI checksum errors.
**Verified by:** the regenerate-and-diff CI step, and the iOS/Android parity suites that call the generated
bindings against the freshly built library.
