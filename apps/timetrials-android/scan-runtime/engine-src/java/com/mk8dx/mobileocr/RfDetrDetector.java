package com.mk8dx.mobileocr;

import android.content.Context;
import android.content.res.AssetManager;
import android.graphics.Bitmap;
import android.graphics.Color;

import ai.onnxruntime.OnnxTensor;
import ai.onnxruntime.OrtEnvironment;
import ai.onnxruntime.OrtSession;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.nio.FloatBuffer;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import ai.onnxruntime.providers.NNAPIFlags;

public class RfDetrDetector implements AutoCloseable {
    public static final String DEFAULT_MODEL_ASSET = "model/inference_model.onnx";
    public static final String QUANTIZED_MODEL_ASSET = "model/inference_model_dynamic_quant.onnx";
    public static final String DEFAULT_MODEL_PROFILE = "current_cpu";
    public static final int MODEL_SIZE = 704;
    public static final float DETECT_THRESHOLD = 0.20f;
    public static final String[] CLASS_NAMES = new String[]{
            "ghost_timetrail_box",
            "player_timetrail_box",
            "lap_index",
            "background"
    };

    private static final float[] RFDETR_MEAN = new float[]{0.485f, 0.456f, 0.406f};
    private static final float[] RFDETR_STD = new float[]{0.229f, 0.224f, 0.225f};

    private final OrtEnvironment environment;
    private final OrtSession session;
    private final String modelAssetPath;
    private final String loadedModelPath;
    private final String requestedModelProfile;
    private final String actualModelProfile;
    private final String modelHash;
    private final int ortIntraOpThreads;
    private final int ortInterOpThreads;
    private final String requestedProviderStrategy;
    private final String actualProviderUsed;
    private final boolean providerAvailable;
    private final boolean providerInitSuccess;
    private final boolean providerFallbackUsed;
    private final String providerFallbackReason;
    private final int[] pixelBuffer = new int[MODEL_SIZE * MODEL_SIZE];
    private final float[] inputBuffer = new float[1 * 3 * MODEL_SIZE * MODEL_SIZE];
    private final long[] inputShape = new long[]{1, 3, MODEL_SIZE, MODEL_SIZE};

    public RfDetrDetector(AssetManager assets) throws Exception {
        this(assets, DEFAULT_MODEL_ASSET);
    }

    public RfDetrDetector(AssetManager assets, String modelAssetPath) throws Exception {
        this.modelAssetPath = modelAssetPath;
        this.loadedModelPath = modelAssetPath;
        this.requestedModelProfile = DEFAULT_MODEL_PROFILE;
        this.actualModelProfile = DEFAULT_MODEL_PROFILE;
        byte[] modelBytes = readAssetBytes(assets, modelAssetPath);
        this.modelHash = sha256Bytes(modelBytes);
        this.environment = OrtEnvironment.getEnvironment();
        this.ortIntraOpThreads = boundedOrtIntraOpThreads();
        this.ortInterOpThreads = 1;
        this.requestedProviderStrategy = "cpu_current";
        ProviderSelection providerSelection = new ProviderSelection(this.requestedProviderStrategy);
        OrtSession.SessionOptions options = createSessionOptions(ortIntraOpThreads, ortInterOpThreads, providerSelection);
        this.actualProviderUsed = providerSelection.actualProviderUsed;
        this.providerAvailable = providerSelection.providerAvailable;
        this.providerInitSuccess = providerSelection.providerInitSuccess;
        this.providerFallbackUsed = providerSelection.fallbackUsed;
        this.providerFallbackReason = providerSelection.fallbackReason;
        this.session = environment.createSession(modelBytes, options);
    }

    public RfDetrDetector(Context context) throws Exception {
        this(context, DEFAULT_MODEL_ASSET, "cpu_current", DEFAULT_MODEL_PROFILE);
    }

