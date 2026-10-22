plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
    // Test-only: screenshot comparison on Robolectric (ADR-0031).
    id("io.github.takahirom.roborazzi") version "1.60.0" apply false
}
