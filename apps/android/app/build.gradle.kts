import java.util.Base64

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("io.github.takahirom.roborazzi")
}

// REQ-MOB-008: release signing with the upload keystore from the environment (the fastlane `beta` lane, a
// developer's untracked .env). The keystore arrives base64-encoded and is decoded to an owner-only temporary
// file outside the repo, deleted when Gradle's JVM exits. Without every variable the release build stays
// unsigned, as release.yml and scripts/build-release.sh expect.
val uploadKeystoreBase64: String? = System.getenv("TRAN_ANDROID_KEYSTORE_BASE64")
val uploadKeystorePassword: String? = System.getenv("TRAN_ANDROID_KEYSTORE_PASSWORD")
val uploadKeyAlias: String? = System.getenv("TRAN_ANDROID_KEY_ALIAS")
val uploadKeyPassword: String? = System.getenv("TRAN_ANDROID_KEY_PASSWORD")
val uploadSigning =
    listOf(uploadKeystoreBase64, uploadKeystorePassword, uploadKeyAlias, uploadKeyPassword)
        .all { !it.isNullOrBlank() }

// REQ-PSH-012, ADR-0044 decision 9: Firebase Cloud Messaging is initialised by hand from these four
// public project values (no google-services.json, no google-services plugin). No defaults: with any
// of them unset the app builds without push, its gateway reports push unavailable and Firebase never
// starts. They identify the Firebase project and are not secrets (the "API key" included).
val fcmValues: Map<String, String> = mapOf(
    "TRAN_FCM_PROJECT_ID" to System.getenv("TRAN_FCM_PROJECT_ID"),
    "TRAN_FCM_APP_ID" to System.getenv("TRAN_FCM_APP_ID"),
    "TRAN_FCM_API_KEY" to System.getenv("TRAN_FCM_API_KEY"),
    "TRAN_FCM_SENDER_ID" to System.getenv("TRAN_FCM_SENDER_ID"),
).mapValues { (name, value) ->
    val trimmed = value.orEmpty().trim()
    // Compiled into a Java string literal: only the characters Firebase values use.
    require(Regex("[A-Za-z0-9:._-]*").matches(trimmed)) { "$name has characters a Firebase value never has" }
    trimmed
}

// REQ-VER-011: the store page "Update" opens (spec 028). App configuration, not a delivery value: unset or
// empty, the placeholder builds everywhere; a fork sets its Play listing.
val storeUrl: String = System.getenv("TRAN_ANDROID_STORE_URL").orEmpty().trim().ifEmpty { "https://tran.example/android" }.also {
    // Compiled into a Java string literal: an https address with no quote, backslash or space.
    require(Regex("https://[^\\s\"\\\\]+").matches(it)) { "TRAN_ANDROID_STORE_URL must be an https:// address" }
}

fun decodeUploadKeystore(base64: String): File {
    val file = File.createTempFile("tran-upload-", ".jks")
    file.deleteOnExit()
    file.setReadable(false, false)
    file.setWritable(false, false)
    file.setReadable(true, true)
    file.setWritable(true, true)
    file.writeBytes(Base64.getMimeDecoder().decode(base64.trim()))
    return file
}

