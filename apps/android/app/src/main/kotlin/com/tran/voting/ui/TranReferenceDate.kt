package com.tran.voting.ui

import java.time.Clock
import java.time.ZoneOffset

/**
 * The date the Rust core judges an age against (REQ-NAT-012): `YYYY-MM-DD` in UTC, like the web
 * and iOS, so every platform gives the same verdict at the same instant. `LocalDate.toString` is
 * ISO 8601 whatever the device's locale.
 */
fun tranReferenceDate(clock: Clock = Clock.systemUTC()): String =
    // `atOffset(…).toLocalDate()`, not `LocalDate.ofInstant`: that one needs API 34, minSdk is 26.
    clock.instant().atOffset(ZoneOffset.UTC).toLocalDate().toString()
