# Android Keystore Security & System Services Guide

This guide establishes enterprise security standards for Android apps targeting SDK 37 (Android 17), based on **Bitwarden Android (`bitwarden/android`)** and **Proton Pass Android (`protonpass/android-pass`)**.

---

## 1. Hardware-Backed Android Keystore (AES-256 GCM)

Plaintext preferences (`SharedPreferences`) or unencrypted databases must never hold credentials, tokens, or private keys. The Android Keystore provider (`AndroidKeyStore`) keeps cryptographic keys inside the device's Secure Element (SE) or Trusted Execution Environment (TEE).

### Key Generation with Biometric Policy
```kotlin
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureKeystoreManager {
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    private val keyAlias = "tran_voting_master_key"

    fun getOrCreateKey(requireBiometrics: Boolean = false): SecretKey {
        if (keyStore.containsAlias(keyAlias)) {
            val entry = keyStore.getEntry(keyAlias, null) as KeyStore.SecretKeyEntry
            return entry.secretKey
        }

        val keyGenerator = KeyGenerator.getInstance(
            KeyProperties.KEY_ALGORITHM_AES,
            "AndroidKeyStore"
        )

        val specBuilder = KeyGenParameterSpec.Builder(
            keyAlias,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)

        if (requireBiometrics) {
            specBuilder
                .setUserAuthenticationRequired(true)
                .setUserAuthenticationParameters(
                    0, // 0 = requires auth for every cipher operation
                    KeyProperties.AUTH_BIOMETRIC_STRONG
                )
        }

        keyGenerator.init(specBuilder.build())
        return keyGenerator.generateKey()
    }
}
```

---

## 2. Secure Clipboard & Auto-Clearing (Android 13+ & SDK 37)

Sensitive data (passwords, private seed phrases, voter tokens) must be marked sensitive in the Android clipboard so that soft keyboards do not display them in suggestion strips, and must be cleared automatically:

```kotlin
import android.content.ClipData
import android.content.ClipDescription
import android.content.ClipboardManager
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class SecureClipboardHelper(private val context: Context) {
    private val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager

    fun copySensitive(label: String, sensitiveText: String, timeoutSeconds: Long = 60) {
        val clip = ClipData.newPlainText(label, sensitiveText)

        // Mark as sensitive on Android 13 (API 33) and above
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val extras = PersistableBundle().apply {
                putBoolean(ClipDescription.EXTRA_IS_SENSITIVE, true)
            }
            clip.description.extras = extras
        }

        clipboard.setPrimaryClip(clip)

        // Schedule auto-clearing
        CoroutineScope(Dispatchers.Main).launch {
            delay(timeoutSeconds * 1000)
            if (clipboard.hasPrimaryClip() && clipboard.primaryClip?.description?.label == label) {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    clipboard.clearPrimaryClip()
                } else {
                    clipboard.setPrimaryClip(ClipData.newPlainText("", ""))
                }
            }
        }
    }
}
```

---

## 3. Window Screenshot & Task-Switcher Protection

Prevent other applications or system recents task-switcher previews from taking screenshots of sensitive voting screens:

```kotlin
import android.app.Activity
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext

@Composable
fun SecureScreenProtection() {
    val context = LocalContext.current
    DisposableEffect(Unit) {
        val activity = context as? Activity
        activity?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose {
            activity?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        }
    }
}
```
