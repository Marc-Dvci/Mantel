plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "app.mantel.tv"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.mantel.tv"
        // Fire OS 6 is API 25; Fire OS 7 is 28; Fire OS 8 is 30.
        minSdk = 25
        targetSdk = 34
        versionCode = 1
        versionName = "0.1.0"
        // The server the TV talks to until it is paired. Override with -Pmantel.server=...
        buildConfigField("String", "DEFAULT_SERVER", "\"${project.findProperty("mantel.server") ?: ""}\"")
        // Fire TV devices are ARM; x86 keeps the Android TV emulator working.
        ndk { abiFilters += listOf("armeabi-v7a", "arm64-v8a", "x86") }
    }

    buildFeatures {
        buildConfig = true
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    androidResources {
        // The speech model's files must stay uncompressed to be unpacked quickly.
        noCompress += listOf("mdl", "fst", "int", "conf", "mat", "carpa", "txt")
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

dependencies {
    implementation(project(":caremode"))
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.camera:camera-core:1.4.2")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("com.alphacephei:vosk-android:0.3.47")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
