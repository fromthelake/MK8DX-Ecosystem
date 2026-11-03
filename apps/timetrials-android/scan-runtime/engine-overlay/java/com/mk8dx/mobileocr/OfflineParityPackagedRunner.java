package com.mk8dx.mobileocr;

import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.util.Base64;

import org.json.JSONArray;
import org.json.JSONObject;
import org.opencv.android.OpenCVLoader;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.Point;
import org.opencv.core.Scalar;
import org.opencv.core.Size;
import org.opencv.imgproc.CLAHE;
import org.opencv.imgproc.Imgproc;
import org.opencv.imgcodecs.Imgcodecs;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Locale;

public class OfflineParityPackagedRunner {

    private final Context context;
    private boolean suppressVisualArtifacts = false;
    private RfDetrDetector liveDetector = null;
    private JSONObject liveDetectorStatus = null;
    private JSONObject liveRelGrid = null;
    private JSONObject liveRelGridGhostDetail = null;
    private OfflineParityNativePipeline.SegmentTemplate liveLapTemplate = null;
    private OfflineParityNativePipeline.SegmentTemplate liveTotalTemplate = null;
    private boolean liveOpenCvReady = false;
    private String liveOpenCvStatus = "not_initialized";
    private static final List<String> LIVE_REVIEW_STAGE_ORDER = Arrays.asList(
            "00_InputImage",
            "01_AutoCardROI",
            "02_AutoBrightnessContrast",
            "03_HSVMask",
            "04_Grayscale",
            "05_CLAHE",
            "06_AdaptiveThreshold",
            "07_FlowJoin",
            "08_MaskCombine",
            "09_MaskCleanup",
            "10_Morphology",
            "11_CannyEdges",
            "12_HoughLinesP",
            "13_AngleFilterLines",
            "14_ClusterLines",
            "15_QuadSelect",
            "16_RoiRestore",
            "17_PerspectiveWarp",
            "18_CanonicalPlayerBoxAlign",
            "19_RFDetr3ClassDetect",
            "20_RFDetrLapIndexRefine",
            "21_RFDetrDynamicLapGrid",
            "24_SevenSegmentOCRProbe",
            "26_OfflineOCRDecode"
    );

    public interface LiveProgressListener {
        void onLiveProgress(String status, String stage, int completedStages, int totalStages, long elapsedMs);
    }

    public OfflineParityPackagedRunner(Context context) {
        this.context = context.getApplicationContext();
    }

    public synchronized LiveResult runLiveBitmap(Bitmap bitmap) {
        return runLiveBitmap(bitmap, true, "live_camera_frame");
    }

    public synchronized LiveResult runLiveBitmap(Bitmap bitmap, boolean minimalArtifacts, String imageKey) {
        return runLiveBitmap(bitmap, minimalArtifacts, imageKey, null, false);
    }

    /** Identity-only frame: stemmen voor character/kart/wheel/glider/flag zonder 7-segment-read. */

    public synchronized LiveResult runLiveBitmap(Bitmap bitmap, boolean minimalArtifacts, String imageKey, LiveProgressListener progressListener) {
        return runLiveBitmap(bitmap, minimalArtifacts, imageKey, progressListener, false);
    }

    public synchronized LiveResult runLiveBitmap(Bitmap bitmap, boolean minimalArtifacts, String imageKey, LiveProgressListener progressListener, boolean identityOnly) {
        return runLiveBitmap(bitmap, minimalArtifacts, imageKey, progressListener, identityOnly, OfflineParityNativePipeline.LAYOUT_ENDSCREEN);
    }

    /** layoutProfile: LAYOUT_ENDSCREEN (origineel, speler+ghost-kaarten) of LAYOUT_GHOST_DETAIL (Select-a-Ghost detailpaneel). */
    public synchronized LiveResult runLiveBitmap(Bitmap bitmap, boolean minimalArtifacts, String imageKey, LiveProgressListener progressListener, boolean identityOnly, String layoutProfile) {
        long started = System.currentTimeMillis();
        LiveResult live = new LiveResult();
        live.status = "not_started";
        live.message = "";
        live.acceptedDecodeSource = "";
        live.fixedGridUsedForAcceptedDecode = false;
        live.expectedValuesValidationOnly = true;
        live.noRuntimeLabelFallback = true;
        if (bitmap == null) {
            live.status = "error";
            live.message = "bitmap unavailable";
            live.firstBlockingStage = "00_InputImage";
            live.totalRuntimeMs = System.currentTimeMillis() - started;
            return live;
        }
        String safeImageKey = safeName(imageKey);
        RunOptions options = new RunOptions();
        options.minimalArtifacts = minimalArtifacts;
        options.identityOnly = identityOnly;
        options.reuseRoiDetections = identityOnly;
        options.layoutProfile = OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL.equals(layoutProfile)
                ? OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL
                : OfflineParityNativePipeline.LAYOUT_ENDSCREEN;
        this.step02ScoreDownscale = identityOnly;
        this.suppressVisualArtifacts = minimalArtifacts;
        File root = new File(context.getCacheDir(), minimalArtifacts ? "live_camera_workflow/latest" : "live_camera_workflow/gallery_latest");
        File imageDir = new File(new File(root, "per_image"), safeImageKey);
        ProgressTracker progress = new ProgressTracker(root, minimalArtifacts ? "camera_live" : "gallery_import", options, progressListener);
        try {
            ensureLiveWorkflowResources(options);
            recreateDirectory(root);
            imageDir.mkdirs();
            progress.writeRunEvent("run_started", "", 0, 1, null);
            progress.writeImageEvent(safeImageKey, 0, 1, imageDir, "image_started", "", null);

            progress.stageStarted(safeImageKey, 0, 1, imageDir, "00_InputImage");
            writeText(new File(imageDir, "01_input_metadata.json"), new JSONObject()
                    .put("image_key", safeImageKey)
                    .put("input_width", bitmap.getWidth())
                    .put("input_height", bitmap.getHeight())
                    .put("source", minimalArtifacts ? "CameraX live preview frame" : "Gallery imported still image")
                    .put("expected_values_validation_only", true)
                    .put("no_runtime_label_fallback", true)
                    .toString(2));
            if (!minimalArtifacts) {
                writeSourceBitmap(new File(imageDir, "00_input.png"), bitmap);
            }
            progress.stageCompleted(safeImageKey, 0, 1, imageDir, "00_InputImage", null);

            progress.stageStarted(safeImageKey, 0, 1, imageDir, "01_AutoCardROI");
            AutoCardRoiSelector.Selection roiSelection = runAutoCardRoi(bitmap, imageDir, liveDetector, liveDetectorStatus, options.layoutProfile);
            progress.stageCompleted(safeImageKey, 0, 1, imageDir, "01_AutoCardROI", null);

            boolean ghostDetailLayout = OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL.equals(options.layoutProfile);
            EarlyCvResult earlyCv = runEarlyCvStages(
                    bitmap,
                    imageDir,
                    roiSelection,
                    liveDetector,
                    ghostDetailLayout ? liveRelGridGhostDetail : liveRelGrid,
                    liveLapTemplate,
                    liveTotalTemplate,
                    liveOpenCvReady,
                    liveOpenCvStatus,
                    options,
                    progress,
                    safeImageKey,
                    0,
                    1
            );
            writeText(new File(imageDir, "implementation_status.json"), implementationStatus(roiSelection, earlyCv).toString(2));
            writeText(new File(imageDir, "unavailable_stage_status.json"), unavailableStatus(roiSelection, earlyCv).toString(2));
            progress.writeImageEvent(safeImageKey, 0, 1, imageDir, "image_completed", "success", null);
            progress.writeRunEvent("run_completed", "", 0, 1, null);
            progress.writeTimingSummary();

            live.outputDir = imageDir.getAbsolutePath();
            live.stageStatus.putAll(earlyCv.downstreamStatuses);
            live.stageStatus.put("01_AutoCardROI", roiSelection.status);
            live.status = "implemented";
            if (!roiSelection.hasRoi()) {
                live.status = "blocked";
                live.firstBlockingStage = "01_AutoCardROI";
                live.message = roiSelection.status + ": " + roiSelection.reason;
                live.totalRuntimeMs = System.currentTimeMillis() - started;
                return live;
            }
            populateLiveDecodeResult(live, imageDir);
            if (live.fields.isEmpty()) {
                live.status = "blocked";
                live.firstBlockingStage = firstBlockingStage(earlyCv);
                live.message = "No Step 26 fields available";
            } else if (live.frameValid) {
                live.status = "valid_decode";
                live.message = "Step 26 frame valid";
            } else {
                live.status = "partial_decode";
                live.message = "Step 26 produced fields but not all values are valid";
            }
        } catch (Exception exc) {
            live.status = "error";
            live.message = exc.getMessage();
            live.firstBlockingStage = "runtime";
        } finally {
            live.totalRuntimeMs = System.currentTimeMillis() - started;
        }
        return live;
    }

    private void ensureLiveWorkflowResources(RunOptions options) throws Exception {
        if (liveDetectorStatus != null && liveRelGrid != null && liveRelGridGhostDetail != null && liveLapTemplate != null && liveTotalTemplate != null) {
            return;
        }
        AssetManager assets = context.getAssets();
        liveRelGrid = readAssetJson(assets, "grid/new_relative_grid_combined.json");
        liveRelGridGhostDetail = readAssetJson(assets, "grid/ghost_detail_relative_grid.json");
        liveLapTemplate = readSegmentTemplate(assets, "segment_templates/template_7segments_17x25.png");
        liveTotalTemplate = readSegmentTemplate(assets, "segment_templates/template_7segments_18x29.png");
        try {
            liveOpenCvReady = OpenCVLoader.initDebug();
            liveOpenCvStatus = liveOpenCvReady ? "loaded" : "init_failed";
        } catch (Exception exc) {
            liveOpenCvReady = false;
            liveOpenCvStatus = "init_error: " + exc.getMessage();
        }
        liveDetectorStatus = new JSONObject();
        if (liveDetector == null) {
            String detectorModelAsset = RfDetrDetector.modelAssetForProfile(options.rfdetrModelProfile);
            String detectorModelProfile = RfDetrDetector.normalizeModelProfile(options.rfdetrModelProfile);
            try {
                liveDetector = new RfDetrDetector(context, detectorModelAsset, options.rfdetrProviderStrategy, detectorModelProfile);
                liveDetectorStatus.put("status", "available");
                liveDetectorStatus.put("implementation_mode", "native_android_rfdetr_ort");
                liveDetectorStatus.put("config", liveDetector.configJson());
            } catch (Exception exc) {
                liveDetectorStatus.put("status", "blocked_missing_detector");
                liveDetectorStatus.put("reason", exc.getMessage());
                liveDetectorStatus.put("missing_dependency", "model_asset_or_ort_runtime_initialization");
                liveDetectorStatus.put("model_asset_path", detectorModelAsset);
                liveDetectorStatus.put("requested_model_profile", detectorModelProfile);
                liveDetectorStatus.put("no_runtime_label_fallback", true);
            }
        }
    }

    private KartConfigMatcher kartConfigMatcherInstance;
    private boolean kartConfigMatcherFailed;
    private boolean step02ScoreDownscale = false;

    /** Lazy; bij een laadfout draait de pipeline gewoon zonder node 27. */
    private KartConfigMatcher kartConfigMatcherOrNull() {
        if (kartConfigMatcherInstance == null && !kartConfigMatcherFailed) {
            try {
                kartConfigMatcherInstance = KartConfigMatcher.get(context);
            } catch (Exception exc) {
                kartConfigMatcherFailed = true;
                DebugConsole.log("IDENT", "kart-config-assets laden faalde: " + exc.getMessage());
            }
        }
        return kartConfigMatcherInstance;
    }

    private void populateLiveDecodeResult(LiveResult live, File imageDir) throws Exception {
        // identiteit EERST: identity-only frames hebben geen 26-json maar wel node 27
        File kartConfigFile = new File(imageDir, "27_kart_config.json");
        if (kartConfigFile.exists()) {
            live.kartConfig = new JSONObject(readText(kartConfigFile));
        }
        File decode = new File(imageDir, "26_ocr_result_slot_details.json");
        if (!decode.exists()) {
            return;
        }
        JSONObject root = new JSONObject(readText(decode));
        live.acceptedDecodeSource = root.optString("accepted_decode_source", "");
        live.fixedGridUsedForAcceptedDecode = root.optBoolean("fixed_grid_used_for_accepted_decode", false);
        live.frameValid = root.optBoolean("frame_valid", false);
        live.lapSumOk = root.isNull("lap_sum_ok") ? null : root.optBoolean("lap_sum_ok");
        live.lapSumRepairs = root.optJSONArray("lap_sum_repairs") == null ? 0 : root.getJSONArray("lap_sum_repairs").length();
        JSONArray fields = root.optJSONArray("fields");
        if (fields != null) {
            for (int i = 0; i < fields.length(); i++) {
                JSONObject row = fields.optJSONObject(i);
                if (row == null) {
                    continue;
                }
                String name = row.optString("field_name", row.optString("name", ""));
                String value = row.optString("decoded_value", row.optString("value", ""));
                if (!name.isEmpty()) {
                    live.fields.put(name, value);
                }
            }
        }
        File grid = new File(imageDir, "21_dynamic_lap_grid.json");
        if (grid.exists()) {
            JSONObject gridJson = new JSONObject(readText(grid));
            live.raceProfile = gridJson.optString("canonical_race_key", gridJson.optString("race_key", ""));
            live.expectedFieldCount = gridJson.optInt("expected_field_count", live.fields.size());
        }
        if (live.expectedFieldCount <= 0) {
            live.expectedFieldCount = live.fields.size();
        }
    }

    private String firstBlockingStage(EarlyCvResult earlyCv) {
        if (!earlyCv.step02) return "02_AutoBrightnessContrast";
        if (!earlyCv.step03) return "03_HSVMask";
        if (!earlyCv.step04) return "04_Grayscale";
        if (!earlyCv.step05) return "05_CLAHE";
        if (!earlyCv.step06) return "06_AdaptiveThreshold";
        String[] ordered = new String[]{
                "07_FlowJoin", "08_MaskCombine", "09_MaskCleanup", "10_Morphology",
                "11_CannyEdges", "12_HoughLinesP", "13_AngleFilterLines", "14_ClusterLines",
                "15_QuadSelect", "16_RoiRestore", "17_PerspectiveWarp",
                "18_CanonicalPlayerBoxAlign", "19_RFDetr3ClassDetect", "20_RFDetrLapIndexRefine",
                "21_RFDetrDynamicLapGrid", "22_FixedMK8Grid", "23_TimeTrialEndscreenGate",
                "24_SevenSegmentOCRProbe", "25_SevenSegmentOCRInspect", "26_OfflineOCRDecode"
        };
        for (String stage : ordered) {
            String status = earlyCv.downstreamStatuses.get(stage);
            if (status == null || status.startsWith("blocked") || status.startsWith("not_")) {
                return stage;
            }
        }
        return "26_OfflineOCRDecode";
    }



