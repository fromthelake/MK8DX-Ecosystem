import java.net.URI


plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

val enableScanRuntime = providers.gradleProperty("enableScanRuntime").orNull != "false"
val mk8dxApiOrigin = providers.gradleProperty("mk8dxApiOrigin").orNull
    ?: "https://example.invalid"
val mk8dxApiUri = URI(mk8dxApiOrigin)
val repositoryRoot = rootProject.projectDir.parentFile.parentFile
val internalCollection = repositoryRoot.resolve("packages/assets/collection")
val productLauncherSource = repositoryRoot.resolve("apps/timetrials-web/styles/app-icon-512.png")
val mk8dxDebugCaCertificate = providers.gradleProperty("mk8dxDebugCaCertificate").orNull
// Owner-private release signing. All four properties must be supplied
// together (outside Git, e.g. through a gradle.properties in GRADLE_USER_HOME
// or -P arguments); otherwise the release build stays unsigned as before.
val mk8dxReleaseSigning = listOf(
    "mk8dxReleaseStoreFile",
    "mk8dxReleaseStorePassword",
    "mk8dxReleaseKeyAlias",
    "mk8dxReleaseKeyPassword",
).associateWith { providers.gradleProperty(it).orNull }
val mk8dxReleaseSigningConfigured = mk8dxReleaseSigning.values.all { !it.isNullOrEmpty() }
require(mk8dxReleaseSigningConfigured || mk8dxReleaseSigning.values.all { it == null }) {
    "mk8dxRelease* signing properties must be supplied together"
}
val generatedDebugNetworkSecurityResources =
    layout.buildDirectory.dir("generated/mk8dxDebugNetworkSecurity/res")
val generatedCollectionProductAssets =
    layout.buildDirectory.dir("generated/mk8dxCollectionProductAssets/assets")
val generatedProductLauncherResources =
    layout.buildDirectory.dir("generated/mk8dxProductLauncher/res")
require(productLauncherSource.isFile) {
    "The shared Web/Android product icon is missing: $productLauncherSource"
}
require(
    mk8dxApiUri.scheme == "https" &&
        !mk8dxApiUri.host.isNullOrEmpty() &&
        mk8dxApiUri.rawUserInfo == null &&
        mk8dxApiUri.rawPath in setOf("", "/") &&
        mk8dxApiUri.rawQuery == null &&
        mk8dxApiUri.rawFragment == null &&
        (mk8dxApiUri.port == -1 || mk8dxApiUri.port in 1..65_535),
) {
    "mk8dxApiOrigin must be an exact HTTPS origin"
}

