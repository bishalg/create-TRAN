buildscript {
    dependencies {
        // AGP 9 ships built-in Kotlin with a minimum embedded KGP; pin the KGP used for
        // compilation (matches org.jetbrains.kotlin.plugin.compose above).
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.4.21")
    }
}

plugins {
    id("com.android.application") version "9.4.1" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.21" apply false
    // Test-only: screenshot comparison on Robolectric (ADR-0031).
    id("io.github.takahirom.roborazzi") version "1.76.0" apply false
}
