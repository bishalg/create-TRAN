plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.tran.voting"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.tran.voting"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
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
    testImplementation("junit:junit:4.13.2")
    testImplementation("net.java.dev.jna:jna:5.15.0")
    testImplementation("org.json:json:20240303")
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

tasks.withType<Test> {
    val repoRoot = rootProject.projectDir.parentFile.parentFile
    val libDir = repoRoot.resolve("target/release").absolutePath
    environment("UNIFFI_LIB_DIR", libDir)
    environment("REPO_ROOT", repoRoot.absolutePath)
}
