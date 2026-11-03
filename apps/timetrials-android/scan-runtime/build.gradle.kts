plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

val stagedRuntime = layout.buildDirectory.dir("generated/scanRuntime")
val repositoryRoot = rootProject.projectDir.parentFile.parentFile
val collectionManifest = repositoryRoot.resolve("packages/assets/collection/collection-manifest.v1.json")
val selection = repositoryRoot.resolve("packages/assets/android-scan-selection-v1.json")
val materializer = repositoryRoot.resolve("tooling/assets/materialize_collection.mjs")

android {
    namespace = "nl.mariokart8.mk8dxtimetrials.scanruntime"
    compileSdk = 37

    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlin {
        compilerOptions {
            jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
        }
    }

    sourceSets {
        getByName("main") {
            java.srcDir("engine-src/java")
            // The shared field reader's Java implementation (packages/icon-matcher), and the plain-Java
            // part the app also needs (scan result, sequence decision, name matcher). With the scanner
            // the app takes the latter through this module, so the classes exist once.
            java.srcDir(rootProject.file("../../packages/icon-matcher/java/src/main/java"))
            java.srcDir(rootProject.file("../../packages/icon-matcher/java-result/src/main/java"))
            assets.srcDir(stagedRuntime.map { it.dir("assets") })
        }
        getByName("androidTest") {
            assets.srcDir(stagedRuntime.map { it.dir("androidTestAssets") })
        }
    }

    packaging {
        jniLibs {
            useLegacyPackaging = true
        }
    }
}

val stageMk8dxScanAssets = tasks.register<Exec>("stageMk8dxScanAssets") {
    inputs.files(materializer, collectionManifest, selection)
    outputs.dir(stagedRuntime.map { it.dir("assets") })
    workingDir(repositoryRoot)
    // A view is regenerated whole: files of an older collection version must not survive (or block) an update.
    doFirst { project.delete(stagedRuntime.map { it.dir("assets") }) }
    commandLine("node", materializer.absolutePath, "android-scan",
        stagedRuntime.get().dir("assets").asFile.absolutePath)
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(stageMk8dxScanAssets)
}

dependencies {
    implementation("com.microsoft.onnxruntime:onnxruntime-android:1.31.1")
    implementation("org.opencv:opencv:4.10.0")
    implementation("com.google.mlkit:text-recognition:16.0.1")
    implementation("com.google.mlkit:text-recognition-japanese:16.0.1")
    implementation("com.google.mlkit:text-recognition-chinese:16.0.1")
    implementation("com.google.mlkit:text-recognition-korean:16.0.1")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")

    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
}
