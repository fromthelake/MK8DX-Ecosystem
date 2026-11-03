pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "MK8DXTimeTrials"
include(":app")

if (providers.gradleProperty("enableScanRuntime").orNull != "false") {
    include(":scan-runtime")
}
