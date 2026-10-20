# 001 Eligibility rules

Scope: the question "can a person of this age vote in this country?", implemented in `crates/rust-core`
and mirrored in `packages/core-ts` and the native apps. Rationale: [ADR-0001](../adr/0001-rust-core-source-of-truth.md),
[ADR-0002](../adr/0002-golden-fixtures.md), [ADR-0004](../adr/0004-inject-time-and-config.md).

### REQ-RULE-001 [verified] One source of truth

`crates/rust-core` MUST be the only place a rule is defined. Every other implementation MUST pass the same
golden cases in `fixtures/vote-eligibility.json`.
**Verified by:** `crates/rust-core/tests/parity_fixtures.rs`, `packages/core-ts/tests/parity.test.ts`, native parity tests.

### REQ-RULE-002 [verified] Minimum age by country

The minimum voting age MUST be looked up by ISO 3166-1 alpha-2 code, case-insensitively. Brazil is 16; every other
supported country is 18. A well-formed code that is not in the table MUST fall back to 18.
**Verified by:** fixture `votingAges`.

### REQ-RULE-003 [verified] Eligibility is age at or above the minimum

A person is eligible if and only if their age is greater than or equal to the minimum age.
**Verified by:** fixture `canVote` (17/18 and 15/16 boundaries).

### REQ-RULE-004 [verified] Age from birthdate

Age MUST be whole years completed on the reference date. If the birthday has not yet occurred this year the age is one
lower. A 29 February birthday counts as passed on 1 March in non-leap years. A birthdate after the reference date yields 0.
**Verified by:** fixture `ageFromBirthdate`.

### REQ-RULE-005 [verified] Birthdate overrides supplied age

When both a birthdate and an age are supplied, the age derived from the birthdate MUST be used.
**Verified by:** fixture `evaluations` ("birthdate wins over the supplied age").

### REQ-RULE-006 [verified] Input validation

The rules MUST reject, with these exact messages: an age above 150 (`Age must be 150 or less`); a birthdate after the
reference date (`Birthdate cannot be in the future`); a country code that is not two ASCII letters
(`Country code must be two ASCII letters (ISO 3166-1 alpha-2)`). Impossible calendar dates (for example `2000-02-30`)
MUST be rejected rather than rolled over. TypeScript MUST additionally reject negative, fractional and non-finite ages.
**Verified by:** fixture `rejectedEvaluations`, `invalidBirthdates`, `invalidCountryCodes`.

### REQ-RULE-007 [verified] Time is injected

No rule function may read the clock. The current date MUST be a parameter; only a thin wrapper may call `now()`.
**Verified by:** every fixture evaluation runs with a fixed `referenceDate`.

### REQ-RULE-008 [verified] Reason text

The result MUST carry a reason in the form `Age {age} meets the minimum voting age of {min} in {CC}.` or
`Age {age} is below the minimum voting age of {min} in {CC}.`, with the country code upper-cased.
**Verified by:** fixture `evaluations`.

### REQ-RULE-009 [verified] Supported countries

The core MUST expose the ordered list of supported countries (code and minimum age), sorted by code. The voting-age
lookup (REQ-RULE-002) and this list MUST come from one table.
**Verified by:** fixture `countries` (`parity_fixtures.rs`, `parity.test.ts`), `voting.rs` sorted/unique unit test.

### REQ-RULE-010 [verified] Rule data is generated, not copied

Rule data — `DEFAULT_VOTING_AGE`, `MAX_AGE`, the supported-country table and the validation messages — MUST be
defined once in `crates/rust-core`. TypeScript MUST import it from `packages/core-ts/src/generated/rules.ts`, written by
`pnpm tokens:sync`; CI MUST fail when the generated file differs from Rust. Rationale: [ADR-0027](../adr/0027-rule-data-generated-from-rust.md).
**Verified by:** `validation/voting.rs` (`every_error_has_a_unique_key_and_message`), `tran-tokens-codegen` `rules_ts` tests, `parity.test.ts` (messages and table via fixtures), CI drift check.
