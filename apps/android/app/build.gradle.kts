plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("io.github.takahirom.roborazzi")
}

android {
    namespace = "com.tran.voting"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tran.voting"
        minSdk = 26
        targetSdk = 35
        versionCode = 1000
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // REQ-NAT-011: the API base URL is configurable per build — `-PtranApiBaseUrl=…` or
    // `TRAN_API_BASE_URL=…` wins, otherwise debug targets the emulator host and release HTTPS.
    val configuredApiBaseUrl =
        (findProperty("tranApiBaseUrl") as String?) ?: System.getenv("TRAN_API_BASE_URL")

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

    kotlinOptions {
        jvmTarget = "17"
        freeCompilerArgs +=
            listOf("-opt-in=androidx.compose.ui.ExperimentalComposeUiApi")
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("net.java.dev.jna:jna:5.15.0@aar")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.15.0")
    testImplementation("org.json:json:20240303")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    // Virtual time for ServerConfirmation; the version the Compose BOM already resolves.
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.7.3")
    // Screenshots (ADR-0031): Google's Robolectric renders Compose on the JVM; Roborazzi compares.
    testImplementation(composeBom)
    testImplementation("androidx.compose.ui:ui-test-junit4")
    testImplementation("org.robolectric:robolectric:4.17")
    testImplementation("io.github.takahirom.roborazzi:roborazzi:1.60.0")
    testImplementation("io.github.takahirom.roborazzi:roborazzi-compose:1.60.0")
    androidTestImplementation(composeBom)
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}

// Stage the Rust core for the device ABIs before packaging (mirrors the iOS Xcode pre-build script).
val stageRustLib by tasks.registering(Exec::class) {
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
val buildHostRustLib by tasks.registering(Exec::class) {
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