    public RfDetrDetector(Context context, String modelAssetPath) throws Exception {
        this(context, modelAssetPath, "cpu_current", DEFAULT_MODEL_PROFILE);
    }

    public RfDetrDetector(Context context, String modelAssetPath, String requestedProviderStrategy) throws Exception {
        this(context, modelAssetPath, requestedProviderStrategy, DEFAULT_MODEL_PROFILE);
    }

    public RfDetrDetector(Context context, String modelAssetPath, String requestedProviderStrategy, String requestedModelProfile) throws Exception {
        this.modelAssetPath = modelAssetPath;
        this.requestedModelProfile = normalizeModelProfile(requestedModelProfile);
        this.actualModelProfile = modelProfileForAsset(modelAssetPath);
        this.environment = OrtEnvironment.getEnvironment();
        this.ortIntraOpThreads = boundedOrtIntraOpThreads();
        this.ortInterOpThreads = 1;
        this.requestedProviderStrategy = normalizeProviderStrategy(requestedProviderStrategy);
        ProviderSelection providerSelection = new ProviderSelection(this.requestedProviderStrategy);
        OrtSession.SessionOptions options = createSessionOptions(ortIntraOpThreads, ortInterOpThreads, providerSelection);
        this.actualProviderUsed = providerSelection.actualProviderUsed;
        this.providerAvailable = providerSelection.providerAvailable;
        this.providerInitSuccess = providerSelection.providerInitSuccess;
        this.providerFallbackUsed = providerSelection.fallbackUsed;
        this.providerFallbackReason = providerSelection.fallbackReason;
        File modelFile = materializeAssetToFile(context, modelAssetPath);
        this.loadedModelPath = modelFile.getAbsolutePath();
        this.modelHash = sha256File(modelFile);
        this.session = environment.createSession(this.loadedModelPath, options);
    }

    public synchronized DetectionResult detect(Bitmap bitmap) throws Exception {
        long totalStartMs = System.currentTimeMillis();
        long resizeStartMs = System.currentTimeMillis();
        Bitmap inputBitmap = Bitmap.createScaledBitmap(bitmap, MODEL_SIZE, MODEL_SIZE, true);
        long resizeMs = System.currentTimeMillis() - resizeStartMs;

        long normalizeStartMs = System.currentTimeMillis();
        inputBitmap.getPixels(pixelBuffer, 0, MODEL_SIZE, 0, 0, MODEL_SIZE, MODEL_SIZE);
        inputBitmap.recycle();
        int plane = MODEL_SIZE * MODEL_SIZE;
        for (int i = 0; i < pixelBuffer.length; i++) {
            int color = pixelBuffer[i];
            inputBuffer[i] = ((Color.red(color) / 255.0f) - RFDETR_MEAN[0]) / RFDETR_STD[0];
            inputBuffer[plane + i] = ((Color.green(color) / 255.0f) - RFDETR_MEAN[1]) / RFDETR_STD[1];
            inputBuffer[2 * plane + i] = ((Color.blue(color) / 255.0f) - RFDETR_MEAN[2]) / RFDETR_STD[2];
        }
        long normalizeMs = System.currentTimeMillis() - normalizeStartMs;

        long tensorStartMs = System.currentTimeMillis();
        OnnxTensor tensor = OnnxTensor.createTensor(
                environment,
                FloatBuffer.wrap(inputBuffer),
                inputShape
        );
        Map<String, OnnxTensor> inputs = new HashMap<>();
        inputs.put("input", tensor);
        long tensorMs = System.currentTimeMillis() - tensorStartMs;
        long ortStartMs = System.currentTimeMillis();
        OrtSession.Result result = session.run(inputs);
        long ortRunMs = System.currentTimeMillis() - ortStartMs;
        long parseStartMs = System.currentTimeMillis();
        float[][][] dets = (float[][][]) result.get("dets").orElseThrow().getValue();
        float[][][] labels = (float[][][]) result.get("labels").orElseThrow().getValue();
        List<Detection> detections = parseDetections(dets[0], labels[0], bitmap.getWidth(), bitmap.getHeight());
        long parseMs = System.currentTimeMillis() - parseStartMs;
        result.close();
        tensor.close();
        return new DetectionResult(detections, resizeMs, normalizeMs, tensorMs, ortRunMs, parseMs, System.currentTimeMillis() - totalStartMs);
    }

