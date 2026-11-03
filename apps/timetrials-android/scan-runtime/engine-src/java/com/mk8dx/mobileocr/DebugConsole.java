package com.mk8dx.mobileocr;

import java.text.SimpleDateFormat;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Locale;

/**
 * Proceswijde activity-feed voor het debug-consolescherm in MainActivity.
 * De parity-runner, receiver en pipeline loggen hier naartoe zodat op het
 * toestel zichtbaar is wat de app doet (broadcast van de laptop ontvangen,
 * actieve frame/stage, wall-clock, leesresultaten) in plaats van een stil
 * camerabeeld tijdens adb-gestuurde tests.
 */
public final class DebugConsole {

    public interface Listener {
        /** Wordt op een willekeurige thread aangeroepen; UI-kant moet zelf naar de main thread posten. */
        void onConsoleLine(String line);
    }

    private static final int MAX_LINES = 500;
    private static final ArrayDeque<String> LINES = new ArrayDeque<>();
    private static volatile Listener listener;

    private static volatile boolean runActive = false;
    private static volatile String runLabel = "";
    private static volatile long runStartedAtMs = 0L;
    private static volatile String currentImageKey = "";
    private static volatile String currentStage = "";
    private static volatile int currentImageIndex = -1;
    private static volatile int totalImages = 0;

    private DebugConsole() {
    }

    public static void log(String tag, String message) {
        String stamp = new SimpleDateFormat("HH:mm:ss.SSS", Locale.US).format(new Date());
        String line = stamp + " [" + tag + "] " + message;
        // Spiegel naar logcat zodat de laptop live kan meekijken (adb logcat -s MK8Console).
        android.util.Log.i("MK8Console", "[" + tag + "] " + message);
        synchronized (LINES) {
            LINES.addLast(line);
            while (LINES.size() > MAX_LINES) {
                LINES.removeFirst();
            }
        }
        Listener current = listener;
        if (current != null) {
            current.onConsoleLine(line);
        }
    }



    public static void stageStatus(String imageKey, String stage, int imageIndex, int total) {
        currentImageKey = imageKey == null ? "" : imageKey;
        currentStage = stage == null ? "" : stage;
        currentImageIndex = imageIndex;
        totalImages = total;
    }


    /** Eén-regel heartbeat voor de consolekop: run-label, actieve frame/stage en verstreken wall-clock. */
    public static String heartbeatLine() {
        if (!runActive) {
            return "IDLE | waiting for work (adb broadcast / scan)";
        }
        long elapsed = System.currentTimeMillis() - runStartedAtMs;
        StringBuilder line = new StringBuilder("RUN ").append(runLabel);
        if (currentImageIndex >= 0 && totalImages > 0) {
            line.append(" | frame ").append(currentImageIndex + 1).append("/").append(totalImages);
        }
        if (!currentImageKey.isEmpty()) {
            line.append(" ").append(currentImageKey);
        }
        if (!currentStage.isEmpty()) {
            line.append(" | ").append(currentStage);
        }
        line.append(" | ").append(String.format(Locale.US, "%.1fs", elapsed / 1000.0));
        return line.toString();
    }

    public static List<String> snapshot() {
        synchronized (LINES) {
            return new ArrayList<>(LINES);
        }
    }

    public static void setListener(Listener newListener) {
        listener = newListener;
    }
}
