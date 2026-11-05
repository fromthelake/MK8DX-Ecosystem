# Recognition review tooling

## OpenCV 4/5 qualification harness

`opencv_call_inventory.py` and `opencv_cross_platform_inventory.py` record every
explicit Python, Web-scanner and Android OpenCV call with its source expression,
arguments and flags. `opencv_step_trace.py` runs a chosen Python recognition
entry point with each `cv2` function called once, saving per-step array hash,
shape, dtype and sampled `.npy` output; `opencv_trace_compare.py` reports the
first difference and pixel metrics. The video, affine, perspective, Hough and
icon/ghost report probes isolate causes. `opencv_android_qualification_compare.py`
compares Android stage dossiers from the same disposable AVD;
`opencv_android_staff_compare.py` compares per-panel marks and raw scores/margins.
`opencv_web_android_parity.py` measures field-mark disagreements against the
unchanged Web scanner for each Android version on the same staff panels.
`opencv_android_single_stage_compare.py` compares one captured HDMI, phone or
webcam case across versions, ignoring runtime timings.
After building `:scan-runtime:assembleDebugAndroidTest` with the current
private recognition pack, `opencv_android_stage_capture.py` runs the opt-in
instrumentation on an allowlisted disposable AVD and extracts a stage dossier
to a new private directory. Use `--source phone`, `hdmi`, `webcam` or `frames`;
`--labelled` with an optional exact `--case-name` stages one hash-verified
private image when the current AVD corpus is a different class.
For a complete labelled staff corpus, `opencv_android_stage_corpus.py` checks
each source hash and retries transient adb copy failures before the central
Android gate; its exact index check then reuses the staged images.
Never use the release AVD. Opt-in DNN and imgproc spikes do not alter product
defaults. See
`docs/qa/OPENCV5_QUALIFICATION_2026-11-04.md` for versions, commands, corpus
counts, decision and limitations.

Always pass a new output directory outside Git and keep protected images,
models, labels and array snapshots there. Labels are validation-only. Pin one
OpenCV thread and fixed seeds; repeat the old version first to establish the
noise floor. For LiveTrial, use its packaged vision runtime or engine-overlay,
never edit the preserved original engine.