android {
    namespace = "nl.mariokart8.mk8dxtimetrials"
    compileSdk = 37

    defaultConfig {
        applicationId = "nl.mariokart8.mk8dxtimetrials"
        minSdk = if (enableScanRuntime) 26 else 24
        targetSdk = 36
        versionCode = 161
        versionName = "2.95.0"

        manifestPlaceholders["mk8dxLauncherIcon"] = "@mipmap/mk8dx_product_launcher"
        manifestPlaceholders["mk8dxApiHost"] = mk8dxApiUri.host

        buildConfigField("String", "MK8DX_API_ORIGIN", "\"$mk8dxApiOrigin\"")
        buildConfigField("boolean", "MK8DX_SCAN_RUNTIME_ENABLED", enableScanRuntime.toString())

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }

    if (mk8dxReleaseSigningConfigured) {
        signingConfigs {
            create("mk8dxRelease") {
                val storePath = file(mk8dxReleaseSigning.getValue("mk8dxReleaseStoreFile")!!)
                require(storePath.isAbsolute && storePath.isFile) {
                    "mk8dxReleaseStoreFile must identify an existing keystore file"
                }
                storeFile = storePath
                storePassword = mk8dxReleaseSigning.getValue("mk8dxReleaseStorePassword")
                keyAlias = mk8dxReleaseSigning.getValue("mk8dxReleaseKeyAlias")
                keyPassword = mk8dxReleaseSigning.getValue("mk8dxReleaseKeyPassword")
            }
        }
    }

    buildTypes {
        debug {
            // Opt-in only: a suffixed application id installs a throwaway
            // measurement copy beside the owner's real app, so a device test
            // never touches their session, their data or their launcher entry.
            val sideBySide = providers.gradleProperty("mk8dxSideBySideSuffix").orNull
            if (!sideBySide.isNullOrEmpty()) {
                require(Regex("^[a-z][a-z0-9]{0,15}$").matches(sideBySide)) {
                    "mk8dxSideBySideSuffix must be a short lowercase word"
                }
                applicationIdSuffix = ".$sideBySide"
                versionNameSuffix = "-$sideBySide"
            }
        }
        release {
            isMinifyEnabled = false
            if (mk8dxReleaseSigningConfigured) {
                signingConfig = signingConfigs.getByName("mk8dxRelease")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro",
            )
        }
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

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The central plain-Java part (packages/icon-matcher java-result: scan result, sequence decision,
    // name matcher; CENTRAL_RECOGNITION section 8.6) is needed in every variant. A scanner build gets
    // it through :scan-runtime (which compiles it); a scanner-free build compiles it here.
    if (!enableScanRuntime) {
        sourceSets.getByName("main").java.srcDir(rootProject.file("../../packages/icon-matcher/java-result/src/main/java"))
    }

    if (enableScanRuntime) {
        // The scanner is included by default from the repository collection.
        sourceSets {
            getByName("main").java.srcDir("src/scanRuntime/java")
            getByName("androidTest").java.srcDir("src/scanRuntimeAndroidTest/java")
            getByName("androidTest").assets.srcDir(
                project(":scan-runtime").layout.buildDirectory.dir(
                    "generated/scanRuntime/androidTestAssets",
                ),
            )
        }
    }

    sourceSets.getByName("main").assets.srcDir(generatedCollectionProductAssets)
    if (mk8dxDebugCaCertificate != null) {
        sourceSets.getByName("debug").res.srcDir(generatedDebugNetworkSecurityResources)
    }
}

val stageMk8dxCollectionProductAssets = tasks.register<Exec>("stageMk8dxCollectionProductAssets") {
    val materializer = repositoryRoot.resolve("tooling/assets/materialize_collection.mjs")
    inputs.files(materializer, internalCollection.resolve("collection-manifest.v1.json"),
        repositoryRoot.resolve("packages/assets/android-product-selection-v1.json"))
    outputs.dir(generatedCollectionProductAssets)
    workingDir(repositoryRoot)
    // A view is regenerated whole: files of an older collection version must not survive (or block) an update.
    doFirst { project.delete(generatedCollectionProductAssets) }
    commandLine("node", materializer.absolutePath, "android-product",
        generatedCollectionProductAssets.get().asFile.absolutePath)
}
tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
    dependsOn(stageMk8dxCollectionProductAssets)
}
tasks.matching { it.name.contains("lint", ignoreCase = true) }.configureEach {
    dependsOn(stageMk8dxCollectionProductAssets)
}
android.sourceSets.getByName("main").res.srcDir("src/fallbackSplash/res")

// The Web's 512 px derivative is pixel-identical to the owner's original
// Play Store icon; stage that one committed source for Android as well.
val stageMk8dxProductLauncher = tasks.register<Copy>("stageMk8dxProductLauncher") {
    inputs.file(productLauncherSource)
    outputs.dir(generatedProductLauncherResources)
    into(generatedProductLauncherResources)
    from(productLauncherSource) {
        into("drawable-nodpi")
        rename { "mk8dx_product_launcher_art.png" }
    }
}
android.sourceSets.getByName("main").res.srcDir(generatedProductLauncherResources)
tasks.matching { it.name.startsWith("pre") && it.name.endsWith("Build") }.configureEach {
    dependsOn(stageMk8dxProductLauncher)
}
tasks.matching { it.name.contains("lint", ignoreCase = true) }.configureEach {
    dependsOn(stageMk8dxProductLauncher)
}

if (mk8dxDebugCaCertificate != null) {
    val certificate = file(mk8dxDebugCaCertificate).canonicalFile
    require(certificate.isAbsolute && certificate.isFile) {
        "mk8dxDebugCaCertificate must identify an existing certificate file"
    }
    val generateMk8dxDebugNetworkSecurity = tasks.register(
        "generateMk8dxDebugNetworkSecurity",
    ) {
        inputs.file(certificate)
        outputs.dir(generatedDebugNetworkSecurityResources)
        doLast {
            val resources = generatedDebugNetworkSecurityResources.get().asFile
            val rawDirectory = resources.resolve("raw").apply { mkdirs() }
            val xmlDirectory = resources.resolve("xml").apply { mkdirs() }
            certificate.copyTo(rawDirectory.resolve("mk8dx_debug_ca.pem"), overwrite = true)
            xmlDirectory.resolve("mk8dx_network_security_config.xml").writeText(
                """<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors>
            <certificates src="system" />
        </trust-anchors>
    </base-config>
    <debug-overrides>
        <trust-anchors>
            <certificates src="@raw/mk8dx_debug_ca" />
        </trust-anchors>
    </debug-overrides>
</network-security-config>
""",
                Charsets.UTF_8,
            )
        }
    }
    tasks.matching { it.name == "preDebugBuild" }.configureEach {
        dependsOn(generateMk8dxDebugNetworkSecurity)
    }
}

dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.09.00"))
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.core:core:1.19.1")
    // The splash screen the product already gets on Android 12+, backported to
    // every supported release (DESIGN_SYSTEM §23).
    implementation("androidx.core:core-splashscreen:1.2.0")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.material:material-icons-core")
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    // Captured frames carry their orientation as EXIF; the scan reads it so a
    // frame is upright whichever way the phone was held.
    implementation("androidx.exifinterface:exifinterface:1.3.7")
    implementation("androidx.camera:camera-camera2:1.4.2")
    implementation("androidx.camera:camera-lifecycle:1.4.2")
    implementation("androidx.camera:camera-view:1.4.2")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.8.7")
    implementation("androidx.work:work-runtime-ktx:2.12.0")
    // Reads the host's setup QR to pair with an offline LAN installation (ADR-0223).
    // Pure Java decoder (Apache-2.0); no Google service, nothing leaves the phone.
    implementation("com.google.zxing:core:3.5.3")
    debugImplementation("androidx.compose.ui:ui-tooling")

    if (enableScanRuntime) {
        implementation(project(":scan-runtime"))
    }

    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.11.0")

    testImplementation("junit:junit:4.13.2")

    androidTestImplementation(platform("androidx.compose:compose-bom:2026.09.00"))
    androidTestImplementation("androidx.compose.ui:ui-test-junit4")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
    debugImplementation("androidx.compose.ui:ui-test-manifest")
}
