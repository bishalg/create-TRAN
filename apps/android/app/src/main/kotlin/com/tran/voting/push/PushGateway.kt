package com.tran.voting.push

import com.tran.voting.BuildConfig
import com.tran.voting.permissions.stagedPermission
import uniffi.tran_uniffi.TranPermissionId

/**
 * The app's only way to the platform's push service (REQ-PSH-012). [SystemPushGateway] is the one
 * real implementation and the only file that may touch Firebase; tests, the screen contract's
 * interpreter and staged debug launches use [StagedPushGateway]. The notification *permission* is
 * not asked here but by the permission gateway, like every other permission.
 */
interface PushGateway {
    /** The build is configured for push (the four FCM values are set). `false` hides the control. */
    val available: Boolean

    /** The installation's current token, or `null` when there is none (unavailable, or the service failed). */
    suspend fun token(): String?

    /** Hands platform events to [events] until replaced; `null` stops them. */
    fun listen(events: PushEvents?)
}

/** What the platform tells the app, on the main thread. Neither carries a token or message content. */
interface PushEvents {
    /** The service issued a new token: run the sync (REQ-PSH-009). */
    fun tokenChanged()

    /** A notification arrived while the app is in use: show it in the app (REQ-PSH-013). */
    fun messageInForeground()
}

/**
 * Firebase's public project values, from the build (ADR-0044 decision 9): no `google-services.json`.
 * They identify the project to Google and are not secrets, but a stray template prints none of them.
 */
class FcmConfig(val projectId: String, val applicationId: String, val apiKey: String, val senderId: String) {
    override fun toString(): String = "FcmConfig(redacted)"
}

/** All four values set → a config; any one missing or blank → `null`, and push is unavailable (REQ-PSH-012). */
fun fcmConfig(projectId: String?, applicationId: String?, apiKey: String?, senderId: String?): FcmConfig? {
    val values = listOf(projectId, applicationId, apiKey, senderId)
    if (values.any { it.isNullOrBlank() }) return null
    return FcmConfig(projectId!!.trim(), applicationId!!.trim(), apiKey!!.trim(), senderId!!.trim())
}

/** The values this build was compiled with (empty when the variables were not set). */
fun fcmConfigFromBuild(): FcmConfig? = fcmConfig(
    BuildConfig.TRAN_FCM_PROJECT_ID,
    BuildConfig.TRAN_FCM_APP_ID,
    BuildConfig.TRAN_FCM_API_KEY,
    BuildConfig.TRAN_FCM_SENDER_ID,
)

/**
 * A gateway whose answers are set in advance. Available with [token] once asked; unavailable (the
 * default) it never hands one out. It counts token requests, so a test can prove none was made
 * without permission, and lets a test deliver a new token or a foreground message.
 */
class StagedPushGateway(
    override val available: Boolean = false,
    private var current: String? = null,
) : PushGateway {
    private var events: PushEvents? = null

    /** How many times the token was asked for. */
    var tokenRequests: Int = 0
        private set

    override suspend fun token(): String? {
        if (!available) return null
        tokenRequests += 1
        return current
    }

    override fun listen(events: PushEvents?) {
        this.events = events
    }

    /** The service rotates the token. */
    fun issue(token: String) {
        current = token
        events?.tokenChanged()
    }

    /** A notification arrives while the app is in use. */
    fun deliverMessage() {
        events?.messageInForeground()
    }
}

/** The fixed fake token a staged, available gateway hands out: the shape of an FCM token, never a real one. */
const val STAGED_PUSH_TOKEN = "staged-fcm-token:APA91b-tran-template-never-delivered"

/**
 * Push for a screen scenario or a debug launch (`docs/PUSH.md`): a staged `permission` naming
 * `notifications` stages push as available, with [STAGED_PUSH_TOKEN]; any other staged permission
 * leaves it unavailable, so every other scenario sees the screen it always saw.
 */
fun stagedPushGateway(permission: TranPermissionId?): StagedPushGateway =
    if (permission == TranPermissionId.NOTIFICATIONS) {
        StagedPushGateway(available = true, current = STAGED_PUSH_TOKEN)
    } else {
        StagedPushGateway()
    }

/**
 * The gateway the app runs with: a debug build launched with a staged permission gets a staged one;
 * a release build always gets the system's and ignores the extra.
 */
fun pushGatewayFor(debug: Boolean, extra: String?, system: () -> PushGateway): PushGateway {
    val staged = if (debug) stagedPermission(extra) else null
    return staged?.let { (id, _) -> stagedPushGateway(id) } ?: system()
}