    public JSONObject configJson() throws Exception {
        JSONObject root = new JSONObject();
        root.put("model_asset_path", modelAssetPath);
        root.put("loaded_model_path", loadedModelPath);
        root.put("requested_model_profile", requestedModelProfile);
        root.put("actual_model_profile", actualModelProfile);
        root.put("model_path", loadedModelPath);
        root.put("model_hash", modelHash);
        root.put("model_load_method", loadedModelPath.equals(modelAssetPath) ? "asset_byte_array" : "asset_streamed_to_app_file_then_path_session");
        root.put("input_name", "input");
        root.put("input_shape", new JSONArray().put(1).put(3).put(MODEL_SIZE).put(MODEL_SIZE));
        root.put("output_names", new JSONArray().put("dets").put("labels"));
        root.put("model_size", MODEL_SIZE);
        root.put("detect_threshold", DETECT_THRESHOLD);
        root.put("class_names", new JSONArray().put(CLASS_NAMES[0]).put(CLASS_NAMES[1]).put(CLASS_NAMES[2]).put(CLASS_NAMES[3]));
        root.put("preprocessing", "Bitmap RGB -> resized 704x704 -> CHW float normalize with RF-DETR ImageNet mean/std");
        root.put("preprocessing_buffer_reuse", true);
        root.put("preprocessing_buffer_reuse_scope", "detector_instance_fixed_model_size");
        root.put("ort_intra_op_threads", ortIntraOpThreads);
        root.put("ort_inter_op_threads", ortInterOpThreads);
        root.put("ort_thread_config", "bounded_by_runtime_available_processors_cap_4");
        root.put("requested_provider_strategy", requestedProviderStrategy);
        root.put("actual_provider_used", actualProviderUsed);
        root.put("provider_available", providerAvailable);
        root.put("provider_init_success", providerInitSuccess);
        root.put("fallback_used", providerFallbackUsed);
        root.put("fallback_reason", providerFallbackReason);
        root.put("mean_rgb", new JSONArray().put(RFDETR_MEAN[0]).put(RFDETR_MEAN[1]).put(RFDETR_MEAN[2]));
        root.put("std_rgb", new JSONArray().put(RFDETR_STD[0]).put(RFDETR_STD[1]).put(RFDETR_STD[2]));
        root.put("no_runtime_label_fallback", true);
        return root;
    }

    @Override
    public void close() throws Exception {
        session.close();
    }

    private List<Detection> parseDetections(float[][] boxes, float[][] logits, int width, int height) {
        List<Detection> detections = new ArrayList<>();
        int count = Math.min(boxes.length, logits.length);
        for (int i = 0; i < count; i++) {
            for (int cls = 0; cls < Math.min(3, logits[i].length); cls++) {
                float score = sigmoid(logits[i][cls]);
                if (score < DETECT_THRESHOLD) {
                    continue;
                }
                float cx = boxes[i][0];
                float cy = boxes[i][1];
                float bw = boxes[i][2];
                float bh = boxes[i][3];
                float left = clamp((cx - bw / 2.0f) * width, 0, width);
                float top = clamp((cy - bh / 2.0f) * height, 0, height);
                float right = clamp((cx + bw / 2.0f) * width, 0, width);
                float bottom = clamp((cy + bh / 2.0f) * height, 0, height);
                detections.add(new Detection(CLASS_NAMES[cls], score, left / width, top / height, right / width, bottom / height));
            }
        }
        Collections.sort(detections, new Comparator<Detection>() {
            @Override
            public int compare(Detection a, Detection b) {
                return Float.compare(b.score, a.score);
            }
        });
        return detections.size() > 40 ? new ArrayList<>(detections.subList(0, 40)) : detections;
    }