    public static class RunOptions {
        public int maxImages = -1;
        public String imageKey = "";
        public String warmupImageKey = "";
        public String stopAfterStage = "";
        public long stageTimeoutMs = 0L;
        public long runTimeoutMs = 0L;
        public boolean minimalArtifacts = false;
        // Identity-only: na een tijden-lock hoeven vervolgframes alleen nog de
        // identiteits-stemmen te leveren — localisatie+grid+node27, geen 7-segment.
        public boolean identityOnly = false;
        // Scanner-layout: "endscreen" (default) of "ghost_detail". Bepaalt de
        // ROI-route (stap 01), het relatieve grid en de canonieke targetbox.
        public String layoutProfile = OfflineParityNativePipeline.LAYOUT_ENDSCREEN;
        // two-phase: node 19 hergebruikt step-01-detecties via warp-transform.
        // GEMETEN 2026-07-16: -34% wall-clock maar de lap-som sloot niet meer op
        // 2/3 GT-frames (digit-grid is gevoeliger dan de icoon-slots) => alleen
        // veilig voor identity-only stemframes (iconen hebben +-10px zoekmarge).
        public boolean reuseRoiDetections = false;
        public String rfdetrProviderStrategy = "cpu_current";
        public String rfdetrModelProfile = RfDetrDetector.DEFAULT_MODEL_PROFILE;

        public boolean stopAfterStage(String stagePrefix) {
            if (stopAfterStage == null || stopAfterStage.isEmpty()) {
                return false;
            }
            return stopAfterStage.equals(stagePrefix)
                    || stopAfterStage.startsWith(stagePrefix + "_")
                    || stopAfterStage.startsWith(stagePrefix + "-");
        }