android {
    namespace = "com.tran.voting"
    // okhttp-android 5.5's AAR metadata requires compiling against API 37 (AGP 9.4 max).
    compileSdk = 37

    defaultConfig {
        // REQ-MOB-004: the same variable and placeholder default as fastlane/Appfile, so a fork that
        // sets only the variable builds and uploads one id; the scaffolder rewrites the placeholder.
        applicationId = System.getenv("TRAN_ANDROID_APPLICATION_ID") ?: "com.tran.voting"
        // ADR-0045: the latest platforms only. Android 13 is the floor; nothing below it is written or tested.
        minSdk = 33
        targetSdk = 36
        versionCode = 1000
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "TRAN_FCM_PROJECT_ID", "\"${fcmValues.getValue("TRAN_FCM_PROJECT_ID")}\"")
        buildConfigField("String", "TRAN_FCM_APP_ID", "\"${fcmValues.getValue("TRAN_FCM_APP_ID")}\"")
        buildConfigField("String", "TRAN_FCM_API_KEY", "\"${fcmValues.getValue("TRAN_FCM_API_KEY")}\"")
        buildConfigField("String", "TRAN_FCM_SENDER_ID", "\"${fcmValues.getValue("TRAN_FCM_SENDER_ID")}\"")
        buildConfigField("String", "TRAN_ANDROID_STORE_URL", "\"$storeUrl\"")
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // REQ-NAT-011: the API base URL is configurable per build — `-PtranApiBaseUrl=…` or
    // `TRAN_API_BASE_URL=…` wins, otherwise debug targets the emulator host and release HTTPS.
    val configuredApiBaseUrl =
        (findProperty("tranApiBaseUrl") as String?) ?: System.getenv("TRAN_API_BASE_URL")

    signingConfigs {
        if (uploadSigning) {
            create("upload") {
                storeFile = decodeUploadKeystore(uploadKeystoreBase64!!)
                storePassword = uploadKeystorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            buildConfigField(
                "String",
                "TRAN_API_BASE_URL",
                "\"${configuredApiBaseUrl ?: "http://10.0.2.2:3001"}\"",
            )
        }
        release {
            isMinifyEnabled = false
            if (uploadSigning) signingConfig = signingConfigs.getByName("upload")
            buildConfigField(
                "String",
                "TRAN_API_BASE_URL",
                "\"${configuredApiBaseUrl ?: "https://api.tran.example"}\"",
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    // Robolectric renders the real resources (strings, fonts) in the JVM screenshot tests.
    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

// KGP 2.1+ removed the deprecated android.kotlinOptions{} DSL; compilerOptions replaces it.
kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
        freeCompilerArgs.addAll(
            listOf("-opt-in=androidx.compose.ui.ExperimentalComposeUiApi"),
        )
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("net.java.dev.jna:jna:5.19.1@aar")
    implementation("com.squareup.okhttp3:okhttp:5.5.0")
    // Push (spec 027): FCM, the one third-party SDK the app allows (ADR-0044 decision 9), used only by
    // push/SystemPushGateway.kt and initialised from the build values above. Pinned; Dependabot's gradle
    // entry keeps it current.
    implementation("com.google.firebase:firebase-messaging:26.0.1")
    constraints {
        // Play services (under FCM) still pulls fragment 1.1.0, whose result handling breaks the
        // permission launcher (lint InvalidFragmentVersionForActivityResult). The app has no fragments;
        // this only lifts the transitive version.
        implementation("androidx.fragment:fragment:1.8.9") {
            because("registerForActivityResult needs fragment 1.3.0 or later on the classpath")
        }
    }
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.19.1")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:5.5.0")
    // Virtual time for ServerConfirmation; the version the Compose BOM already resolves.
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.11.0")
    // Screenshots (ADR-0031): Google's Robolectric renders Compose on the JVM; Roborazzi compares.
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.76.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.76.0")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Stage the Rust core for the device ABIs before packaging (mirrors the iOS Xcode pre-build script).
val stageRustLib = tasks.register<Exec>("stageRustLib") {
    description = "Builds libtran_uniffi.so for arm64-v8a and x86_64 into src/main/jniLibs"
    group = "build"
    commandLine("bash", rootProject.file("scripts/build-rust-lib.sh").absolutePath)
    workingDir = rootProject.projectDir
}

tasks.named("preBuild") {
    dependsOn(stageRustLib)
}

// JVM tests (parity, screenshots) load the host build of the Rust core through JNA; build it so a clean
// clone or CI runner does not depend on an earlier manual `cargo build`.
val buildHostRustLib = tasks.register<Exec>("buildHostRustLib") {
    description = "Builds libtran_uniffi for the host into target/release for JVM tests"
    group = "build"
    commandLine("cargo", "build", "-p", "tran-uniffi", "--release", "--lib")
    workingDir = rootProject.projectDir.parentFile.parentFile
}

tasks.withType<Test> {
    dependsOn(buildHostRustLib)
    val repoRoot = rootProject.projectDir.parentFile.parentFile
    val libDir = repoRoot.resolve("target/release").absolutePath
    environment("UNIFFI_LIB_DIR", libDir)
    environment("REPO_ROOT", repoRoot.absolutePath)
}

// References are per machine and gitignored (ADR-0031): the first run records, later runs verify.
roborazzi {
    outputDir.set(file(".screenshots"))
}
