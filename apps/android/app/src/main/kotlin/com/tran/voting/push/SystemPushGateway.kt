// Verifies: REQ-PSH-012
package com.tran.voting.push

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.tran.voting.generated.TranStrings
import com.tran.voting.ui.feedback.tranLogcat
import kotlinx.coroutines.suspendCancellableCoroutine
import uniffi.tran_uniffi.TranLogLevel
import kotlin.coroutines.resume

/**
 * The only code that talks to Firebase Cloud Messaging (REQ-PSH-012, guarded by
 * `push-guards.test.ts`; FCM is the one SDK exception, ADR-0044 decision 9).
 *
 * Firebase is initialised by hand from the four build values ([fcmConfigFromBuild]); the manifest
 * removes its auto-init provider and turns off token auto-init. Without the values the gateway is
 * unavailable and Firebase is never initialised, so nothing in it runs or reaches the network. With
 * them, nothing runs until the person has granted notifications and holds an API session: only then
 * does the sync ask for a token.
 */
class SystemPushGateway(
    private val context: Context,
    private val config: FcmConfig? = fcmConfigFromBuild(),
) : PushGateway {
    override val available: Boolean = config != null

    init {
        // The channel's name follows the app's language, so it is renamed on every launch.
        if (config != null) createChannel(context)
    }

    override suspend fun token(): String? {
        if (initialize(context, config) == null) return null
        return suspendCancellableCoroutine { continuation ->
            // firebase-messaging 26 deprecates the registration token for an opt-in installation-id
            // registration (`register()`, `onRegistered`, behind a manifest flag). The API's FCM
            // sender addresses `message.token`, the registration token (spec 027), so this stays on
            // the token until the sender moves too; docs/PUSH.md lists it.
            @Suppress("DEPRECATION")
            FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                // The failure is logged once, without its message: it may name the installation.
                val token = if (task.isSuccessful) task.result else null
                if (token == null) tranLogcat(TranLogLevel.WARN, "push token unavailable")
                if (continuation.isActive) continuation.resume(token)
            }
        }
    }

    override fun listen(events: PushEvents?) {
        Companion.events = events
    }

    companion object {
        /** The channel FCM posts to while the app is in the background (the manifest names it too). */
        const val CHANNEL_ID = "eligibility_reminders"

        @Volatile
        private var events: PushEvents? = null
        private val main by lazy { Handler(Looper.getMainLooper()) }
        private val lock = Any()

        /** The default Firebase app, initialised once from [config]; `null` without one. */
        fun initialize(context: Context, config: FcmConfig? = fcmConfigFromBuild()): FirebaseApp? {
            if (config == null) return null
            val app = context.applicationContext
            return synchronized(lock) {
                FirebaseApp.getApps(app).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
                    ?: FirebaseApp.initializeApp(
                        app,
                        FirebaseOptions.Builder()
                            .setProjectId(config.projectId)
                            .setApplicationId(config.applicationId)
                            .setApiKey(config.apiKey)
                            .setGcmSenderId(config.senderId)
                            .build(),
                    ).also { createChannel(app) }
            }
        }

        /** One channel for the eligibility reminder; creating it again only renames it. */
        fun createChannel(context: Context) {
            val manager = context.getSystemService(NotificationManager::class.java) ?: return
            val channel = NotificationChannel(
                CHANNEL_ID,
                context.getString(TranStrings.Eligibility.notifyLabel),
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = context.getString(TranStrings.Eligibility.notifyPurpose) }
            manager.createNotificationChannel(channel)
        }

        internal fun tokenChanged() {
            main.post { events?.tokenChanged() }
        }

        internal fun messageReceived() {
            main.post { events?.messageInForeground() }
        }
    }
}

/**
 * FCM's entry point, declared in the manifest. Everything goes to the gateway; neither the token
 * nor the message is read, kept or logged here. FCM calls [onMessageReceived] for a notification
 * only while the app is in the foreground, where it becomes the catalogue's toast, never a system
 * notification (REQ-PSH-013); in the background FCM shows it on [SystemPushGateway.CHANNEL_ID].
 */
class TranMessagingService : FirebaseMessagingService() {
    override fun onCreate() {
        // A message can start the process before any activity: Firebase must exist first.
        SystemPushGateway.initialize(applicationContext)
        super.onCreate()
    }

    // Deprecated with the token itself in firebase-messaging 26; see [SystemPushGateway.token].
    @Suppress("OVERRIDE_DEPRECATION")
    override fun onNewToken(token: String) = SystemPushGateway.tokenChanged()

    override fun onMessageReceived(message: RemoteMessage) = SystemPushGateway.messageReceived()
}