        public JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("max_images", maxImages)
                    .put("image_key", imageKey)
                    .put("warmup_image_key", warmupImageKey)
                    .put("stop_after_stage", stopAfterStage)
                    .put("stage_timeout_ms", stageTimeoutMs)
                    .put("run_timeout_ms", runTimeoutMs)
                    .put("minimal_artifacts", minimalArtifacts)
                    .put("layout_profile", layoutProfile)
                    .put("rfdetr_provider_strategy", rfdetrProviderStrategy == null || rfdetrProviderStrategy.isEmpty() ? "cpu_current" : rfdetrProviderStrategy)
                    .put("rfdetr_model_profile", RfDetrDetector.normalizeModelProfile(rfdetrModelProfile));
        }
    }

    public static class LiveResult {
        public String status = "";
        public String message = "";
        public String firstBlockingStage = "";
        public String raceProfile = "";
        public String acceptedDecodeSource = "";
        public boolean fixedGridUsedForAcceptedDecode = false;
        public boolean expectedValuesValidationOnly = true;
        public boolean noRuntimeLabelFallback = true;
        public boolean frameValid = false;
        public Boolean lapSumOk = null;
        public int lapSumRepairs = 0;
        public JSONObject kartConfig = null;
        public int expectedFieldCount = 0;
        public long totalRuntimeMs = 0L;
        public String outputDir = "";
        public final Map<String, String> fields = new LinkedHashMap<>();
        public final Map<String, String> stageStatus = new LinkedHashMap<>();

        public JSONObject toJson() throws Exception {
            JSONObject root = new JSONObject()
                    .put("status", status)
                    .put("message", message)
                    .put("first_blocking_stage", firstBlockingStage)
                    .put("race_profile", raceProfile)
                    .put("accepted_decode_source", acceptedDecodeSource)
                    .put("fixed_grid_used_for_accepted_decode", fixedGridUsedForAcceptedDecode)
                    .put("expected_values_validation_only", expectedValuesValidationOnly)
                    .put("no_runtime_label_fallback", noRuntimeLabelFallback)
                    .put("frame_valid", frameValid)
                    .put("lap_sum_ok", lapSumOk == null ? JSONObject.NULL : lapSumOk)
                    .put("expected_field_count", expectedFieldCount)
                    .put("total_runtime_ms", totalRuntimeMs)
                    .put("output_dir", outputDir);
            JSONObject fieldsJson = new JSONObject();
            for (String key : fields.keySet()) {
                fieldsJson.put(key, fields.get(key));
            }
            root.put("fields", fieldsJson);
            JSONObject stagesJson = new JSONObject();
            for (String key : stageStatus.keySet()) {
                stagesJson.put(key, stageStatus.get(key));
            }
            root.put("stage_status", stagesJson);
            return root;
        }
    }

    private class ProgressTracker {
        private final File runRoot;
        private final String assetRoot;
        private final RunOptions options;
        private final LiveProgressListener liveProgressListener;
        private final long createdAtMs = System.currentTimeMillis();
        private final LinkedHashSet<String> completedReviewStages = new LinkedHashSet<>();
        private final JSONArray events = new JSONArray();
        private final Map<String, Long> stageStarts = new LinkedHashMap<>();
        private final Map<String, JSONArray> imageEvents = new LinkedHashMap<>();

        ProgressTracker(File runRoot, String assetRoot, RunOptions options) {
            this(runRoot, assetRoot, options, null);
        }

        ProgressTracker(File runRoot, String assetRoot, RunOptions options, LiveProgressListener liveProgressListener) {
            this.runRoot = runRoot;
            this.assetRoot = assetRoot;
            this.options = options;
            this.liveProgressListener = liveProgressListener;
        }

        void writeRunEvent(String status, String stage, int imageIndex, int totalImages, String error) throws Exception {
            JSONObject event = baseEvent(status, "", imageIndex, totalImages, stage, error);
            event.put("asset_root", assetRoot);
            event.put("runner_options", options.toJson());
            events.put(event);
            notifyLiveProgress(status, stage);
            DebugConsole.log("RUN", status + (stage == null || stage.isEmpty() ? "" : " " + stage)
                    + (error == null || error.isEmpty() ? "" : " error=" + error));
            writeHeartbeat(event);
            writeRunProgress();
        }

        void writeImageEvent(String imageKey, int imageIndex, int totalImages, File imageDir, String status, String stage, String error) throws Exception {
            JSONObject event = baseEvent(status, imageKey, imageIndex, totalImages, stage, error);
            addImageEvent(imageKey, event);
            events.put(event);
            notifyLiveProgress(status, stage);
            writeHeartbeat(event);
            writeRunProgress();
            writeText(new File(imageDir, "stage_progress.json"), imageProgress(imageKey).toString(2));
        }

        void stageStarted(String imageKey, int imageIndex, int totalImages, File imageDir, String stage) throws Exception {
            String key = imageKey + "|" + stage;
            stageStarts.put(key, System.currentTimeMillis());
            JSONObject event = baseEvent("started", imageKey, imageIndex, totalImages, stage, null);
            addImageEvent(imageKey, event);
            events.put(event);
            notifyLiveProgress("started", stage);
            DebugConsole.stageStatus(imageKey, stage, imageIndex, totalImages);
            DebugConsole.log("STAGE", "[" + imageKey + "] > " + stage);
            writeHeartbeat(event);
            writeRunProgress();
            writeText(new File(imageDir, "stage_progress.json"), imageProgress(imageKey).toString(2));
        }

        void stageCompleted(String imageKey, int imageIndex, int totalImages, File imageDir, String stage, JSONObject extra) throws Exception {
            String key = imageKey + "|" + stage;
            long now = System.currentTimeMillis();
            Long started = stageStarts.get(key);
            JSONObject event = baseEvent("completed", imageKey, imageIndex, totalImages, stage, null);
            if (started != null) {
                event.put("stage_duration_ms", now - started);
            }
            if (extra != null) {
                event.put("extra", extra);
            }
            addImageEvent(imageKey, event);
            events.put(event);
            if (isLiveReviewStage(stage)) {
                completedReviewStages.add(stage);
            }
            notifyLiveProgress("completed", stage);
            DebugConsole.stageStatus(imageKey, stage, imageIndex, totalImages);
            DebugConsole.log("STAGE", "[" + imageKey + "] ok " + stage
                    + (started == null ? "" : " (" + (now - started) + "ms)"));
            writeHeartbeat(event);
            writeRunProgress();
            writeText(new File(imageDir, "stage_progress.json"), imageProgress(imageKey).toString(2));
        }

        private boolean isLiveReviewStage(String stage) {
            return LIVE_REVIEW_STAGE_ORDER.contains(stage);
        }

        private void notifyLiveProgress(String status, String stage) {
            if (liveProgressListener == null) {
                return;
            }
            liveProgressListener.onLiveProgress(
                    status == null ? "" : status,
                    stage == null ? "" : stage,
                    completedReviewStages.size(),
                    LIVE_REVIEW_STAGE_ORDER.size(),
                    System.currentTimeMillis() - createdAtMs
            );
        }

        void writeTimingSummary() throws Exception {
            JSONObject byStage = new JSONObject();
            for (int i = 0; i < events.length(); i++) {
                JSONObject event = events.getJSONObject(i);
                if (!"completed".equals(event.optString("status")) || !event.has("stage_duration_ms")) {
                    continue;
                }
                String stage = event.optString("current_stage", "unknown");
                JSONObject agg = byStage.optJSONObject(stage);
                if (agg == null) {
                    agg = new JSONObject()
                            .put("count", 0)
                            .put("total_ms", 0)
                            .put("min_ms", Long.MAX_VALUE)
                            .put("max_ms", 0)
                            .put("slowest_image_key", "");
                    byStage.put(stage, agg);
                }
                long duration = event.optLong("stage_duration_ms", 0);
                agg.put("count", agg.optInt("count") + 1);
                agg.put("total_ms", agg.optLong("total_ms") + duration);
                agg.put("min_ms", Math.min(agg.optLong("min_ms"), duration));
                if (duration > agg.optLong("max_ms")) {
                    agg.put("max_ms", duration);
                    agg.put("slowest_image_key", event.optString("current_image_key"));
                }
                agg.put("mean_ms", agg.optLong("total_ms") / Math.max(1.0, agg.optInt("count")));
            }
            writeText(new File(runRoot, "summary_stage_timings.json"), new JSONObject()
                    .put("schema_version", "phase4o_stage_timings_v1")
                    .put("asset_root", assetRoot)
                    .put("stage_timings", byStage)
                    .put("events", events)
                    .toString(2));
        }

        private JSONObject baseEvent(String status, String imageKey, int imageIndex, int totalImages, String stage, String error) throws Exception {
            JSONObject event = new JSONObject()
                    .put("timestamp_ms", System.currentTimeMillis())
                    .put("current_image_key", imageKey)
                    .put("current_image_index", imageIndex)
                    .put("total_images", totalImages)
                    .put("current_stage", stage == null ? "" : stage)
                    .put("status", status)
                    .put("memory", memorySnapshot());
            if (error != null && !error.isEmpty()) {
                event.put("error", error);
            }
            return event;
        }

        private JSONObject imageProgress(String imageKey) throws Exception {
            JSONArray arr = imageEvents.get(imageKey);
            return new JSONObject()
                    .put("schema_version", "phase4o_image_stage_progress_v1")
                    .put("image_key", imageKey)
                    .put("events", arr == null ? new JSONArray() : arr);
        }

        private void addImageEvent(String imageKey, JSONObject event) {
            JSONArray arr = imageEvents.get(imageKey);
            if (arr == null) {
                arr = new JSONArray();
                imageEvents.put(imageKey, arr);
            }
            arr.put(event);
        }

        private void writeHeartbeat(JSONObject event) throws Exception {
            writeText(new File(runRoot, "run_heartbeat.json"), new JSONObject()
                    .put("schema_version", "phase4o_run_heartbeat_v1")
                    .put("asset_root", assetRoot)
                    .put("last_event", event)
                    .toString(2));
        }

        private void writeRunProgress() throws Exception {
            writeText(new File(runRoot, "run_progress.json"), new JSONObject()
                    .put("schema_version", "phase4o_run_progress_v1")
                    .put("asset_root", assetRoot)
                    .put("events", events)
                    .toString(2));
        }

        private JSONObject memorySnapshot() throws Exception {
            Runtime runtime = Runtime.getRuntime();
            long max = runtime.maxMemory();
            long total = runtime.totalMemory();
            long free = runtime.freeMemory();
            long used = total - free;
            return new JSONObject()
                    .put("used_mb", used / (1024.0 * 1024.0))
                    .put("max_mb", max / (1024.0 * 1024.0))
                    .put("free_mb", free / (1024.0 * 1024.0));
        }
    }

    static final float GHOST_DETAIL_MARGIN_SCALE = 1.4f;

    /**
     * Detect on the bitmap (grey when asked) surrounded by an edge-replicated
     * margin; detections in the bitmap's normalized space.
     */
    static RfDetrDetector.DetectionResult detectWithMargin(RfDetrDetector detector, Bitmap bitmap, float scale, boolean grey) throws Exception {
        int width = bitmap.getWidth();
        int height = bitmap.getHeight();
        int padX = Math.round((width * scale - width) / 2f);
        int padY = Math.round((height * scale - height) / 2f);
        Mat source = new Mat();
        Mat padded = new Mat();
        Bitmap paddedBitmap = null;
        try {
            Utils.bitmapToMat(bitmap, source);
            if (grey) {
                Mat luma = new Mat();
                Imgproc.cvtColor(source, luma, Imgproc.COLOR_RGBA2GRAY);
                Imgproc.cvtColor(luma, source, Imgproc.COLOR_GRAY2RGBA);
                luma.release();
            }
            Core.copyMakeBorder(source, padded, padY, padY, padX, padX, Core.BORDER_REPLICATE);
            paddedBitmap = Bitmap.createBitmap(padded.cols(), padded.rows(), Bitmap.Config.ARGB_8888);
            Utils.matToBitmap(padded, paddedBitmap);
            RfDetrDetector.DetectionResult result = detector.detect(paddedBitmap);
            float paddedWidth = padded.cols();
            float paddedHeight = padded.rows();
            List<RfDetrDetector.Detection> mapped = new ArrayList<>();
            for (RfDetrDetector.Detection d : result.detections) {
                mapped.add(new RfDetrDetector.Detection(d.label, d.score,
                        marginBack(d.left, width, padX, paddedWidth),
                        marginBack(d.top, height, padY, paddedHeight),
                        marginBack(d.right, width, padX, paddedWidth),
                        marginBack(d.bottom, height, padY, paddedHeight)));
            }
            return new RfDetrDetector.DetectionResult(mapped, result.resizeMs, result.normalizeMs,
                    result.tensorMs, result.ortRunMs, result.parseMs, result.totalMs);
        } finally {
            source.release();
            padded.release();
            if (paddedBitmap != null) {
                paddedBitmap.recycle();
            }
        }
    }

    static float marginBack(float value, int size, int pad, float paddedSize) {
        return Math.max(0f, Math.min(1f, (value * paddedSize - pad) / size));
    }

    private static List<RfDetrDetector.Detection> ghostBoxesOf(List<RfDetrDetector.Detection> detections) {
        List<RfDetrDetector.Detection> out = new ArrayList<>();
        for (RfDetrDetector.Detection detection : detections) {
            if ("ghost_timetrail_box".equals(detection.label)) out.add(detection);
        }
        return out;
    }

    private LapCircleFinder lapCircleFinder;
    private boolean lapCircleFinderLoaded;

    /** The pack's lap-circle templates (assets/shared_icon), loaded once; null when the build has none. */
    private synchronized LapCircleFinder lapCircleFinder() {
        if (!lapCircleFinderLoaded) {
            lapCircleFinderLoaded = true;
            lapCircleFinder = LapCircleFinder.load(context.getAssets());
        }
        return lapCircleFinder;
    }

    private AutoCardRoiSelector.Selection runAutoCardRoi(
            Bitmap bitmap,
            File imageDir,
            RfDetrDetector detector,
            JSONObject detectorStatus,
            String layoutProfile
    ) throws Exception {
        boolean ghostDetailLayout = OfflineParityNativePipeline.LAYOUT_GHOST_DETAIL.equals(layoutProfile);
        if (detector == null) {
            JSONObject blocked = new JSONObject();
            blocked.put("stage", "01_AutoCardROI");
            blocked.put("status", "blocked_missing_detector");
            blocked.put("reason", detectorStatus.optString("reason", "RF-DETR/ORT detector did not initialize."));
            blocked.put("missing_dependency", detectorStatus.optString("missing_dependency", "model_asset_or_ort_runtime_initialization"));
            blocked.put("model_asset_path", detectorStatus.optString("model_asset_path", RfDetrDetector.DEFAULT_MODEL_ASSET));
            blocked.put("no_runtime_label_fallback", true);
            writeText(new File(imageDir, "01_auto_card_roi_status.json"), blocked.toString(2));
            return AutoCardRoiSelector.Selection.blocked(
                    "blocked_missing_detector",
                    blocked.optString("reason"),
                    new AutoCardRoiSelector.DetectionCounts()
            );
        }

        RfDetrDetector.DetectionResult detectionResult;
        try {
            detectionResult = detector.detect(bitmap);
        } catch (Exception exc) {
            JSONObject blocked = new JSONObject();
            blocked.put("stage", "01_AutoCardROI");
            blocked.put("status", "blocked_detector_runtime_error");
            blocked.put("reason", exc.getMessage());
            blocked.put("model_asset_path", RfDetrDetector.DEFAULT_MODEL_ASSET);
            blocked.put("no_runtime_label_fallback", true);
            writeText(new File(imageDir, "01_auto_card_roi_status.json"), blocked.toString(2));
            return AutoCardRoiSelector.Selection.blocked(
                    "blocked_detector_runtime_error",
                    exc.getMessage(),
                    new AutoCardRoiSelector.DetectionCounts()
            );
        }

        // MK8DX ecosystem overlay (ADR-0203): the lap-index checks of the Web scan
        // sessions; the Select-a-Ghost panel keeps its own badge route.
        List<RfDetrDetector.Detection> roiDetections = ghostDetailLayout
                ? detectionResult.detections
                : AutoCardRoiSelector.withoutWeakLapIndexExtras(detectionResult.detections);
        boolean hasPlayerDetection = hasDetectionLabel(roiDetections, "player_timetrail_box");
        // ghost_detail: één rijder, geen gele kaart — de route eist een
        // ghost-box + >=3 lap-badges en projecteert de ROI uit de badge-pitch.
        List<AutoCardRoiSelector.Box> yellowReferences = (!ghostDetailLayout && !hasPlayerDetection)
                ? yellowReferenceBoxes(bitmap)
                : Collections.<AutoCardRoiSelector.Box>emptyList();
        AutoCardRoiSelector.Box yellowReference = yellowReferences.isEmpty() ? null : yellowReferences.get(0);
        AutoCardRoiSelector selector = new AutoCardRoiSelector();
        AutoCardRoiSelector.Selection selection = ghostDetailLayout
                ? selector.selectGhostDetail(roiDetections, bitmap.getWidth(), bitmap.getHeight())
                : selector.select(
                        roiDetections,
                        bitmap.getWidth(),
                        bitmap.getHeight(),
                        yellowReferences
                );
        AutoCardRoiSelector.withDetections(selection, roiDetections, bitmap.getWidth(), bitmap.getHeight());
        AutoCardRoiSelector.DetectionCounts supportCounts = selection.counts;
        // MK8DX ecosystem overlay (ADR-0203): on the Select-a-Ghost panel a
        // straight badge column may stand in for the rarely detected ghost box;
        // the selector only allows that when no player card is seen either.
        boolean ghostBadgeColumnRoute = ghostDetailLayout
                && selection.hasRoi()
                && selection.candidate != null
                && AutoCardRoiSelector.GHOST_DETAIL_BADGE_COLUMN_ONLY.equals(selection.candidate.reason);
        boolean hasOwnerSupport = ghostDetailLayout
                ? supportCounts.ghostCount > 0 || ghostBadgeColumnRoute
                : supportCounts.playerCount > 0 || supportCounts.ghostCount > 0;
        boolean hasLapIndexSupport = supportCounts.lapIndexCount >= 3
                || supportCounts.lapIndexCount == 6
                || supportCounts.lapIndexCount == 14;
        boolean hasYellowPanelSupport = yellowReference != null
                && selection.hasRoi()
                && !selection.fallbackUsed
                && selection.candidate != null
                && selection.candidate.yellowSupportPass;
        boolean hasSupportedOwnerRoute = hasOwnerSupport || hasYellowPanelSupport;
        if (!selection.hasRoi() || !hasSupportedOwnerRoute || !hasLapIndexSupport) {
            selection = AutoCardRoiSelector.Selection.blocked(
                    ghostDetailLayout ? "blocked_missing_ghost_detail_support" : "blocked_missing_supported_owner_lap_index_route",
                    ghostDetailLayout
                            ? "Ghost-detail layout requires a ghost_timetrail_box detection plus at least three lap-index detections."
                            : "Step 01 requires a supported route from RF-DETR owner-box evidence or image-derived yellow-panel support tied to lap-index geometry before running downstream packaged-image OCR.",
                    supportCounts
            );
        }
        // MK8DX ecosystem overlay: a phone photo through the scan guide can show the
        // Select-a-Ghost panel larger than the detector was trained on; its lap badges
        // then score ~0.4 and one goes missing (Vivo, 2026-10-25). Without support the
        // detector looks again at a copy with an edge-replicated margin and the
        // detections are mapped back. A second look uses a grey copy: a bright
        // background shining through the translucent panel (the ghost's character
        // badge behind the lap circles, N64 Royal Raceway) hides the circles in
        // colour but not in grey. Same as the Web scanner's runner.ts.
        JSONObject marginRetry = null;
        if (ghostDetailLayout && !selection.hasRoi()) {
            marginRetry = new JSONObject().put("scale", GHOST_DETAIL_MARGIN_SCALE).put("accepted", false);
            JSONArray looks = new JSONArray();
            List<RfDetrDetector.Detection> ghostBoxes = new ArrayList<>(ghostBoxesOf(roiDetections));
            for (boolean grey : new boolean[]{false, true}) {
                JSONObject look = new JSONObject().put("grey", grey);
                looks.put(look);
                try {
                    RfDetrDetector.DetectionResult retry = detectWithMargin(detector, bitmap, GHOST_DETAIL_MARGIN_SCALE, grey);
                    ghostBoxes.addAll(ghostBoxesOf(retry.detections));
                    AutoCardRoiSelector.Selection retried = selector.selectGhostDetail(retry.detections, bitmap.getWidth(), bitmap.getHeight());
                    AutoCardRoiSelector.withDetections(retried, retry.detections, bitmap.getWidth(), bitmap.getHeight());
                    AutoCardRoiSelector.DetectionCounts retryCounts = retried.counts;
                    boolean retryOwner = retryCounts.ghostCount > 0
                            || (retried.hasRoi() && retried.candidate != null
                            && AutoCardRoiSelector.GHOST_DETAIL_BADGE_COLUMN_ONLY.equals(retried.candidate.reason));
                    boolean retryLaps = retryCounts.lapIndexCount >= 3
                            || retryCounts.lapIndexCount == 6
                            || retryCounts.lapIndexCount == 14;
                    boolean accepted = retried.hasRoi() && retryOwner && retryLaps;
                    look.put("accepted", accepted)
                            .put("lap_index_count", retryCounts.lapIndexCount)
                            .put("ghost_count", retryCounts.ghostCount);
                    if (accepted) {
                        marginRetry.put("accepted", true).put("grey", grey);
                        retried.extraLook = true;
                        selection = retried;
                        roiDetections = retry.detections;
                        detectionResult = retry;
                        hasOwnerSupport = true;
                        hasLapIndexSupport = true;
                        hasSupportedOwnerRoute = true;
                        break;
                    }
                } catch (Exception exc) {
                    look.put("accepted", false).put("error", String.valueOf(exc.getMessage()));
                }
            }
            // Last look: the lap circles 1-2-3 by shape (LapCircleFinder), with the
            // strongest ghost box any look saw. For the large badge behind the circles
            // (3DS Koopa City, 3DS Alpine Pass, GCN DK Mountain on the Vivo).
            LapCircleFinder finder = selection.hasRoi() ? null : lapCircleFinder();
            if (finder != null) {
                JSONObject look = new JSONObject().put("shape", true);
                looks.put(look);
                try {
                    LapCircleFinder.Column column = finder.find(bitmap);
                    look.put("score", column == null ? JSONObject.NULL : column.score);
                    if (column != null) {
                        List<RfDetrDetector.Detection> shaped = new ArrayList<>(
                                LapCircleFinder.asDetections(column, bitmap.getWidth(), bitmap.getHeight()));
                        RfDetrDetector.Detection ghostBox = null;
                        for (RfDetrDetector.Detection box : ghostBoxes) {
                            if (ghostBox == null || box.score > ghostBox.score) ghostBox = box;
                        }
                        if (ghostBox != null) shaped.add(ghostBox);
                        AutoCardRoiSelector.Selection retried = selector.selectGhostDetail(shaped, bitmap.getWidth(), bitmap.getHeight());
                        AutoCardRoiSelector.withDetections(retried, shaped, bitmap.getWidth(), bitmap.getHeight());
                        boolean accepted = retried.hasRoi()
                                && (retried.counts.ghostCount > 0 || (retried.candidate != null
                                && AutoCardRoiSelector.GHOST_DETAIL_BADGE_COLUMN_ONLY.equals(retried.candidate.reason)))
                                && retried.counts.lapIndexCount >= 3;
                        look.put("accepted", accepted).put("ghost_count", retried.counts.ghostCount);
                        if (accepted) {
                            marginRetry.put("accepted", true).put("shape", true);
                            retried.extraLook = true;
                            selection = retried;
                            roiDetections = shaped;
                            detectionResult = new RfDetrDetector.DetectionResult(shaped, 0, 0, 0, 0, 0, 0);
                            hasOwnerSupport = true;
                            hasLapIndexSupport = true;
                            hasSupportedOwnerRoute = true;
                        }
                    }
                } catch (Exception exc) {
                    look.put("accepted", false).put("error", String.valueOf(exc.getMessage()));
                }
            }
            marginRetry.put("looks", looks);
        }
        JSONObject root = new JSONObject();
        root.put("ghost_detail_margin_retry", marginRetry == null ? JSONObject.NULL : marginRetry);
        root.put("stage", "01_AutoCardROI");
        root.put("implementation_mode", "native_android");
        root.put("native_android_implementation", true);
        root.put("detection_source", "android_rfdetr_ort");
        root.put("model_asset_used", RfDetrDetector.DEFAULT_MODEL_ASSET);
        root.put("preprocessing_config", detector.configJson());
        root.put("confidence_threshold", RfDetrDetector.DETECT_THRESHOLD);
        root.put("candidate_count", selection.counts.candidateCount);
        root.put("lap_index_count", selection.counts.lapIndexCount);
        root.put("player_count", selection.counts.playerCount);
        root.put("ghost_count", selection.counts.ghostCount);
        root.put("owner_box_support_present", hasOwnerSupport);
        root.put("yellow_panel_support_present", hasYellowPanelSupport);
        root.put("supported_owner_route_present", hasSupportedOwnerRoute);
        root.put("lap_index_support_present", hasLapIndexSupport);
        root.put("strict_owner_lap_index_gate", true);
        root.put("strict_owner_lap_index_gate_policy", "explicit_owner_lap_index_route_or_yellow_supported_lap_index_route");
        root.put("fallback_used", selection.fallbackUsed);
        root.put("no_runtime_label_fallback", true);
        root.put("yellow_reference_used", yellowReference != null);
        root.put("yellow_reference_box_xyxy", yellowReference == null ? JSONObject.NULL : yellowReference.toJson());
        JSONArray yellowReferenceArray = new JSONArray();
        for (AutoCardRoiSelector.Box box : yellowReferences) {
            yellowReferenceArray.put(box.toJson());
        }
        root.put("yellow_reference_candidates", yellowReferenceArray);
        root.put("detector_timing_ms", detectionResult.timingJson());
        JSONArray detections = new JSONArray();
        for (RfDetrDetector.Detection detection : roiDetections) {
            detections.put(detection.toJson(bitmap.getWidth(), bitmap.getHeight()));
        }
        root.put("detections", detections);

        if (selection.hasRoi()) {
            AutoCardRoiSelector.Box box = selection.roi;
            root.put("status", "implemented");
            root.put("selected_reason", selection.selectedReason);
            root.put("roi_box_xyxy", box.toJson());
            root.put("roi_box", box.toObjectJson());
            root.put("roi_width", box.width());
            root.put("roi_height", box.height());
            if (selection.candidate != null) {
                root.put("selected", selection.candidate.toJson());
                root.put("selected_route", selection.candidate.selectedRoute);
                root.put("score", selection.candidate.score);
                root.put("rfdetr_score", selection.candidate.rfdetrScore);
                root.put("source_box_xyxy", selection.candidate.sourceBox == null ? JSONObject.NULL : selection.candidate.sourceBox.toJson());
                root.put("lap_index_width", selection.candidate.lapIndexWidth);
                root.put("lap_index_height", selection.candidate.lapIndexHeight);
                root.put("row_gap", selection.candidate.rowGap);
                root.put("selected_lap_index_count", selection.candidate.lapIndexCount);
                root.put("player_lap_index_count", selection.candidate.playerLapIndexCount);
                root.put("ghost_lap_index_count", selection.candidate.ghostLapIndexCount);
                root.put("yellow_support_score", selection.candidate.yellowSupportScore);
                root.put("yellow_support_pass", selection.candidate.yellowSupportPass);
                root.put("yellow_support_reason", selection.candidate.yellowSupportReason);
            }
            writeBitmap(new File(imageDir, "01_auto_card_roi_crop.png"), cropBitmap(bitmap, box));
            writeBitmap(new File(imageDir, "01_auto_card_roi_overlay.png"), overlayAutoCardRoi(bitmap, roiDetections, box));
            writeText(new File(imageDir, "01_auto_card_roi.json"), root.toString(2));
        } else {
            root.put("status", selection.status);
            root.put("reason", selection.reason);
            root.put("missing_dependency", "detector_supported_roi");
            root.put("next_required_action", "Confirm RF-DETR owner-box and lap-index support before running downstream packaged-image OCR.");
            writeText(new File(imageDir, "01_auto_card_roi_status.json"), root.toString(2));
            writeText(new File(imageDir, "01_auto_card_roi.json"), root.toString(2));
        }
        return selection;
    }

    private boolean hasDetectionLabel(List<RfDetrDetector.Detection> detections, String label) {
        for (RfDetrDetector.Detection detection : detections) {
            if (label.equals(detection.label)) {
                return true;
            }
        }
        return false;
    }


    private List<AutoCardRoiSelector.Box> yellowReferenceBoxes(Bitmap bitmap) {
        Mat rgba = new Mat();
        Mat bgr = new Mat();
        Mat mask = new Mat();
        Mat labels = new Mat();
        Mat stats = new Mat();
        Mat centroids = new Mat();
        try {
            Utils.bitmapToMat(bitmap, rgba);
            Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
            mask = autoCardYellowMask(bgr);
            int count = Imgproc.connectedComponentsWithStats(mask, labels, stats, centroids);
            int minArea = Math.max(1000, (int) Math.round(bitmap.getWidth() * bitmap.getHeight() * 0.00025));
            List<YellowComponent> components = new ArrayList<>();
            for (int i = 1; i < count; i++) {
                double[] areaVal = stats.get(i, Imgproc.CC_STAT_AREA);
                if (areaVal == null || areaVal.length == 0 || areaVal[0] < minArea) {
                    continue;
                }
                double[] xVal = stats.get(i, Imgproc.CC_STAT_LEFT);
                double[] yVal = stats.get(i, Imgproc.CC_STAT_TOP);
                double[] wVal = stats.get(i, Imgproc.CC_STAT_WIDTH);
                double[] hVal = stats.get(i, Imgproc.CC_STAT_HEIGHT);
                if (xVal == null || yVal == null || wVal == null || hVal == null) {
                    continue;
                }
                double bw = wVal[0];
                double bh = hVal[0];
                double aspect = bw / Math.max(1.0, bh);
                double aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 1.1) / 1.1);
                double score = areaVal[0] / Math.max(1.0, bw * bh) * 4.0 + aspectScore + Math.min(1.0, areaVal[0] / Math.max(1.0, bitmap.getWidth() * bitmap.getHeight()) * 60.0);
                components.add(new YellowComponent(new AutoCardRoiSelector.Box(
                        (float) xVal[0],
                        (float) yVal[0],
                        (float) (xVal[0] + wVal[0]),
                        (float) (yVal[0] + hVal[0])
                ), score));
            }
            Collections.sort(components, new Comparator<YellowComponent>() {
                @Override
                public int compare(YellowComponent a, YellowComponent b) {
                    return Double.compare(b.score, a.score);
                }
            });
            List<AutoCardRoiSelector.Box> boxes = new ArrayList<>();
            for (int i = 0; i < Math.min(8, components.size()); i++) {
                boxes.add(components.get(i).box);
            }
            return boxes;
        } catch (Exception exc) {
            return Collections.emptyList();
        } finally {
            rgba.release();
            bgr.release();
            mask.release();
            labels.release();
            stats.release();
            centroids.release();
        }
    }

    private static class YellowComponent {
        final AutoCardRoiSelector.Box box;
        final double score;

        YellowComponent(AutoCardRoiSelector.Box box, double score) {
            this.box = box;
            this.score = score;
        }
    }

    private EarlyCvResult runEarlyCvStages(
            Bitmap bitmap,
            File imageDir,
            AutoCardRoiSelector.Selection roiSelection,
            RfDetrDetector detector,
            JSONObject relGrid,
            OfflineParityNativePipeline.SegmentTemplate lapTemplate,
            OfflineParityNativePipeline.SegmentTemplate totalTemplate,
            boolean opencvReady,
            String opencvStatus,
            RunOptions options,
            ProgressTracker progress,
            String imageKey,
            int imageIndex,
            int totalImages
    ) throws Exception {
        EarlyCvResult result = new EarlyCvResult();
        if (!roiSelection.hasRoi()) {
            result.status = "blocked_missing_auto_card_roi";
            result.reason = "Step 02-06 require detector-backed AutoCardROI ROI-local input.";
            return result;
        }
        if (!opencvReady) {
            result.status = "blocked_missing_opencv";
            result.reason = "OpenCV is not available in packaged runner: " + opencvStatus;
            writeText(new File(imageDir, "02_06_native_cv_status.json"), result.toJson().toString(2));
            return result;
        }

        Mat rgba = new Mat();
        Mat bgr = new Mat();
        Mat roi = new Mat();
        Mat adjusted = new Mat();
        Mat hsvMask = new Mat();
        Mat gray = new Mat();
        Mat claheOut = new Mat();
        Mat adaptive = new Mat();
        try {
            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, "02_AutoBrightnessContrast");
            Step02Timing step02Timing = new Step02Timing(imageKey);
            long step02Tick = System.currentTimeMillis();
            Utils.bitmapToMat(bitmap, rgba);
            Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
            step02Timing.addDuration("bitmap_mat_conversion_ms", System.currentTimeMillis() - step02Tick);
            step02Tick = System.currentTimeMillis();
            org.opencv.core.Rect roiRect = boxToCvRect(roiSelection.roi, bgr.cols(), bgr.rows());
            roi = new Mat(bgr, roiRect).clone();
            step02Timing.addDuration("roi_extraction_ms", System.currentTimeMillis() - step02Tick);
            step02Tick = System.currentTimeMillis();
            BrightnessChoice choice = selectBrightnessContrast(roi, roiSelection, step02Timing);
            step02Timing.addDuration("candidate_generation_and_scoring_ms", System.currentTimeMillis() - step02Tick);
            double alpha = Math.max(0.05, 1.0 + choice.contrast / 100.0);
            step02Tick = System.currentTimeMillis();
            Core.convertScaleAbs(roi, adjusted, alpha, choice.brightness);
            step02Timing.addDuration("selected_candidate_application_ms", System.currentTimeMillis() - step02Tick);
            step02Tick = System.currentTimeMillis();
            writeMatImage(new File(imageDir, "02_auto_brightness_contrast.png"), adjusted);
            step02Timing.addDuration("png_artifact_writing_ms", System.currentTimeMillis() - step02Tick);
            step02Tick = System.currentTimeMillis();
            writeText(new File(imageDir, "02_auto_brightness_contrast_stats.json"), brightnessStats(roi, adjusted, choice, opencvStatus).toString(2));
            step02Timing.addDuration("stats_json_writing_ms", System.currentTimeMillis() - step02Tick);
            writeText(new File(imageDir, "02_auto_brightness_contrast_timing.json"), step02Timing.toJson(choice).toString(2));
            result.step02 = true;
            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, "02_AutoBrightnessContrast", null);

            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, "03_HSVMask");
            HsvResult hsvResult = hsvMask(adjusted, choice);
            hsvMask = hsvResult.mask;
            writeMatImage(new File(imageDir, "03_hsv_mask.png"), hsvMask);
            writeText(new File(imageDir, "03_hsv_mask_stats.json"), maskStats(hsvMask, hsvResult.meta, "03_hsv_mask.png").toString(2));
            result.step03 = true;
            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, "03_HSVMask", null);

            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, "04_Grayscale");
            Imgproc.cvtColor(adjusted, gray, Imgproc.COLOR_BGR2GRAY);
            writeMatImage(new File(imageDir, "04_grayscale.png"), gray);
            writeText(new File(imageDir, "04_grayscale_stats.json"), matStats(gray, "04_grayscale.png", opencvStatus).toString(2));
            result.step04 = true;
            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, "04_Grayscale", null);

            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, "05_CLAHE");
            CLAHE clahe = Imgproc.createCLAHE(5.9, new org.opencv.core.Size(10, 10));
            clahe.apply(gray, claheOut);
            writeMatImage(new File(imageDir, "05_clahe.png"), claheOut);
            writeText(new File(imageDir, "05_clahe_stats.json"), matStats(claheOut, "05_clahe.png", opencvStatus)
                    .put("clip_limit", 5.9)
                    .put("tile_grid_size", new JSONArray().put(10).put(10))
                    .toString(2));
            result.step05 = true;
            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, "05_CLAHE", null);

            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, "06_AdaptiveThreshold");
            Imgproc.adaptiveThreshold(claheOut, adaptive, 255, Imgproc.ADAPTIVE_THRESH_GAUSSIAN_C, Imgproc.THRESH_BINARY, 29, 6);
            writeMatImage(new File(imageDir, "06_adaptive_threshold.png"), adaptive);
            writeText(new File(imageDir, "06_adaptive_threshold_stats.json"), maskStats(adaptive, new JSONObject()
                    .put("adaptive_method", "ADAPTIVE_THRESH_GAUSSIAN_C")
                    .put("threshold_type", "THRESH_BINARY")
                    .put("block_size", 29)
                    .put("c", 6), "06_adaptive_threshold.png").toString(2));
            result.step06 = true;
            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, "06_AdaptiveThreshold", null);
            if (options.stopAfterStage("06")) {
                result.status = "stopped_after_stage_06";
                result.reason = "Diagnostic stop-after-stage requested.";
                return result;
            }
            OfflineParityNativePipeline.Result downstream = new OfflineParityNativePipeline(
                    relGrid,
                    lapTemplate,
                    totalTemplate,
                    new OfflineParityNativePipeline.StageProgress() {
                        @Override
                        public void stageStarted(String stage) throws Exception {
                            progress.stageStarted(imageKey, imageIndex, totalImages, imageDir, stage);
                        }

                        @Override
                        public void stageCompleted(String stage) throws Exception {
                            progress.stageCompleted(imageKey, imageIndex, totalImages, imageDir, stage, null);
                        }
                    },
                    options.stopAfterStage,
                    options.minimalArtifacts
            ).withKartConfigMatcher(kartConfigMatcherOrNull())
                    .withSharedFieldReader(nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader.get(context))
                    .withIdentityOnly(options.identityOnly)
                    .withLayout(options.layoutProfile)
                    .withRoiDetections(
                            // An extra look's lap circles carry on: the panel's second
                            // detection (step 19, colour, no margin) misses them the same way.
                            options.reuseRoiDetections || roiSelection.extraLook ? roiSelection.detections : null,
                            roiSelection.frameWidth,
                            roiSelection.frameHeight)
                    .run(
                    imageDir,
                    bitmap,
                    roiSelection.roi,
                    roiSelection,
                    detector,
                    bgr,
                    adjusted,
                    hsvMask,
                    adaptive
            );
            result.downstreamStatuses.putAll(downstream.stageStatus);
            result.status = "implemented";
            result.reason = "";
            return result;
        } catch (Exception exc) {
            result.status = "blocked_native_cv_runtime_error";
            result.reason = exc.getMessage();
            writeText(new File(imageDir, "02_06_native_cv_status.json"), result.toJson().toString(2));
            return result;
        } finally {
            rgba.release();
            bgr.release();
            roi.release();
            adjusted.release();
            hsvMask.release();
            gray.release();
            claheOut.release();
            adaptive.release();
        }
    }

    private JSONArray implementationStatus(AutoCardRoiSelector.Selection roiSelection, EarlyCvResult earlyCv) throws Exception {
        JSONArray rows = new JSONArray();
        rows.put(status("00_input", "implemented", "Packaged asset image was decoded by Android BitmapFactory and written to the artifact folder."));
        if (roiSelection.hasRoi()) {
            rows.put(status(
                    "01_AutoCardROI",
                    "implemented",
                    "Detector-backed native Android RF-DETR/ORT AutoCardROI was exported by the packaged-image runner.",
                    "",
                    "Compare ROI against Phase 3I laptop reference after device/emulator execution."
            ));
        } else {
            rows.put(status(
                    "01_AutoCardROI",
                    roiSelection.status,
                    roiSelection.reason,
                    "android_rfdetr_ort_runtime_or_detector_supported_roi",
                    "Run on device/emulator and inspect 01_auto_card_roi_status.json; do not use labels, golden values, or laptop ROI boxes as runtime fallback."
            ));
        }
        rows.put(status("02_AutoBrightnessContrast", earlyCv.step02 ? "implemented" : earlyCv.status, earlyCv.step02 ? "ROI-local brightness/contrast was produced by native Android/OpenCV." : earlyCv.reason, earlyCv.step02 ? "" : "01_AutoCardROI_or_OpenCV", "Compare against laptop reference after device execution."));
        rows.put(status("03_HSVMask", earlyCv.step03 ? "implemented" : earlyCv.status, earlyCv.step03 ? "ROI-local HSV yellow mask was produced by native Android/OpenCV." : earlyCv.reason, earlyCv.step03 ? "" : "02_AutoBrightnessContrast", "Compare mask IoU after device execution."));
        rows.put(status("04_Grayscale", earlyCv.step04 ? "implemented" : earlyCv.status, earlyCv.step04 ? "ROI-local grayscale was produced by native Android/OpenCV." : earlyCv.reason, earlyCv.step04 ? "" : "02_AutoBrightnessContrast", "Compare image stats after device execution."));
        rows.put(status("05_CLAHE", earlyCv.step05 ? "implemented" : earlyCv.status, earlyCv.step05 ? "ROI-local CLAHE was produced by native Android/OpenCV." : earlyCv.reason, earlyCv.step05 ? "" : "04_Grayscale", "Compare image stats after device execution."));
        rows.put(status("06_AdaptiveThreshold", earlyCv.step06 ? "implemented" : earlyCv.status, earlyCv.step06 ? "ROI-local adaptive threshold was produced by native Android/OpenCV." : earlyCv.reason, earlyCv.step06 ? "" : "05_CLAHE", "Compare mask stats after device execution."));
        String[] downstream = {
                "07_FlowJoin", "08_MaskCombine",
                "09_MaskCleanup", "10_Morphology", "11_CannyEdges", "12_HoughLinesP",
                "13_AngleFilterLines", "14_ClusterLines", "15_QuadSelect", "16_RoiRestore",
                "17_PerspectiveWarp", "18_CanonicalPlayerBoxAlign", "19_RFDetr3ClassDetect",
                "20_RFDetrLapIndexRefine", "21_RFDetrDynamicLapGrid", "22_FixedMK8Grid",
                "23_TimeTrialEndscreenGate", "24_SevenSegmentOCRProbe", "25_SevenSegmentOCRInspect",
                "26_OfflineOCRDecode"
        };
        for (String stage : downstream) {
            String downstreamStatus = earlyCv.downstreamStatuses.get(stage);
            if (downstreamStatus != null) {
                rows.put(status(
                        stage,
                        downstreamStatus,
                        "Native packaged-image downstream stage emitted artifact/status JSON. Runtime parity remains pending device execution.",
                        "",
                        "Compare against Phase 3I reference after device execution."
                ));
                continue;
            }
            rows.put(status(
                    stage,
                    "blocked_missing_upstream_dependency",
                    "Downstream stage did not run because Step 01-06 did not complete for this image.",
                    "01_06_native_pipeline",
                    "Inspect earlier stage status and rerun on device/emulator."
            ));
        }
        return rows;
    }

    private JSONArray unavailableStatus(AutoCardRoiSelector.Selection roiSelection, EarlyCvResult earlyCv) throws Exception {
        JSONArray rows = new JSONArray();
        if (earlyCv.step06) {
            rows.put(status("native_cv_pipeline", "implemented_through_step06", "Packaged runner produced native ROI-local artifacts through Step 06 when detector ROI and OpenCV were available.", "", "Run on device/emulator and compare against Phase 3I laptop reference."));
        } else if (roiSelection.hasRoi()) {
            rows.put(status("native_cv_pipeline", earlyCv.status, earlyCv.reason, "OpenCV_or_native_cv_runtime", "Inspect 02_06_native_cv_status.json if present."));
        } else {
            rows.put(status("native_cv_pipeline", "blocked_missing_auto_card_roi", "Phase 4C writes truthful early-stage blockers; Step 01 did not produce a detector-backed ROI for this image.", "01_AutoCardROI", "Inspect detector status and ROI selection output."));
        }
        rows.put(status("camera", "skipped", "Camera input is out of scope for the packaged-image parity path.", "phase_scope", "Use packaged assets only."));
        rows.put(status("golden_runtime_fallback", "skipped", "Expected/golden values are validation-only and are not read by this runner.", "policy", "Keep validation strictly post-prediction."));
        return rows;
    }

    private JSONObject status(String stage, String status, String reason) throws Exception {
        return status(stage, status, reason, "", "");
    }

    private JSONObject status(String stage, String status, String reason, String missingDependency, String nextRequiredAction) throws Exception {
        JSONObject row = new JSONObject();
        row.put("stage_name", stage);
        row.put("status", status);
        row.put("reason", reason);
        row.put("missing_dependency", missingDependency);
        row.put("next_required_action", nextRequiredAction);
        return row;
    }

    private JSONObject readAssetJson(AssetManager assets, String path) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (InputStream in = assets.open(path);
             BufferedReader reader = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return new JSONObject(builder.toString());
    }

    private OfflineParityNativePipeline.SegmentTemplate readSegmentTemplate(AssetManager assets, String path) throws Exception {
        Bitmap bitmap;
        try (InputStream in = assets.open(path)) {
            bitmap = BitmapFactory.decodeStream(in);
        }
        if (bitmap == null) {
            throw new IllegalStateException("Unable to decode segment template asset: " + path);
        }
        Map<String, List<OfflineParityNativePipeline.PointI>> masks = new LinkedHashMap<>();
        for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
            masks.put(key, new ArrayList<OfflineParityNativePipeline.PointI>());
        }
        for (int y = 0; y < bitmap.getHeight(); y++) {
            for (int x = 0; x < bitmap.getWidth(); x++) {
                int color = bitmap.getPixel(x, y);
                String segment = segmentKeyForColor(Color.red(color), Color.green(color), Color.blue(color));
                if (segment != null) {
                    masks.get(segment).add(new OfflineParityNativePipeline.PointI(x, y));
                }
            }
        }
        OfflineParityNativePipeline.SegmentTemplate template =
                new OfflineParityNativePipeline.SegmentTemplate(bitmap.getWidth(), bitmap.getHeight(), masks);
        bitmap.recycle();
        return template;
    }

    private String segmentKeyForColor(int r, int g, int b) {
        if (near(r, g, b, 255, 0, 0)) return "a";
        if (near(r, g, b, 0, 255, 0)) return "b";
        if (near(r, g, b, 0, 0, 255)) return "c";
        if (near(r, g, b, 255, 255, 0)) return "d";
        if (near(r, g, b, 255, 0, 255)) return "e";
        if (near(r, g, b, 0, 255, 255)) return "f";
        if (near(r, g, b, 255, 128, 0)) return "g";
        return null;
    }

    private boolean near(int r, int g, int b, int targetR, int targetG, int targetB) {
        return Math.abs(r - targetR) <= 1
                && Math.abs(g - targetG) <= 1
                && Math.abs(b - targetB) <= 1;
    }

    private void writeText(File file, String text) throws Exception {
        File parent = file.getParentFile();
        if (parent != null) {
            parent.mkdirs();
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
    }

    private String readText(File file) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(new java.io.FileInputStream(file), StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                builder.append(line).append('\n');
            }
        }
        return builder.toString();
    }

    private void writeBitmap(File file, Bitmap bitmap) throws Exception {
        try {
            if (suppressVisualArtifacts && isImageArtifact(file)) {
                return;
            }
            File parent = file.getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            Mat rgba = new Mat();
            Mat bgr = new Mat();
            try {
                Utils.bitmapToMat(bitmap, rgba);
                Imgproc.cvtColor(rgba, bgr, Imgproc.COLOR_RGBA2BGR);
                if (!Imgcodecs.imwrite(file.getAbsolutePath(), bgr)) {
                    throw new IllegalStateException("OpenCV Imgcodecs.imwrite returned false for " + file.getAbsolutePath());
                }
            } catch (Exception exc) {
                try (FileOutputStream out = new FileOutputStream(file)) {
                    bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
                }
            } finally {
                rgba.release();
                bgr.release();
            }
        } finally {
            bitmap.recycle();
        }
    }

    private void writeSourceBitmap(File file, Bitmap bitmap) throws Exception {
        if (suppressVisualArtifacts && isImageArtifact(file)) {
            return;
        }
        File parent = file.getParentFile();
        if (parent != null) {
            parent.mkdirs();
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out);
        }
    }

    private Bitmap cropBitmap(Bitmap bitmap, AutoCardRoiSelector.Box box) {
        int x = clampInt(Math.round(box.left), 0, Math.max(0, bitmap.getWidth() - 1));
        int y = clampInt(Math.round(box.top), 0, Math.max(0, bitmap.getHeight() - 1));
        int right = clampInt(Math.round(box.right), x + 1, bitmap.getWidth());
        int bottom = clampInt(Math.round(box.bottom), y + 1, bitmap.getHeight());
        return Bitmap.createBitmap(bitmap, x, y, Math.max(1, right - x), Math.max(1, bottom - y));
    }

    private Bitmap overlayAutoCardRoi(Bitmap bitmap, java.util.List<RfDetrDetector.Detection> detections, AutoCardRoiSelector.Box roi) {
        Bitmap out = bitmap.copy(Bitmap.Config.ARGB_8888, true);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint();
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3.0f);
        for (RfDetrDetector.Detection detection : detections) {
            if ("player_timetrail_box".equals(detection.label)) {
                paint.setColor(Color.YELLOW);
            } else if ("ghost_timetrail_box".equals(detection.label)) {
                paint.setColor(Color.CYAN);
            } else if ("lap_index".equals(detection.label)) {
                paint.setColor(Color.GREEN);
            } else {
                paint.setColor(Color.GRAY);
            }
            canvas.drawRect(
                    detection.left * bitmap.getWidth(),
                    detection.top * bitmap.getHeight(),
                    detection.right * bitmap.getWidth(),
                    detection.bottom * bitmap.getHeight(),
                    paint
            );
        }
        paint.setColor(Color.MAGENTA);
        paint.setStrokeWidth(5.0f);
        canvas.drawRect(new Rect(
                Math.round(roi.left),
                Math.round(roi.top),
                Math.round(roi.right),
                Math.round(roi.bottom)
        ), paint);
        return out;
    }

    private int clampInt(int value, int lo, int hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    private org.opencv.core.Rect boxToCvRect(AutoCardRoiSelector.Box box, int width, int height) {
        int x = clampInt(Math.round(box.left), 0, Math.max(0, width - 1));
        int y = clampInt(Math.round(box.top), 0, Math.max(0, height - 1));
        int right = clampInt(Math.round(box.right), x + 1, width);
        int bottom = clampInt(Math.round(box.bottom), y + 1, height);
        return new org.opencv.core.Rect(x, y, Math.max(1, right - x), Math.max(1, bottom - y));
    }

    private void writeMatImage(File file, Mat mat) throws Exception {
        if (suppressVisualArtifacts && isImageArtifact(file)) {
            return;
        }
        Mat writable = new Mat();
        try {
            File parent = file.getParentFile();
            if (parent != null) {
                parent.mkdirs();
            }
            if (mat.channels() == 1) {
                writable = mat.clone();
            } else if (mat.channels() == 3) {
                writable = mat.clone();
            } else if (mat.channels() == 4) {
                Imgproc.cvtColor(mat, writable, Imgproc.COLOR_RGBA2BGR);
            } else {
                writable = mat.clone();
            }
            if (!Imgcodecs.imwrite(file.getAbsolutePath(), writable)) {
                throw new IllegalStateException("OpenCV Imgcodecs.imwrite returned false for " + file.getAbsolutePath());
            }
        } finally {
            writable.release();
        }
    }

    private boolean isImageArtifact(File file) {
        String name = file.getName().toLowerCase(Locale.US);
        return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
    }

    private BrightnessChoice selectBrightnessContrast(Mat bgr, AutoCardRoiSelector.Selection roiSelection, Step02Timing timing) throws Exception {
        long tick = System.currentTimeMillis();
        MeasurementRoi measurement = measurementRoi(bgr, roiSelection);
        timing.addDuration("measurement_roi_selection_ms", System.currentTimeMillis() - tick);
        tick = System.currentTimeMillis();
        Mat scoringInput = prepareStep02ScoringInput(bgr, measurement, timing);
        timing.addDuration("measurement_roi_sampling_ms", System.currentTimeMillis() - tick);
        MeasurementRoi scoringMeasurement = MeasurementRoi.full(scoringInput.cols(), scoringInput.rows(), "scoring_measurement_sample");
        int[] brightnessValues = {-90, -78, -70, -60, -54, -48, -40, -32, -20, 0, 10};
        int[] contrastValues = {15, 22, 30, 35, 44, 50, 58, 65};
        final double maxAdaptivePredictedYellowError = 0.10;
        try {
            tick = System.currentTimeMillis();
            YellowEstimate estimate = estimateYellowTarget(scoringInput, scoringMeasurement, contrastValues);
            timing.addDuration("color_statistics_calculation_ms", System.currentTimeMillis() - tick);
            if (estimate != null) {
                boolean adaptiveEstimatePlausible = estimate.predictedYellowError <= maxAdaptivePredictedYellowError;
                BrightnessChoice direct = scoreBrightnessCandidate(scoringInput, estimate.brightness, estimate.contrast, scoringMeasurement, measurement, true, timing);
                direct.reason = "adaptive_direct";
                direct.candidateCount = 1;
                direct.estimatedBrightness = estimate.brightness;
                direct.estimatedContrast = estimate.contrast;
                direct.estimatedAlpha = estimate.alpha;
                direct.estimatedBeta = estimate.beta;
                direct.predictedYellowError = estimate.predictedYellowError;
                direct.rawMedianBgr = estimate.rawMedianBgr;
                direct.rawMedianLuma = estimate.rawMedianLuma;
                direct.rawYellowCoverage = estimate.rawYellowCoverage;
                direct.maxAdaptivePredictedYellowError = maxAdaptivePredictedYellowError;
                direct.adaptiveGuardApplied = !adaptiveEstimatePlausible;
                direct.measurementMeta = measurement.toJson("measurement_crop");
                direct.candidates = new JSONArray().put(direct.toJson(false));
                if (adaptiveEstimatePlausible && direct.yellowError != null && direct.yellowError <= 0.04 && direct.maskCoverage >= 0.02) {
                    return direct;
                }

                List<BrightnessChoice> micro = new ArrayList<>();
                tick = System.currentTimeMillis();
                for (int db = -12; db <= 12; db += 4) {
                    for (int dc = -8; dc <= 8; dc += 4) {
                        int brightness = Math.max(-255, Math.min(255, estimate.brightness + db));
                        int contrast = Math.max(-95, Math.min(255, estimate.contrast + dc));
                        micro.add(scoreBrightnessCandidate(scoringInput, brightness, contrast, scoringMeasurement, measurement, true, timing));
                    }
                }
                timing.addDuration("adaptive_micro_sweep_ms", System.currentTimeMillis() - tick);
                Collections.sort(micro, new Comparator<BrightnessChoice>() {
                    @Override
                    public int compare(BrightnessChoice a, BrightnessChoice b) {
                        return Double.compare(b.score, a.score);
                    }
                });
                if (!micro.isEmpty()) {
                    BrightnessChoice bestMicro = micro.get(0);
                    if (adaptiveEstimatePlausible && bestMicro.yellowError != null && bestMicro.yellowError <= 0.04 && bestMicro.maskCoverage >= 0.02) {
                        bestMicro.reason = "adaptive_micro_sweep";
                        bestMicro.candidateCount = micro.size();
                        bestMicro.estimatedBrightness = estimate.brightness;
                        bestMicro.estimatedContrast = estimate.contrast;
                        bestMicro.estimatedAlpha = estimate.alpha;
                        bestMicro.estimatedBeta = estimate.beta;
                        bestMicro.predictedYellowError = estimate.predictedYellowError;
                        bestMicro.rawMedianBgr = estimate.rawMedianBgr;
                        bestMicro.rawMedianLuma = estimate.rawMedianLuma;
                        bestMicro.rawYellowCoverage = estimate.rawYellowCoverage;
                        bestMicro.maxAdaptivePredictedYellowError = maxAdaptivePredictedYellowError;
                        bestMicro.adaptiveGuardApplied = false;
                        bestMicro.measurementMeta = measurement.toJson("measurement_crop");
                        bestMicro.candidates = topCandidates(micro);
                        return bestMicro;
                    }
                }
            }
            BrightnessChoice best = null;
            List<BrightnessChoice> scored = new ArrayList<>();
            tick = System.currentTimeMillis();
            for (int brightness : brightnessValues) {
                for (int contrast : contrastValues) {
                    BrightnessChoice candidate = scoreBrightnessCandidate(scoringInput, brightness, contrast, scoringMeasurement, measurement, true, timing);
                    scored.add(candidate);
                    if (best == null || candidate.score > best.score) {
                        best = candidate;
                    }
                }
            }
            timing.addDuration("full_sweep_scoring_ms", System.currentTimeMillis() - tick);
            if (best == null) {
                best = scoreBrightnessCandidate(scoringInput, -83, 50, scoringMeasurement, measurement, true, timing);
                best.reason = "fallback_no_candidates";
            } else {
                best.reason = "full_sweep_fallback";
            }
            best.candidateCount = scored.size();
            best.candidates = topCandidates(scored);
            if (estimate != null) {
                best.estimatedBrightness = estimate.brightness;
                best.estimatedContrast = estimate.contrast;
                best.predictedYellowError = estimate.predictedYellowError;
                best.maxAdaptivePredictedYellowError = maxAdaptivePredictedYellowError;
                best.adaptiveGuardApplied = estimate.predictedYellowError > maxAdaptivePredictedYellowError;
            }
            best.measurementMeta = measurement.toJson("measurement_crop");
            return best;
        } finally {
            scoringInput.release();
        }
    }

    private Mat prepareStep02ScoringInput(Mat bgr, MeasurementRoi measurement, Step02Timing timing) {
        Mat measured = measurement.crop(bgr);
        // Sweep-downscale (server score_downscale_max_dim=220): GEMETEN 2026-07-16
        // verschuift de keuze net genoeg voor een digit-misser op het inkling-GT-frame
        // => alleen voor identity-only stemframes (icoon-match is gain-genormaliseerd);
        // leesframes scoren op volle resolutie.
        int maxDim = Math.max(measured.cols(), measured.rows());
        if (step02ScoreDownscale && maxDim > 220) {
            double scale = 220.0 / maxDim;
            Mat scaled = new Mat();
            Imgproc.resize(measured, scaled, new org.opencv.core.Size(
                    Math.max(1, (int) Math.round(measured.cols() * scale)),
                    Math.max(1, (int) Math.round(measured.rows() * scale))), 0, 0, Imgproc.INTER_AREA);
            measured.release();
            timing.scoringSampleScale = scale;
            timing.scoringSampleShape = new int[]{scaled.rows(), scaled.cols()};
            return scaled;
        }
        timing.scoringSampleScale = 1.0;
        timing.scoringSampleShape = new int[]{measured.rows(), measured.cols()};
        return measured;
    }

    private JSONArray topCandidates(List<BrightnessChoice> choices) throws Exception {
        Collections.sort(choices, new Comparator<BrightnessChoice>() {
            @Override
            public int compare(BrightnessChoice a, BrightnessChoice b) {
                return Double.compare(b.score, a.score);
            }
        });
        JSONArray arr = new JSONArray();
        for (int i = 0; i < Math.min(5, choices.size()); i++) {
            arr.put(choices.get(i).toJson(false));
        }
        return arr;
    }

    private BrightnessChoice scoreBrightnessCandidate(Mat bgr, int brightness, int contrast, MeasurementRoi measurement, MeasurementRoi reportedMeasurement, boolean yellowTargetMode, Step02Timing timing) throws Exception {
        timing.incrementCandidate();
        Mat measuredInput = new Mat();
        Mat adjusted = new Mat();
        Mat gray = new Mat();
        Mat edges = new Mat();
        Mat yellow = new Mat();
        try {
            double alpha = Math.max(0.05, 1.0 + contrast / 100.0);
            long tick = System.currentTimeMillis();
            measuredInput = measurement.crop(bgr);
            Core.convertScaleAbs(measuredInput, adjusted, alpha, brightness);
            timing.addDuration("per_candidate_transform_ms", System.currentTimeMillis() - tick);
            tick = System.currentTimeMillis();
            Imgproc.cvtColor(adjusted, gray, Imgproc.COLOR_BGR2GRAY);
            Imgproc.Canny(gray, edges, 60, 140);
            timing.addDuration("edge_density_per_candidate_ms", System.currentTimeMillis() - tick);
            tick = System.currentTimeMillis();
            yellow = autoCardYellowMask(adjusted);
            timing.addDuration("full_roi_hsv_conversion_per_candidate_ms", System.currentTimeMillis() - tick);
            double edgeDensity = Core.countNonZero(edges) / Math.max(1.0, edges.rows() * edges.cols());
            double maskCoverage = Core.countNonZero(yellow) / Math.max(1.0, yellow.rows() * yellow.cols());
            double meanLuma = Core.mean(gray).val[0] / 255.0;
            double edgeScore = Math.min(edgeDensity, 0.14) * 9.0;
            double coverageScore = Math.min(maskCoverage, 0.40) * 4.0;
            double lumaPenalty = Math.abs(meanLuma - 0.36) * 0.8;
            double score = edgeScore + coverageScore - lumaPenalty;
            BrightnessChoice choice = new BrightnessChoice(brightness, contrast, score, edgeDensity, maskCoverage, meanLuma);
            choice.measurementMeta = reportedMeasurement.toJson("measurement_crop");
            if (yellowTargetMode) {
                tick = System.currentTimeMillis();
                MaskedColorStats stats = maskedColorStats(adjusted, yellow);
                timing.addDuration("lab_conversion_per_candidate_ms", System.currentTimeMillis() - tick);
                if (stats != null) {
                    double yellowError = yellowError(stats.medianHsv, stats.medianLab);
                    double coveragePenalty = Math.max(0.0, 0.02 - maskCoverage) * 30.0;
                    score = -yellowError * 6.0 + edgeScore * 0.45 + Math.min(maskCoverage, 0.20) * 8.0 - lumaPenalty - coveragePenalty;
                    choice.score = score;
                    choice.yellowError = yellowError;
                    choice.coveragePenalty = coveragePenalty;
                    choice.medianH = stats.medianHsv[0];
                    choice.medianS = stats.medianHsv[1];
                    choice.medianV = stats.medianHsv[2];
                    choice.medianLabB = stats.medianLab[2];
                } else {
                    choice.score = -999.0 + edgeScore * 0.1;
                    choice.coveragePenalty = 0.6;
                }
            }
            return choice;
        } finally {
            measuredInput.release();
            adjusted.release();
            gray.release();
            edges.release();
            yellow.release();
        }
    }

    private MeasurementRoi measurementRoi(Mat roi, AutoCardRoiSelector.Selection selection) throws Exception {
        if (selection == null || selection.roi == null || selection.candidate == null || selection.candidate.sourceBox == null) {
            return MeasurementRoi.full(roi.cols(), roi.rows(), "missing_lap_index_metadata");
        }
        AutoCardRoiSelector.Candidate candidate = selection.candidate;
        AutoCardRoiSelector.Box source = candidate.sourceBox;
        double lapW = candidate.lapIndexWidth > 0.0 ? candidate.lapIndexWidth : Math.max(1.0, source.width() / 1.3);
        double lapH = candidate.lapIndexHeight > 0.0 ? candidate.lapIndexHeight : Math.max(1.0, source.height() / 7.0);
        double fullLeft = source.left - lapW * 12.0;
        double fullTop = source.top - lapH * 1.4;
        double fullRight = source.right + lapW * 4.7;
        double fullBottom = source.bottom + lapH * 0.15;
        int x1 = clampInt((int) Math.round(fullLeft - selection.roi.left), 0, Math.max(0, roi.cols() - 2));
        int y1 = clampInt((int) Math.round(fullTop - selection.roi.top), 0, Math.max(0, roi.rows() - 2));
        int x2 = clampInt((int) Math.round(fullRight - selection.roi.left), x1 + 1, roi.cols());
        int y2 = clampInt((int) Math.round(fullBottom - selection.roi.top), y1 + 1, roi.rows());
        if (x2 <= x1 + 2 || y2 <= y1 + 2) {
            return MeasurementRoi.full(roi.cols(), roi.rows(), "invalid_lap_index_projected_small_box");
        }
        MeasurementRoi out = new MeasurementRoi(x1, y1, x2, y2, true, "lap_index_projected_small");
        out.fullFrameBox = new int[]{(int) Math.round(fullLeft), (int) Math.round(fullTop), (int) Math.round(fullRight), (int) Math.round(fullBottom)};
        out.sourceBox = new int[]{Math.round(source.left), Math.round(source.top), Math.round(source.right), Math.round(source.bottom)};
        out.lapIndexWidth = lapW;
        out.lapIndexHeight = lapH;
        return out;
    }

    private YellowEstimate estimateYellowTarget(Mat bgr, MeasurementRoi measurement, int[] contrastValues) throws Exception {
        Mat measured = new Mat();
        Mat mask = new Mat();
        Mat gray = new Mat();
        try {
            measured = measurement.crop(bgr);
            mask = autoCardYellowMask(measured);
            int maskCount = Core.countNonZero(mask);
            if (maskCount <= 0) {
                return null;
            }
            double[] yellowBgr = maskedMedianBgr(measured, mask);
            Imgproc.cvtColor(measured, gray, Imgproc.COLOR_BGR2GRAY);
            double yellowLuma = maskedMedianChannel(gray, mask);
            double[] targetBgr = new double[]{0x3a, 0xae, 0xd1};
            YellowEstimate best = null;
            for (int contrast : contrastValues) {
                double alpha = Math.max(0.05, Math.min(3.55, 1.0 + contrast / 100.0));
                double[] betaParts = new double[]{
                        targetBgr[0] - alpha * yellowBgr[0],
                        targetBgr[1] - alpha * yellowBgr[1],
                        targetBgr[2] - alpha * yellowBgr[2]
                };
                int brightness = (int) Math.round(Math.max(-255.0, Math.min(255.0, median(betaParts))));
                double[] predicted = new double[]{
                        clampDouble(yellowBgr[0] * alpha + brightness, 0.0, 255.0),
                        clampDouble(yellowBgr[1] * alpha + brightness, 0.0, 255.0),
                        clampDouble(yellowBgr[2] * alpha + brightness, 0.0, 255.0)
                };
                double predictedError = predictedYellowError(predicted);
                YellowEstimate estimate = new YellowEstimate();
                estimate.brightness = brightness;
                estimate.contrast = contrast;
                estimate.alpha = alpha;
                estimate.beta = median(betaParts);
                estimate.predictedYellowError = predictedError;
                estimate.rawMedianBgr = yellowBgr;
                estimate.rawMedianLuma = yellowLuma / 255.0;
                estimate.rawYellowCoverage = maskCount / Math.max(1.0, mask.rows() * mask.cols());
                if (best == null || estimate.predictedYellowError < best.predictedYellowError) {
                    best = estimate;
                }
            }
            return best;
        } finally {
            measured.release();
            mask.release();
            gray.release();
        }
    }

    private double[] maskedMedianBgr(Mat bgr, Mat mask) {
        int pixels = bgr.rows() * bgr.cols();
        byte[] bgrBytes = new byte[pixels * 3];
        byte[] maskBytes = new byte[pixels];
        bgr.get(0, 0, bgrBytes);
        mask.get(0, 0, maskBytes);
        int[] bHist = new int[256];
        int[] gHist = new int[256];
        int[] rHist = new int[256];
        int count = 0;
        for (int i = 0; i < pixels; i++) {
            if ((maskBytes[i] & 0xff) > 0) {
                int base = i * 3;
                bHist[bgrBytes[base] & 0xff]++;
                gHist[bgrBytes[base + 1] & 0xff]++;
                rHist[bgrBytes[base + 2] & 0xff]++;
                count++;
            }
        }
        return new double[]{medianFromHistogram(bHist, count), medianFromHistogram(gHist, count), medianFromHistogram(rHist, count)};
    }

    private double maskedMedianChannel(Mat mat, Mat mask) {
        int pixels = mat.rows() * mat.cols();
        byte[] values = new byte[pixels];
        byte[] maskBytes = new byte[pixels];
        mat.get(0, 0, values);
        mask.get(0, 0, maskBytes);
        int[] hist = new int[256];
        int count = 0;
        for (int i = 0; i < pixels; i++) {
            if ((maskBytes[i] & 0xff) > 0) {
                hist[values[i] & 0xff]++;
                count++;
            }
        }
        return medianFromHistogram(hist, count);
    }

    private MaskedColorStats maskedColorStats(Mat bgr, Mat mask) {
        Mat hsv = new Mat();
        Mat lab = new Mat();
        try {
            Imgproc.cvtColor(bgr, hsv, Imgproc.COLOR_BGR2HSV);
            Imgproc.cvtColor(bgr, lab, Imgproc.COLOR_BGR2Lab);
            int pixels = bgr.rows() * bgr.cols();
            byte[] hsvBytes = new byte[pixels * 3];
            byte[] labBytes = new byte[pixels * 3];
            byte[] maskBytes = new byte[pixels];
            hsv.get(0, 0, hsvBytes);
            lab.get(0, 0, labBytes);
            mask.get(0, 0, maskBytes);
            int[] hHist = new int[256];
            int[] sHist = new int[256];
            int[] vHist = new int[256];
            int[] labBHist = new int[256];
            int count = 0;
            for (int i = 0; i < pixels; i++) {
                if ((maskBytes[i] & 0xff) > 0) {
                    int base = i * 3;
                    hHist[hsvBytes[base] & 0xff]++;
                    sHist[hsvBytes[base + 1] & 0xff]++;
                    vHist[hsvBytes[base + 2] & 0xff]++;
                    labBHist[labBytes[base + 2] & 0xff]++;
                    count++;
                }
            }
            if (count <= 0) {
                return null;
            }
            MaskedColorStats out = new MaskedColorStats();
            out.medianHsv = new double[]{
                    medianFromHistogram(hHist, count),
                    medianFromHistogram(sHist, count),
                    medianFromHistogram(vHist, count)
            };
            out.medianLab = new double[]{0.0, 0.0, medianFromHistogram(labBHist, count)};
            return out;
        } finally {
            hsv.release();
            lab.release();
        }
    }

    private double medianFromHistogram(int[] hist, int count) {
        if (count <= 0) {
            return 0.0;
        }
        if ((count & 1) == 1) {
            return histogramValueAt(hist, count / 2 + 1);
        }
        int lo = histogramValueAt(hist, count / 2);
        int hi = histogramValueAt(hist, count / 2 + 1);
        return (lo + hi) * 0.5;
    }

    private int histogramValueAt(int[] hist, int targetOneBased) {
        int seen = 0;
        for (int i = 0; i < hist.length; i++) {
            seen += hist[i];
            if (seen >= targetOneBased) {
                return i;
            }
        }
        return hist.length - 1;
    }

    private double yellowError(double[] medianHsv, double[] medianLab) {
        int[] targetHsv = hexToHsv("#d1ae3a");
        int[] targetLab = hexToLab("#d1ae3a");
        double hueDelta = Math.abs(medianHsv[0] - targetHsv[0]);
        hueDelta = Math.min(hueDelta, 180.0 - hueDelta) / 90.0;
        double saturationDelta = Math.abs(medianHsv[1] - targetHsv[1]) / 255.0;
        double valueDelta = Math.abs(medianHsv[2] - targetHsv[2]) / 255.0;
        double labBDelta = Math.abs(medianLab[2] - targetLab[2]) / 255.0;
        return hueDelta * 2.0 + saturationDelta * 0.8 + valueDelta * 0.35 + labBDelta * 0.8;
    }

    private double predictedYellowError(double[] bgr) {
        Mat color = new Mat(1, 1, CvType.CV_8UC3);
        Mat hsv = new Mat();
        Mat lab = new Mat();
        try {
            color.put(0, 0, new byte[]{(byte) Math.round(bgr[0]), (byte) Math.round(bgr[1]), (byte) Math.round(bgr[2])});
            Imgproc.cvtColor(color, hsv, Imgproc.COLOR_BGR2HSV);
            Imgproc.cvtColor(color, lab, Imgproc.COLOR_BGR2Lab);
            byte[] hsvBytes = new byte[3];
            byte[] labBytes = new byte[3];
            hsv.get(0, 0, hsvBytes);
            lab.get(0, 0, labBytes);
            return yellowError(
                    new double[]{hsvBytes[0] & 0xff, hsvBytes[1] & 0xff, hsvBytes[2] & 0xff},
                    new double[]{labBytes[0] & 0xff, labBytes[1] & 0xff, labBytes[2] & 0xff}
            );
        } finally {
            color.release();
            hsv.release();
            lab.release();
        }
    }

    private int[] hexToLab(String hex) {
        int r = Integer.parseInt(hex.substring(1, 3), 16);
        int g = Integer.parseInt(hex.substring(3, 5), 16);
        int b = Integer.parseInt(hex.substring(5, 7), 16);
        Mat color = new Mat(1, 1, CvType.CV_8UC3);
        Mat lab = new Mat();
        try {
            color.put(0, 0, new byte[]{(byte) b, (byte) g, (byte) r});
            Imgproc.cvtColor(color, lab, Imgproc.COLOR_BGR2Lab);
            byte[] out = new byte[3];
            lab.get(0, 0, out);
            return new int[]{out[0] & 0xff, out[1] & 0xff, out[2] & 0xff};
        } finally {
            color.release();
            lab.release();
        }
    }

    private double median(double[] values) {
        ArrayList<Double> list = new ArrayList<>();
        for (double value : values) {
            list.add(value);
        }
        return medianDoubles(list);
    }

    private double medianDoubles(ArrayList<Double> values) {
        if (values.isEmpty()) {
            return 0.0;
        }
        Collections.sort(values);
        int mid = values.size() / 2;
        if (values.size() % 2 == 1) {
            return values.get(mid);
        }
        return (values.get(mid - 1) + values.get(mid)) * 0.5;
    }

    private double clampDouble(double value, double lo, double hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    private Mat autoCardYellowMask(Mat bgr) {
        Mat hsv = new Mat();
        Mat lab = new Mat();
        Mat hsvMask = new Mat();
        Mat labMask = new Mat();
        Mat mask = new Mat();
        try {
            Imgproc.cvtColor(bgr, hsv, Imgproc.COLOR_BGR2HSV);
            Imgproc.cvtColor(bgr, lab, Imgproc.COLOR_BGR2Lab);
            Core.inRange(hsv, new Scalar(12, 35, 80), new Scalar(42, 255, 255), hsvMask);
            Core.inRange(lab, new Scalar(65, 0, 135), new Scalar(255, 255, 255), labMask);
            Core.bitwise_and(hsvMask, labMask, mask);
            Mat closeKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new org.opencv.core.Size(11, 11));
            Mat openKernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new org.opencv.core.Size(5, 5));
            Imgproc.morphologyEx(mask, mask, Imgproc.MORPH_CLOSE, closeKernel);
            Imgproc.morphologyEx(mask, mask, Imgproc.MORPH_OPEN, openKernel);
            closeKernel.release();
            openKernel.release();
            return mask.clone();
        } finally {
            hsv.release();
            lab.release();
            hsvMask.release();
            labMask.release();
            mask.release();
        }
    }

    private HsvResult hsvMask(Mat adjusted, BrightnessChoice choice) throws Exception {
        String configuredMode = "Two HEX range";
        String colorA = "#ffd747";
        String colorB = "#fff4d8";
        boolean followAutoApplied = false;
        String followAutoReason = "upstream_not_full_sweep_fallback";
        String upstreamReason = choice != null ? choice.reason : "";
        if ("full_sweep_fallback".equals(upstreamReason)) {
            configuredMode = "Color picker";
            colorA = "#d1ae3a";
            colorB = "";
            followAutoApplied = true;
            followAutoReason = "full_sweep_fallback";
        }

        int hTol = 18;
        int sTol = 90;
        int vTol = 110;
        int[] center;
        int hMin;
        int hMax;
        int sMin;
        int sMax;
        int vMin;
        int vMax;
        if ("Color picker".equals(configuredMode)) {
            int[] target = hexToHsv(colorA);
            hMin = (target[0] - hTol + 180) % 180;
            hMax = (target[0] + hTol) % 180;
            sMin = Math.max(0, target[1] - sTol);
            sMax = Math.min(255, target[1] + sTol);
            vMin = Math.max(0, target[2] - vTol);
            vMax = Math.min(255, target[2] + vTol);
            center = target;
        } else {
            int[] hsvA = hexToHsv(colorA);
            int[] hsvB = hexToHsv(colorB);
            int[] hueBounds = twoHueBounds(hsvA[0], hsvB[0], hTol);
            hMin = hueBounds[0];
            hMax = hueBounds[1];
            sMin = Math.max(0, Math.min(hsvA[1], hsvB[1]) - sTol);
            sMax = Math.min(255, Math.max(hsvA[1], hsvB[1]) + sTol);
            vMin = Math.max(0, Math.min(hsvA[2], hsvB[2]) - vTol);
            vMax = Math.min(255, Math.max(hsvA[2], hsvB[2]) + vTol);
            center = new int[]{
                    (int) Math.round((hsvA[0] + hsvB[0]) / 2.0),
                    (int) Math.round((hsvA[1] + hsvB[1]) / 2.0),
                    (int) Math.round((hsvA[2] + hsvB[2]) / 2.0)
            };
        }
        Mat hsv = new Mat();
        Mat mask = new Mat();
        Imgproc.cvtColor(adjusted, hsv, Imgproc.COLOR_BGR2HSV);
        if (hMin <= hMax) {
            Core.inRange(hsv, new Scalar(hMin, sMin, vMin), new Scalar(hMax, sMax, vMax), mask);
        } else {
            Mat low = new Mat();
            Mat high = new Mat();
            try {
                Core.inRange(hsv, new Scalar(0, sMin, vMin), new Scalar(hMax, sMax, vMax), low);
                Core.inRange(hsv, new Scalar(hMin, sMin, vMin), new Scalar(179, sMax, vMax), high);
                Core.bitwise_or(low, high, mask);
            } finally {
                low.release();
                high.release();
            }
        }
        hsv.release();
        JSONObject meta = new JSONObject();
        meta.put("hsv_lower_bound_used", new JSONArray().put(hMin).put(sMin).put(vMin));
        meta.put("hsv_upper_bound_used", new JSONArray().put(hMax).put(sMax).put(vMax));
        meta.put("hsv_bounds_order", new JSONArray().put("h_min").put("h_max").put("s_min").put("s_max").put("v_min").put("v_max"));
        meta.put("hsv_bounds_tuple", new JSONArray().put(hMin).put(hMax).put(sMin).put(sMax).put(vMin).put(vMax));
        meta.put("center_hsv", new JSONArray().put(center[0]).put(center[1]).put(center[2]));
        meta.put("adaptive_or_fixed_mode", configuredMode);
        meta.put("configured_mode", "Two HEX range");
        meta.put("color_a", colorA);
        meta.put("color_b", colorB);
        meta.put("auto_yellow_source", "target_on_full_sweep_fallback");
        meta.put("follow_auto_applied", followAutoApplied);
        meta.put("follow_auto_reason", followAutoReason);
        meta.put("upstream_reason", upstreamReason);
        meta.put("color_order_assumption", "Android Bitmap -> OpenCV RGBA -> BGR -> HSV");
        meta.put("implementation_notes", "Native packaged runner mirrors the Phase 3 workflow-mirror target-yellow follow-auto HSV path without labels or golden fallback.");
        return new HsvResult(mask, meta);
    }

    private int[] twoHueBounds(int h1, int h2, int pad) {
        int a = ((h1 % 180) + 180) % 180;
        int b = ((h2 % 180) + 180) % 180;
        int p = Math.max(0, pad);
        int direct = Math.abs(a - b);
        if (direct <= 90) {
            int lo = Math.min(a, b) - p;
            int hi = Math.max(a, b) + p;
            if (lo < 0 || hi > 179) {
                return new int[]{((lo % 180) + 180) % 180, ((hi % 180) + 180) % 180};
            }
            return new int[]{lo, hi};
        }
        return new int[]{((Math.max(a, b) - p) % 180 + 180) % 180, ((Math.min(a, b) + p) % 180 + 180) % 180};
    }

    private int[] hexToHsv(String hex) {
        int r = Integer.parseInt(hex.substring(1, 3), 16);
        int g = Integer.parseInt(hex.substring(3, 5), 16);
        int b = Integer.parseInt(hex.substring(5, 7), 16);
        Mat color = new Mat(1, 1, CvType.CV_8UC3);
        Mat hsv = new Mat();
        try {
            color.put(0, 0, new byte[]{(byte) b, (byte) g, (byte) r});
            Imgproc.cvtColor(color, hsv, Imgproc.COLOR_BGR2HSV);
            byte[] out = new byte[3];
            hsv.get(0, 0, out);
            return new int[]{out[0] & 0xff, out[1] & 0xff, out[2] & 0xff};
        } finally {
            color.release();
            hsv.release();
        }
    }

    private JSONObject brightnessStats(Mat before, Mat after, BrightnessChoice choice, String opencvStatus) throws Exception {
        JSONObject root = matStats(after, "02_auto_brightness_contrast.png", opencvStatus);
        root.put("mode", "yellow_target_adaptive");
        root.put("brightness", choice.brightness);
        root.put("contrast", choice.contrast);
        root.put("alpha", Math.max(0.05, 1.0 + choice.contrast / 100.0));
        root.put("beta", choice.brightness);
        root.put("reason", choice.reason);
        root.put("score", choice.score);
        root.put("edge_density", choice.edgeDensity);
        root.put("mask_coverage", choice.maskCoverage);
        root.put("mean_luma", choice.meanLuma);
        root.put("candidate_count", choice.candidateCount);
        root.put("candidates", choice.candidates);
        root.put("target_yellow_hex", "#d1ae3a");
        root.put("estimated_brightness", choice.estimatedBrightness == null ? JSONObject.NULL : choice.estimatedBrightness);
        root.put("estimated_contrast", choice.estimatedContrast == null ? JSONObject.NULL : choice.estimatedContrast);
        root.put("estimated_alpha", choice.estimatedAlpha == null ? JSONObject.NULL : choice.estimatedAlpha);
        root.put("estimated_beta", choice.estimatedBeta == null ? JSONObject.NULL : choice.estimatedBeta);
        root.put("predicted_yellow_error", choice.predictedYellowError == null ? JSONObject.NULL : choice.predictedYellowError);
        root.put("max_adaptive_predicted_yellow_error", choice.maxAdaptivePredictedYellowError == null ? JSONObject.NULL : choice.maxAdaptivePredictedYellowError);
        root.put("adaptive_guard_applied", choice.adaptiveGuardApplied == null ? JSONObject.NULL : choice.adaptiveGuardApplied);
        root.put("yellow_error_after", choice.yellowError == null ? JSONObject.NULL : choice.yellowError);
        root.put("raw_median_bgr", choice.rawMedianBgr == null ? JSONObject.NULL : new JSONArray().put(choice.rawMedianBgr[0]).put(choice.rawMedianBgr[1]).put(choice.rawMedianBgr[2]));
        root.put("raw_median_luma", choice.rawMedianLuma == null ? JSONObject.NULL : choice.rawMedianLuma);
        root.put("raw_yellow_coverage", choice.rawYellowCoverage == null ? JSONObject.NULL : choice.rawYellowCoverage);
        root.put("measurement_roi", choice.measurementMeta == null ? JSONObject.NULL : choice.measurementMeta);
        root.put("luma_mean_before", Core.mean(toGray(before)).val[0]);
        root.put("luma_mean_after", Core.mean(toGray(after)).val[0]);
        root.put("color_order_assumption", "Android Bitmap -> OpenCV RGBA -> BGR");
        root.put("implementation_notes", "Native packaged runner uses the stable workflow yellow_target_adaptive path with lap-index projected measurement ROI when AutoCardROI metadata is available.");
        return root;
    }

    private Mat toGray(Mat input) {
        Mat gray = new Mat();
        if (input.channels() == 1) {
            gray = input.clone();
        } else {
            Imgproc.cvtColor(input, gray, Imgproc.COLOR_BGR2GRAY);
        }
        return gray;
    }

    private JSONObject matStats(Mat mat, String artifactName, String opencvStatus) throws Exception {
        JSONObject root = new JSONObject();
        root.put("available", true);
        root.put("artifact_name", artifactName);
        root.put("width", mat.cols());
        root.put("height", mat.rows());
        root.put("channels", mat.channels());
        root.put("opencv_status", opencvStatus);
        Scalar mean = Core.mean(mat);
        JSONArray meanValues = new JSONArray();
        for (int i = 0; i < mat.channels(); i++) {
            meanValues.put(mean.val[i]);
        }
        root.put("mean", meanValues);
        root.put("coordinate_space", "auto_card_roi_local");
        root.put("expected_values_validation_only", true);
        root.put("no_runtime_label_fallback", true);
        return root;
    }

    private JSONObject maskStats(Mat mask, JSONObject meta, String artifactName) throws Exception {
        JSONObject root = matStats(mask, artifactName, "loaded");
        int width = mask.cols();
        int height = mask.rows();
        int nonzero = Core.countNonZero(mask);
        root.put("mask_width", width);
        root.put("mask_height", height);
        root.put("nonzero_pixels", nonzero);
        root.put("nonzero_ratio", nonzero / Math.max(1.0, width * height));
        root.put("touches_left_edge", edgeHasNonzero(mask, 0, true));
        root.put("touches_right_edge", edgeHasNonzero(mask, width - 1, true));
        root.put("touches_top_edge", edgeHasNonzero(mask, 0, false));
        root.put("touches_bottom_edge", edgeHasNonzero(mask, height - 1, false));
        root.put("touches_any_edge", root.optBoolean("touches_left_edge") || root.optBoolean("touches_right_edge") || root.optBoolean("touches_top_edge") || root.optBoolean("touches_bottom_edge"));
        Mat labels = new Mat();
        Mat stats = new Mat();
        Mat centroids = new Mat();
        try {
            int count = Imgproc.connectedComponentsWithStats(mask, labels, stats, centroids);
            int largest = 0;
            int minX = mask.cols();
            int minY = mask.rows();
            int maxX = -1;
            int maxY = -1;
            for (int i = 1; i < count; i++) {
                double[] area = stats.get(i, Imgproc.CC_STAT_AREA);
                if (area != null && area.length > 0) {
                    largest = Math.max(largest, (int) area[0]);
                }
                double[] x = stats.get(i, Imgproc.CC_STAT_LEFT);
                double[] y = stats.get(i, Imgproc.CC_STAT_TOP);
                double[] w = stats.get(i, Imgproc.CC_STAT_WIDTH);
                double[] h = stats.get(i, Imgproc.CC_STAT_HEIGHT);
                if (x != null && y != null && w != null && h != null
                        && x.length > 0 && y.length > 0 && w.length > 0 && h.length > 0) {
                    minX = Math.min(minX, (int) x[0]);
                    minY = Math.min(minY, (int) y[0]);
                    maxX = Math.max(maxX, (int) (x[0] + w[0]));
                    maxY = Math.max(maxY, (int) (y[0] + h[0]));
                }
            }
            root.put("connected_component_count", Math.max(0, count - 1));
            root.put("largest_component_area", largest);
            JSONArray bbox = new JSONArray();
            if (maxX >= 0) {
                bbox.put(minX).put(minY).put(maxX).put(maxY);
            }
            root.put("bounding_box_of_nonzero_pixels", bbox);
        } finally {
            labels.release();
            stats.release();
            centroids.release();
        }
        JSONArray names = meta.names();
        if (names != null) {
            for (int i = 0; i < names.length(); i++) {
                String name = names.getString(i);
                root.put(name, meta.get(name));
            }
        }
        return root;
    }

    private boolean edgeHasNonzero(Mat mask, int index, boolean vertical) {
        if (mask.empty() || index < 0) {
            return false;
        }
        if (vertical) {
            if (index >= mask.cols()) {
                return false;
            }
            Mat col = mask.col(index);
            try {
                return Core.countNonZero(col) > 0;
            } finally {
                col.release();
            }
        }
        if (index >= mask.rows()) {
            return false;
        }
        Mat row = mask.row(index);
        try {
            return Core.countNonZero(row) > 0;
        } finally {
            row.release();
        }
    }

    private static class BrightnessChoice {
        final int brightness;
        final int contrast;
        double score;
        final double edgeDensity;
        final double maskCoverage;
        final double meanLuma;
        int candidateCount;
        String reason = "";
        JSONArray candidates = new JSONArray();
        Integer estimatedBrightness;
        Integer estimatedContrast;
        Double estimatedAlpha;
        Double estimatedBeta;
        Double predictedYellowError;
        Double maxAdaptivePredictedYellowError;
        Boolean adaptiveGuardApplied;
        Double yellowError;
        Double coveragePenalty;
        Double medianH;
        Double medianS;
        Double medianV;
        Double medianLabB;
        double[] rawMedianBgr;
        Double rawMedianLuma;
        Double rawYellowCoverage;
        JSONObject measurementMeta;

        BrightnessChoice(int brightness, int contrast, double score, double edgeDensity, double maskCoverage, double meanLuma) {
            this.brightness = brightness;
            this.contrast = contrast;
            this.score = score;
            this.edgeDensity = edgeDensity;
            this.maskCoverage = maskCoverage;
            this.meanLuma = meanLuma;
        }

        JSONObject toJson(boolean includeCandidates) throws Exception {
            JSONObject root = new JSONObject();
            root.put("brightness", brightness);
            root.put("contrast", contrast);
            root.put("score", score);
            root.put("edge_density", edgeDensity);
            root.put("mask_coverage", maskCoverage);
            root.put("mean_luma", meanLuma);
            root.put("target_yellow_hex", "#d1ae3a");
            root.put("yellow_error", yellowError == null ? JSONObject.NULL : yellowError);
            root.put("max_adaptive_predicted_yellow_error", maxAdaptivePredictedYellowError == null ? JSONObject.NULL : maxAdaptivePredictedYellowError);
            root.put("adaptive_guard_applied", adaptiveGuardApplied == null ? JSONObject.NULL : adaptiveGuardApplied);
            root.put("coverage_penalty", coveragePenalty == null ? JSONObject.NULL : coveragePenalty);
            root.put("median_h", medianH == null ? JSONObject.NULL : medianH);
            root.put("median_s", medianS == null ? JSONObject.NULL : medianS);
            root.put("median_v", medianV == null ? JSONObject.NULL : medianV);
            root.put("median_lab_b", medianLabB == null ? JSONObject.NULL : medianLabB);
            root.put("measurement_roi", measurementMeta == null ? JSONObject.NULL : measurementMeta);
            if (includeCandidates) {
                root.put("candidate_count", candidateCount);
                root.put("candidates", candidates);
            }
            return root;
        }
    }

    private static class MeasurementRoi {
        final int x1;
        final int y1;
        final int x2;
        final int y2;
        final boolean applied;
        final String reason;
        int[] fullFrameBox;
        int[] sourceBox;
        double lapIndexWidth;
        double lapIndexHeight;

        MeasurementRoi(int x1, int y1, int x2, int y2, boolean applied, String reason) {
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
            this.applied = applied;
            this.reason = reason;
        }

        static MeasurementRoi full(int width, int height, String reason) {
            return new MeasurementRoi(0, 0, width, height, false, reason);
        }

        Mat crop(Mat image) {
            return new Mat(image, new org.opencv.core.Rect(x1, y1, Math.max(1, x2 - x1), Math.max(1, y2 - y1))).clone();
        }

        JSONObject toJson(String appliedReason) throws Exception {
            JSONObject root = new JSONObject();
            root.put("mode", "lap_index_projected_small");
            root.put("applied", applied);
            root.put("reason", applied ? appliedReason : reason);
            root.put("box_xyxy", new JSONArray().put(x1).put(y1).put(x2).put(y2));
            root.put("shape", new JSONArray().put(y2 - y1).put(x2 - x1));
            if (fullFrameBox != null) {
                root.put("full_frame_box_xyxy", new JSONArray().put(fullFrameBox[0]).put(fullFrameBox[1]).put(fullFrameBox[2]).put(fullFrameBox[3]));
            }
            if (sourceBox != null) {
                root.put("source_box_xyxy", new JSONArray().put(sourceBox[0]).put(sourceBox[1]).put(sourceBox[2]).put(sourceBox[3]));
            }
            if (lapIndexWidth > 0.0) {
                root.put("lap_index_width", lapIndexWidth);
            }
            if (lapIndexHeight > 0.0) {
                root.put("lap_index_height", lapIndexHeight);
            }
            return root;
        }
    }

    private static class Step02Timing {
        final String imageKey;
        final long startedAtMs = System.currentTimeMillis();
        final LinkedHashMap<String, Long> durations = new LinkedHashMap<>();
        int candidateCount = 0;
        double scoringSampleScale = 1.0;
        int[] scoringSampleShape = null;

        Step02Timing(String imageKey) {
            this.imageKey = imageKey;
        }

        void addDuration(String key, long durationMs) {
            long safeDuration = Math.max(0L, durationMs);
            Long prior = durations.get(key);
            durations.put(key, (prior == null ? 0L : prior) + safeDuration);
        }

        void incrementCandidate() {
            candidateCount += 1;
        }

        JSONObject toJson(BrightnessChoice choice) throws Exception {
            JSONObject root = new JSONObject();
            JSONObject timing = new JSONObject();
            long totalMs = Math.max(0L, System.currentTimeMillis() - startedAtMs);
            root.put("schema_version", "phase4p1_step02_timing_v1");
            root.put("image_key", imageKey);
            root.put("stage", "02_AutoBrightnessContrast");
            root.put("total_step02_measured_ms", totalMs);
            for (Map.Entry<String, Long> entry : durations.entrySet()) {
                timing.put(entry.getKey(), entry.getValue());
            }
            root.put("sub_stage_durations_ms", timing);
            root.put("candidate_count_scored", candidateCount);
            root.put("candidate_scoring_input", "full_measurement_roi_bulk_histogram_median");
            root.put("candidate_scoring_sample_scale", scoringSampleScale);
            if (scoringSampleShape != null) {
                root.put("candidate_scoring_sample_shape", new JSONArray().put(scoringSampleShape[0]).put(scoringSampleShape[1]));
            }
            if (choice != null) {
                root.put("selected_candidate", choice.toJson(false));
                root.put("selected_reason", choice.reason);
                root.put("selected_brightness", choice.brightness);
                root.put("selected_contrast", choice.contrast);
            }
            root.put("bottleneck_classification", classifyStep02Bottleneck());
            root.put("optimization_notes", "Candidates are scored on the full measurement ROI using bulk array histogram medians; the selected transform is applied once to the full AutoCardROI crop.");
            root.put("expected_values_validation_only", true);
            root.put("no_runtime_label_fallback", true);
            return root;
        }

        String classifyStep02Bottleneck() {
            String bestKey = "unknown";
            long bestValue = -1L;
            for (Map.Entry<String, Long> entry : durations.entrySet()) {
                if (entry.getValue() > bestValue) {
                    bestKey = entry.getKey();
                    bestValue = entry.getValue();
                }
            }
            if (bestKey.contains("full_sweep") && candidateCount > 50) {
                return "candidate_count_too_high";
            }
            if (bestKey.contains("transform")) {
                return "full_roi_transform_per_candidate";
            }
            if (bestKey.contains("hsv")) {
                return "full_roi_hsv_conversion_per_candidate";
            }
            if (bestKey.contains("lab")) {
                return "lab_conversion_per_candidate";
            }
            if (bestKey.contains("edge")) {
                return "edge_density_per_candidate";
            }
            if (bestKey.contains("png")) {
                return "png_artifact_writing";
            }
            if (bestKey.contains("json")) {
                return "json_writing";
            }
            return bestKey;
        }
    }

    private static class YellowEstimate {
        int brightness;
        int contrast;
        double alpha;
        double beta;
        double predictedYellowError;
        double[] rawMedianBgr;
        double rawMedianLuma;
        double rawYellowCoverage;
    }

    private static class MaskedColorStats {
        double[] medianHsv;
        double[] medianLab;
    }

    private static class HsvResult {
        final Mat mask;
        final JSONObject meta;

        HsvResult(Mat mask, JSONObject meta) {
            this.mask = mask;
            this.meta = meta;
        }
    }

    private static class EarlyCvResult {
        boolean step02;
        boolean step03;
        boolean step04;
        boolean step05;
        boolean step06;
        String status = "not_attempted";
        String reason = "";
        final Map<String, String> downstreamStatuses = new java.util.LinkedHashMap<>();

        JSONObject toJson() throws Exception {
            JSONObject root = new JSONObject();
            root.put("step02_available", step02);
            root.put("step03_available", step03);
            root.put("step04_available", step04);
            root.put("step05_available", step05);
            root.put("step06_available", step06);
            root.put("status", status);
            root.put("reason", reason);
            JSONObject downstream = new JSONObject();
            for (String key : downstreamStatuses.keySet()) {
                downstream.put(key, downstreamStatuses.get(key));
            }
            root.put("downstream_statuses", downstream);
            root.put("expected_values_validation_only", true);
            root.put("no_runtime_label_fallback", true);
            return root;
        }
    }

    private void recreateDirectory(File dir) {
        deleteRecursively(dir);
        dir.mkdirs();
    }

    private void deleteRecursively(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        if (file.isDirectory()) {
            File[] children = file.listFiles();
            if (children != null) {
                for (File child : children) {
                    deleteRecursively(child);
                }
            }
        }
        file.delete();
    }

    private String safeName(String value) {
        return value == null ? "image" : value.replaceAll("[^A-Za-z0-9._-]", "_");
    }

    /**
     * MK8DX ecosystem overlay: the Select-a-Ghost panel's last look. When the
     * RF-DETR detector sees no lap circles (the ghost's character badge shining
     * through the translucent panel right behind them), the circles 1-2-3 are found
     * by shape: grey template matching over several sizes, a vertical column at an
     * even pitch. Templates and search settings come from the recognition pack
     * (mk8dx.lap-circle-templates.v1, tooling/recognition/build_lap_circle_templates.py).
     * Same arithmetic as the Web scanner's lapCircles.ts.
     */
    static final class LapCircleFinder {
        static final String ASSET = "shared_icon/lap-circle-templates-v1.json";

        private final Mat[] templates = new Mat[3];
        private final double minRel, maxRel, step, pitchMin, pitchMax, pitchStep, seedMinScore;
        final double minScore;
        private final int work, window, seedPeaks;

        /** Three found circles (centre x, centre y, size in the input's pixels) and their score. */
        static final class Column {
            final double[][] circles;
            final double score;

            Column(double[][] circles, double score) {
                this.circles = circles;
                this.score = score;
            }
        }

        private LapCircleFinder(JSONObject document) throws Exception {
            if (!"mk8dx.lap-circle-templates.v1".equals(document.optString("schema"))) {
                throw new IllegalArgumentException("Expected a mk8dx.lap-circle-templates.v1 document");
            }
            int size = document.getInt("size");
            JSONObject search = document.getJSONObject("search");
            minRel = search.getDouble("minRelativeSize");
            maxRel = search.getDouble("maxRelativeSize");
            step = search.getDouble("sizeStep");
            work = search.getInt("workSize");
            pitchMin = search.getDouble("pitchMin");
            pitchMax = search.getDouble("pitchMax");
            pitchStep = search.getDouble("pitchStep");
            window = search.getInt("neighbourWindow");
            seedPeaks = search.getInt("seedPeaks");
            seedMinScore = search.getDouble("seedMinScore");
            minScore = search.getDouble("minScore");
            JSONObject encoded = document.getJSONObject("templates");
            for (int digit = 1; digit <= 3; digit++) {
                byte[] bytes = Base64.decode(encoded.getString(String.valueOf(digit)), Base64.DEFAULT);
                Mat grey = new Mat(size, size, CvType.CV_8UC1);
                grey.put(0, 0, bytes);
                Mat asFloat = new Mat();
                grey.convertTo(asFloat, CvType.CV_32F);
                grey.release();
                Mat scaled = new Mat();
                Imgproc.resize(asFloat, scaled, new Size(work, work), 0, 0, Imgproc.INTER_AREA);
                asFloat.release();
                templates[digit - 1] = scaled;
            }
        }

        /** The finder from the staged pack file, or null when this build carries none. */
        static LapCircleFinder load(AssetManager assets) {
            try (InputStream stream = assets.open(ASSET)) {
                byte[] bytes = new byte[stream.available()];
                int read = 0;
                while (read < bytes.length) {
                    int n = stream.read(bytes, read, bytes.length - read);
                    if (n < 0) break;
                    read += n;
                }
                return new LapCircleFinder(new JSONObject(new String(bytes, 0, read, StandardCharsets.UTF_8)));
            } catch (Exception exc) {
                return null;
            }
        }

        /** The best 1-2-3 column in the bitmap, or null when none reaches the pack's minimum score. */
        Column find(Bitmap bitmap) {
            Mat rgba = new Mat();
            Mat grey = new Mat();
            try {
                Utils.bitmapToMat(bitmap, rgba);
                Imgproc.cvtColor(rgba, grey, Imgproc.COLOR_RGBA2GRAY);
                Column best = findGrey(grey);
                return best != null && best.score >= minScore ? best : null;
            } finally {
                rgba.release();
                grey.release();
            }
        }

        private Column findGrey(Mat grey) {
            int w = grey.cols();
            int h = grey.rows();
            Column best = null;
            for (double rel = minRel; rel <= maxRel; rel *= step) {
                double size = rel * w;
                double scale = work / size;
                Mat small = new Mat();
                Mat smallFloat = new Mat();
                Imgproc.resize(grey, small, new Size(Math.max(work + 1, Math.round(w * scale)), Math.max(work + 1, Math.round(h * scale))),
                        0, 0, Imgproc.INTER_AREA);
                small.convertTo(smallFloat, CvType.CV_32F);
                small.release();
                Mat[] response = new Mat[3];
                for (int digit = 0; digit < 3; digit++) {
                    response[digit] = new Mat();
                    Imgproc.matchTemplate(smallFloat, templates[digit], response[digit], Imgproc.TM_CCOEFF_NORMED);
                }
                smallFloat.release();
                Mat seeds = response[0].clone();
                for (int peak = 0; peak < seedPeaks; peak++) {
                    Core.MinMaxLocResult top = Core.minMaxLoc(seeds);
                    if (top.maxVal < seedMinScore) break;
                    int x1 = (int) top.maxLoc.x;
                    int y1 = (int) top.maxLoc.y;
                    Imgproc.rectangle(seeds, new Point(x1 - work / 2, y1 - work / 2), new Point(x1 + work / 2, y1 + work / 2),
                            new Scalar(-1), -1);
                    for (double pitchFactor = pitchMin; pitchFactor <= pitchMax + 1e-9; pitchFactor += pitchStep) {
                        double pitch = pitchFactor * work;
                        double[][] found = new double[2][];
                        boolean inside = true;
                        for (int d = 1; d <= 2 && inside; d++) {
                            int yy = (int) Math.round(y1 + d * pitch);
                            int y0 = yy - window, y1b = yy + window + 1, x0 = x1 - window, x1b = x1 + window + 1;
                            if (y0 < 0 || y1b > response[d].rows() || x0 < 0 || x1b > response[d].cols()) {
                                inside = false;
                                break;
                            }
                            Mat region = response[d].submat(y0, y1b, x0, x1b);
                            Core.MinMaxLocResult local = Core.minMaxLoc(region);
                            region.release();
                            found[d - 1] = new double[]{local.maxVal, x0 + local.maxLoc.x, y0 + local.maxLoc.y};
                        }
                        if (!inside) continue;
                        double score = Math.min(top.maxVal, Math.min(found[0][0], found[1][0]));
                        if (best == null || score > best.score) {
                            double[][] circles = new double[3][];
                            double[][] points = {{x1, y1}, {found[0][1], found[0][2]}, {found[1][1], found[1][2]}};
                            for (int i = 0; i < 3; i++) {
                                circles[i] = new double[]{(points[i][0] + work / 2.0) / scale, (points[i][1] + work / 2.0) / scale, size};
                            }
                            best = new Column(circles, score);
                        }
                    }
                }
                seeds.release();
                for (Mat r : response) r.release();
            }
            return best;
        }

        /** The column as lap_index detections in the bitmap's normalized space (one circle-sized box each). */
        static List<RfDetrDetector.Detection> asDetections(Column column, int width, int height) {
            List<RfDetrDetector.Detection> out = new ArrayList<>();
            for (double[] circle : column.circles) {
                double half = circle[2] / 2.0;
                out.add(new RfDetrDetector.Detection("lap_index", (float) column.score,
                        (float) Math.max(0, (circle[0] - half) / width), (float) Math.max(0, (circle[1] - half) / height),
                        (float) Math.min(1, (circle[0] + half) / width), (float) Math.min(1, (circle[1] + half) / height)));
            }
            return out;
        }
    }
}
