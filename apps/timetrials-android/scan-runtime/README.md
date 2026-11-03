# Android scan runtime

This Android library is the on-device Time Trial recognition engine: detector, card registration, time digits
and identity. The app includes it by default; pass `-PenableScanRuntime=false` to build the app without it.

The engine's Java source is in `engine-src/java/`. At build time Gradle materializes the model and recognition
assets from the repository's asset collection, using the selection in
`packages/assets/android-scan-selection-v1.json` and `tooling/assets/materialize_collection.mjs`, into the ignored
`build/generated/scanRuntime/` folder. No external asset folder is needed. Build commands are in
[Client builds](../../../docs/CLIENT_BUILDS.md).

## Tests

```powershell
cd apps\timetrials-android
.\gradlew.bat :scan-runtime:assembleDebug :scan-runtime:lintDebug
.\gradlew.bat :scan-runtime:connectedDebugAndroidTest
```

The instrumentation tests compare the engine with pinned reference decisions on a set of labelled frames. That
evaluation set is not part of this repository; without it, those tests skip. `ScanRuntimeFrameEnvelope` turns the
engine's result into the five-field form the app's multi-frame consensus uses.

The detector model, game-derived references and segment templates are covered by
[Third-party materials](../../../docs/THIRD_PARTY_MATERIALS.md). ONNX Runtime, OpenCV, ML Kit, AndroidX and Kotlin
keep their own licenses.