    private static byte[] readAssetBytes(AssetManager assets, String path) throws Exception {
        ByteArrayOutputStream buffer = new ByteArrayOutputStream();
        byte[] chunk = new byte[1024 * 64];
        try (InputStream in = assets.open(path)) {
            int n;
            while ((n = in.read(chunk)) >= 0) {
                buffer.write(chunk, 0, n);
            }
        }
        return buffer.toByteArray();
    }

    private static File materializeAssetToFile(Context context, String path) throws Exception {
        File dir = new File(context.getFilesDir(), "offline_parity_model_cache");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("Unable to create model cache directory: " + dir.getAbsolutePath());
        }
        File out = new File(dir, path.replace('/', '_'));
        byte[] chunk = new byte[1024 * 1024];
        try (InputStream in = context.getAssets().open(path);
             FileOutputStream output = new FileOutputStream(out, false)) {
            int n;
            while ((n = in.read(chunk)) >= 0) {
                output.write(chunk, 0, n);
            }
        }
        return out;
    }

    private static OrtSession.SessionOptions createSessionOptions(int intraOpThreads, int interOpThreads, ProviderSelection providerSelection) throws Exception {
        OrtSession.SessionOptions options = new OrtSession.SessionOptions();
        options.setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT);
        options.setExecutionMode(OrtSession.SessionOptions.ExecutionMode.SEQUENTIAL);
        options.setMemoryPatternOptimization(true);
        options.setCPUArenaAllocator(true);
        options.setIntraOpNumThreads(intraOpThreads);
        options.setInterOpNumThreads(interOpThreads);
        providerSelection.apply(options);
        return options;
    }

    private static int boundedOrtIntraOpThreads() {
        return Math.max(1, Math.min(4, Runtime.getRuntime().availableProcessors()));
    }

    private static String normalizeProviderStrategy(String value) {
        if (value == null || value.trim().isEmpty()) {
            return "cpu_current";
        }
        String strategy = value.trim();
        if ("cpu_default".equals(strategy)) {
            return "cpu_current";
        }
        if ("cpu_current".equals(strategy)
                || "nnapi_default_if_available".equals(strategy)
                || "nnapi_cpu_disabled_if_available".equals(strategy)
                || "cpu_xnnpack_if_available".equals(strategy)
                || "qnn_if_available".equals(strategy)) {
            return strategy;
        }
        return "cpu_current";
    }

    public static String normalizeModelProfile(String value) {
        if (value == null || value.trim().isEmpty()) {
            return DEFAULT_MODEL_PROFILE;
        }
        String profile = value.trim();
        if (DEFAULT_MODEL_PROFILE.equals(profile) || "candidate_quantized".equals(profile)) {
            return profile;
        }
        return DEFAULT_MODEL_PROFILE;
    }

    public static String modelAssetForProfile(String value) {
        String profile = normalizeModelProfile(value);
        if ("candidate_quantized".equals(profile)) {
            return QUANTIZED_MODEL_ASSET;
        }
        return DEFAULT_MODEL_ASSET;
    }

    private static String modelProfileForAsset(String assetPath) {
        if (QUANTIZED_MODEL_ASSET.equals(assetPath)) {
            return "candidate_quantized";
        }
        return DEFAULT_MODEL_PROFILE;
    }

    private static String sha256Bytes(byte[] bytes) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] hash = digest.digest(bytes);
        return hex(hash);
    }

    private static String sha256File(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        byte[] buffer = new byte[1024 * 1024];
        try (FileInputStream in = new FileInputStream(file)) {
            int read;
            while ((read = in.read(buffer)) >= 0) {
                if (read > 0) {
                    digest.update(buffer, 0, read);
                }
            }
        }
        return hex(digest.digest());
    }

    private static String hex(byte[] bytes) {
        StringBuilder out = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            out.append(String.format("%02x", b & 0xff));
        }
        return out.toString();
    }

    private static class ProviderSelection {
        final String requestedProviderStrategy;
        String actualProviderUsed = "CPUExecutionProvider";
        boolean providerAvailable = true;
        boolean providerInitSuccess = true;
        boolean fallbackUsed = false;
        String fallbackReason = "";

        ProviderSelection(String requestedProviderStrategy) {
            this.requestedProviderStrategy = requestedProviderStrategy;
        }

        void apply(OrtSession.SessionOptions options) throws Exception {
            if ("cpu_current".equals(requestedProviderStrategy)) {
                return;
            }
            try {
                if ("nnapi_default_if_available".equals(requestedProviderStrategy)) {
                    options.addNnapi();
                    actualProviderUsed = "NNAPIExecutionProvider_with_CPU_fallback";
                } else if ("nnapi_cpu_disabled_if_available".equals(requestedProviderStrategy)) {
                    options.addNnapi(EnumSet.of(NNAPIFlags.CPU_DISABLED));
                    actualProviderUsed = "NNAPIExecutionProvider_CPU_DISABLED";
                } else if ("cpu_xnnpack_if_available".equals(requestedProviderStrategy)) {
                    options.addXnnpack(new HashMap<String, String>());
                    actualProviderUsed = "XNNPACKExecutionProvider_with_CPU_fallback";
                } else if ("qnn_if_available".equals(requestedProviderStrategy)) {
                    options.addQnn(new HashMap<String, String>());
                    actualProviderUsed = "QNNExecutionProvider_with_CPU_fallback";
                }
                providerAvailable = true;
                providerInitSuccess = true;
            } catch (Exception exc) {
                providerAvailable = false;
                providerInitSuccess = false;
                fallbackUsed = true;
                fallbackReason = exc.getClass().getSimpleName() + ": " + exc.getMessage();
                actualProviderUsed = "CPUExecutionProvider";
            }
        }
    }

    private static float sigmoid(float value) {
        return (float) (1.0 / (1.0 + Math.exp(-value)));
    }

    private static float clamp(float value, float lo, float hi) {
        return Math.max(lo, Math.min(hi, value));
    }

    public static class DetectionResult {
        public final List<Detection> detections;
        public final long resizeMs;
        public final long normalizeMs;
        public final long tensorMs;
        public final long ortRunMs;
        public final long parseMs;
        public final long totalMs;

        DetectionResult(List<Detection> detections, long resizeMs, long normalizeMs, long tensorMs, long ortRunMs, long parseMs, long totalMs) {
            this.detections = detections;
            this.resizeMs = resizeMs;
            this.normalizeMs = normalizeMs;
            this.tensorMs = tensorMs;
            this.ortRunMs = ortRunMs;
            this.parseMs = parseMs;
            this.totalMs = totalMs;
        }

        public JSONObject timingJson() throws Exception {
            return new JSONObject()
                    .put("resize", resizeMs)
                    .put("normalize", normalizeMs)
                    .put("tensor", tensorMs)
                    .put("ort_run", ortRunMs)
                    .put("parse", parseMs)
                    .put("total", totalMs);
        }
    }

    public static class Detection {
        public final String label;
        public final float score;
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;

        Detection(String label, float score, float left, float top, float right, float bottom) {
            this.label = label;
            this.score = score;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }

        public JSONObject toJson(int width, int height) throws Exception {
            JSONObject root = new JSONObject();
            root.put("label", label);
            root.put("score", score);
            root.put("box_normalized_xyxy", new JSONArray().put(left).put(top).put(right).put(bottom));
            root.put("box_xyxy", new JSONArray()
                    .put(left * width)
                    .put(top * height)
                    .put(right * width)
                    .put(bottom * height));
            return root;
        }
    }
}
