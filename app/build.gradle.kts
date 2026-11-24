plugins {
    alias(libs.plugins.android.application)
}

android {
    namespace = "com.echo.memorynetwork"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.echo.memorynetwork"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"

        val rawServerUrl = ((project.findProperty("ECHO_SERVER_URL") as String?)
            ?: System.getenv("ECHO_SERVER_URL")
            ?: "")
            .trim()
            .trimEnd('/')
        val defaultServerUrl = rawServerUrl
            .ifEmpty { "https://ais-pre-2yzod2n5xijkorfgbkbt7x-6611368983.asia-southeast1.run.app" }
            .replace("\"", "")
        resValue("string", "default_server_url", defaultServerUrl)
    }

    signingConfigs {
        getByName("debug") {
            val ciKeystore = rootProject.file("debug.keystore")
            if (ciKeystore.exists()) {
                storeFile = ciKeystore
                storePassword = "android"
                keyAlias = "androiddebugkey"
                keyPassword = "android"
            }
        }
    }

    buildTypes {
        debug {
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation(libs.androidx.appcompat)
}
