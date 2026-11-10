// Verifies: REQ-PSH-008 REQ-PSH-013
package com.tran.voting.push

import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.tran.voting.permissions.PermissionFlow
import com.tran.voting.permissions.PermissionGateway
import com.tran.voting.permissions.PermissionPrompt
import com.tran.voting.ui.feedback.tranLogcat
import uniffi.tran_uniffi.TranLogLevel
import uniffi.tran_uniffi.TranPermissionId

/**
 * "Notify me when I can vote" (spec 027): the notification permission asked in context, after
 * priming, like every permission (REQ-PSH-008). A grant hands over to [onGranted], which runs the
 * sync that fetches the token and registers it; a refusal changes nothing (fallback `no_reminder`).
 */
class NotificationReminder(
    permissions: PermissionGateway,
    private val onGranted: suspend () -> Unit,
    log: (TranLogLevel, String) -> Unit = ::tranLogcat,
) {
    private val flow = PermissionFlow(permissions, TranPermissionId.NOTIFICATIONS, "notifications", log)

    val prompt: PermissionPrompt get() = flow.prompt

    /** A tap on the control. */
    suspend fun ask() {
        if (flow.tap()) onGranted()
    }

    /** "Continue" on the priming. */
    suspend fun proceed() {
        if (flow.proceed()) onGranted()
    }

    /** "Not now" (or back) on the priming. */
    fun dismiss() = flow.dismiss()

    /** "Open Settings" in the note. */
    fun openSettings() = flow.openSettings()
}

/**
 * The notification types the API sends (`fixtures/push.json` `payloads`). FCM opens the launcher
 * activity with the message's data as extras when one is tapped; the `type` says it was a
 * notification. Nothing else in the extras is read: the app fetches what happened with its session.
 */
val NOTIFICATION_TYPES: Set<String> = setOf("eligibility.reached")

/** Whether [intent] is the app opened from one of its notifications. */
fun isNotificationOpen(intent: Intent?): Boolean = intent?.getStringExtra("type") in NOTIFICATION_TYPES

/**
 * Notification taps the activity has seen, for the coordinator to route (REQ-PSH-013): each one
 * sends the stored session through the navigation director again, never straight to a screen.
 */
class NotificationOpens {
    var count by mutableIntStateOf(0)
        private set

    fun opened() {
        count += 1
    }
}
