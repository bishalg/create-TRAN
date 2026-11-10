package com.tran.voting.permissions

import com.tran.voting.generated.TranStrings
import uniffi.tran_uniffi.TranPermissionId
import uniffi.tran_uniffi.TranPermissionStatus
import java.util.Locale

/**
 * The app's only way to the operating system's permissions and location (ADR-0043 decision 6).
 * [SystemPermissionGateway] is the one real implementation; tests and the screen contract's
 * interpreter use [StagedPermissionGateway], so no system dialog can appear in them.
 */
interface PermissionGateway {
    /** The current answer, in the catalogue's statuses; never shows anything. */
    fun status(id: TranPermissionId): TranPermissionStatus

    /** Shows the system prompt (only after priming, REQ-PRV-003) and returns the status after it. */
    suspend fun request(id: TranPermissionId): TranPermissionStatus

    /** One approximate reading, or `null` when there is none (location off, no provider, timeout). */
    suspend fun locationFix(): LocationFix?

    /** Opens this app's page in Settings where [id], once refused, can be turned on. */
    fun openSettings(id: TranPermissionId)
}

/**
 * One coarse reading, alive only until it becomes a country (REQ-PRV-006). It prints no
 * coordinates, so a stray string template cannot log them.
 */
class LocationFix(val latitude: Double, val longitude: Double) {
    override fun toString(): String = "LocationFix(redacted)"
}

/** Turns a reading into an ISO 3166-1 alpha-2 country code on the device, or `null`. */
fun interface CountryGeocoder {
    suspend fun countryCode(fix: LocationFix): String?
}

/** No geocoder: every reading falls back to the typed country. */
val NoCountryGeocoder = CountryGeocoder { null }

/** The catalogue's snake-case name of a permission (`location_approximate`), as fixtures and launch extras spell it. */
val TranPermissionId.code: String get() = name.lowercase(Locale.ROOT)

/** The catalogue's snake-case name of a status (`denied_permanently`). */
val TranPermissionStatus.code: String get() = name.lowercase(Locale.ROOT)

/**
 * A gateway whose answers are set in advance: the fake for tests, the screen contract's
 * `permission` given and a debug build's [EXTRA_PERMISSION] launch extra. It records every
 * request, so a test can prove none happened before a tap and priming (REQ-PRV-003).
 */
class StagedPermissionGateway(
    private var current: TranPermissionStatus = TranPermissionStatus.NOT_DETERMINED,
    /** What the "system prompt" answers. */
    private val answer: TranPermissionStatus = TranPermissionStatus.DENIED,
    private val fix: LocationFix? = null,
) : PermissionGateway {
    private val asked = mutableListOf<TranPermissionId>()

    /** Every system request, in order. */
    val requests: List<TranPermissionId> get() = asked.toList()

    private val opened = mutableListOf<TranPermissionId>()

    /** Which permission each opening of Settings was for, in order. */
    val settingsFor: List<TranPermissionId> get() = opened.toList()

    /** How many times Settings was opened. */
    val settingsOpened: Int get() = opened.size

    /** How many readings were taken. */
    var fixesTaken: Int = 0
        private set

    override fun status(id: TranPermissionId): TranPermissionStatus = current

    override suspend fun request(id: TranPermissionId): TranPermissionStatus {
        asked += id
        current = answer
        return current
    }

    override suspend fun locationFix(): LocationFix? {
        fixesTaken += 1
        return fix
    }

    override fun openSettings(id: TranPermissionId) {
        opened += id
    }
}

/**
 * Debug-only launch extra that stages a permission's status, the Android spelling of iOS's
 * `-TranPermission location_approximate=denied_permanently`:
 * `adb shell am start -n com.tran.voting/.MainActivity --es tran.permission location_approximate=denied_permanently`.
 */
const val EXTRA_PERMISSION = "tran.permission"

/** `location_approximate=denied_permanently` → the status it stages, or `null` when it names nothing known. */
fun stagedPermission(extra: String?): Pair<TranPermissionId, TranPermissionStatus>? {
    val (id, status) = extra?.split('=')?.takeIf { it.size == 2 } ?: return null
    val permission = TranPermissionId.entries.firstOrNull { it.code == id.trim() } ?: return null
    val staged = TranPermissionStatus.entries.firstOrNull { it.code == status.trim() } ?: return null
    return permission to staged
}

/**
 * The gateway the app runs with: a debug build launched with [EXTRA_PERMISSION] gets a staged one;
 * a release build always gets the system's and ignores the extra.
 */
fun permissionGatewayFor(debug: Boolean, extra: String?, system: () -> PermissionGateway): PermissionGateway {
    val staged = if (debug) stagedPermission(extra) else null
    return staged?.let { (_, status) -> StagedPermissionGateway(status) } ?: system()
}

/**
 * String resources for the locale keys the permission catalogue names. The keys are Rust data;
 * `PermissionParityTest` fails when one has no entry here.
 */
object PermissionCopy {
    private val byKey: Map<String, Int> = mapOf(
        "eligibility.location.primingTitle" to TranStrings.Eligibility.locationPrimingTitle,
        "eligibility.location.primingBody" to TranStrings.Eligibility.locationPrimingBody,
        "eligibility.location.purpose" to TranStrings.Eligibility.locationPurpose,
        "eligibility.location.settingsNote" to TranStrings.Eligibility.locationSettingsNote,
        "eligibility.notify.primingTitle" to TranStrings.Eligibility.notifyPrimingTitle,
        "eligibility.notify.primingBody" to TranStrings.Eligibility.notifyPrimingBody,
        "eligibility.notify.purpose" to TranStrings.Eligibility.notifyPurpose,
        "eligibility.notify.settingsNote" to TranStrings.Eligibility.notifySettingsNote,
    )

    fun res(key: String): Int? = byKey[key]
}
