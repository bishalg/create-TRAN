# Gradle Convention Plugins Guide

In 2026 enterprise Android engineering, duplicating compiler configurations, Compose options, and dependencies across dozens of submodules creates maintenance gridlock. Google's **Now in Android (`android/nowinandroid`)** solves this with **Gradle Convention Plugins** in `build-logic`.

---

## 1. Directory Structure

```
root/
├── build-logic/
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   └── convention/
│       └── src/main/kotlin/
│           ├── AndroidApplicationConventionPlugin.kt
│           ├── AndroidLibraryComposeConventionPlugin.kt
│           └── AndroidFeatureConventionPlugin.kt
├── settings.gradle.kts   # includes build-logic via includeBuild("build-logic")
└── apps/android/
    ├── app/build.gradle.kts (under 20 lines!)
    └── feature/voting/build.gradle.kts
```

---

## 2. Includebuild Setup (`settings.gradle.kts`)

```kotlin
pluginManagement {
    includeBuild("build-logic")
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
```

---

## 3. Library Compose Convention Plugin Implementation

```kotlin
import com.android.build.gradle.LibraryExtension
import org.gradle.api.Plugin
import org.gradle.api.Project
import org.gradle.kotlin.dsl.configure
import org.gradle.kotlin.dsl.dependencies

class AndroidLibraryComposeConventionPlugin : Plugin<Project> {
    override fun apply(target: Project) {
        with(target) {
            pluginManager.apply("com.android.library")
            pluginManager.apply("org.jetbrains.kotlin.android")
            pluginManager.apply("org.jetbrains.kotlin.plugin.compose")

            extensions.configure<LibraryExtension> {
                compileSdk = 37

                defaultConfig {
                    minSdk = 26
                    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
                }

                buildFeatures {
                    compose = true
                }
            }

            dependencies {
                val bom = "androidx.compose:compose-bom:2026.09.00"
                add("implementation", platform(bom))
                add("implementation", "androidx.compose.material3:material3")
                add("implementation", "androidx.compose.ui:ui-tooling-preview")
                add("debugImplementation", "androidx.compose.ui:ui-tooling")
            }
        }
    }
}
```

---

## 4. Consumer Module `build.gradle.kts` (Under 15 Lines!)

Once the convention plugin is registered, consumer modules become clean and declarative:

```kotlin
plugins {
    alias(libs.plugins.tran.android.library.compose)
    alias(libs.plugins.tran.android.feature)
}

android {
    namespace = "com.tran.voting.feature.eligibility"
}

dependencies {
    implementation(projects.core.model)
    implementation(projects.core.designsystem)
}
```
