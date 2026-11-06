package com.mk8dx.mobileocr;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import org.json.JSONArray;
import org.json.JSONObject;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.geometry.Geometry;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfPoint2f;
import org.opencv.core.Point;
import org.opencv.core.Rect;
import org.opencv.core.Scalar;
import org.opencv.imgcodecs.Imgcodecs;
import org.opencv.imgproc.Imgproc;

import nl.mariokart8.iconmatcher.CardQuad;
import nl.mariokart8.iconmatcher.CardQuad.Line;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public class OfflineParityNativePipeline {
    private static final double HOUGH_MIN_LINE_LENGTH_PX = CardQuad.HOUGH_MIN_LINE_LENGTH_PX;
    private static final double ANGLE_FILTER_SHORT_LINE_MIN_LENGTH_PX = CardQuad.SHORT_LINE_MIN_LENGTH_PX;

    private static final String ACCEPTED_EVIDENCE = "native_dynamic_refined_slot_details_equivalent";
    private static final String DIAGNOSTIC_EVIDENCE = "fixed_grid_exported_segment_evidence";
    private static final double[] CANONICAL_PLAYER_BOX_RACE7 = new double[]{548.0, 362.0, 1231.0, 661.0};
    private static final double[] CANONICAL_GHOST_BOX_RACE7 = new double[]{548.0, 42.0, 1231.0, 349.0};
    private final JSONObject relGrid;
    private final SegmentTemplate lapTemplate;
    private final SegmentTemplate totalTemplate;
    private final StageProgress progress;
    private final String stopAfterStage;
    private final boolean suppressVisualArtifacts;
    private KartConfigMatcher kartConfigMatcher;
    private boolean identityOnly = false;
    // Scanner-layout: "endscreen" (origineel, speler+ghost-kaarten) of
    // "ghost_detail" (Select-a-Ghost detailpaneel, één rijder). Zie
    // docs/scanner-layouts.md. Alle ghost_detail-vertakkingen zijn no-ops
    // voor de standaard "endscreen"-route.
    private String layoutProfile = LAYOUT_ENDSCREEN;

    public static final String LAYOUT_ENDSCREEN = "endscreen";
    public static final String LAYOUT_GHOST_DETAIL = "ghost_detail";
    // Canonieke targetboxen voor ghost_detail: de badge-center/rowGap-
    // geprojecteerde ROI (AutoCardRoiSelector.selectGhostDetail) wordt hierop
    // gepind; maat zo gekozen dat de 7-seg-glyphs op de canonieke celmaten
    // (lap 19x27, totaal 22x33) landen. Gekalibreerd op de native
    // 1920x1080-referentiebeelden; wijzigt een box, dan moet
    // grid/ghost_detail_relative_grid.json mee (zie docs/scanner-layouts.md).
    private static final double[] CANONICAL_GHOST_DETAIL_BOX_RACE3 = new double[]{540.0, 170.0, 782.0, 331.0};
    private static final double[] CANONICAL_GHOST_DETAIL_BOX_RACE7 = new double[]{540.0, 120.0, 767.0, 379.0};

    /** Optionele identiteits-matcher (node 27, fase 1); null = stage wordt overgeslagen. */
    public OfflineParityNativePipeline withKartConfigMatcher(KartConfigMatcher matcher) {
        this.kartConfigMatcher = matcher;
        return this;
    }

    private nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader sharedFieldReader;

    /**
     * The shared field decision (packages/icon-matcher) supplies the visible
     * result-card fields; null keeps the engine's own decision (pack absent,
     * or switched off). Ghost Select panels keep the engine's decision.
     */
    public OfflineParityNativePipeline withSharedFieldReader(
            nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader reader) {
        this.sharedFieldReader = reader;
        return this;
    }

    /** Scanner-layout: LAYOUT_ENDSCREEN (default) of LAYOUT_GHOST_DETAIL. */
    public OfflineParityNativePipeline withLayout(String layoutProfile) {
        this.layoutProfile = LAYOUT_GHOST_DETAIL.equals(layoutProfile) ? LAYOUT_GHOST_DETAIL : LAYOUT_ENDSCREEN;
        return this;
    }

    private boolean isGhostDetail() {
        return LAYOUT_GHOST_DETAIL.equals(layoutProfile);
    }

    /** Identity-only: na node 21 direct node 27 draaien, 7-segment (24/26) overslaan —
     *  voor extra identiteits-stemframes ná een tijden-lock (gebruikersidee 2026-07-16). */
    public OfflineParityNativePipeline withIdentityOnly(boolean identityOnly) {
        this.identityOnly = identityOnly;
        return this;
    }

    private java.util.List<RfDetrDetector.Detection> roiDetections;
    private int roiFrameWidth;
    private int roiFrameHeight;

    /** Step-01-detecties hergebruiken voor node 19 (two-phase wall-clock-fix):
     *  de boxen worden per seed door warp+align naar canonieke coördinaten
     *  getransformeerd i.p.v. een tweede RF-DETR-inferentie (~0,9s/seed). */
    public OfflineParityNativePipeline withRoiDetections(java.util.List<RfDetrDetector.Detection> detections, int frameWidth, int frameHeight) {
        this.roiDetections = detections;
        this.roiFrameWidth = frameWidth;
        this.roiFrameHeight = frameHeight;
        return this;
    }

    public interface StageProgress {
        void stageStarted(String stage) throws Exception;
        void stageCompleted(String stage) throws Exception;
    }

    public OfflineParityNativePipeline() {
        this(null, null, null, null, "");
    }

    public OfflineParityNativePipeline(JSONObject relGrid) {
        this(relGrid, null, null, null, "");
    }

    public OfflineParityNativePipeline(JSONObject relGrid, SegmentTemplate lapTemplate, SegmentTemplate totalTemplate) {
        this(relGrid, lapTemplate, totalTemplate, null, "");
    }

    public OfflineParityNativePipeline(JSONObject relGrid, SegmentTemplate lapTemplate, SegmentTemplate totalTemplate, StageProgress progress, String stopAfterStage) {
        this(relGrid, lapTemplate, totalTemplate, progress, stopAfterStage, false);
    }

    public OfflineParityNativePipeline(JSONObject relGrid, SegmentTemplate lapTemplate, SegmentTemplate totalTemplate, StageProgress progress, String stopAfterStage, boolean suppressVisualArtifacts) {
        this.relGrid = relGrid;
        this.lapTemplate = lapTemplate;
        this.totalTemplate = totalTemplate;
        this.progress = progress;
        this.stopAfterStage = stopAfterStage == null ? "" : stopAfterStage;
        this.suppressVisualArtifacts = suppressVisualArtifacts;
    }

    public Result run(
            File imageDir,
            Bitmap sourceBitmap,
            AutoCardRoiSelector.Box roiBox,
            AutoCardRoiSelector.Selection roiSelection,
            RfDetrDetector detector,
            Mat fullBgr,
            Mat adjusted,
            Mat hsvMask,
            Mat adaptive
    ) throws Exception {
        Result result = new Result();
        File workflowDir = new File(imageDir, "workflow_steps");
        workflowDir.mkdirs();

        Mat combined = new Mat();
        Mat cleaned = new Mat();
        Mat morphology = new Mat();
        Mat edges = new Mat();
        Mat warp = new Mat();
        Mat canonical = new Mat();
        try {
            Core.bitwise_and(hsvMask, adaptive, combined);
            stageStarted("07_FlowJoin");
            writeFlowJoin(imageDir, workflowDir, adjusted, hsvMask, adaptive, result);
            stageCompleted("07_FlowJoin");
            if (stopAfterStage("07")) {
                return result;
            }
            stageStarted("08_MaskCombine");
            writeMaskStage(imageDir, workflowDir, "08", "MaskCombine", "08_mask_combine.png", "08_mask_combine_stats.json", combined, result);
            stageCompleted("08_MaskCombine");
            if (stopAfterStage("08")) {
                return result;
            }

            stageStarted("09_MaskCleanup");
            cleaned = cleanupMask(combined);
            JSONObject cleanupMeta = maskStats(cleaned, "09_mask_cleanup.png")
                    .put("cleanup_operations_used", new JSONArray().put("otsu_threshold").put("remove_components_below_min_area").put("guarded_hole_fill"))
                    .put("cleanup_parameters_used", new JSONObject().put("min_area", 80).put("keep_largest", false).put("max_fill_coverage", 0.85));
            writeMaskStage(imageDir, workflowDir, "09", "MaskCleanup", "09_mask_cleanup.png", "09_mask_cleanup_stats.json", cleaned, cleanupMeta, result);
            stageCompleted("09_MaskCleanup");
            if (stopAfterStage("09")) {
                return result;
            }

            stageStarted("10_Morphology");
            Mat kernel = Imgproc.getStructuringElement(Imgproc.MORPH_RECT, new org.opencv.core.Size(8, 8));
            Imgproc.morphologyEx(cleaned, morphology, Imgproc.MORPH_CLOSE, kernel, new Point(-1, -1), 4);
            kernel.release();
            writeMaskStage(imageDir, workflowDir, "10", "Morphology", "10_morphology.png", "10_morphology_stats.json", morphology, result);
            stageCompleted("10_Morphology");
            if (stopAfterStage("10")) {
                return result;
            }

            stageStarted("11_CannyEdges");
            Imgproc.Canny(morphology, edges, 35, 120);
            writeMaskStage(imageDir, workflowDir, "11", "CannyEdges", "11_canny_edges.png", "11_canny_edges_stats.json", edges, result);
            stageCompleted("11_CannyEdges");
            if (stopAfterStage("11")) {
                return result;
            }

            stageStarted("12_HoughLinesP");
            List<Line> lines = houghLines(edges);
            JSONObject houghMeta = new JSONObject()
                    .put("min_line_length_px", HOUGH_MIN_LINE_LENGTH_PX)
                    .put("filter_policy", "permissive_hough_detection_short_line_guard_applied_at_step13");
            writeLineStage(imageDir, workflowDir, "12", "HoughLinesP", "12_hough_lines_p.json", "12_hough_lines_p_overlay.png", morphology, lines, result, houghMeta);
            stageCompleted("12_HoughLinesP");
            if (stopAfterStage("12")) {
                return result;
            }

            stageStarted("13_AngleFilterLines");
            List<Line> axisFiltered = filterAngles(lines);
            ShortLineGuardResult lineGuard = applyShortLineGuard(axisFiltered);
            writeLineStage(imageDir, workflowDir, "13", "AngleFilterLines", "13_angle_filter_lines.json", "13_angle_filter_lines_overlay.png", adjusted, lineGuard.lines, result, lineGuard.toJson());
            stageCompleted("13_AngleFilterLines");
            if (stopAfterStage("13")) {
                return result;
            }

            stageStarted("14_ClusterLines");
            List<Line> clusters = clusterLines(lineGuard.lines);
            JSONObject clusterMeta = new JSONObject()
                    .put("source_stage", "13_AngleFilterLines")
                    .put("short_line_guard_used", lineGuard.guardUsed)
                    .put("short_line_guard_fallback_used", lineGuard.fallbackUsed)
                    .put("short_line_min_length_px", ANGLE_FILTER_SHORT_LINE_MIN_LENGTH_PX);
            writeLineStage(imageDir, workflowDir, "14", "ClusterLines", "14_cluster_lines.json", "14_cluster_lines_overlay.png", adjusted, clusters, result, clusterMeta);
            stageCompleted("14_ClusterLines");
            if (stopAfterStage("14")) {
                return result;
            }

            // === Localize + read met staged quad-seed retry (port van node-27 guide-first) ===
            // Seed 1 = geometrische quad (mask/hough). Seed 2 = ROI-box guide-seed: de kaart
            // is uitgelijnd met de cyan grid-gids, dus de volledige ROI is een betrouwbare
            // re-seed. Server-side redt dit sand-levels + scheve frames door bij een falende
            // read opnieuw te warpen vanaf een andere quad tot de grid/lap-som sluit. We
            // proberen de seeds op volgorde en houden de eerste die een leesbare grid geeft.
            // ghost_detail: de gele-kaart-maskerketen levert hier geen bruikbare
            // quad (het paneel is niet geel) en een gedeeltelijke sub-quad (bv.
            // de binnenste tijdenbox) zou de canonieke pinning verstoren. De
            // badge-geprojecteerde ROI is de deterministische en enige seed;
            // stage 18 pint hem exact op CANONICAL_GHOST_DETAIL_BOX.
            Quad geometricQuad = isGhostDetail() ? null : selectQuad(cleaned, clusters);
            List<Quad> seedQuads = new ArrayList<>();
            List<String> seedNames = new ArrayList<>();
            if (geometricQuad != null) {
                seedQuads.add(geometricQuad);
                seedNames.add("geometric_quad");
            }
            AutoCardRoiSelector.Box playerOwnerBox = roiSelection == null || isGhostDetail() ? null : roiSelection.playerOwnerBox;
            if (playerOwnerBox != null) {
                // RF-DETR-spelerbox als quad-seed: node 18 pint de quad-bounding-box op de
                // canonieke spelerkaart-positie en de detectorbox IS de gele kaart, terwijl de
                // lap-index-geprojecteerde ROI de kaartrand kan afsnijden (live blocked-op-21,
                // 2026-07-16: ROI tot x=601 waar de kaart tot x=805 liep -> alles ~150px off-pin).
                // Seeds leven in ROI-crop-coördinaten; stage 16 schuift ze terug naar full-frame,
                // dus de spelerbox mag buiten de crop uitsteken.
                seedQuads.add(new Quad(
                        new Point(playerOwnerBox.left - roiBox.left, playerOwnerBox.top - roiBox.top),
                        new Point(playerOwnerBox.right - roiBox.left, playerOwnerBox.top - roiBox.top),
                        new Point(playerOwnerBox.right - roiBox.left, playerOwnerBox.bottom - roiBox.top),
                        new Point(playerOwnerBox.left - roiBox.left, playerOwnerBox.bottom - roiBox.top)));
                seedNames.add("player_owner_box_seed");
            }
            // MK8DX ecosystem overlay (ADR-0203): een telefoonfoto is zelden
            // waterpas en de badge-ROI hieronder is as-parallel, dus een paneel
            // dat 1-2 graden gedraaid is duwt de rechter cijfers uit hun slots.
            // De badge-kolom meet de draaiing; deze seed warpt het gedraaide
            // paneel eerst rechtop op dezelfde ROI-rechthoek. Leest hij niet,
            // dan volgen de bestaande seeds ongewijzigd.
            double[] deskewDegrees = new double[1];
            Quad deskewQuad = isGhostDetail() ? ghostDetailDeskewSeed(roiSelection, roiBox, adjusted.cols(), adjusted.rows(), deskewDegrees) : null;
            if (deskewQuad != null) {
                seedQuads.add(deskewQuad);
                seedNames.add(GHOST_DETAIL_DESKEW_SEED);
            }
            seedQuads.add(quadFromRect(new Rect(0, 0, adjusted.cols(), adjusted.rows())));
            seedNames.add("roi_box_guide_seed");
            // ghost_detail reserve-hypothese: bij ontbrekende randbadges kan het
            // badge-rooster ook onder-uitgelijnd zijn (ontbrekende rijen bovenaan);
            // de altRoi-seed probeert die pinning als de primaire read faalt.
            // Seeds leven in ROI-crop-coördinaten en mogen buiten de crop uitsteken.
            AutoCardRoiSelector.Box ghostDetailAltRoi = isGhostDetail() && roiSelection != null && roiSelection.candidate != null
                    ? roiSelection.candidate.altRoi
                    : null;
            if (ghostDetailAltRoi != null) {
                seedQuads.add(new Quad(
                        new Point(ghostDetailAltRoi.left - roiBox.left, ghostDetailAltRoi.top - roiBox.top),
                        new Point(ghostDetailAltRoi.right - roiBox.left, ghostDetailAltRoi.top - roiBox.top),
                        new Point(ghostDetailAltRoi.right - roiBox.left, ghostDetailAltRoi.bottom - roiBox.top),
                        new Point(ghostDetailAltRoi.left - roiBox.left, ghostDetailAltRoi.bottom - roiBox.top)));
                seedNames.add("ghost_detail_alt_span_seed");
            }

            boolean readOk = false;
            int firstReadableSeed = -1;
            boolean firstReadableRerun = false;
            for (int seedIdx = 0; seedIdx < seedQuads.size(); seedIdx++) {
            boolean finalAttempt = (seedIdx == seedQuads.size() - 1) || firstReadableRerun;
            Quad roiQuad = seedQuads.get(seedIdx);
            String seedName = seedNames.get(seedIdx);

            stageStarted("15_QuadSelect");
            result.mark("15_QuadSelect", "geometric_quad".equals(seedName) ? "implemented" : seedName);
            writeQuadStage(imageDir, workflowDir, "15", "QuadSelect", "15_quad_select.json", "15_quad_select_overlay.png", adjusted, roiQuad, result);
            stageCompleted("15_QuadSelect");
            if (stopAfterStage("15")) {
                return result;
            }

            stageStarted("16_RoiRestore");
            Quad fullQuad = roiQuad.shifted(roiBox.left, roiBox.top);
            writeQuadStage(imageDir, workflowDir, "16", "RoiRestore", "16_roi_restore.json", "16_roi_restore_overlay.png", fullBgr, fullQuad, result);
            stageCompleted("16_RoiRestore");
            if (stopAfterStage("16")) {
                return result;
            }

            stageStarted("17_PerspectiveWarp");
            // De rechtzet-seed landt op de rechtopstaande ROI-rechthoek zelf, zodat
            // stage 18 precies pint wat de as-parallelle seed gepind zou hebben.
            Rect warpDestinationBounds = GHOST_DETAIL_DESKEW_SEED.equals(seedName)
                    ? boundingRect(quadFromRect(new Rect(0, 0, adjusted.cols(), adjusted.rows())).shifted(roiBox.left, roiBox.top), fullBgr.cols(), fullBgr.rows())
                    : boundingRect(fullQuad, fullBgr.cols(), fullBgr.rows());
            Quad warpDestinationQuad = quadFromRect(warpDestinationBounds);
            if (!warp.empty()) {
                warp.release();
            }
            warp = warpFullImageTransform(fullBgr, fullQuad, warpDestinationBounds);
            writeMatImage(new File(imageDir, "17_perspective_warp.png"), warp);
            writeMatImage(new File(workflowDir, "17_PerspectiveWarp.png"), warp);
            JSONObject warpGeometry = quadGeometry("17_PerspectiveWarp", fullQuad, fullBgr.cols(), fullBgr.rows(), "native_android_buildable_pending_device")
                    .put("warp_mode", "Full image transform")
                    .put("warp_source_quad", fullQuad.toJson())
                    .put("warp_destination_quad", warpDestinationQuad.toJson())
                    .put("warp_output_size", new JSONArray().put(fullBgr.cols()).put(fullBgr.rows()))
                    .put("seed", seedName)
                    .put("ghost_detail_deskew_degrees", GHOST_DETAIL_DESKEW_SEED.equals(seedName) ? deskewDegrees[0] : 0.0);
            writeJson(new File(imageDir, "17_perspective_warp_geometry.json"), warpGeometry);
            writeJson(new File(workflowDir, "17_PerspectiveWarp.json"), warpGeometry);
            result.mark("17_PerspectiveWarp", "implemented");
            stageCompleted("17_PerspectiveWarp");
            if (stopAfterStage("17")) {
                return result;
            }

            stageStarted("18_CanonicalPlayerBoxAlign");
            CanonicalAlignResult alignResult = canonicalPlayerBoxAlign(warp, warpDestinationQuad, roiSelection);
            if (!canonical.empty()) {
                canonical.release();
            }
            canonical = alignResult.image;
            // ÉÉN-resample-canonical: componeer align(2D-affine) x 17-homografie
            // en warp direct vanaf het RAUWE frame (INTER_CUBIC). De dubbele
            // INTER_LINEAR-resample waste iconen uit (inkling->birdo op de
            // waarheid-positie); geometrie is byte-gelijk aan de twee stappen.
            if (lastPerspectiveHomography != null) {
                Mat affine3 = Mat.eye(3, 3, CvType.CV_64F);
                affine3.put(0, 0, alignResult.scaleX, 0.0, alignResult.translateX,
                        0.0, alignResult.scaleY, alignResult.translateY,
                        0.0, 0.0, 1.0);
                Mat composed = new Mat();
                Core.gemm(affine3, lastPerspectiveHomography, 1.0, new Mat(), 0.0, composed);
                Mat singlePass = new Mat();
                // MK8DX ecosystem overlay (ADR-0203): een 12 MP-camerafoto laat
                // deze warp 4x of meer verkleinen, en bilineair bemonsteren slaat
                // dan de meeste pixels over (aliasing breekt de dunne naden tussen
                // segmenten). Eerst middelend (INTER_AREA) verkleinen tot de warp
                // nog ANTIALIAS_TARGET_SCALE overhoudt; de homografie schaalt mee,
                // dus de geometrie is gelijk. Inputs in het gevalideerde bereik
                // (warp >= ANTIALIAS_BELOW_SCALE) blijven byte-gelijk.
                Mat warpSource = fullBgr;
                Mat reduced = null;
                double shrink = Math.min(alignResult.scaleX, alignResult.scaleY);
                if (shrink > 0.0 && shrink < ANTIALIAS_BELOW_SCALE) {
                    double factor = shrink / ANTIALIAS_TARGET_SCALE;
                    int reducedW = Math.max(1, (int) Math.round(fullBgr.cols() * factor));
                    int reducedH = Math.max(1, (int) Math.round(fullBgr.rows() * factor));
                    reduced = new Mat();
                    Imgproc.resize(fullBgr, reduced, new org.opencv.core.Size(reducedW, reducedH), 0, 0, Imgproc.INTER_AREA);
                    Mat unscale = Mat.eye(3, 3, CvType.CV_64F);
                    unscale.put(0, 0, fullBgr.cols() / (double) reducedW, 0.0, 0.0,
                            0.0, fullBgr.rows() / (double) reducedH, 0.0,
                            0.0, 0.0, 1.0);
                    Mat rescaled = new Mat();
                    Core.gemm(composed, unscale, 1.0, new Mat(), 0.0, rescaled);
                    composed.release();
                    unscale.release();
                    composed = rescaled;
                    warpSource = reduced;
                    lastAntialiasFactor = factor;
                } else {
                    lastAntialiasFactor = 1.0;
                }
                // LINEAR: cubic gaf ringing op 7-seg-digits (tijden 100->99,1%)
                Imgproc.warpPerspective(warpSource, singlePass, composed,
                        new org.opencv.core.Size(canonical.cols(), canonical.rows()),
                        Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE);
                // MK8DX ecosystem overlay (ADR-0203): het Select-a-Ghost-paneel
                // op de schone opname leggen via zijn vaste delen (':' '.', badges,
                // X, vergrootglas), en de canonical een keer opnieuw renderen.
                ghostRegistration = null;
                lastGhostRegistration = null;
                if (isGhostDetail()) {
                    Mat registration = ghostPanelRegistration(singlePass, alignResult.raceKey);
                    if (registration != null) {
                        Mat registered = new Mat();
                        Core.gemm(registration, composed, 1.0, new Mat(), 0.0, registered);
                        composed.release();
                        composed = registered;
                        ghostRegistration = new double[9];
                        registration.get(0, 0, ghostRegistration);
                        registration.release();
                        Imgproc.warpPerspective(warpSource, singlePass, composed,
                                new org.opencv.core.Size(canonical.cols(), canonical.rows()),
                                Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE);
                    }
                }
                if (reduced != null) {
                    reduced.release();
                }
                affine3.release();
                composed.release();
                canonical.release();
                canonical = singlePass;
            }
            writeMatImage(new File(imageDir, "18_canonical_player_box_align.png"), canonical);
            writeMatImage(new File(workflowDir, "18_CanonicalPlayerBoxAlign.png"), canonical);
            writeJson(new File(imageDir, "18_canonical_player_box_align_geometry.json"), new JSONObject()
                    .put("stage", "18_CanonicalPlayerBoxAlign")
                    .put("implementation_mode", "native_android_buildable_pending_device")
                    .put("alignment_method", "Scale + Translate")
                    .put("target_owner", "auto_yellow_slot")
                    .put("target_owner_used", alignResult.targetOwnerUsed)
                    .put("canonical_race_key", alignResult.raceKey)
                    .put("race_profile_source", alignResult.raceProfileSource)
                    .put("target_box_source", alignResult.targetBoxSource)
                    .put("step01_lap_profile_evidence", alignResult.step01LapProfileEvidence)
                    .put("yellow_player_slot", alignResult.yellowPosition)
                    .put("yellow_scores", alignResult.yellowScores)
                    .put("current_box", alignResult.currentBox.toJson())
                    .put("target_box", alignResult.targetBox.toJson())
                    .put("scale_x", alignResult.scaleX)
                    .put("scale_y", alignResult.scaleY)
                    .put("antialias_factor", lastPerspectiveHomography != null ? lastAntialiasFactor : 1.0)
                    .put("ghost_panel_registration", lastGhostRegistration == null ? JSONObject.NULL : lastGhostRegistration)
                    .put("matrix", alignResult.matrixJson())
                    .put("output_width", canonical.cols())
                    .put("output_height", canonical.rows())
                    .put("coordinate_space", "player_card_crop")
                    .put("no_runtime_label_fallback", true));
            writeJson(new File(workflowDir, "18_CanonicalPlayerBoxAlign.json"), new JSONObject()
                    .put("stage", "18_CanonicalPlayerBoxAlign")
                    .put("status", "implemented")
                    .put("implementation_mode", "native_android_buildable_pending_device"));
            result.mark("18_CanonicalPlayerBoxAlign", "implemented");
            stageCompleted("18_CanonicalPlayerBoxAlign");
            if (stopAfterStage("18")) {
                return result;
            }

            // MK8DX ecosystem overlay: a registered Select-a-Ghost panel places its
            // lap circles itself, every time slot at its reference position (as Web).
            registeredGhostGrid = ghostRegistration != null && isGhostDetail();
            RfDetrDetector.DetectionResult reusedDetections = registeredGhostGrid
                    ? registeredLapIndexDetections(alignResult.raceKey, canonical.cols(), canonical.rows())
                    : transformRoiDetections(fullQuad, warpDestinationQuad, alignResult, canonical.cols(), canonical.rows());
            strictSeedAttempt = GHOST_DETAIL_DESKEW_SEED.equals(seedName);
            readOk = runLateStages(imageDir, workflowDir, sourceBitmap, canonical, detector, result, alignResult.raceKey, finalAttempt, reusedDetections);
            strictSeedAttempt = false;
            // MK8DX ecosystem overlay (ADR-0203): Web strictLapSumSeedCandidate.
            if (readOk && SCAN_TIME_CHECKS && lastSeedTimeRead && !firstReadableRerun && !Boolean.TRUE.equals(lastSeedLapSumOk)) {
                if (!finalAttempt) {
                    if (firstReadableSeed < 0) firstReadableSeed = seedIdx;
                    DebugConsole.log("SEED", "[" + imageDir.getName() + "] seed '" + seedName + "' leesbaar maar lap-som open, volgende seed");
                    continue;
                }
                if (firstReadableSeed >= 0) {
                    firstReadableRerun = true;
                    seedIdx = firstReadableSeed - 1;
                    continue;
                }
            }
            if (readOk) {
                result.mark("localization_seed_used", seedName);
                DebugConsole.log("SEED", "[" + imageDir.getName() + "] leesbare grid via seed '" + seedName + "'");
                break;
            }
            if (!finalAttempt) {
                DebugConsole.log("SEED", "[" + imageDir.getName() + "] seed '" + seedName + "' gaf geen leesbare grid, volgende seed");
            }
            }
            return result;
        } finally {
            combined.release();
            cleaned.release();
            morphology.release();
            edges.release();
            warp.release();
            canonical.release();
        }
    }

    private void writeFlowJoin(File imageDir, File workflowDir, Mat adjusted, Mat hsvMask, Mat adaptive, Result result) throws Exception {
        Mat preview = flowJoinPreview(adjusted, hsvMask, adaptive);
        writeMatImage(new File(imageDir, "07_flow_join.png"), preview);
        writeMatImage(new File(workflowDir, "07_FlowJoin.png"), preview);
        preview.release();
        JSONObject root = new JSONObject()
                .put("stage", "07_FlowJoin")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("input_count", 2)
                .put("inputs", new JSONArray().put("03_HSVMask").put("06_AdaptiveThreshold"))
                .put("output", "07_flow_join.png")
                .put("visualization", "ROI-sized workflow composite: darkened AutoBrightnessContrast base with HSV/adaptive mask overlays")
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "07_flow_join_stats.json"), root);
        writeJson(new File(workflowDir, "07_FlowJoin.json"), root);
        result.mark("07_FlowJoin", "implemented");
    }

    private Mat flowJoinPreview(Mat adjusted, Mat hsvMask, Mat adaptive) {
        Mat base = new Mat();
        Mat zero = new Mat();
        Mat preview = new Mat();
        Mat color = new Mat();
        Mat blended = new Mat();
        try {
            if (adjusted.channels() == 3) {
                adjusted.copyTo(base);
            } else {
                Imgproc.cvtColor(adjusted, base, Imgproc.COLOR_GRAY2BGR);
            }
            zero = Mat.zeros(base.rows(), base.cols(), base.type());
            Core.addWeighted(base, 0.45, zero, 0.55, 0.0, preview);
            overlayFlowJoinMask(preview, hsvMask, new Scalar(80, 255, 130), color, blended);
            overlayFlowJoinMask(preview, adaptive, new Scalar(255, 112, 166), color, blended);
            Imgproc.putText(preview, "FlowJoin mask composite | inputs=2 masks=2", new Point(12, 28), Imgproc.FONT_HERSHEY_SIMPLEX, 0.62, new Scalar(255, 212, 59), 2, Imgproc.LINE_AA);
            return preview.clone();
        } finally {
            base.release();
            zero.release();
            color.release();
            blended.release();
            preview.release();
        }
    }

    private void overlayFlowJoinMask(Mat preview, Mat mask, Scalar bgr, Mat color, Mat blended) {
        color.create(preview.rows(), preview.cols(), preview.type());
        color.setTo(bgr);
        Core.addWeighted(preview, 0.35, color, 0.65, 0.0, blended);
        blended.copyTo(preview, mask);
    }

    private Mat cleanupMask(Mat input) {
        Mat binary = new Mat();
        Mat labels = new Mat();
        Mat stats = new Mat();
        Mat centroids = new Mat();
        Mat cleaned = Mat.zeros(input.rows(), input.cols(), CvType.CV_8UC1);
        try {
            Imgproc.threshold(input, binary, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
            int count = Imgproc.connectedComponentsWithStats(binary, labels, stats, centroids);
            for (int i = 1; i < count; i++) {
                double[] areaValues = stats.get(i, Imgproc.CC_STAT_AREA);
                int area = areaValues == null ? 0 : (int) areaValues[0];
                if (area < 80) {
                    continue;
                }
                Mat component = new Mat();
                Core.compare(labels, new Scalar(i), component, Core.CMP_EQ);
                Core.bitwise_or(cleaned, component, cleaned);
                component.release();
            }
            Mat holes = fillHoles(cleaned);
            double fillCoverage = Core.countNonZero(holes) / Math.max(1.0, holes.rows() * holes.cols());
            if (fillCoverage <= 0.85) {
                holes.copyTo(cleaned);
            }
            holes.release();
            return cleaned.clone();
        } finally {
            binary.release();
            labels.release();
            stats.release();
            centroids.release();
            cleaned.release();
        }
    }

    private Mat fillHoles(Mat mask) {
        Mat flood = mask.clone();
        Mat floodMask = Mat.zeros(mask.rows() + 2, mask.cols() + 2, CvType.CV_8UC1);
        Mat inverted = new Mat();
        Mat filled = new Mat();
        try {
            Imgproc.floodFill(flood, floodMask, new Point(0, 0), new Scalar(255));
            Core.bitwise_not(flood, inverted);
            Core.bitwise_or(mask, inverted, filled);
            return filled.clone();
        } finally {
            flood.release();
            floodMask.release();
            inverted.release();
            filled.release();
        }
    }

    private List<Line> houghLines(Mat edges) {
        Mat raw = new Mat();
        Mat lineRows = null;
        List<Line> lines = new ArrayList<>();
        try {
            Imgproc.HoughLinesP(edges, raw, 1.0, Math.PI / 180.0, 35, HOUGH_MIN_LINE_LENGTH_PX, 22.0);
            if (raw.empty()) {
                return lines;
            }
            lineRows = raw.reshape(4, (int) raw.total());
            for (int i = 0; i < lineRows.rows(); i++) {
                double[] values = lineRows.get(i, 0);
                if (values != null && values.length >= 4) {
                    lines.add(new Line(values[0], values[1], values[2], values[3]));
                }
            }
            return lines;
        } finally {
            if (lineRows != null) {
                lineRows.release();
            }
            raw.release();
        }
    }

    private double distance(Point a, Point b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    // laatst gebruikte 17-homografie: node 18 composeert hiermee tot ÉÉN
    // resample vanaf het rauwe frame (dubbel INTER_LINEAR waste iconen uit —
    // canonical@waarheid flipte inkling->birdo, parity-benchmark 2026-07-17)
    private Mat lastPerspectiveHomography;

    private Mat warpFullImageTransform(Mat source, Quad quad, Rect bounds) {
        Mat src = new MatOfPoint2f(quad.points());
        Mat dst = new MatOfPoint2f(
                new Point(bounds.x, bounds.y),
                new Point(bounds.x + bounds.width - 1, bounds.y),
                new Point(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1),
                new Point(bounds.x, bounds.y + bounds.height - 1)
        );
        Mat homography = new Mat();
        Mat warped = new Mat();
        try {
            homography = Geometry.getPerspectiveTransform((MatOfPoint2f) src, (MatOfPoint2f) dst);
            if (lastPerspectiveHomography != null) {
                lastPerspectiveHomography.release();
            }
            lastPerspectiveHomography = homography.clone();
            Imgproc.warpPerspective(source, warped, homography, new org.opencv.core.Size(source.cols(), source.rows()), Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE);
            return warped.clone();
        } finally {
            src.release();
            dst.release();
            homography.release();
            warped.release();
        }
    }

    private Rect boundingRect(Quad quad, int width, int height) {
        Point[] points = quad.points();
        double minX = Double.MAX_VALUE;
        double minY = Double.MAX_VALUE;
        double maxX = -Double.MAX_VALUE;
        double maxY = -Double.MAX_VALUE;
        for (Point point : points) {
            minX = Math.min(minX, point.x);
            minY = Math.min(minY, point.y);
            maxX = Math.max(maxX, point.x);
            maxY = Math.max(maxY, point.y);
        }
        int x = Math.max(0, Math.min(width - 1, (int) Math.floor(minX)));
        int y = Math.max(0, Math.min(height - 1, (int) Math.floor(minY)));
        int right = Math.max(x + 1, Math.min(width, (int) Math.ceil(maxX)));
        int bottom = Math.max(y + 1, Math.min(height, (int) Math.ceil(maxY)));
        return new Rect(x, y, right - x, bottom - y);
    }

    // Onder deze warp-schaal eerst middelend verkleinen, tot de warp deze schaal overhoudt.
    private static final double ANTIALIAS_BELOW_SCALE = 0.5;
    private static final double ANTIALIAS_TARGET_SCALE = 0.8;
    private double lastAntialiasFactor = 1.0;
    // Zolang de rechtzet-seed loopt: alleen een sluitende lap-som telt als read.
    private boolean strictSeedAttempt = false;
    /** Lap sum of the last late-stage seed read (before the time checks). */
    private Boolean lastSeedLapSumOk;
    private boolean lastSeedTimeRead;
    /** MK8DX ecosystem overlay (ADR-0203): the Web scanner's time checks. */
    static final boolean SCAN_TIME_CHECKS = true;

    private static final String GHOST_DETAIL_DESKEW_SEED = "ghost_detail_deskew_seed";

    // MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 5): the angle filter,
    // short-line guard, line clusters, quad choice and the ghost_detail deskew seed are the central
    // CardQuad (the same specification as the Web scanner and Python); this engine keeps the mask,
    // Hough and warp pixel work and its stage diagnostics.
    private List<Line> filterAngles(List<Line> lines) {
        return CardQuad.filterAngles(lines);
    }

    private List<Line> clusterLines(List<Line> lines) {
        return CardQuad.clusterLines(lines);
    }

    private ShortLineGuardResult applyShortLineGuard(List<Line> axisLines) {
        CardQuad.Guard guard = CardQuad.shortLineGuard(axisLines);
        return new ShortLineGuardResult(
                guard.lines,
                guard.guardUsed,
                guard.fallbackUsed,
                guard.guardUsed ? "kept_short_line_filtered_axis_lines"
                        : "fallback_preserved_axis_lines_because_short_line_filter_removed_required_hv_cluster_support",
                axisLines.size(),
                guard.lines.size(),
                axisLines.size() - guard.lines.size(),
                CardQuad.countOrientationClusters(guard.lines, true),
                CardQuad.countOrientationClusters(guard.lines, false));
    }

    private Quad selectQuad(Mat mask, List<Line> clusters) {
        double[][] q = CardQuad.selectQuad(mask.cols(), mask.rows(), clusters);
        return q == null ? null : new Quad(new Point(q[0][0], q[0][1]), new Point(q[1][0], q[1][1]),
                new Point(q[2][0], q[2][1]), new Point(q[3][0], q[3][1]));
    }

    /** The ghost_detail ROI seed turned with the panel (central CardQuad.ghostDetailDeskewSeed). */
    private Quad ghostDetailDeskewSeed(AutoCardRoiSelector.Selection selection, AutoCardRoiSelector.Box roiBox,
                                       int cropW, int cropH, double[] degreesOut) {
        if (selection == null || selection.detections == null) {
            return null;
        }
        List<double[]> lapIndex = new ArrayList<>();
        for (RfDetrDetector.Detection d : selection.detections) {
            if ("lap_index".equals(d.label)) {
                lapIndex.add(new double[]{d.left, d.top, d.right, d.bottom});
            }
        }
        CardQuad.Deskew seed = CardQuad.ghostDetailDeskewSeed(lapIndex, selection.frameWidth, selection.frameHeight,
                roiBox.left, roiBox.top, cropW, cropH);
        if (seed == null) {
            return null;
        }
        degreesOut[0] = seed.degrees;
        double[][] q = seed.quad;
        return new Quad(new Point(q[0][0], q[0][1]), new Point(q[1][0], q[1][1]),
                new Point(q[2][0], q[2][1]), new Point(q[3][0], q[3][1]));
    }

    private static JSONObject lineJson(Line line) throws Exception {
        JSONObject root = new JSONObject()
                .put("x1", line.x1)
                .put("y1", line.y1)
                .put("x2", line.x2)
                .put("y2", line.y2)
                .put("angle_deg", line.angleDeg())
                .put("length", line.workflowLen())
                .put("angle", Double.isNaN(line.angle) ? line.angleDeg() : line.angle)
                .put("support", line.support)
                .put("count", line.count);
        if ("x".equals(line.keyName) || "y".equals(line.keyName)) {
            root.put(line.keyName, Double.isNaN(line.keyValue)
                    ? ("x".equals(line.keyName) ? line.centerX() : line.centerY()) : line.keyValue);
        }
        return root;
    }

    private Quad quadFromRect(Rect rect) {
        return new Quad(
                new Point(rect.x, rect.y),
                new Point(rect.x + rect.width - 1, rect.y),
                new Point(rect.x + rect.width - 1, rect.y + rect.height - 1),
                new Point(rect.x, rect.y + rect.height - 1)
        );
    }

    private CanonicalAlignResult canonicalPlayerBoxAlign(Mat warp, Quad currentQuad, AutoCardRoiSelector.Selection roiSelection) throws Exception {
        // ghost_detail: geen gele kaart — geen yellow-scan (position=null houdt
        // polariteit en semantiek op "ghost"), vaste paneel-targetbox.
        YellowSlot yellow = isGhostDetail() ? new YellowSlot(null, 0.0, 0.0) : detectYellowPlayerSlot(warp);
        String owner = isGhostDetail() ? "ghost" : ("top".equals(yellow.position) ? "ghost" : "player");
        String raceKey = inferStep01RaceKey(roiSelection);
        TargetBox targetProfile = isGhostDetail()
                ? new TargetBox("race7".equals(raceKey) ? CANONICAL_GHOST_DETAIL_BOX_RACE7 : CANONICAL_GHOST_DETAIL_BOX_RACE3,
                        "fixed_ghost_detail_canonical_target_" + ("race7".equals(raceKey) ? "race7" : "race3"))
                : canonicalTargetBox(owner, raceKey);
        double[] target = targetProfile.box;
        String ownerUsed = isGhostDetail()
                ? "ghost_detail_single_panel"
                : ("top".equals(yellow.position) ? "ghost_positional_top" : "player_positional_bottom");
        BoxD currentBox = boxFromQuad(currentQuad);
        BoxD targetBox = new BoxD(target[0], target[1], target[2], target[3]);
        double sx = targetBox.width() / Math.max(1.0, currentBox.width());
        double sy = targetBox.height() / Math.max(1.0, currentBox.height());
        double tx = targetBox.left - currentBox.left * sx;
        double ty = targetBox.top - currentBox.top * sy;
        Mat matrix = new Mat(2, 3, CvType.CV_64F);
        Mat out = new Mat();
        try {
            matrix.put(0, 0, sx, 0.0, tx, 0.0, sy, ty);
            Imgproc.warpAffine(warp, out, matrix, new org.opencv.core.Size(1280, 720), Imgproc.INTER_LINEAR, Core.BORDER_REPLICATE);
            CanonicalAlignResult result = new CanonicalAlignResult();
            result.image = out.clone();
            result.currentBox = currentBox;
            result.targetBox = targetBox;
            result.scaleX = sx;
            result.scaleY = sy;
            result.translateX = tx;
            result.translateY = ty;
            result.yellowPosition = yellow.position;
            result.yellowScores = yellow.toJson();
            result.targetOwnerUsed = ownerUsed + "_" + raceKey;
            result.raceKey = raceKey;
            result.raceProfileSource = "step01_owner_lap_index_count";
            result.targetBoxSource = targetProfile.source;
            result.step01LapProfileEvidence = step01LapProfileEvidence(roiSelection, raceKey);
            return result;
        } finally {
            matrix.release();
            out.release();
        }
    }

    private String inferStep01RaceKey(AutoCardRoiSelector.Selection selection) {
        if (selection == null || selection.candidate == null) {
            return "race7";
        }
        AutoCardRoiSelector.Candidate candidate = selection.candidate;
        int selectedSupport = Math.max(candidate.lapIndexCount, Math.max(candidate.playerLapIndexCount, candidate.ghostLapIndexCount));
        int totalSupport = selection.counts == null ? 0 : selection.counts.lapIndexCount;
        if (selectedSupport >= 2 && selectedSupport <= 3 && totalSupport <= 8) {
            return "race3";
        }
        if (selectedSupport >= 5 || totalSupport >= 10) {
            return "race7";
        }
        return "race7";
    }

    private JSONObject step01LapProfileEvidence(AutoCardRoiSelector.Selection selection, String raceKey) throws Exception {
        JSONObject evidence = new JSONObject().put("inferred_race_key", raceKey);
        if (selection == null) {
            return evidence.put("selection_available", false);
        }
        evidence.put("selection_available", true);
        if (selection.counts != null) {
            evidence.put("step01_total_lap_index_count", selection.counts.lapIndexCount)
                    .put("step01_player_count", selection.counts.playerCount)
                    .put("step01_ghost_count", selection.counts.ghostCount);
        }
        if (selection.candidate != null) {
            evidence.put("selected_route", selection.candidate.selectedRoute)
                    .put("selected_lap_index_count", selection.candidate.lapIndexCount)
                    .put("player_lap_index_count", selection.candidate.playerLapIndexCount)
                    .put("ghost_lap_index_count", selection.candidate.ghostLapIndexCount);
        }
        return evidence.put("no_runtime_label_fallback", true);
    }

    private TargetBox canonicalTargetBox(String owner, String raceKey) {
        double[] race7 = "ghost".equals(owner) ? CANONICAL_GHOST_BOX_RACE7 : CANONICAL_PLAYER_BOX_RACE7;
        if (!"race3".equals(raceKey)) {
            return new TargetBox(race7, "fixed_race7_canonical_target");
        }
        BoxD race3Content = ownerContentExtent("race3", owner);
        BoxD race7Content = ownerContentExtent("race7", owner);
        if (race3Content == null || race7Content == null) {
            return new TargetBox(race7, "fallback_fixed_race7_missing_relative_grid_content_extent");
        }
        double leftMargin = race7Content.left - race7[0];
        double topMargin = race7Content.top - race7[1];
        double rightMargin = race7[2] - race7Content.right;
        double bottomMargin = race7[3] - race7Content.bottom;
        return new TargetBox(
                new double[]{
                        race3Content.left - leftMargin,
                        race3Content.top - topMargin,
                        race3Content.right + rightMargin,
                        race3Content.bottom + bottomMargin
                },
                "derived_from_race3_relative_grid_using_race7_card_content_margins"
        );
    }

    private BoxD ownerContentExtent(String raceKey, String owner) {
        JSONObject ownerGrid = ownerGridForRace(raceKey, owner);
        if (ownerGrid == null) {
            return null;
        }
        List<BoxD> boxes = new ArrayList<>();
        appendRelativeBoxes(ownerGrid, "lap_index_boxes_rel", boxes);
        appendRelativeBoxes(ownerGrid, "total_strip_rel", boxes);
        appendRelativeBoxes(ownerGrid, "lap_strips_rel", boxes);
        if (boxes.isEmpty()) {
            return null;
        }
        return union(boxes);
    }

    private void appendRelativeBoxes(JSONObject ownerGrid, String key, List<BoxD> boxes) {
        Object value = ownerGrid.opt(key);
        if (value instanceof JSONArray) {
            appendRelativeBoxArray(ownerGrid, (JSONArray) value, boxes);
        }
    }

    private void appendRelativeBoxArray(JSONObject ownerGrid, JSONArray arr, List<BoxD> boxes) {
        if (arr.length() == 4 && !(arr.opt(0) instanceof JSONArray)) {
            boxes.add(ownerAbsBox(ownerGrid, arr));
            return;
        }
        for (int i = 0; i < arr.length(); i++) {
            JSONArray child = arr.optJSONArray(i);
            if (child != null) {
                appendRelativeBoxArray(ownerGrid, child, boxes);
            }
        }
    }

    private BoxD boxFromQuad(Quad quad) {
        double left = Double.MAX_VALUE;
        double top = Double.MAX_VALUE;
        double right = -Double.MAX_VALUE;
        double bottom = -Double.MAX_VALUE;
        for (Point point : quad.points()) {
            left = Math.min(left, point.x);
            top = Math.min(top, point.y);
            right = Math.max(right, point.x);
            bottom = Math.max(bottom, point.y);
        }
        return new BoxD(left, top, right, bottom);
    }

    private YellowSlot detectYellowPlayerSlot(Mat bgr) {
        Mat hsv = new Mat();
        Mat lab = new Mat();
        try {
            Imgproc.cvtColor(bgr, hsv, Imgproc.COLOR_BGR2HSV);
            Imgproc.cvtColor(bgr, lab, Imgproc.COLOR_BGR2Lab);
            double top = yellowSlotScore(hsv, lab, 0.42, 0.06, 0.98, 0.50);
            double bottom = yellowSlotScore(hsv, lab, 0.42, 0.50, 0.98, 0.93);
            String position = null;
            if (Math.max(top, bottom) >= 0.08 && Math.abs(top - bottom) >= 0.04) {
                position = top > bottom ? "top" : "bottom";
            }
            return new YellowSlot(position, top, bottom);
        } finally {
            hsv.release();
            lab.release();
        }
    }

    private double yellowSlotScore(Mat hsv, Mat lab, double rx1, double ry1, double rx2, double ry2) {
        int x1 = Math.max(0, Math.min(hsv.cols() - 1, (int) Math.round(rx1 * hsv.cols())));
        int y1 = Math.max(0, Math.min(hsv.rows() - 1, (int) Math.round(ry1 * hsv.rows())));
        int x2 = Math.max(x1 + 1, Math.min(hsv.cols(), (int) Math.round(rx2 * hsv.cols())));
        int y2 = Math.max(y1 + 1, Math.min(hsv.rows(), (int) Math.round(ry2 * hsv.rows())));
        Mat hsvRoi = new Mat(hsv, new Rect(x1, y1, x2 - x1, y2 - y1));
        Mat labRoi = new Mat(lab, new Rect(x1, y1, x2 - x1, y2 - y1));
        Mat hsvMask = new Mat();
        Mat labMask = new Mat();
        Mat yellowMask = new Mat();
        try {
            int total = Math.max(1, hsvRoi.rows() * hsvRoi.cols());
            Core.inRange(hsvRoi, new Scalar(12, 35, 80), new Scalar(40, 255, 255), hsvMask);
            Core.inRange(labRoi, new Scalar(75, 0, 145), new Scalar(255, 255, 255), labMask);
            Core.bitwise_and(hsvMask, labMask, yellowMask);
            int count = Core.countNonZero(yellowMask);
            return count / (double) total;
        } finally {
            hsvRoi.release();
            labRoi.release();
            hsvMask.release();
            labMask.release();
            yellowMask.release();
        }
    }

    /** Full-frame step-01-detecties → canonieke coördinaten via de seed-quad-warp
     *  (homografie) + de scale/translate van node 18. Null als er geen detecties zijn. */
    private RfDetrDetector.DetectionResult transformRoiDetections(Quad fullQuad, Quad destQuad, CanonicalAlignResult align, int canonW, int canonH) {
        if (roiDetections == null || roiDetections.isEmpty() || roiFrameWidth <= 0 || roiFrameHeight <= 0 || align == null) {
            return null;
        }
        org.opencv.core.MatOfPoint2f src = new org.opencv.core.MatOfPoint2f(fullQuad.tl, fullQuad.tr, fullQuad.br, fullQuad.bl);
        org.opencv.core.MatOfPoint2f dst = new org.opencv.core.MatOfPoint2f(destQuad.tl, destQuad.tr, destQuad.br, destQuad.bl);
        Mat homography = Geometry.getPerspectiveTransform(src, dst);
        List<RfDetrDetector.Detection> out = new ArrayList<>();
        try {
            for (RfDetrDetector.Detection detection : roiDetections) {
                double x1 = detection.left * roiFrameWidth;
                double y1 = detection.top * roiFrameHeight;
                double x2 = detection.right * roiFrameWidth;
                double y2 = detection.bottom * roiFrameHeight;
                org.opencv.core.MatOfPoint2f corners = new org.opencv.core.MatOfPoint2f(
                        new Point(x1, y1), new Point(x2, y1), new Point(x2, y2), new Point(x1, y2));
                org.opencv.core.MatOfPoint2f warped = new org.opencv.core.MatOfPoint2f();
                Core.perspectiveTransform(corners, warped, homography);
                double minX = Double.MAX_VALUE;
                double minY = Double.MAX_VALUE;
                double maxX = -Double.MAX_VALUE;
                double maxY = -Double.MAX_VALUE;
                for (Point point : warped.toArray()) {
                    double cx = align.scaleX * point.x + align.translateX;
                    double cy = align.scaleY * point.y + align.translateY;
                    if (ghostRegistration != null) {
                        double[] r = ghostRegistration;
                        double w = r[6] * cx + r[7] * cy + r[8];
                        double rx = (r[0] * cx + r[1] * cy + r[2]) / w;
                        double ry = (r[3] * cx + r[4] * cy + r[5]) / w;
                        cx = rx;
                        cy = ry;
                    }
                    minX = Math.min(minX, cx);
                    minY = Math.min(minY, cy);
                    maxX = Math.max(maxX, cx);
                    maxY = Math.max(maxY, cy);
                }
                corners.release();
                warped.release();
                minX = Math.max(0.0, Math.min(canonW, minX));
                maxX = Math.max(0.0, Math.min(canonW, maxX));
                minY = Math.max(0.0, Math.min(canonH, minY));
                maxY = Math.max(0.0, Math.min(canonH, maxY));
                if (maxX - minX < 2.0 || maxY - minY < 2.0) {
                    continue;
                }
                out.add(new RfDetrDetector.Detection(detection.label, detection.score,
                        (float) (minX / canonW), (float) (minY / canonH),
                        (float) (maxX / canonW), (float) (maxY / canonH)));
            }
        } finally {
            src.release();
            dst.release();
            homography.release();
        }
        return out.isEmpty() ? null : new RfDetrDetector.DetectionResult(out, 0, 0, 0, 0, 0, 0);
    }

    private boolean runLateStages(File imageDir, File workflowDir, Bitmap sourceBitmap, Mat canonical, RfDetrDetector detector, Result result, String raceKey, boolean finalAttempt, RfDetrDetector.DetectionResult reusedDetections) throws Exception {
        lastSeedTimeRead = false;
        lastSeedLapSumOk = null;
        // Retourneert true zodra een leesbare dynamic grid + slot-details is opgebouwd.
        // Bij false probeert run() de volgende quad-seed; terminal blocked-JSON's worden
        // alleen op de laatste poging (finalAttempt) weggeschreven zodat een geslaagde
        // latere seed niet als "blocked" wordt gerapporteerd.
        Bitmap canonicalBitmap = matToBitmap(canonical);
        RfDetrDetector.DetectionResult detections = null;
        try {
            if (detector == null && reusedDetections == null) {
                if (finalAttempt) {
                    stageStarted("19_RFDetr3ClassDetect");
                    writeBlocked(imageDir, workflowDir, "19", "RFDetr3ClassDetect", "19_rfdetr_3class_detect.json", "blocked_missing_detector", "RF-DETR/ORT detector did not initialize", result);
                    stageCompleted("19_RFDetr3ClassDetect");
                    writeLateStagesBlocked(imageDir, workflowDir, result, "blocked_missing_step19_detections");
                }
                return false;
            }
            stageStarted("19_RFDetr3ClassDetect");
            // two-phase: step-01-detecties door de warp getransformeerd i.p.v.
            // een tweede RF-DETR-inferentie (~0,9s/seed); detector blijft fallback
            detections = reusedDetections != null ? reusedDetections : detector.detect(canonicalBitmap);
            writeDetections(imageDir, workflowDir, canonicalBitmap, detections, result);
            stageCompleted("19_RFDetr3ClassDetect");
            if (stopAfterStage("19")) {
                return true;
            }
            stageStarted("20_RFDetrLapIndexRefine");
            List<RfDetrDetector.Detection> refined = refineLapIndexes(detections.detections);
            writeRefinedLapIndexes(imageDir, workflowDir, canonicalBitmap, refined, result);
            stageCompleted("20_RFDetrLapIndexRefine");
            if (stopAfterStage("20")) {
                return true;
            }
            stageStarted("21_RFDetrDynamicLapGrid");
            DynamicGrid grid = buildDynamicGrid(canonical.cols(), canonical.rows(), detections.detections, refined, raceKey);
            if (!grid.available) {
                if (finalAttempt) {
                    writeBlocked(imageDir, workflowDir, "21", "RFDetrDynamicLapGrid", "21_dynamic_lap_grid.json", grid.status, grid.reason, result);
                    writeBlocked(imageDir, workflowDir, "24", "SevenSegmentOCRProbe", "24_slot_details_evidence.json", "blocked_missing_dynamic_grid", "Accepted slot_details evidence requires dynamic/refined grid", result);
                    writeBlocked(imageDir, workflowDir, "26", "OfflineOCRDecode", "26_ocr_result_slot_details.json", "blocked_missing_slot_details", "Accepted OCR decode requires 24_slot_details_evidence.json", result);
                }
                stageCompleted("21_RFDetrDynamicLapGrid");
                return false;
            }
            writeDynamicGrid(imageDir, workflowDir, canonical, grid, result);
            stageCompleted("21_RFDetrDynamicLapGrid");
            if (stopAfterStage("21")) {
                return true;
            }
            if (identityOnly) {
                // stemframe voor de identiteit: grid staat, 7-segment is al gelockt
                if (kartConfigMatcher != null) {
                    stageStarted("27_KartConfig");
                    SlotDetails identityDetails = new SlotDetails();
                    identityDetails.yellowPlayerSlot = isGhostDetail() ? null : detectYellowPlayerSlot(canonical).position;
                    identityDetails.swappedPlayerGhost = "top".equals(identityDetails.yellowPlayerSlot);
                    runKartConfig(imageDir, workflowDir, canonical, raceKey, identityDetails, grid, result);
                    stageCompleted("27_KartConfig");
                }
                return true;
            }
            stageStarted("24_SevenSegmentOCRProbe");
            SlotDetails seedDetails = buildSlotDetails(imageDir, canonical, grid);
            lastSeedLapSumOk = seedDetails.lapSumOk;
            lastSeedTimeRead = true;
            writeSlotDetails(imageDir, workflowDir, canonical, seedDetails, result);
            stageCompleted("24_SevenSegmentOCRProbe");
            if (stopAfterStage("24")) {
                return true;
            }
            // Read-kwaliteit-gate: de grid bouwde, maar als de meeste velden geen geldig
            // tijdformaat opleveren (veel '?' unknowns) is dit een slechte warp (bv. een
            // rotatie-harde frame op de crude ROI-box-seed). Probeer dan de volgende seed
            // i.p.v. een garbage-read te accepteren. Op de laatste seed schrijven we de
            // best-effort read alsnog weg (eerlijk gemarkeerd via de veld-validFormat-vlaggen).
            // MK8DX ecosystem overlay (ADR-0203): de rechtzet-seed wint alleen met
            // een sluitende lap-som. Op een al rechte foto meet de badge-fit ruis,
            // en een leesbare maar net verkeerde read mag de as-parallelle seed
            // dan niet verdringen; die volgt anders ongewijzigd.
            if (!finalAttempt && (strictSeedAttempt
                    ? !Boolean.TRUE.equals(seedDetails.lapSumOk)
                    : !isReadGood(seedDetails))) {
                return false;
            }
            // MK8DX ecosystem overlay (ADR-0203): a readable seed whose lap sum
            // stays open yields to the next seed (Web strictLapSumSeedCandidate);
            // when none closes, the seed loop reads the first one again in full,
            // so its time checks and identities are not needed here.
            if (SCAN_TIME_CHECKS && !finalAttempt && !Boolean.TRUE.equals(seedDetails.lapSumOk)) {
                return true;
            }
            // MK8DX ecosystem overlay (ADR-0203): the Web scan sessions' time
            // checks read the grid once more; a closed seed read is kept when the
            // refined read does not close, and its closed ghost side survives.
            SlotDetails slotDetails = seedDetails;
            if (SCAN_TIME_CHECKS) {
                SlotDetails timeChecked = buildSlotDetails(imageDir, canonical, grid, true);
                if (nl.mariokart8.iconmatcher.TimeDecision.preferClosedSeed(
                        Boolean.TRUE.equals(seedDetails.lapSumOk), Boolean.TRUE.equals(timeChecked.lapSumOk),
                        timeChecked.lapSumRepairs == null ? 0 : timeChecked.lapSumRepairs.length(),
                        minDigitConfidence(timeChecked))) {
                    slotDetails = seedDetails;
                } else {
                    preserveClosedGhostSide(seedDetails, timeChecked);
                    slotDetails = timeChecked;
                }
                applyRepairConfidenceGuard(slotDetails);
                if (slotDetails != seedDetails) {
                    writeSlotDetails(imageDir, workflowDir, canonical, slotDetails, result);
                }
            }
            stageStarted("26_OfflineOCRDecode");
            writeOcrDecode(imageDir, workflowDir, slotDetails, result);
            writeLateStageRouteReport(imageDir, workflowDir);
            saveFieldCrops(imageDir, canonical, slotDetails);
            stageCompleted("26_OfflineOCRDecode");
            if (kartConfigMatcher != null) {
                stageStarted("27_KartConfig");
                runKartConfig(imageDir, workflowDir, canonical, raceKey, slotDetails, grid, result);
                stageCompleted("27_KartConfig");
            }
        } finally {
            canonicalBitmap.recycle();
        }
        return true;
    }

    /**
     * Node 27 (fase 1): identiteits-matcher op de canonieke kaartregio's, ná een
     * geaccepteerde read (zware extra's nooit in het per-frame-retry-pad). Output
     * per SEMANTIC owner (speler=gele kaart, ook bij geswapte lay-out).
     */
    private void runKartConfig(File imageDir, File workflowDir, Mat canonical, String raceKey, SlotDetails details, DynamicGrid grid, Result result) throws Exception {
        long started = System.currentTimeMillis();
        // schaal-invariantie zit ín de matcher (venster -> nominale panelmaat,
        // KartConfigMatcher.matchCard); hier geen canonical-herschaal — de
        // 960-kopie-poging plaatste sloten off-card (panel_rels/anchors zijn
        // input-ruimte) en de botte gallery-downscale brak 7-laps-digits
        Mat matchMat = canonical;
        try {
            JSONObject owners = new JSONObject();
            StringBuilder consoleLine = new StringBuilder();
            File cropDir = new File(imageDir, "27_crops");
            cropDir.mkdirs();
            // gele kaart eerst: die bepaalt het taal-slot (helderste rijteksten),
            // de ghostkaart erft script+locale — één taal per frame (server-principe)
            String[] localeSlot = new String[2];
            String[] ownerOrder = isGhostDetail()
                    ? new String[]{"ghost"}
                    : ("top".equals(details.yellowPlayerSlot)
                            ? new String[]{"ghost", "player"}
                            : new String[]{"player", "ghost"});
            String matcherRaceKey = isGhostDetail()
                    ? ("race7".equals(raceKey) ? KartConfigMatcher.RACE_KEY_GHOST_DETAIL7 : KartConfigMatcher.RACE_KEY_GHOST_DETAIL)
                    : raceKey;
            for (String physOwner : ownerOrder) {
                double[] anchor = grid == null ? null : grid.ownerAnchors.get(physOwner);
                String semantic = semanticOwner(physOwner, details.yellowPlayerSlot);
                JSONObject match = kartConfigMatcher.matchCard(matchMat, physOwner, matcherRaceKey, anchor, cropDir, "player".equals(semantic), localeSlot);
                // Result cards and the Select-a-Ghost panel take the same central decision.
                if (sharedFieldReader != null) {
                    final CleanAssetsMatcher catalog = kartConfigMatcher.cleanAssets();
                    sharedFieldReader.setCatalogNames(new nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader.CatalogNames() {
                        @Override
                        public String displayName(String id, String group) {
                            return catalog.displayName(id, group);
                        }

                        @Override
                        public String assetRefFor(String id, String group) {
                            return catalog.assetRefFor(id, group);
                        }
                    });
                    if (!sharedFieldReader.adopt(matchMat, match, isGhostDetail(),
                            isGhostDetail() && !"race7".equals(raceKey))) {
                        nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader.clearChoices(match, "adoption_failed");
                    }
                } else {
                    // No central reader (pack missing or damaged): no older rule guesses the fields.
                    nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader.clearChoices(match, "reader_unavailable");
                }
                match.put("physical_owner", physOwner);
                match.put("semantic_owner", semantic);
                owners.put(semantic, match);
                if (consoleLine.length() > 0) {
                    consoleLine.append(" || ");
                }
                consoleLine.append(semantic).append(":");
                for (String kind : new String[]{"character", "kart", "wheel", "glider", "flag"}) {
                    JSONObject kr = match.optJSONObject(kind);
                    if (kr == null) {
                        continue;
                    }
                    String name = kr.optString("name", "");
                    boolean ok = kr.optBoolean("ok", false);
                    consoleLine.append(" ").append(kind).append("=")
                            .append(name.isEmpty() ? "?" : name)
                            .append("(").append(kr.optDouble("score", 0.0)).append(ok ? "" : ",!ok").append(")");
                }
            }
            // kalibratie-artefact (alleen diagnostische runs, niet het live-pad):
            // slot-vakken op het canonieke beeld (grid vs crop)
            if (!suppressVisualArtifacts) {
            try {
                // overlay in de match-ruimte (960): slot_xywh-coords horen daarbij
                Mat overlay = matchMat.clone();
                java.util.Iterator<String> ownerKeys = owners.keys();
                while (ownerKeys.hasNext()) {
                    JSONObject match = owners.optJSONObject(ownerKeys.next());
                    if (match == null) {
                        continue;
                    }
                    for (String kind : new String[]{"character", "kart", "wheel", "glider", "flag"}) {
                        JSONObject kr = match.optJSONObject(kind);
                        JSONArray box = kr == null ? null : kr.optJSONArray("slot_xywh");
                        if (box == null) {
                            continue;
                        }
                        // nominale grid-positie: magenta (leesbaar op geel én grijs)
                        Imgproc.rectangle(overlay,
                                new Point(box.getInt(0), box.getInt(1)),
                                new Point(box.getInt(0) + box.getInt(2), box.getInt(1) + box.getInt(3)),
                                new org.opencv.core.Scalar(255, 0, 255), 1);
                        // gevonden match-positie (nominaal + dx/dy, evt. geschaald):
                        // groen = ok, donkerrood = onzeker — residu vs vangst in één blik
                        if (kr.has("dx") || kr.has("dy")) {
                            double scale = kr.optDouble("scale", 1.0);
                            double w2 = box.getInt(2) * scale;
                            double h2 = box.getInt(3) * scale;
                            double mx = box.getInt(0) + (box.getInt(2) - w2) / 2.0 + kr.optInt("dx", 0);
                            double my = box.getInt(1) + (box.getInt(3) - h2) / 2.0 + kr.optInt("dy", 0);
                            boolean ok = kr.optBoolean("ok", false);
                            Imgproc.rectangle(overlay,
                                    new Point(mx, my),
                                    new Point(mx + w2, my + h2),
                                    ok ? new org.opencv.core.Scalar(80, 230, 90) : new org.opencv.core.Scalar(40, 40, 230), 2);
                        }
                    }
                }
                writeMatImage(new File(imageDir, "27_slot_overlay.png"), overlay);
                overlay.release();
            } catch (Exception ignored) {
            }
            }
            JSONObject root = new JSONObject()
                    .put("stage", "27_KartConfig")
                    .put("status", "implemented")
                    .put("implementation_mode", sharedFieldReader != null
                            ? "shared_field_" + nl.mariokart8.mk8dxtimetrials.scanruntime.shared.SharedFieldReader.SEMANTICS_VERSION
                            : "native_android_v1_icon_ncc_phase1")
                    .put("evidence", "v1_icon_grid_masked_ncc_plus_pattern_first_flag")
                    .put("not_ported_yet", new JSONArray().put("deploy_registration").put("text_ocr").put("color_variant_refinement").put("name_strip"))
                    .put("race_key", raceKey)
                    .put("yellow_player_slot", details.yellowPlayerSlot)
                    .put("owners", owners)
                    .put("duration_ms", System.currentTimeMillis() - started)
                    .put("no_runtime_label_fallback", true);
            writeJson(new File(imageDir, "27_kart_config.json"), root);
            writeJson(new File(workflowDir, "27_KartConfig.json"), root);
            result.mark("27_KartConfig", "implemented_v1_phase1");
            DebugConsole.log("IDENT", "[" + imageDir.getName() + "] " + consoleLine + " (" + (System.currentTimeMillis() - started) + "ms)");
        } catch (Exception exc) {
            // identiteit mag de tijden-read nooit breken
            result.mark("27_KartConfig", "failed_" + exc.getClass().getSimpleName());
            DebugConsole.log("IDENT", "[" + imageDir.getName() + "] kart-config faalde: " + exc.getMessage());
        }
    }

    /**
     * Een read telt als "goed" als minstens de helft van de gedecodeerde velden een geldig
     * MK8-tijdformaat heeft (d:dd.ddd, geen '?' unknowns). Gebruikt om een slechte
     * quad-seed (garbage-read) te onderscheiden van een leesbare warp in de seed-retry.
     */
    private boolean isReadGood(SlotDetails slotDetails) {
        if (slotDetails == null || slotDetails.fields.isEmpty()) {
            return false;
        }
        if (Boolean.TRUE.equals(slotDetails.lapSumOk)) {
            return true; // lap-som sluit = sterkste GT-vrije eigen-lees-bewijs
        }
        int valid = 0;
        for (FieldRead field : slotDetails.fields) {
            if (field.validFormat) {
                valid++;
            }
        }
        return valid * 2 >= slotDetails.fields.size();
    }

    private void stageStarted(String stage) throws Exception {
        if (progress != null) {
            progress.stageStarted(stage);
        }
    }

    private void stageCompleted(String stage) throws Exception {
        if (progress != null) {
            progress.stageCompleted(stage);
        }
    }

    private boolean stopAfterStage(String stagePrefix) {
        if (stopAfterStage == null || stopAfterStage.isEmpty()) {
            return false;
        }
        return stopAfterStage.equals(stagePrefix)
                || stopAfterStage.startsWith(stagePrefix + "_")
                || stopAfterStage.startsWith(stagePrefix + "-");
    }

    private void writeLateStagesBlocked(File imageDir, File workflowDir, Result result, String reason) throws Exception {
        for (String[] row : new String[][]{
                {"19", "RFDetr3ClassDetect", "19_rfdetr_3class_detect.json"},
                {"20", "RFDetrLapIndexRefine", "20_rfdetr_lap_index_refine.json"},
                {"21", "RFDetrDynamicLapGrid", "21_dynamic_lap_grid.json"},
                {"22", "FixedMK8Grid", "22_fixed_mk8_grid.json"},
                {"23", "TimeTrialEndscreenGate", "23_time_trial_endscreen_gate.json"},
                {"24", "SevenSegmentOCRProbe", "24_slot_details_evidence.json"},
                {"25", "SevenSegmentOCRInspect", "25_SevenSegmentOCRInspect.json"},
                {"26", "OfflineOCRDecode", "26_ocr_result_slot_details.json"},
        }) {
            writeBlocked(imageDir, workflowDir, row[0], row[1], row[2], reason, "Upstream canonical player-card image is unavailable", result);
        }
    }

    private void writeDetections(File imageDir, File workflowDir, Bitmap canonicalBitmap, RfDetrDetector.DetectionResult detections, Result result) throws Exception {
        JSONArray arr = new JSONArray();
        for (RfDetrDetector.Detection detection : detections.detections) {
            arr.put(detection.toJson(canonicalBitmap.getWidth(), canonicalBitmap.getHeight()));
        }
        JSONObject root = new JSONObject()
                .put("stage", "19_RFDetr3ClassDetect")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("detection_source", "android_rfdetr_ort")
                .put("detections", arr)
                .put("candidate_count", detections.detections.size())
                .put("detector_timing_ms", detections.timingJson())
                .put("visual_artifacts_suppressed", suppressVisualArtifacts)
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "19_rfdetr_3class_detect.json"), root);
        writeJson(new File(workflowDir, "19_RFDetr3ClassDetect.json"), root);
        if (!suppressVisualArtifacts) {
            writeBitmap(new File(imageDir, "19_rfdetr_3class_detect_overlay.png"), detectionOverlay(canonicalBitmap, detections.detections, null));
            writeBitmap(new File(workflowDir, "19_RFDetr3ClassDetect.png"), detectionOverlay(canonicalBitmap, detections.detections, null));
        }
        result.mark("19_RFDetr3ClassDetect", "implemented");
    }

    private List<RfDetrDetector.Detection> refineLapIndexes(List<RfDetrDetector.Detection> detections) {
        List<RfDetrDetector.Detection> laps = new ArrayList<>();
        for (RfDetrDetector.Detection detection : detections) {
            if ("lap_index".equals(detection.label)) {
                laps.add(detection);
            }
        }
        Collections.sort(laps, new Comparator<RfDetrDetector.Detection>() {
            @Override
            public int compare(RfDetrDetector.Detection a, RfDetrDetector.Detection b) {
                return Float.compare((a.top + a.bottom) * 0.5f, (b.top + b.bottom) * 0.5f);
            }
        });
        return laps;
    }

    private void writeRefinedLapIndexes(File imageDir, File workflowDir, Bitmap canonicalBitmap, List<RfDetrDetector.Detection> refined, Result result) throws Exception {
        JSONArray rows = new JSONArray();
        for (int i = 0; i < refined.size(); i++) {
            JSONObject row = refined.get(i).toJson(canonicalBitmap.getWidth(), canonicalBitmap.getHeight());
            row.put("row_index", i + 1);
            rows.put(row);
        }
        JSONObject root = new JSONObject()
                .put("stage", "20_RFDetrLapIndexRefine")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("refined_detections_count", refined.size())
                .put("lap_index_rows", rows)
                .put("visual_artifacts_suppressed", suppressVisualArtifacts)
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "20_rfdetr_lap_index_refine.json"), root);
        writeJson(new File(workflowDir, "20_RFDetrLapIndexRefine.json"), root);
        if (!suppressVisualArtifacts) {
            writeBitmap(new File(imageDir, "20_rfdetr_lap_index_refine_overlay.png"), detectionOverlay(canonicalBitmap, refined, null));
            writeBitmap(new File(workflowDir, "20_RFDetrLapIndexRefine.png"), detectionOverlay(canonicalBitmap, refined, null));
        }
        result.mark("20_RFDetrLapIndexRefine", "implemented");
    }

    // MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 5): the digit slots come from the
    // central lap grid (packages/icon-matcher LapGrid, the same specification as the Web scanner and
    // Python); this method keeps the engine's own grid object and its diagnostics.
    private DynamicGrid buildDynamicGrid(int width, int height, List<RfDetrDetector.Detection> detections, List<RfDetrDetector.Detection> lapRows, String raceKey) throws Exception {
        nl.mariokart8.iconmatcher.LapGrid.Grid central = nl.mariokart8.iconmatcher.LapGrid.build(relGrid, raceKey, isGhostDetail(),
                width, height, gridDetections(detections), gridDetections(lapRows), registeredGhostGrid);
        DynamicGrid grid = new DynamicGrid();
        grid.raceKey = central.raceKey;
        grid.available = central.available;
        grid.status = central.status;
        grid.reason = central.reason;
        if ("blocked_missing_relative_grid".equals(central.status) || "blocked_insufficient_lap_index_support".equals(central.status)) {
            return grid;
        }
        grid.width = width;
        grid.height = height;
        grid.evidenceSource = ACCEPTED_EVIDENCE;
        if ("blocked_unresolved_active_ocr_profile".equals(central.status)) {
            return grid;
        }
        grid.profileSource = "step19_rfdetr_owner_boxes_and_lap_index_matches";
        for (Map.Entry<String, nl.mariokart8.iconmatcher.LapGrid.OwnerMatches> entry : central.ownerMatches.entrySet()) {
            JSONArray rows = new JSONArray();
            for (nl.mariokart8.iconmatcher.LapGrid.Match match : entry.getValue().matches) {
                rows.put(match.rowIndex);
            }
            grid.ownerProfileEvidence.put(entry.getKey(), new JSONObject()
                    .put("owner_box_detected", physicalOwnerDetected(detections, entry.getKey()))
                    .put("matched_lap_index_count", entry.getValue().matches.size())
                    .put("matched_row_indices", rows)
                    .put("inferred_lap_count", entry.getValue().inferredLapCount));
        }
        grid.ownerAnchors.putAll(central.ownerAnchors);
        if (!central.available) {
            grid.activeProfileStatus = central.status;
            return grid;
        }
        grid.activeLapCount = central.activeLapCount;
        grid.activeProfileStatus = "resolved";
        grid.activeOwners.addAll(central.activeOwners);
        grid.matchedLapIndexCount = central.matchedLapIndexCount;
        for (nl.mariokart8.iconmatcher.LapGrid.Field field : central.fields) {
            List<BoxD> slots = new ArrayList<>();
            for (nl.mariokart8.iconmatcher.LapGrid.Box slot : field.slots) {
                slots.add(new BoxD(slot.left, slot.top, slot.right, slot.bottom));
            }
            grid.fields.add(new FieldBox(field.name, field.owner, field.type, field.lapIndex,
                    new BoxD(field.box.left, field.box.top, field.box.right, field.box.bottom), slots));
        }
        grid.expectedFieldCount = central.expectedFieldCount;
        return grid;
    }

    private static List<nl.mariokart8.iconmatcher.LapGrid.Detection> gridDetections(List<RfDetrDetector.Detection> detections) {
        List<nl.mariokart8.iconmatcher.LapGrid.Detection> out = new ArrayList<>();
        for (RfDetrDetector.Detection d : detections) {
            out.add(new nl.mariokart8.iconmatcher.LapGrid.Detection(d.label, d.score, d.left, d.top, d.right, d.bottom));
        }
        return out;
    }

    private static int ownerOrder(String owner) {
        return "ghost".equals(owner) ? 0 : 1;
    }


    private boolean physicalOwnerDetected(List<RfDetrDetector.Detection> detections, String physicalOwner) {
        for (RfDetrDetector.Detection detection : detections) {
            if (!"player_timetrail_box".equals(detection.label) && !"ghost_timetrail_box".equals(detection.label)) {
                continue;
            }
            String slot = ((detection.top + detection.bottom) * 0.5f) < 0.5f ? "ghost" : "player";
            if (physicalOwner.equals(slot)) {
                return true;
            }
        }
        return false;
    }


    private JSONObject raceOwners(String raceKey) {
        if (relGrid == null) {
            return null;
        }
        JSONObject race = relGrid.optJSONObject(raceKey);
        return race == null ? null : race.optJSONObject("owners");
    }

    private JSONObject ownerGridForRace(String raceKey, String owner) {
        JSONObject owners = raceOwners(raceKey);
        return owners == null ? null : owners.optJSONObject(owner);
    }

    private BoxD ownerAbsBox(JSONObject ownerGrid, JSONArray rel) {
        JSONObject anchor = ownerGrid.optJSONObject("anchor");
        double ax = anchor == null ? 0.0 : anchor.optDouble("x", 0.0);
        double ay = anchor == null ? 0.0 : anchor.optDouble("y", 0.0);
        return new BoxD(
                ax + rel.optDouble(0, 0.0),
                ay + rel.optDouble(1, 0.0),
                ax + rel.optDouble(2, 0.0),
                ay + rel.optDouble(3, 0.0)
        );
    }

    private BoxD union(List<BoxD> boxes) {
        if (boxes.isEmpty()) {
            return new BoxD(0, 0, 1, 1);
        }
        double left = Double.MAX_VALUE;
        double top = Double.MAX_VALUE;
        double right = -Double.MAX_VALUE;
        double bottom = -Double.MAX_VALUE;
        for (BoxD box : boxes) {
            left = Math.min(left, box.left);
            top = Math.min(top, box.top);
            right = Math.max(right, box.right);
            bottom = Math.max(bottom, box.bottom);
        }
        return new BoxD(left, top, right, bottom);
    }

    private int[] canonicalSegmentSlotSize(String type, int slot) {
        boolean punctuation = slot == 2 || slot == 5;
        int width = "total".equals(type) ? (punctuation ? 8 : 22) : (punctuation ? 7 : 19);
        int height = "total".equals(type) ? 33 : 27;
        return new int[]{width, height};
    }

    /**
     * MK8DX ecosystem overlay: the registered Select-a-Ghost panel lies on its
     * clean reference, so its lap circles are where the reference has them. Detecting
     * them again and extrapolating the total from the lap rows put the total's
     * digits 2-3 px off on HDMI (a 3 read as 1). Same rule as Web
     * (pipeline.ts registeredLapIndexDetections).
     */
    private boolean registeredGhostGrid;

    private RfDetrDetector.DetectionResult registeredLapIndexDetections(String raceKey, int width, int height) {
        JSONObject owners = raceOwners(raceKey);
        JSONObject ownerGrid = owners == null ? null : owners.optJSONObject("ghost");
        List<RfDetrDetector.Detection> out = new ArrayList<>();
        if (ownerGrid != null) {
            for (BoxD box : canonicalLapIndexBoxes(ownerGrid)) {
                out.add(new RfDetrDetector.Detection("lap_index", 1.0f, (float) (box.left / width), (float) (box.top / height),
                        (float) (box.right / width), (float) (box.bottom / height)));
            }
        }
        return new RfDetrDetector.DetectionResult(out, 0L, 0L, 0L, 0L, 0L, 0L);
    }

    private List<BoxD> canonicalLapIndexBoxes(JSONObject ownerGrid) {
        List<BoxD> boxes = new ArrayList<>();
        JSONArray rels = ownerGrid.optJSONArray("lap_index_boxes_rel");
        if (rels != null) {
            for (int i = 0; i < rels.length(); i++) {
                JSONArray rel = rels.optJSONArray(i);
                if (rel != null) {
                    boxes.add(ownerAbsBox(ownerGrid, rel));
                }
            }
            return boxes;
        }
        JSONArray strips = ownerGrid.optJSONArray("lap_strips_rel");
        JSONObject anchor = ownerGrid.optJSONObject("anchor");
        if (strips == null || anchor == null) {
            return boxes;
        }
        double ax = anchor.optDouble("x", 0.0);
        double ay = anchor.optDouble("y", 0.0);
        for (int i = 0; i < strips.length(); i++) {
            JSONArray rel = strips.optJSONArray(i);
            if (rel == null || rel.length() < 4) {
                continue;
            }
            double centerY = ay + (rel.optDouble(1, 0.0) + rel.optDouble(3, 0.0)) * 0.5;
            boxes.add(new BoxD(ax - 12.5, centerY - 12.5, ax + 12.5, centerY + 12.5));
        }
        return boxes;
    }

    private double range(List<Double> values) {
        if (values.isEmpty()) {
            return 0.0;
        }
        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        for (double value : values) {
            min = Math.min(min, value);
            max = Math.max(max, value);
        }
        return max - min;
    }

    private void writeDynamicGrid(File imageDir, File workflowDir, Mat canonical, DynamicGrid grid, Result result) throws Exception {
        JSONObject root = grid.toJson()
                .put("stage", "21_RFDetrDynamicLapGrid")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("evidence_source", ACCEPTED_EVIDENCE)
                .put("visual_artifacts_suppressed", suppressVisualArtifacts)
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "21_dynamic_lap_grid.json"), root);
        writeJson(new File(workflowDir, "21_RFDetrDynamicLapGrid.json"), root);
        if (!suppressVisualArtifacts) {
            Mat overlay = gridOverlay(canonical, grid.fields, new Scalar(0, 255, 0));
            try {
                writeMatImage(new File(imageDir, "21_dynamic_lap_grid_overlay.png"), overlay);
                writeMatImage(new File(workflowDir, "21_RFDetrDynamicLapGrid.png"), overlay);
            } finally {
                overlay.release();
            }
        }
        result.mark("21_RFDetrDynamicLapGrid", "implemented");
    }




    private SlotDetails buildSlotDetails(File imageDir, Mat canonical, DynamicGrid grid) throws Exception {
        return buildSlotDetails(imageDir, canonical, grid, false);
    }

    private SlotDetails buildSlotDetails(File imageDir, Mat canonical, DynamicGrid grid, boolean timeChecks) throws Exception {
        File cropDir = new File(imageDir, "24_slot_details_digit_crops");
        cropDir.mkdirs();
        SlotDetails details = new SlotDetails();
        YellowSlot yellow = isGhostDetail() ? new YellowSlot(null, 0.0, 0.0) : detectYellowPlayerSlot(canonical);
        details.yellowPlayerSlot = yellow.position;
        details.swappedPlayerGhost = "top".equals(yellow.position);
        for (FieldBox field : grid.fields) {
            FieldRead read = new FieldRead(field);
            List<BoxD> slots = field.slotBoxes();
            String polarityOwner = digitPolarityOwner(field.owner, yellow.position);
            for (int i = 0; i < slots.size(); i++) {
                String slotType = slotType(i + 1);
                SlotRead slot = new SlotRead(i + 1, slotType, slots.get(i));
                slot.polarityOwner = polarityOwner;
                if ("digit".equals(slotType)) {
                    Rect rect = slots.get(i).toRect(canonical.cols(), canonical.rows());
                    Mat crop = new Mat(canonical, rect).clone();
                    String cropName = field.name + "_slot_" + (i + 1) + ".png";
                    writeMatImage(new File(cropDir, cropName), crop);
                    slot.cropPath = "24_slot_details_digit_crops/" + cropName;
                    scoreSlot(crop, slot, polarityOwner, field.type, i + 1);
                    crop.release();
                } else {
                    slot.charValue = slotType.equals("colon") ? ":" : ".";
                    slot.valid = true;
                }
                read.slots.add(slot);
            }
            read.physicalAssembled = assemble(read.slots);
            read.assembled = read.physicalAssembled;
            read.validFormat = read.assembled.matches("\\d:\\d\\d\\.\\d\\d\\d");
            if (!read.validFormat) {
                read.rejectionReason = "invalid_format_or_unknown_digit";
            }
            details.fields.add(read);
        }
        Map<Integer, int[]> playerColumnOffsets = null;
        if (timeChecks) {
            int ghostLapRows = 0;
            for (FieldRead read : details.fields) {
                if ("lap".equals(read.field.type)
                        && "ghost".equals(semanticOwner(read.field.owner, details.yellowPlayerSlot))) ghostLapRows++;
            }
            // Keep punctuation and digit columns on the same aligned three-lap field.
            // Seven-lap cards retain their existing lap/total repair order.
            if (ghostLapRows == 3) applyGuardedFieldFits(imageDir, cropDir, canonical, details);
            applyGhostLapColumnCandidate(canonical, details);
            playerColumnOffsets = applyPlayerLapColumnCandidate(canonical, details);
        }
        applyGuardedFieldFits(imageDir, cropDir, canonical, details);
        applySemanticDecodedValues(details, yellow.position);
        applyLapSumClosure(details);
        if (timeChecks) {
            applyPlayerTotalColumnRefit(canonical, details, playerColumnOffsets);
        }
        applyTotalRefit(canonical, details);
        if (timeChecks) {
            applyGhostTotalVerticalRefit(canonical, details);
        }
        return details;
    }

    // ------------------------------------------------------------------
    // MK8DX ecosystem overlay (ADR-0203): the Web scanner's lap-sum guarded time
    // checks, default for its scan sessions since 2026-10-23 (pipeline.ts
    // applyGhostLapColumnCandidate, applyPlayerLapColumnCandidate,
    // applyPlayerTotalColumnRefit, applyGhostTotalVerticalRefit,
    // preserveClosedGhostSide). On 97 in-app phone photos they took the Web from
    // 804/872 to 872/872 exact times with no wrongly locked session.

    /** One digit read again at another box; the original slot stays untouched. */
    private SlotRead scoreDigitAt(Mat canonical, BoxD box, SlotRead original, String kind) throws Exception {
        BoxD clipped = box.clipped(canonical.cols(), canonical.rows());
        SlotRead slot = new SlotRead(original.index, "digit", clipped);
        slot.polarityOwner = original.polarityOwner;
        Mat crop = new Mat(canonical, clipped.toRect(canonical.cols(), canonical.rows())).clone();
        try {
            scoreSlot(crop, slot, slot.polarityOwner, kind, original.index);
        } finally {
            crop.release();
        }
        return slot;
    }

    private static BoxD shiftedBox(BoxD box, double dx, double dy) {
        return new BoxD(box.left + dx, box.top + dy, box.right + dx, box.bottom + dy);
    }

    private void reassemble(FieldRead read) {
        read.physicalAssembled = assemble(read.slots);
        read.assembled = read.physicalAssembled;
        read.validFormat = read.assembled.matches("\\d:\\d\\d\\.\\d\\d\\d");
        read.rejectionReason = read.validFormat ? "" : "invalid_format_or_unknown_digit";
    }

    private static int compareColumnRank(double[] a, double[] b) {
        for (int i = 0; i < a.length; i++) {
            if (a[i] != b[i]) return a[i] > b[i] ? 1 : -1;
        }
        return 0;
    }

    /** Align ghost-lap digit columns across the repeated in-game rows. */
    private void applyGhostLapColumnCandidate(Mat canonical, SlotDetails details) throws Exception {
        List<FieldRead> rows = new ArrayList<>();
        for (FieldRead read : details.fields) {
            if ("lap".equals(read.field.type) && "ghost".equals(semanticOwner(read.field.owner, details.yellowPlayerSlot))) rows.add(read);
        }
        if (rows.size() < 2) return;
        for (int position : SEGMENT_DIGIT_POSITIONS) {
            List<FieldRead> group = new ArrayList<>();
            for (FieldRead read : rows) {
                if (read.slots.size() > position && "digit".equals(read.slots.get(position).type)) group.add(read);
            }
            if (group.size() < 2) continue;
            double[] bestRank = null;
            int bestDx = 0;
            int bestDy = 0;
            List<SlotRead> bestSlots = null;
            for (int dy = -2; dy <= 2; dy++) {
                for (int dx = -2; dx <= 2; dx++) {
                    List<SlotRead> slots = new ArrayList<>();
                    int valid = 0;
                    double confidence = 0;
                    for (FieldRead read : group) {
                        SlotRead original = read.slots.get(position);
                        SlotRead slot = scoreDigitAt(canonical, shiftedBox(original.box, dx, dy), original, "lap");
                        slots.add(slot);
                        if (slot.valid) valid++;
                        confidence += slot.confidence;
                    }
                    double[] rank = {valid, confidence / slots.size(), -Math.abs(dx) - Math.abs(dy), -Math.abs(dx), -Math.abs(dy), -dx, -dy};
                    if (bestRank == null || compareColumnRank(rank, bestRank) > 0) {
                        bestRank = rank;
                        bestDx = dx;
                        bestDy = dy;
                        bestSlots = slots;
                    }
                }
            }
            if (bestSlots == null || (bestDx == 0 && bestDy == 0)) continue;
            for (int row = 0; row < group.size(); row++) group.get(row).slots.set(position, bestSlots.get(row));
        }
        for (FieldRead read : rows) reassemble(read);
    }

    /** Rescue unread player-lap columns with the repeated in-game rows. */
    private Map<Integer, int[]> applyPlayerLapColumnCandidate(Mat canonical, SlotDetails details) throws Exception {
        Map<Integer, int[]> offsets = new LinkedHashMap<>();
        List<FieldRead> rows = new ArrayList<>();
        FieldRead total = null;
        for (FieldRead read : details.fields) {
            String owner = semanticOwner(read.field.owner, details.yellowPlayerSlot);
            if (!"player".equals(owner)) continue;
            if ("lap".equals(read.field.type)) rows.add(read);
            else if ("total".equals(read.field.type) && total == null) total = read;
        }
        int unreadRows = 0;
        for (FieldRead read : rows) if (!read.validFormat) unreadRows++;
        if (rows.size() < 3 || total == null || !total.validFormat || segmentTimeMs(total.assembled) == null || unreadRows < 2) {
            return offsets;
        }
        for (int position : SEGMENT_DIGIT_POSITIONS) {
            List<FieldRead> group = new ArrayList<>();
            int unknown = 0;
            for (FieldRead read : rows) {
                if (read.slots.size() > position && "digit".equals(read.slots.get(position).type)) {
                    group.add(read);
                    if ("?".equals(read.slots.get(position).charValue)) unknown++;
                }
            }
            if (group.size() != rows.size() || unknown < 2) continue;
            double[] bestRank = null;
            int bestDx = 0;
            int bestDy = 0;
            List<SlotRead> bestSlots = null;
            for (int dy = -2; dy <= 2; dy++) {
                for (int dx = -6; dx <= 6; dx++) {
                    List<SlotRead> slots = new ArrayList<>();
                    boolean usable = true;
                    double confidence = 0;
                    for (FieldRead read : group) {
                        SlotRead original = read.slots.get(position);
                        SlotRead slot = scoreDigitAt(canonical, shiftedBox(original.box, dx, dy), original, "lap");
                        if (!slot.valid || slot.confidence < 0.6 || (original.valid && !slot.charValue.equals(original.charValue))) {
                            usable = false;
                            break;
                        }
                        slots.add(slot);
                        confidence += slot.confidence;
                    }
                    if (!usable) continue;
                    double[] rank = {confidence / slots.size(), -Math.abs(dx) - Math.abs(dy), -Math.abs(dx), -Math.abs(dy), -dx, -dy};
                    if (bestRank == null || compareColumnRank(rank, bestRank) > 0) {
                        bestRank = rank;
                        bestDx = dx;
                        bestDy = dy;
                        bestSlots = slots;
                    }
                }
            }
            if (bestSlots == null) continue;
            offsets.put(position + 1, new int[]{bestDx, bestDy});
            for (int row = 0; row < group.size(); row++) group.get(row).slots.set(position, bestSlots.get(row));
        }
        if (!offsets.isEmpty()) {
            for (FieldRead read : rows) reassemble(read);
        }
        return offsets;
    }

    /** Re-read one player total digit at a player-lap column offset, only when its
     * pixels support the exact sum of cleanly read laps. */
    private void applyPlayerTotalColumnRefit(Mat canonical, SlotDetails details, Map<Integer, int[]> offsets) throws Exception {
        if (offsets == null || offsets.isEmpty()) return;
        List<FieldRead> rows = new ArrayList<>();
        FieldRead total = null;
        for (FieldRead read : details.fields) {
            if (!"player".equals(read.semanticOwner)) continue;
            if ("lap".equals(read.field.type)) rows.add(read);
            else if ("total".equals(read.field.type) && total == null) total = read;
        }
        if (total == null || !total.validFormat || segmentTimeMs(total.assembled) == null || rows.size() < 3) return;
        long lapSum = 0;
        for (FieldRead read : rows) {
            Integer ms = read.validFormat ? segmentTimeMs(read.assembled) : null;
            if (ms == null || !digitsReadCleanly(read.slots)) return;
            lapSum += ms;
        }
        String expected = formatSegmentTime(lapSum);
        if (expected == null || expected.equals(total.assembled)) return;
        int wrong = -1;
        for (int i = 0; i < expected.length(); i++) {
            if (expected.charAt(i) != total.assembled.charAt(i)) {
                if (wrong >= 0) return;
                wrong = i;
            }
        }
        boolean digitPosition = false;
        for (int position : SEGMENT_DIGIT_POSITIONS) digitPosition |= position == wrong;
        if (!digitPosition) return;
        int[] offset = offsets.get(wrong + 1);
        SlotRead original = total.slots.get(wrong);
        if (offset == null || !"digit".equals(original.type)) return;
        SlotRead best = null;
        int bestDx = 0;
        int bestDy = 0;
        for (int dy = Math.max(-2, offset[1] - 2); dy <= Math.min(2, offset[1] + 2); dy++) {
            for (int dx = Math.max(-8, offset[0] - 2); dx <= Math.min(8, offset[0] + 2); dx++) {
                SlotRead slot = scoreDigitAt(canonical, shiftedBox(original.box, dx, dy), original, "total");
                if (!slot.charValue.equals(String.valueOf(expected.charAt(wrong)))
                        || slot.confidence < Math.max(0.8, original.confidence + 0.05)) continue;
                if (best == null || slot.confidence > best.confidence) {
                    best = slot;
                    bestDx = dx;
                    bestDy = dy;
                }
            }
        }
        if (best == null) return;
        String from = total.assembled;
        total.slots.set(wrong, best);
        reassemble(total);
        if (details.lapSumRepairs == null) details.lapSumRepairs = new JSONArray();
        details.lapSumRepairs.put(new JSONObject().put("kind", "player_total_column_refit").put("owner", "player")
                .put("field", total.field.name).put("from", from).put("to", total.assembled)
                .put("method", "player_lap_column_pixel_sum").put("dx", bestDx).put("dy", bestDy));
        details.lapSumOk = fieldsLapSumComplete(details);
    }

    /** A ghost total's final digit can sit below the nominal slot row: two
     * independent vertical reads must agree with the sum of clean lap rows. */
    private void applyGhostTotalVerticalRefit(Mat canonical, SlotDetails details) throws Exception {
        if (Boolean.TRUE.equals(details.lapSumOk)) return;
        List<FieldRead> keys = ownerFieldsTotalFirst(details, "ghost");
        if (keys.size() < 3) return;
        FieldRead total = keys.get(0);
        if (!"ghost".equals(total.semanticOwner) || !total.validFormat) return;
        long lapSum = 0;
        for (int i = 1; i < keys.size(); i++) {
            FieldRead lap = keys.get(i);
            Integer ms = lap.validFormat ? segmentTimeMs(lap.assembled) : null;
            if (!"ghost".equals(lap.semanticOwner) || ms == null || !digitsReadCleanly(lap.slots)) return;
            lapSum += ms;
        }
        String expected = formatSegmentTime(lapSum);
        if (expected == null || expected.equals(total.assembled)) return;
        int wrong = -1;
        for (int i = 0; i < expected.length(); i++) {
            if (expected.charAt(i) != total.assembled.charAt(i)) {
                if (wrong >= 0) return;
                wrong = i;
            }
        }
        if (wrong != 7 || total.slots.size() <= 7) return;
        SlotRead original = total.slots.get(7);
        if (!"digit".equals(original.type)) return;
        SlotRead[] alternatives = new SlotRead[2];
        for (int dy = 1; dy <= 2; dy++) {
            SlotRead slot = scoreDigitAt(canonical, shiftedBox(original.box, 0, dy), original, "total");
            if (!slot.charValue.equals(String.valueOf(expected.charAt(7))) || slot.confidence < 0.85) return;
            alternatives[dy - 1] = slot;
        }
        String from = total.assembled;
        SlotRead chosen = alternatives[1].confidence >= alternatives[0].confidence ? alternatives[1] : alternatives[0];
        total.slots.set(7, chosen);
        reassemble(total);
        if (details.lapSumRepairs == null) details.lapSumRepairs = new JSONArray();
        details.lapSumRepairs.put(new JSONObject().put("kind", "ghost_total_vertical_refit").put("owner", "ghost")
                .put("field", total.field.name).put("from", from).put("to", total.assembled)
                .put("method", "ghost_total_vertical_pixel_sum").put("dy", chosen.box.top - original.box.top));
        details.lapSumOk = fieldsLapSumComplete(details);
    }

    // A lap sum that closes only after a repair counts as closed only when every
    // digit read at least this cleanly: on a dark translucent ghost card two
    // phone photos can repeat the same pair of compensating misreads (6 as 8 in
    // one lap, 5 as 3 in the next), and a confirmed repair would lock them.
    static final double REPAIR_MIN_DIGIT_CONFIDENCE = nl.mariokart8.iconmatcher.TimeDecision.REPAIR_MIN_DIGIT_CONFIDENCE;

    private double minDigitConfidence(SlotDetails details) {
        double min = 1.0;
        for (FieldRead read : details.fields) {
            for (SlotRead slot : read.slots) {
                if ("digit".equals(slot.type)) min = Math.min(min, slot.confidence);
            }
        }
        return min;
    }

    private void applyRepairConfidenceGuard(SlotDetails details) throws Exception {
        if (details.lapSumRepairs == null) return;
        double min = minDigitConfidence(details);
        if (!nl.mariokart8.iconmatcher.TimeDecision.repairGuardApplies(Boolean.TRUE.equals(details.lapSumOk),
                details.lapSumRepairs.length(), min)) return;
        details.lapSumOk = false;
        details.lapSumRepairs.put(new JSONObject().put("kind", "repair_confidence_guard")
                .put("min_digit_confidence", min).put("threshold", REPAIR_MIN_DIGIT_CONFIDENCE));
    }

    /** A closed ghost side of the seed read survives a refined read that opened it. */
    private void preserveClosedGhostSide(SlotDetails seed, SlotDetails refined) throws Exception {
        String physicalGhost = "top".equals(seed.yellowPlayerSlot) ? "player" : "ghost";
        List<FieldRead> seedRows = ownerFieldsTotalFirst(seed, physicalGhost);
        List<FieldRead> refinedRows = ownerFieldsTotalFirst(refined, physicalGhost);
        Long seedDelta = seedRows.isEmpty() ? null : lapSumDelta(seedRows, -1, null);
        Long refinedDelta = refinedRows.isEmpty() ? null : lapSumDelta(refinedRows, -1, null);
        if (seedRows.isEmpty() || seedDelta == null || seedDelta != 0L
                || (!refinedRows.isEmpty() && refinedDelta != null && refinedDelta == 0L)) return;
        Map<String, FieldRead> original = new LinkedHashMap<>();
        for (FieldRead read : seedRows) original.put(read.field.name, read);
        for (int i = 0; i < refined.fields.size(); i++) {
            FieldRead replacement = original.get(refined.fields.get(i).field.name);
            if (replacement != null) refined.fields.set(i, replacement);
        }
        JSONArray repairs = new JSONArray();
        JSONArray refinedRepairs = refined.lapSumRepairs == null ? new JSONArray() : refined.lapSumRepairs;
        for (int i = 0; i < refinedRepairs.length(); i++) {
            if (!physicalGhost.equals(refinedRepairs.getJSONObject(i).optString("owner"))) repairs.put(refinedRepairs.get(i));
        }
        JSONArray seedRepairs = seed.lapSumRepairs == null ? new JSONArray() : seed.lapSumRepairs;
        for (int i = 0; i < seedRepairs.length(); i++) {
            if (physicalGhost.equals(seedRepairs.getJSONObject(i).optString("owner"))) repairs.put(seedRepairs.get(i));
        }
        refined.lapSumRepairs = repairs;
        refined.lapSumOk = fieldsLapSumComplete(refined);
    }

    // A refit total digit must read at least this cleanly (ADR-0203 overlay).
    private static final double TOTAL_REFIT_MIN_DIGIT_CONFIDENCE = 0.6;

    /**
     * MK8DX ecosystem overlay (ADR-0203). When every lap of a card reads validly
     * but the total does not match their sum, the total alone is read again with
     * the stretch and shift fits: the total is the widest field and the one a
     * small scale error pushes furthest out of its slots (seen on the ghost
     * panel's header total). A refit is taken only when what it reads from the
     * image is exactly the laps' sum, every digit valid and read with at least
     * TOTAL_REFIT_MIN_DIGIT_CONFIDENCE; nothing is filled in from arithmetic. It
     * is recorded as a lap-sum repair, so it counts as one downstream.
     * With a cleanly read total, a single lap may instead be refit to the total
     * minus the other laps (a lap drifted a 9 into a 4 on an upright phone
     * photo); only when exactly one field of the card refits.
     */
    private void applyTotalRefit(Mat canonical, SlotDetails details) throws Exception {
        if (Boolean.TRUE.equals(details.lapSumOk)) {
            return;
        }
        JSONArray repairs = details.lapSumRepairs == null ? new JSONArray() : details.lapSumRepairs;
        boolean refitted = false;
        for (String owner : new String[]{"player", "ghost"}) {
            List<FieldRead> keys = ownerFieldsTotalFirst(details, owner);
            if (keys.size() < 3 || !"total".equals(keys.get(0).field.type)) {
                continue;
            }
            FieldRead total = keys.get(0);
            long lapSum = 0L;
            FieldRead unread = null;
            int unreadCount = 0;
            List<FieldRead> cleanLaps = new ArrayList<>();
            for (int i = 1; i < keys.size(); i++) {
                FieldRead lap = keys.get(i);
                Integer ms = lap.validFormat ? segmentTimeMs(lap.assembled) : null;
                if (ms == null) {
                    unread = lap;
                    unreadCount++;
                    continue;
                }
                lapSum += ms;
                if (digitsReadCleanly(lap.slots)) {
                    cleanLaps.add(lap);
                }
            }
            if (unreadCount > 1) {
                continue;
            }
            Integer totalMs = segmentTimeMs(total.assembled);
            if (unreadCount == 0 && totalMs != null && totalMs == lapSum) {
                continue;
            }
            boolean totalClean = totalMs != null && total.validFormat && digitsReadCleanly(total.slots);
            // One field is refit: the total to the laps' sum, or a single lap to
            // the total minus the other laps (a lap drifts like the total does),
            // also a lap that did not read at all. When several fields can be
            // refit, use the single fit that improves on its own pixel reading;
            // otherwise abstain.
            FieldRead chosenField = null;
            FieldFitResult chosen = null;
            int options = 0;
            FieldRead improvingField = null;
            FieldFitResult improvingFit = null;
            int improvingOptions = 0;
            if (unreadCount == 0) {
                FieldFitResult totalFit = refitTo(canonical, total, formatSegmentTime(lapSum), "total_lap_sum_refit", null);
                if (totalFit != null) {
                    chosenField = total;
                    chosen = totalFit;
                    options++;
                    if (totalFit.compareTo(FieldFitResult.baseline(total)) > 0) {
                        improvingField = total;
                        improvingFit = totalFit;
                        improvingOptions++;
                    }
                }
            }
            if (totalClean) {
                for (int i = 1; i < keys.size(); i++) {
                    FieldRead lap = keys.get(i);
                    if (unread != null && lap != unread) {
                        continue;
                    }
                    long others = lap == unread ? lapSum : lapSum - segmentTimeMs(lap.assembled);
                    List<FieldRead> siblings = new ArrayList<>(cleanLaps);
                    siblings.remove(lap);
                    FieldFitResult lapFit = refitTo(canonical, lap, formatSegmentTime(totalMs - others), "lap_total_refit", siblings);
                    if (lapFit != null) {
                        chosenField = lap;
                        chosen = lapFit;
                        options++;
                        if (lapFit.compareTo(FieldFitResult.baseline(lap)) > 0) {
                            improvingField = lap;
                            improvingFit = lapFit;
                            improvingOptions++;
                        }
                    }
                }
            }
            if (options > 1 && improvingOptions == 1) {
                chosenField = improvingField;
                chosen = improvingFit;
                options = 1;
            }
            if (options != 1) {
                continue;
            }
            String from = chosenField.assembled;
            chosen.accepted = true;
            applyFieldFitResult(chosenField, chosen);
            repairs.put(new JSONObject()
                    .put("kind", chosenField == total ? "total_refit" : "lap_refit")
                    .put("owner", owner)
                    .put("field", chosenField.field.name)
                    .put("from", from)
                    .put("to", chosen.text)
                    .put("method", chosen.method)
                    .put("dx", chosen.dx)
                    .put("scale", chosen.scale));
            refitted = true;
        }
        if (refitted) {
            details.lapSumRepairs = repairs;
            details.lapSumOk = fieldsLapSumComplete(details);
        }
    }

    /**
     * The first fit of a field that reads exactly want, every digit clean; or
     * null. First the slot columns of cleanly read sibling laps of the same card
     * (the lap rows share their digit columns, so this is measured geometry),
     * then the stretch and shift fits.
     */
    private FieldFitResult refitTo(Mat canonical, FieldRead read, String want, String method, List<FieldRead> siblings) throws Exception {
        if (want == null || want.equals(read.assembled)) {
            return null;
        }
        List<FieldFitResult> candidates = new ArrayList<>();
        if (siblings != null) {
            for (FieldRead sibling : siblings) {
                if (sibling.slots.size() != read.slots.size()) {
                    continue;
                }
                List<BoxD> boxes = new ArrayList<>();
                for (int i = 0; i < read.slots.size(); i++) {
                    BoxD own = read.slots.get(i).box;
                    BoxD column = sibling.slots.get(i).box;
                    boxes.add(new BoxD(column.left, own.top, column.right, own.bottom).clipped(canonical.cols(), canonical.rows()));
                }
                candidates.add(evaluateFieldBoxes(canonical, read, method + "_sibling_columns", boxes));
            }
        }
        candidates.addAll(stretchedFieldCandidates(canonical, read, method));
        for (double dx : new double[]{1.0, 2.0, 3.0, -1.0, -2.0}) {
            candidates.add(evaluateShiftedField(canonical, read, method, dx));
        }
        for (FieldFitResult candidate : candidates) {
            if (candidate.validFormat && want.equals(candidate.text) && digitsReadCleanly(candidate.slots)) {
                return candidate;
            }
        }
        return null;
    }

    private boolean digitsReadCleanly(List<SlotRead> slots) {
        for (SlotRead slot : slots) {
            if ("digit".equals(slot.type) && (!slot.valid || slot.confidence < TOTAL_REFIT_MIN_DIGIT_CONFIDENCE)) {
                return false;
            }
        }
        return true;
    }

    /** m:ss.mmm for a time under ten minutes, or null. */
    private static String formatSegmentTime(long ms) {
        if (ms < 0 || ms >= 600_000L) {
            return null;
        }
        long minutes = ms / 60_000L;
        long seconds = (ms / 1000L) % 60L;
        long millis = ms % 1000L;
        return String.format(java.util.Locale.ROOT, "%d:%02d.%03d", minutes, seconds, millis);
    }

    private void applyGuardedFieldFits(File imageDir, File cropDir, Mat canonical, SlotDetails details) throws Exception {
        long started = System.currentTimeMillis();
        int triggered = 0;
        int accepted = 0;
        JSONArray fields = new JSONArray();
        for (FieldRead read : details.fields) {
            if (!fieldNeedsRetry(read)) {
                continue;
            }
            triggered++;
            FieldFitResult result = retryFieldFit(canonical, read);
            if (result.accepted) {
                accepted++;
                applyFieldFitResult(read, result);
                rewriteFieldDigitCrops(cropDir, canonical, read);
            }
            read.guardedFit = result.toJson();
            fields.put(read.guardedFit);
        }
        details.guardedFitMeta = new JSONObject()
                .put("policy", "baseline_then_field_fit_on_unknown_or_invalid")
                .put("triggered_field_count", triggered)
                .put("accepted_field_count", accepted)
                .put("duration_ms", System.currentTimeMillis() - started)
                .put("methods", new JSONArray().put("field_x_shift_fit").put("field_x_right_projection_fit"))
                .put("acceptance_rule", "candidate accepted only when valid-format and unknown count improves")
                .put("fields", fields)
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "24_guarded_field_fit_retry.json"), details.guardedFitMeta);
    }

    private boolean fieldNeedsRetry(FieldRead read) {
        return !read.validFormat || read.physicalAssembled.contains("?");
    }

    private FieldFitResult retryFieldFit(Mat canonical, FieldRead read) {
        FieldFitResult baseline = FieldFitResult.baseline(read);
        FieldFitResult xShift = bestShiftedField(canonical, read, "field_x_shift_fit", new double[]{0.0, 1.0, 2.0});
        if (candidateImproves(baseline, xShift)) {
            xShift.accepted = true;
            return xShift;
        }
        FieldFitResult rightProjection = bestShiftedField(canonical, read, "field_x_right_projection_fit", new double[]{0.0, 1.0, 2.0, 3.0, -1.0});
        if (candidateImproves(baseline, rightProjection)) {
            rightProjection.accepted = true;
            return rightProjection;
        }
        // MK8DX ecosystem overlay (ADR-0203): the slot pitch comes from the scale
        // the badge spacing gives; on a photo a small scale error adds up digit by
        // digit across a wide field (the ghost-panel total drifted a whole slot).
        // Same acceptance rule as the shifts above.
        FieldFitResult stretch = bestStretchedField(canonical, read, "field_x_stretch_fit");
        if (candidateImproves(baseline, stretch)) {
            stretch.accepted = true;
            return stretch;
        }
        baseline.accepted = false;
        baseline.reason = "no_retry_candidate_improved_unknown_count_and_valid_format";
        baseline.methodsTried.put(xShift.toJson());
        baseline.methodsTried.put(rightProjection.toJson());
        baseline.methodsTried.put(stretch.toJson());
        return baseline;
    }

    // Slot pitch factors and shifts tried by the stretch fit (ADR-0203). The
    // narrowing factors stay: without them the tilted webcam series lost 3 of
    // its 22 exact reads, although a 0.94 squeeze once read a 9 as a clean but
    // wrong 4 (the lap sum refused it; the sibling-column refit repairs it).
    private static final double[] FIELD_STRETCH_FACTORS = {1.03, 1.06, 1.09, 1.12, 1.15, 0.97, 0.94};
    private static final double[] FIELD_STRETCH_SHIFTS = {0.0, 1.0, -1.0};

    /** The field's slots spread (or narrowed) about its first slot's left edge, then shifted. */
    private FieldFitResult bestStretchedField(Mat canonical, FieldRead read, String method) {
        FieldFitResult best = null;
        for (FieldFitResult candidate : stretchedFieldCandidates(canonical, read, method)) {
            if (best == null || candidate.compareTo(best) > 0) {
                best = candidate;
            }
        }
        return best == null ? FieldFitResult.baseline(read) : best;
    }

    private List<FieldFitResult> stretchedFieldCandidates(Mat canonical, FieldRead read, String method) {
        List<FieldFitResult> candidates = new ArrayList<>();
        if (read.slots.isEmpty()) {
            return candidates;
        }
        double anchor = read.slots.get(0).box.left;
        for (double factor : FIELD_STRETCH_FACTORS) {
            for (double dx : FIELD_STRETCH_SHIFTS) {
                List<BoxD> boxes = new ArrayList<>();
                for (SlotRead original : read.slots) {
                    boxes.add(new BoxD(
                            anchor + (original.box.left - anchor) * factor + dx,
                            original.box.top,
                            anchor + (original.box.right - anchor) * factor + dx,
                            original.box.bottom
                    ).clipped(canonical.cols(), canonical.rows()));
                }
                FieldFitResult result = evaluateFieldBoxes(canonical, read, method, boxes);
                result.dx = dx;
                result.scale = factor;
                candidates.add(result);
            }
        }
        return candidates;
    }

    /** Reads a field with the given slot boxes, the way evaluateShiftedField reads a shifted one. */
    private FieldFitResult evaluateFieldBoxes(Mat canonical, FieldRead read, String method, List<BoxD> boxes) {
        long started = System.currentTimeMillis();
        List<SlotRead> slots = new ArrayList<>();
        for (int i = 0; i < read.slots.size(); i++) {
            SlotRead original = read.slots.get(i);
            SlotRead slot = new SlotRead(original.index, original.type, boxes.get(i));
            slot.polarityOwner = original.polarityOwner;
            if ("digit".equals(original.type)) {
                Rect rect = boxes.get(i).toRect(canonical.cols(), canonical.rows());
                Mat crop = new Mat(canonical, rect).clone();
                try {
                    scoreSlot(crop, slot, slot.polarityOwner, read.field.type, slot.index);
                } finally {
                    crop.release();
                }
            } else {
                slot.charValue = original.type.equals("colon") ? ":" : ".";
                slot.valid = true;
            }
            slots.add(slot);
        }
        FieldFitResult result = new FieldFitResult();
        result.method = method;
        result.text = assemble(slots);
        result.validFormat = result.text.matches("\\d:\\d\\d\\.\\d\\d\\d");
        result.unknownCount = countUnknowns(result.text);
        result.averageConfidence = averageConfidence(slots);
        result.durationMs = System.currentTimeMillis() - started;
        result.slots = slots;
        result.reason = result.validFormat ? "candidate_valid_format" : "candidate_invalid_format";
        return result;
    }

    private boolean candidateImproves(FieldFitResult baseline, FieldFitResult candidate) {
        return candidate != null
                && candidate.validFormat
                && candidate.unknownCount < baseline.unknownCount;
    }

    private FieldFitResult bestShiftedField(Mat canonical, FieldRead read, String method, double[] dxValues) {
        FieldFitResult best = null;
        for (double dx : dxValues) {
            FieldFitResult candidate = evaluateShiftedField(canonical, read, method, dx);
            if (best == null || candidate.compareTo(best) > 0) {
                best = candidate;
            }
        }
        return best == null ? FieldFitResult.baseline(read) : best;
    }

    private FieldFitResult evaluateShiftedField(Mat canonical, FieldRead read, String method, double dx) {
        long started = System.currentTimeMillis();
        List<SlotRead> slots = new ArrayList<>();
        for (SlotRead original : read.slots) {
            BoxD shiftedBox = new BoxD(
                    original.box.left + dx,
                    original.box.top,
                    original.box.right + dx,
                    original.box.bottom
            ).clipped(canonical.cols(), canonical.rows());
            SlotRead slot = new SlotRead(original.index, original.type, shiftedBox);
            slot.polarityOwner = original.polarityOwner;
            if ("digit".equals(original.type)) {
                Rect rect = shiftedBox.toRect(canonical.cols(), canonical.rows());
                Mat crop = new Mat(canonical, rect).clone();
                try {
                    scoreSlot(crop, slot, slot.polarityOwner, read.field.type, slot.index);
                } finally {
                    crop.release();
                }
            } else {
                slot.charValue = original.type.equals("colon") ? ":" : ".";
                slot.valid = true;
            }
            slots.add(slot);
        }
        FieldFitResult result = new FieldFitResult();
        result.method = method;
        result.dx = dx;
        result.text = assemble(slots);
        result.validFormat = result.text.matches("\\d:\\d\\d\\.\\d\\d\\d");
        result.unknownCount = countUnknowns(result.text);
        result.averageConfidence = averageConfidence(slots);
        result.durationMs = System.currentTimeMillis() - started;
        result.slots = slots;
        result.reason = result.validFormat ? "candidate_valid_format" : "candidate_invalid_format";
        return result;
    }

    private void applyFieldFitResult(FieldRead read, FieldFitResult result) {
        read.slots.clear();
        read.slots.addAll(result.slots);
        read.physicalAssembled = result.text;
        read.assembled = result.text;
        read.validFormat = result.validFormat;
        read.rejectionReason = result.validFormat ? "" : "invalid_format_or_unknown_digit";
    }

    private void rewriteFieldDigitCrops(File cropDir, Mat canonical, FieldRead read) throws Exception {
        for (SlotRead slot : read.slots) {
            if (!"digit".equals(slot.type)) {
                continue;
            }
            Rect rect = slot.box.toRect(canonical.cols(), canonical.rows());
            Mat crop = new Mat(canonical, rect).clone();
            try {
                String cropName = read.field.name + "_slot_" + slot.index + ".png";
                writeMatImage(new File(cropDir, cropName), crop);
                slot.cropPath = "24_slot_details_digit_crops/" + cropName;
            } finally {
                crop.release();
            }
        }
    }

    private int countUnknowns(String text) {
        int count = 0;
        for (int i = 0; i < text.length(); i++) {
            if (text.charAt(i) == '?') {
                count++;
            }
        }
        return count;
    }

    private double averageConfidence(List<SlotRead> slots) {
        double total = 0.0;
        int count = 0;
        for (SlotRead slot : slots) {
            if ("digit".equals(slot.type)) {
                total += slot.confidence;
                count++;
            }
        }
        return count == 0 ? 0.0 : total / count;
    }

    private String digitPolarityOwner(String canonicalOwner, String yellowPosition) {
        if ("top".equals(yellowPosition)) {
            if ("ghost".equals(canonicalOwner)) {
                return "player";
            }
            if ("player".equals(canonicalOwner)) {
                return "ghost";
            }
        }
        return canonicalOwner;
    }

    private String semanticOwner(String physicalOwner, String yellowPosition) {
        if ("top".equals(yellowPosition)) {
            if ("ghost".equals(physicalOwner)) {
                return "player";
            }
            if ("player".equals(physicalOwner)) {
                return "ghost";
            }
        }
        return physicalOwner;
    }

    private String semanticFieldName(String physicalFieldName, String yellowPosition) {
        if (!"top".equals(yellowPosition)) {
            return physicalFieldName;
        }
        if (physicalFieldName.startsWith("player_")) {
            return "ghost_" + physicalFieldName.substring("player_".length());
        }
        if (physicalFieldName.startsWith("ghost_")) {
            return "player_" + physicalFieldName.substring("ghost_".length());
        }
        return physicalFieldName;
    }

    private void applySemanticDecodedValues(SlotDetails details, String yellowPosition) {
        for (FieldRead read : details.fields) {
            read.semanticFieldName = semanticFieldName(read.field.name, yellowPosition);
            read.semanticOwner = semanticOwner(read.field.owner, yellowPosition);
            read.semanticDecodedSourceField = read.field.name;
            read.assembled = read.physicalAssembled;
            read.validFormat = read.assembled.matches("\\d:\\d\\d\\.\\d\\d\\d");
            read.rejectionReason = read.validFormat ? "" : "invalid_format_or_unknown_digit";
        }
    }

    // --- Lap-som closure (accept_path=direct_lap_som) ------------------------
    // GT-vrij eigen-lees-bewijs uit de MK8-eigenschap dat rondetijden exact
    // optellen tot het totaal. Port van de server (_lap_sum_repair_fields +
    // _fields_lap_sum_complete in scripts/workflow_lab.py; corpus 960/960 wrong=0).
    // R1: precies één onbekende '?'-digit invullen als exact één cijfer de som
    // sluit. R2: precies één digit flippen als exact één unieke correctie de som
    // sluit. Ambigu (meerdere kandidaten) => niets doen; elke reparatie blijft
    // herleidbaar via lap_sum_repairs in de node-24/26-JSON.

    private static final int[] SEGMENT_DIGIT_POSITIONS = {0, 2, 3, 5, 6, 7};

    private void applyLapSumClosure(SlotDetails details) throws Exception {
        // The fill/flip decision is the central time decision (packages/icon-matcher TimeDecision,
        // the same rules as the Web scanner and Python); this engine applies the repair to its slots.
        JSONArray repairs = new JSONArray();
        for (String owner : new String[]{"player", "ghost"}) {
            List<FieldRead> keys = ownerFieldsTotalFirst(details, owner);
            if (keys.isEmpty()) {
                continue;
            }
            List<String> texts = new ArrayList<>();
            for (FieldRead read : keys) texts.add(read.assembled);
            nl.mariokart8.iconmatcher.TimeDecision.Repair repair = nl.mariokart8.iconmatcher.TimeDecision.lapSumClosure(texts);
            if (repair != null) {
                applyLapSumRepair(keys.get(repair.field), repair.pos, repair.to.charAt(repair.pos), repair.kind, owner, repairs);
            }
        }
        details.lapSumRepairs = repairs;
        details.lapSumOk = fieldsLapSumComplete(details);
    }

    /**
     * Velden van één kaart (physical owner) in server-volgorde: total eerst, dan
     * aaneengesloten laps 1..n. Leeg als de kaart incompleet is (geen total,
     * <2 laps, of een gat in de lap-nummering) — dan is reparatie niet eenduidig.
     */
    private List<FieldRead> ownerFieldsTotalFirst(SlotDetails details, String owner) {
        FieldRead total = null;
        List<FieldRead> laps = new ArrayList<>();
        for (FieldRead read : details.fields) {
            if (!owner.equals(read.field.owner)) {
                continue;
            }
            if ("total".equals(read.field.type)) {
                total = read;
            } else if ("lap".equals(read.field.type)) {
                laps.add(read);
            }
        }
        Collections.sort(laps, new Comparator<FieldRead>() {
            @Override
            public int compare(FieldRead a, FieldRead b) {
                return Integer.compare(a.field.lapIndex, b.field.lapIndex);
            }
        });
        List<FieldRead> keys = new ArrayList<>();
        if (total == null || laps.size() < 2) {
            return keys;
        }
        for (int i = 0; i < laps.size(); i++) {
            if (laps.get(i).field.lapIndex != i + 1) {
                return keys;
            }
        }
        keys.add(total);
        keys.addAll(laps);
        return keys;
    }

    /**
     * som(laps) - total in ms over de kaartvelden (keys[0] = total), waarbij het
     * veld op replaceIdx vervangen wordt door replacement. Null zodra één veld
     * geen geldige tijd parst.
     */
    private Long lapSumDelta(List<FieldRead> keys, int replaceIdx, String replacement) {
        long total = 0;
        long lapSum = 0;
        for (int i = 0; i < keys.size(); i++) {
            String text = i == replaceIdx ? replacement : keys.get(i).assembled;
            Integer ms = segmentTimeMs(text);
            if (ms == null) {
                return null;
            }
            if (i == 0) {
                total = ms;
            } else {
                lapSum += ms;
            }
        }
        return lapSum - total;
    }

    private void applyLapSumRepair(FieldRead read, int pos, char digit, String kind, String owner, JSONArray repairs) throws Exception {
        String from = read.assembled;
        String to = replaceCharAt(from, pos, digit);
        read.physicalAssembled = to;
        read.assembled = to;
        read.validFormat = to.matches("\\d:\\d\\d\\.\\d\\d\\d");
        if (read.validFormat) {
            read.rejectionReason = "";
        }
        if (read.slots.size() == to.length()) {
            SlotRead slot = read.slots.get(pos);
            if ("digit".equals(slot.type)) {
                slot.charValue = String.valueOf(digit);
                slot.valid = true;
                slot.rejectionReason = "";
            }
        }
        repairs.put(new JSONObject()
                .put("owner", owner)
                .put("semantic_owner", read.semanticOwner)
                .put("field", read.field.name)
                .put("semantic_field", read.semanticFieldName)
                .put("kind", kind)
                .put("char_pos", pos)
                .put("from", from)
                .put("to", to));
    }

    /**
     * Server-semantiek (_fields_lap_sum_complete): true als ELKE aanwezige kaart
     * compleet en rekenkundig sluitend is (total + alle laps parsen en sommeren
     * exact tot het totaal), met minstens één kaart aanwezig.
     */
    private boolean fieldsLapSumComplete(SlotDetails details) {
        List<nl.mariokart8.iconmatcher.TimeDecision.OwnerTimes> owners = new ArrayList<>();
        for (String owner : new String[]{"player", "ghost"}) {
            String total = null;
            List<String> laps = new ArrayList<>();
            for (FieldRead read : details.fields) {
                if (!owner.equals(read.field.owner)) {
                    continue;
                }
                if ("total".equals(read.field.type)) {
                    total = read.assembled;
                } else if ("lap".equals(read.field.type)) {
                    laps.add(read.assembled);
                }
            }
            owners.add(new nl.mariokart8.iconmatcher.TimeDecision.OwnerTimes(total, laps));
        }
        return nl.mariokart8.iconmatcher.TimeDecision.lapSumComplete(owners);
    }

    private static String replaceCharAt(String text, int pos, char c) {
        return text.substring(0, pos) + c + text.substring(pos + 1);
    }

    /** "M:SS.mmm" met SS<=59, anders ongeldig. */
    private static boolean formatSegmentValid(String text) {
        if (text == null || text.length() != 8 || text.charAt(1) != ':' || text.charAt(4) != '.') {
            return false;
        }
        if (!Character.isDigit(text.charAt(0))) {
            return false;
        }
        for (int pos : new int[]{2, 3, 5, 6, 7}) {
            if (!Character.isDigit(text.charAt(pos))) {
                return false;
            }
        }
        int seconds = Integer.parseInt(text.substring(2, 4));
        return seconds >= 0 && seconds <= 59;
    }

    private static Integer segmentTimeMs(String text) {
        if (!formatSegmentValid(text)) {
            return null;
        }
        return Integer.parseInt(text.substring(0, 1)) * 60000
                + Integer.parseInt(text.substring(2, 4)) * 1000
                + Integer.parseInt(text.substring(5, 8));
    }

    private void scoreSlot(Mat crop, SlotRead slot, String polarityOwner, String kind, int slotIndex) {
        Mat gray = new Mat();
        Mat binary = new Mat();
        try {
            if (crop.channels() == 1) {
                gray = crop.clone();
            } else {
                Imgproc.cvtColor(crop, gray, Imgproc.COLOR_BGR2GRAY);
            }
            if ("player".equals(polarityOwner) && "lap".equals(kind)) {
                Core.bitwise_not(gray, gray);
            }
            Imgproc.GaussianBlur(gray, gray, new org.opencv.core.Size(3, 3), 0);
            Imgproc.threshold(gray, binary, 0, 255, Imgproc.THRESH_BINARY | Imgproc.THRESH_OTSU);
            SegmentTemplate template = "total".equals(kind) ? totalTemplate : lapTemplate;
            SegmentCandidate candidate = template == null ? null : bestSegmentCandidate(binary, template, kind, slotIndex);
            Map<String, Double> scores = candidate == null ? segmentScores(binary) : candidate.values;
            slot.segmentScores.putAll(scores);
            if (candidate != null) {
                slot.templateX = candidate.x;
                slot.templateY = candidate.y;
                slot.templateW = candidate.w;
                slot.templateH = candidate.h;
                slot.templateScaleX = candidate.scaleX;
                slot.templateScaleY = candidate.scaleY;
                slot.confidence = candidate.confidence;
            }
            StringBuilder pattern = new StringBuilder();
            for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
                boolean on = scores.get(key) >= 0.35;
                slot.segmentOn.put(key, on);
                pattern.append(on ? "1" : "0");
            }
            slot.pattern = pattern.toString();
            slot.charValue = decodePattern(slot.pattern);
            slot.valid = !"?".equals(slot.charValue);
            if (!slot.valid) {
                slot.rejectionReason = "unsupported_digit_pattern";
            }
        } finally {
            gray.release();
            binary.release();
        }
    }

    // The central 7-segment matcher (packages/icon-matcher SegmentDigits, the same specification as
    // the Web scanner and Python; CENTRAL_RECOGNITION section 8.6 phase 2) reads the binary slot.
    private final Map<SegmentTemplate, nl.mariokart8.iconmatcher.SegmentDigits.Template> sharedTemplates =
            new java.util.IdentityHashMap<>();

    private nl.mariokart8.iconmatcher.SegmentDigits.Template sharedTemplate(SegmentTemplate template) {
        return sharedTemplates.computeIfAbsent(template, source -> {
            String[] keys = nl.mariokart8.iconmatcher.SegmentDigits.KEYS;
            int[][][] points = new int[keys.length][][];
            for (int k = 0; k < keys.length; k++) {
                List<PointI> src = source.points.get(keys[k]);
                points[k] = new int[src == null ? 0 : src.size()][];
                for (int i = 0; src != null && i < src.size(); i++) points[k][i] = new int[]{src.get(i).x, src.get(i).y};
            }
            return new nl.mariokart8.iconmatcher.SegmentDigits.Template(source.width, source.height, points);
        });
    }

    private static byte[] binaryBytes(Mat binary) {
        byte[] bytes = new byte[binary.cols() * binary.rows()];
        Mat continuous = binary.isContinuous() ? binary : binary.clone();
        try {
            continuous.get(0, 0, bytes);
        } finally {
            if (continuous != binary) continuous.release();
        }
        return bytes;
    }

    private SegmentCandidate bestSegmentCandidate(Mat binary, SegmentTemplate base, String kind, int slotIndex) {
        nl.mariokart8.iconmatcher.SegmentDigits.Candidate shared = nl.mariokart8.iconmatcher.SegmentDigits.best(
                binaryBytes(binary), binary.cols(), binary.rows(), sharedTemplate(base), kind, slotIndex, null);
        if (shared == null) {
            return null;
        }
        SegmentCandidate candidate = new SegmentCandidate();
        String[] keys = nl.mariokart8.iconmatcher.SegmentDigits.KEYS;
        for (int k = 0; k < keys.length; k++) {
            candidate.values.put(keys[k], shared.values[k]);
            candidate.states.put(keys[k], shared.values[k] >= nl.mariokart8.iconmatcher.SegmentDigits.SEGMENT_ON);
        }
        candidate.pattern = shared.pattern;
        candidate.decoded = shared.decoded;
        candidate.valid = shared.valid;
        candidate.onCount = shared.onCount;
        candidate.confidence = shared.confidence;
        candidate.margin = shared.margin;
        candidate.x = shared.x;
        candidate.y = shared.y;
        candidate.w = shared.w;
        candidate.h = shared.h;
        candidate.scaleX = shared.scaleX;
        candidate.scaleY = shared.scaleY;
        return candidate;
    }

    private SegmentCandidate scoreTemplateAt(Mat binary, SegmentTemplate template, int tx, int ty, double sx, double sy) {
        SegmentCandidate candidate = new SegmentCandidate();
        candidate.x = tx;
        candidate.y = ty;
        candidate.w = template.width;
        candidate.h = template.height;
        candidate.scaleX = sx;
        candidate.scaleY = sy;
        int onCount = 0;
        double confidenceSum = 0.0;
        int confidenceCount = 0;
        for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
            List<PointI> points = template.points.get(key);
            int total = 0;
            int on = 0;
            if (points != null) {
                for (PointI point : points) {
                    int xx = tx + point.x;
                    int yy = ty + point.y;
                    if (0 <= xx && xx < binary.cols() && 0 <= yy && yy < binary.rows()) {
                        total++;
                        double[] value = binary.get(yy, xx);
                        if (value != null && value.length > 0 && value[0] > 127.0) {
                            on++;
                        }
                    }
                }
            }
            double frac = total == 0 ? 0.0 : on / (double) total;
            boolean state = frac >= 0.35;
            candidate.values.put(key, frac);
            candidate.states.put(key, state);
            onCount += state ? 1 : 0;
            confidenceSum += state ? frac : (1.0 - frac);
            confidenceCount++;
        }
        candidate.pattern = patternFromStates(candidate.states);
        candidate.decoded = decodePattern(candidate.pattern);
        candidate.valid = !"?".equals(candidate.decoded);
        candidate.onCount = onCount;
        candidate.confidence = confidenceCount == 0 ? 0.0 : confidenceSum / confidenceCount;
        candidate.margin = segmentMargin(candidate.values, candidate.states);
        return candidate;
    }

    private String patternFromStates(Map<String, Boolean> states) {
        StringBuilder pattern = new StringBuilder();
        for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
            pattern.append(Boolean.TRUE.equals(states.get(key)) ? "1" : "0");
        }
        return pattern.toString();
    }

    private double segmentMargin(Map<String, Double> values, Map<String, Boolean> states) {
        double activeTotal = 0.0;
        int activeCount = 0;
        double inactiveMax = 0.0;
        for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
            double value = values.containsKey(key) ? values.get(key) : 0.0;
            if (Boolean.TRUE.equals(states.get(key))) {
                activeTotal += value;
                activeCount++;
            } else {
                inactiveMax = Math.max(inactiveMax, value);
            }
        }
        double activeMean = activeCount == 0 ? 0.0 : activeTotal / activeCount;
        return activeMean - inactiveMax;
    }

    private Map<String, Double> segmentScores(Mat binary) {
        Map<String, Double> scores = new LinkedHashMap<>();
        double[] shared = nl.mariokart8.iconmatcher.SegmentDigits.segmentScores(binaryBytes(binary), binary.cols(), binary.rows());
        String[] keys = nl.mariokart8.iconmatcher.SegmentDigits.KEYS;
        for (int k = 0; k < keys.length; k++) scores.put(keys[k], shared[k]);
        return scores;
    }

    private double coverage(Mat binary, double x1, double y1, double x2, double y2) {
        int left = Math.max(0, Math.min(binary.cols() - 1, (int) Math.round(binary.cols() * x1)));
        int top = Math.max(0, Math.min(binary.rows() - 1, (int) Math.round(binary.rows() * y1)));
        int right = Math.max(left + 1, Math.min(binary.cols(), (int) Math.round(binary.cols() * x2)));
        int bottom = Math.max(top + 1, Math.min(binary.rows(), (int) Math.round(binary.rows() * y2)));
        Mat roi = new Mat(binary, new Rect(left, top, right - left, bottom - top));
        try {
            return Core.countNonZero(roi) / Math.max(1.0, roi.rows() * roi.cols());
        } finally {
            roi.release();
        }
    }

    private String decodePattern(String pattern) {
        Map<String, String> map = new LinkedHashMap<>();
        map.put("1111110", "0");
        map.put("0001100", "1");
        map.put("0110111", "2");
        map.put("0011111", "3");
        map.put("1001101", "4");
        map.put("1011011", "5");
        map.put("1111011", "6");
        map.put("0001110", "7");
        map.put("1111111", "8");
        map.put("1011111", "9");
        return map.containsKey(pattern) ? map.get(pattern) : "?";
    }

    private void writeSlotDetails(File imageDir, File workflowDir, Mat canonical, SlotDetails slotDetails, Result result) throws Exception {
        JSONObject root = slotDetails.toJson()
                .put("stage", "24_SevenSegmentOCRProbe")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("evidence_source", ACCEPTED_EVIDENCE)
                .put("coordinate_space", "player_card_crop")
                .put("threshold_used", 0.35)
                .put("guarded_field_fit_retry", slotDetails.guardedFitMeta == null ? JSONObject.NULL : slotDetails.guardedFitMeta)
                .put("visual_artifacts_suppressed", suppressVisualArtifacts)
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "24_slot_details_evidence.json"), root);
        writeJson(new File(workflowDir, "24_SevenSegmentOCRProbe.json"), root);
        writeJson(new File(imageDir, "24_fixed_grid_segment_evidence_diagnostic.json"), new JSONObject()
                .put("stage", "24_SevenSegmentOCRProbe")
                .put("evidence_source", DIAGNOSTIC_EVIDENCE)
                .put("diagnostic_only", true)
                .put("not_used_for_accepted_decode", true)
                .put("no_runtime_label_fallback", true));
        if (!suppressVisualArtifacts) {
            writeMatImage(new File(imageDir, "24_seven_segment_ocr_probe_overlay.png"), slotOverlay(canonical, slotDetails));
            writeMatImage(new File(workflowDir, "24_SevenSegmentOCRProbe.png"), slotOverlay(canonical, slotDetails));
        }
        result.mark("24_SevenSegmentOCRProbe", "implemented_slot_details");
    }


    /** R2-verificatie: kleine veld-crops (totaal + laps) uit de canonical zodat
     *  de gelezen waarde naast het originele beeld te controleren is. */
    private void saveFieldCrops(File imageDir, Mat canonical, SlotDetails details) {
        try {
            File dir = new File(imageDir, "26_field_crops");
            dir.mkdirs();
            for (FieldRead fr : details.fields) {
                String name = fr.semanticFieldName == null || fr.semanticFieldName.isEmpty()
                        ? fr.field.name : fr.semanticFieldName;
                BoxD b = fr.field.box;
                int x = (int) Math.max(0, b.left - 2);
                int y = (int) Math.max(0, b.top - 2);
                int w = (int) Math.min(canonical.cols() - x, b.right - b.left + 4);
                int h = (int) Math.min(canonical.rows() - y, b.bottom - b.top + 4);
                if (w < 4 || h < 4) {
                    continue;
                }
                Mat crop = new Mat(canonical, new org.opencv.core.Rect(x, y, w, h));
                org.opencv.imgcodecs.Imgcodecs.imwrite(new File(dir, name + ".png").getAbsolutePath(), crop);
                crop.release();
            }
        } catch (Exception ignored) {
        }
    }

    private void writeOcrDecode(File imageDir, File workflowDir, SlotDetails details, Result result) throws Exception {
        JSONObject root = new JSONObject()
                .put("stage", "26_OfflineOCRDecode")
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("accepted_decode_source", "24_slot_details_evidence.json")
                .put("evidence_source", ACCEPTED_EVIDENCE)
                .put("fixed_grid_used_for_accepted_decode", false)
                .put("expected_values_validation_only", true)
                .put("no_runtime_label_fallback", true);
        JSONArray fields = new JSONArray();
        int valid = 0;
        for (FieldRead field : details.fields) {
            JSONObject row = field.toJson();
            fields.put(row);
            if (field.validFormat) {
                valid++;
            }
        }
        root.put("fields", fields);
        root.put("field_count", details.fields.size());
        root.put("valid_field_count", valid);
        root.put("frame_valid", valid == details.fields.size());
        root.put("lap_sum_ok", details.lapSumOk == null ? JSONObject.NULL : details.lapSumOk);
        root.put("lap_sum_repairs", details.lapSumRepairs == null ? new JSONArray() : details.lapSumRepairs);
        root.put("accept_path", Boolean.TRUE.equals(details.lapSumOk) ? "direct_lap_som" : "slot_details_default");
        writeJson(new File(imageDir, "26_ocr_result_slot_details.json"), root);
        writeJson(new File(imageDir, "26_ocr_result_fields_slot_details.json"), new JSONObject().put("fields", fields).put("expected_values_validation_only", true));
        writeJson(new File(workflowDir, "26_OfflineOCRDecode.json"), root);
        result.mark("26_OfflineOCRDecode", "implemented_offline_slot_details");
        StringBuilder readLine = new StringBuilder();
        for (FieldRead field : details.fields) {
            if (readLine.length() > 0) {
                readLine.append("  ");
            }
            String name = field.semanticFieldName == null || field.semanticFieldName.isEmpty() ? field.field.name : field.semanticFieldName;
            readLine.append(name).append("=").append(field.assembled);
        }
        DebugConsole.log("READ", "[" + imageDir.getName() + "] " + readLine
                + " | lap_sum_ok=" + details.lapSumOk
                + (details.lapSumRepairs != null && details.lapSumRepairs.length() > 0 ? " repairs=" + details.lapSumRepairs.length() : ""));
    }

    private void writeLateStageRouteReport(File imageDir, File workflowDir) throws Exception {
        JSONArray route = new JSONArray()
                .put("18_CanonicalPlayerBoxAlign")
                .put("19_RFDetr3ClassDetect")
                .put("20_RFDetrLapIndexRefine")
                .put("21_RFDetrDynamicLapGrid")
                .put("24_SevenSegmentOCRProbe")
                .put("26_OfflineOCRDecode");
        JSONArray diagnostic = new JSONArray()
                .put("22_FixedMK8Grid")
                .put("23_TimeTrialEndscreenGate")
                .put("25_SevenSegmentOCRInspect");
        JSONObject root = new JSONObject()
                .put("stage", "26_OfflineOCRDecode")
                .put("report", "late_stage_route")
                .put("status", "implemented")
                .put("production_minimal", suppressVisualArtifacts)
                .put("required_compute_route_after_step18", route)
                .put("removed_non_compute_steps", diagnostic)
                .put("normal_app_route", "18->19->20->21->24->26")
                .put("debug_visual_route", "18->19->20->21->24->26")
                .put("diagnostic_steps_executed", false)
                .put("diagnostic_steps_removed_from_apk_runtime", diagnostic)
                .put("accepted_decode_source", "24_slot_details_evidence.json")
                .put("fixed_grid_used_for_accepted_decode", false)
                .put("policy", "accepted_late_compute_route_only")
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, "26_late_stage_route_report.json"), root);
        writeJson(new File(workflowDir, "26_late_stage_route_report.json"), root);
    }

    private String assemble(List<SlotRead> slots) {
        StringBuilder out = new StringBuilder();
        for (SlotRead slot : slots) {
            out.append(slot.charValue == null ? "?" : slot.charValue);
        }
        return out.toString();
    }

    private String slotType(int oneBased) {
        if (oneBased == 2) {
            return "colon";
        }
        if (oneBased == 5) {
            return "dot";
        }
        return "digit";
    }

    private void writeMaskStage(File imageDir, File workflowDir, String number, String name, String imageName, String statsName, Mat mat, Result result) throws Exception {
        writeMaskStage(imageDir, workflowDir, number, name, imageName, statsName, mat, maskStats(mat, imageName), result);
    }

    private void writeMaskStage(File imageDir, File workflowDir, String number, String name, String imageName, String statsName, Mat mat, JSONObject stats, Result result) throws Exception {
        writeMatImage(new File(imageDir, imageName), mat);
        writeMatImage(new File(workflowDir, number + "_" + name + ".png"), mat);
        JSONObject json = stats.put("stage", number + "_" + name).put("status", "implemented").put("implementation_mode", "native_android_buildable_pending_device").put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, statsName), json);
        writeJson(new File(workflowDir, number + "_" + name + ".json"), json);
        result.mark(number + "_" + name, "implemented");
    }

    private void writeLineStage(File imageDir, File workflowDir, String number, String name, String jsonName, String overlayName, Mat base, List<Line> lines, Result result) throws Exception {
        writeLineStage(imageDir, workflowDir, number, name, jsonName, overlayName, base, lines, result, null);
    }

    private void writeLineStage(File imageDir, File workflowDir, String number, String name, String jsonName, String overlayName, Mat base, List<Line> lines, Result result, JSONObject extraMeta) throws Exception {
        JSONObject root = new JSONObject()
                .put("stage", number + "_" + name)
                .put("status", "implemented")
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("line_count", lines.size())
                .put("lines", linesJson(lines))
                .put("no_runtime_label_fallback", true);
        if (extraMeta != null) {
            Iterator<String> keys = extraMeta.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                root.put(key, extraMeta.get(key));
            }
        }
        if ("12".equals(number)) {
            root.put("hough_input_artifact", "11_canny_edges.png");
            root.put("visual_base_artifact", "10_morphology.png");
        }
        writeJson(new File(imageDir, jsonName), root);
        if ("12".equals(number)) {
            writeJson(new File(imageDir, "12_hough_lines.json"), root);
        }
        writeJson(new File(workflowDir, number + "_" + name + ".json"), root);
        Mat overlay = lineOverlay(base, lines);
        writeMatImage(new File(imageDir, overlayName), overlay);
        if ("12".equals(number)) {
            writeMatImage(new File(imageDir, "12_hough_lines.png"), overlay);
        }
        writeMatImage(new File(workflowDir, number + "_" + name + ".png"), overlay);
        overlay.release();
        result.mark(number + "_" + name, "implemented");
    }

    private void writeQuadStage(File imageDir, File workflowDir, String number, String name, String jsonName, String overlayName, Mat base, Quad quad, Result result) throws Exception {
        JSONObject root = quadGeometry(number + "_" + name, quad, base.cols(), base.rows(), "native_android_buildable_pending_device");
        writeJson(new File(imageDir, jsonName), root);
        writeJson(new File(workflowDir, number + "_" + name + ".json"), root);
        Mat overlay = quadOverlay(base, quad);
        writeMatImage(new File(imageDir, overlayName), overlay);
        writeMatImage(new File(workflowDir, number + "_" + name + ".png"), overlay);
        overlay.release();
        result.mark(number + "_" + name, "implemented");
    }

    private void writeBlocked(File imageDir, File workflowDir, String number, String name, String jsonName, String status, String reason, Result result) throws Exception {
        JSONObject root = new JSONObject()
                .put("stage", number + "_" + name)
                .put("status", status)
                .put("reason", reason)
                .put("implementation_mode", "native_android_buildable_pending_device")
                .put("no_runtime_label_fallback", true);
        writeJson(new File(imageDir, jsonName), root);
        writeJson(new File(workflowDir, number + "_" + name + ".json"), root);
        result.mark(number + "_" + name, status);
    }

    private JSONObject maskStats(Mat mask, String artifactName) throws Exception {
        int nonzero = Core.countNonZero(mask);
        return new JSONObject()
                .put("artifact_name", artifactName)
                .put("mask_width", mask.cols())
                .put("mask_height", mask.rows())
                .put("nonzero_pixels", nonzero)
                .put("nonzero_ratio", nonzero / Math.max(1.0, mask.rows() * mask.cols()))
                .put("coordinate_space", "auto_card_roi_local");
    }

    private JSONObject quadGeometry(String stage, Quad quad, int width, int height, String mode) throws Exception {
        return new JSONObject()
                .put("stage", stage)
                .put("status", "implemented")
                .put("implementation_mode", mode)
                .put("ordered_quad_points", quad.toJson())
                .put("output_width", width)
                .put("output_height", height)
                .put("no_runtime_label_fallback", true);
    }

    private JSONArray linesJson(List<Line> lines) throws Exception {
        JSONArray arr = new JSONArray();
        for (Line line : lines) {
            arr.put(lineJson(line));
        }
        return arr;
    }

    private Mat lineOverlay(Mat base, List<Line> lines) {
        Mat out = ensureBgr(base);
        for (Line line : lines) {
            Imgproc.line(out, new Point(Math.round(line.x1), Math.round(line.y1)), new Point(Math.round(line.x2), Math.round(line.y2)), new Scalar(80, 80, 255), 1, Imgproc.LINE_AA);
        }
        return out;
    }

    private Mat quadOverlay(Mat base, Quad quad) {
        Mat out = ensureBgr(base);
        Point[] p = quad.points();
        for (int i = 0; i < p.length; i++) {
            Imgproc.line(out, p[i], p[(i + 1) % p.length], new Scalar(0, 255, 0), 3);
        }
        return out;
    }

    private Mat gridOverlay(Mat base, List<FieldBox> fields, Scalar color) {
        Mat out = ensureBgr(base);
        for (FieldBox field : fields) {
            Imgproc.rectangle(out, new Point(field.box.left, field.box.top), new Point(field.box.right, field.box.bottom), color, 2);
        }
        return out;
    }

    private Mat slotOverlay(Mat base, SlotDetails details) {
        Mat out = ensureBgr(base);
        for (FieldRead field : details.fields) {
            for (SlotRead slot : field.slots) {
                Scalar color = slot.valid ? new Scalar(0, 255, 0) : new Scalar(0, 0, 255);
                Imgproc.rectangle(out, new Point(slot.box.left, slot.box.top), new Point(slot.box.right, slot.box.bottom), color, 1);
            }
        }
        return out;
    }

    private Mat ensureBgr(Mat input) {
        Mat out = new Mat();
        if (input.channels() == 1) {
            Imgproc.cvtColor(input, out, Imgproc.COLOR_GRAY2BGR);
        } else {
            out = input.clone();
        }
        return out;
    }

    private Bitmap detectionOverlay(Bitmap bitmap, List<RfDetrDetector.Detection> detections, AutoCardRoiSelector.Box roi) {
        Bitmap out = bitmap.copy(Bitmap.Config.ARGB_8888, true);
        Canvas canvas = new Canvas(out);
        Paint paint = new Paint();
        paint.setStyle(Paint.Style.STROKE);
        paint.setStrokeWidth(3.0f);
        for (RfDetrDetector.Detection detection : detections) {
            paint.setColor("lap_index".equals(detection.label) ? Color.GREEN : ("player_timetrail_box".equals(detection.label) ? Color.YELLOW : Color.CYAN));
            canvas.drawRect(detection.left * bitmap.getWidth(), detection.top * bitmap.getHeight(), detection.right * bitmap.getWidth(), detection.bottom * bitmap.getHeight(), paint);
        }
        return out;
    }

    private Bitmap matToBitmap(Mat mat) {
        Mat rgba = new Mat();
        try {
            if (mat.channels() == 1) {
                Imgproc.cvtColor(mat, rgba, Imgproc.COLOR_GRAY2RGBA);
            } else {
                Imgproc.cvtColor(mat, rgba, Imgproc.COLOR_BGR2RGBA);
            }
            Bitmap bitmap = Bitmap.createBitmap(rgba.cols(), rgba.rows(), Bitmap.Config.ARGB_8888);
            Utils.matToBitmap(rgba, bitmap);
            return bitmap;
        } finally {
            rgba.release();
        }
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
            if (mat.channels() == 1 || mat.channels() == 3) {
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

    private void writeJson(File file, JSONObject root) throws Exception {
        File parent = file.getParentFile();
        if (parent != null) {
            parent.mkdirs();
        }
        try (FileOutputStream out = new FileOutputStream(file)) {
            out.write(root.toString(2).getBytes(StandardCharsets.UTF_8));
        }
    }

    private boolean isImageArtifact(File file) {
        String name = file.getName().toLowerCase(java.util.Locale.US);
        return name.endsWith(".png") || name.endsWith(".jpg") || name.endsWith(".jpeg");
    }





    public static class Result {
        public final Map<String, String> stageStatus = new LinkedHashMap<>();

        void mark(String stage, String status) {
            stageStatus.put(stage, status);
        }

        public JSONObject toJson() throws Exception {
            JSONObject root = new JSONObject();
            for (String key : stageStatus.keySet()) {
                root.put(key, stageStatus.get(key));
            }
            return root;
        }
    }

    private static class ShortLineGuardResult {
        final List<Line> lines;
        final boolean guardUsed;
        final boolean fallbackUsed;
        final String reason;
        final int rawAxisLineCount;
        final int acceptedLineCount;
        final int rejectedShortLineCount;
        final int acceptedHorizontalClusterCount;
        final int acceptedVerticalClusterCount;

        ShortLineGuardResult(List<Line> lines, boolean guardUsed, boolean fallbackUsed, String reason, int rawAxisLineCount, int acceptedLineCount, int rejectedShortLineCount, int acceptedHorizontalClusterCount, int acceptedVerticalClusterCount) {
            this.lines = lines;
            this.guardUsed = guardUsed;
            this.fallbackUsed = fallbackUsed;
            this.reason = reason;
            this.rawAxisLineCount = rawAxisLineCount;
            this.acceptedLineCount = acceptedLineCount;
            this.rejectedShortLineCount = rejectedShortLineCount;
            this.acceptedHorizontalClusterCount = acceptedHorizontalClusterCount;
            this.acceptedVerticalClusterCount = acceptedVerticalClusterCount;
        }

        JSONObject toJson() throws Exception {
            return new JSONObject()
                    .put("short_line_guard_enabled", true)
                    .put("short_line_guard_used", guardUsed)
                    .put("short_line_guard_fallback_used", fallbackUsed)
                    .put("short_line_min_length_px", ANGLE_FILTER_SHORT_LINE_MIN_LENGTH_PX)
                    .put("short_line_guard_reason", reason)
                    .put("raw_axis_line_count", rawAxisLineCount)
                    .put("accepted_line_count", acceptedLineCount)
                    .put("rejected_short_line_count", rejectedShortLineCount)
                    .put("accepted_horizontal_cluster_count", acceptedHorizontalClusterCount)
                    .put("accepted_vertical_cluster_count", acceptedVerticalClusterCount)
                    .put("coordinate_space", "auto_card_roi_local")
                    .put("fallback_policy", "use_unfiltered_axis_lines_when_short_line_filter_removes_required_two_horizontal_two_vertical_cluster_support");
        }
    }

    private static class Quad {
        final Point tl;
        final Point tr;
        final Point br;
        final Point bl;

        Quad(Point tl, Point tr, Point br, Point bl) {
            this.tl = tl;
            this.tr = tr;
            this.br = br;
            this.bl = bl;
        }

        static Quad fromRect(Rect rect) {
            return new Quad(
                    new Point(rect.x, rect.y),
                    new Point(rect.x + rect.width, rect.y),
                    new Point(rect.x + rect.width, rect.y + rect.height),
                    new Point(rect.x, rect.y + rect.height)
            );
        }

        Quad shifted(double dx, double dy) {
            return new Quad(new Point(tl.x + dx, tl.y + dy), new Point(tr.x + dx, tr.y + dy), new Point(br.x + dx, br.y + dy), new Point(bl.x + dx, bl.y + dy));
        }

        Point[] points() {
            return new Point[]{tl, tr, br, bl};
        }

        JSONArray toJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (Point p : points()) {
                arr.put(new JSONArray().put(p.x).put(p.y));
            }
            return arr;
        }
    }

    private static class DynamicGrid {
        boolean available;
        String status = "implemented";
        String reason = "";
        String evidenceSource = ACCEPTED_EVIDENCE;
        int matchedLapIndexCount = 0;
        int width;
        int height;
        int activeLapCount = 0;
        int expectedFieldCount = 0;
        String raceKey = "race7";
        String activeProfileStatus = "unresolved";
        String profileSource = "";
        final List<String> activeOwners = new ArrayList<>();
        final JSONObject ownerProfileEvidence = new JSONObject();
        final List<FieldBox> fields = new ArrayList<>();
        // per-frame owner-anker (mean center van de gematchte lap-index-detecties);
        // de identiteits-matcher legt hiermee de kaartpanel-box residu-vrij
        final Map<String, double[]> ownerAnchors = new LinkedHashMap<>();

        JSONObject toJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (FieldBox field : fields) {
                arr.put(field.toJson());
            }
            JSONObject profile = new JSONObject()
                    .put("status", activeProfileStatus)
                    .put("profile_source", profileSource)
                    .put("active_owners", new JSONArray(activeOwners))
                    .put("active_lap_count", activeLapCount)
                    .put("expected_field_count", expectedFieldCount)
                    .put("owner_profile_evidence", ownerProfileEvidence)
                    .put("no_runtime_label_fallback", true);
            return new JSONObject()
                    .put("available", available)
                    .put("status", status)
                    .put("reason", reason)
                    .put("evidence_source", evidenceSource)
                    .put("grid_mode", "owner_lap_count_aware")
                    .put("canonical_race_key", raceKey)
                    .put("active_ocr_profile", profile)
                    .put("matched_lap_index_count", matchedLapIndexCount)
                    .put("coordinate_space", "player_card_crop")
                    .put("no_runtime_label_fallback", true)
                    .put("parent_width", width)
                    .put("parent_height", height)
                    .put("expected_field_count", expectedFieldCount)
                    .put("field_count", fields.size())
                    .put("fields", arr);
        }
    }

    private static class BoxD {
        final double left;
        final double top;
        final double right;
        final double bottom;

        BoxD(double left, double top, double right, double bottom) {
            this.left = Math.min(left, right);
            this.top = Math.min(top, bottom);
            this.right = Math.max(left, right);
            this.bottom = Math.max(top, bottom);
        }

        BoxD clipped(int width, int height) {
            return new BoxD(Math.max(0, Math.min(width - 1, left)), Math.max(0, Math.min(height - 1, top)), Math.max(1, Math.min(width, right)), Math.max(1, Math.min(height, bottom)));
        }

        double width() {
            return Math.max(1.0, right - left);
        }

        double height() {
            return Math.max(1.0, bottom - top);
        }

        double centerX() {
            return (left + right) * 0.5;
        }

        double centerY() {
            return (top + bottom) * 0.5;
        }

        Rect toRect(int width, int height) {
            int x = Math.max(0, Math.min(width - 1, (int) Math.round(left)));
            int y = Math.max(0, Math.min(height - 1, (int) Math.round(top)));
            int r = Math.max(x + 1, Math.min(width, (int) Math.round(right)));
            int b = Math.max(y + 1, Math.min(height, (int) Math.round(bottom)));
            return new Rect(x, y, r - x, b - y);
        }

        JSONArray toJson() throws Exception {
            return new JSONArray().put(left).put(top).put(right).put(bottom);
        }
    }

    private static class YellowSlot {
        final String position;
        final double topScore;
        final double bottomScore;

        YellowSlot(String position, double topScore, double bottomScore) {
            this.position = position;
            this.topScore = topScore;
            this.bottomScore = bottomScore;
        }

        JSONObject toJson() throws Exception {
            return new JSONObject().put("top", topScore).put("bottom", bottomScore);
        }
    }

    private static class CanonicalAlignResult {
        Mat image;
        BoxD currentBox;
        BoxD targetBox;
        double scaleX;
        double scaleY;
        double translateX;
        double translateY;
        String yellowPosition;
        JSONObject yellowScores;
        String targetOwnerUsed;
        String raceKey;
        String raceProfileSource;
        String targetBoxSource;
        JSONObject step01LapProfileEvidence;

        JSONArray matrixJson() throws Exception {
            return new JSONArray()
                    .put(new JSONArray().put(scaleX).put(0.0).put(translateX))
                    .put(new JSONArray().put(0.0).put(scaleY).put(translateY));
        }
    }

    private static class TargetBox {
        final double[] box;
        final String source;

        TargetBox(double[] box, String source) {
            this.box = box;
            this.source = source;
        }
    }

    private static class FieldBox {
        final String name;
        final String owner;
        final String type;
        final int lapIndex;
        final BoxD box;
        final List<BoxD> explicitSlots;

        FieldBox(String name, String owner, String type, int lapIndex, BoxD box) {
            this(name, owner, type, lapIndex, box, null);
        }

        FieldBox(String name, String owner, String type, int lapIndex, BoxD box, List<BoxD> explicitSlots) {
            this.name = name;
            this.owner = owner;
            this.type = type;
            this.lapIndex = lapIndex;
            this.box = box;
            this.explicitSlots = explicitSlots == null ? null : new ArrayList<>(explicitSlots);
        }

        List<BoxD> slotBoxes() {
            if (explicitSlots != null && !explicitSlots.isEmpty()) {
                return new ArrayList<>(explicitSlots);
            }
            List<BoxD> slots = new ArrayList<>();
            double slotW = (box.right - box.left) / 8.0;
            for (int i = 0; i < 8; i++) {
                slots.add(new BoxD(box.left + i * slotW, box.top, box.left + (i + 1) * slotW, box.bottom));
            }
            return slots;
        }

        JSONObject toJson() throws Exception {
            return toJson(name, owner);
        }

        JSONObject toJson(String fieldName, String fieldOwner) throws Exception {
            return new JSONObject().put("field_name", fieldName).put("owner", fieldOwner).put("field_type", type).put("lap_index", lapIndex).put("field_box", box.toJson());
        }
    }

    private static class DetectionCandidate {
        final int index;
        final RfDetrDetector.Detection detection;
        final BoxD box;

        DetectionCandidate(int index, RfDetrDetector.Detection detection, BoxD box) {
            this.index = index;
            this.detection = detection;
            this.box = box;
        }
    }

    private static class FieldFitResult {
        String method = "baseline";
        String reason = "";
        String text = "";
        double dx = 0.0;
        // Slot pitch factor of a stretch fit (ADR-0203 overlay); 1.0 otherwise.
        double scale = 1.0;
        boolean validFormat;
        boolean accepted;
        int unknownCount;
        double averageConfidence;
        long durationMs;
        List<SlotRead> slots = new ArrayList<>();
        final JSONArray methodsTried = new JSONArray();

        static FieldFitResult baseline(FieldRead read) {
            FieldFitResult result = new FieldFitResult();
            result.method = "baseline";
            result.reason = "baseline_decode";
            result.text = read.physicalAssembled;
            result.validFormat = read.validFormat;
            result.unknownCount = 0;
            for (int i = 0; i < result.text.length(); i++) {
                if (result.text.charAt(i) == '?') {
                    result.unknownCount++;
                }
            }
            double total = 0.0;
            int count = 0;
            for (SlotRead slot : read.slots) {
                if ("digit".equals(slot.type)) {
                    total += slot.confidence;
                    count++;
                }
            }
            result.averageConfidence = count == 0 ? 0.0 : total / count;
            result.slots = new ArrayList<>(read.slots);
            return result;
        }

        int compareTo(FieldFitResult other) {
            if (validFormat != other.validFormat) {
                return validFormat ? 1 : -1;
            }
            if (unknownCount != other.unknownCount) {
                return Integer.compare(other.unknownCount, unknownCount);
            }
            int confidence = Double.compare(averageConfidence, other.averageConfidence);
            if (confidence != 0) {
                return confidence;
            }
            return Double.compare(Math.abs(other.dx), Math.abs(dx));
        }

        JSONObject toJson() {
            JSONObject root = new JSONObject();
            try {
                root.put("method", method)
                        .put("reason", reason)
                        .put("text", text)
                        .put("dx", dx)
                        .put("scale", scale)
                        .put("valid_format", validFormat)
                        .put("accepted", accepted)
                        .put("unknown_count", unknownCount)
                        .put("average_confidence", averageConfidence)
                        .put("duration_ms", durationMs)
                        .put("methods_tried", methodsTried)
                        .put("no_runtime_label_fallback", true);
            } catch (Exception ignored) {
            }
            return root;
        }
    }

    private static class SlotRead {
        final int index;
        final String type;
        final BoxD box;
        String cropPath = "";
        String charValue = "?";
        String pattern = "";
        String polarityOwner = "";
        boolean valid;
        String rejectionReason = "";
        double confidence = 0.0;
        int templateX = 0;
        int templateY = 0;
        int templateW = 0;
        int templateH = 0;
        double templateScaleX = 1.0;
        double templateScaleY = 1.0;
        final Map<String, Double> segmentScores = new LinkedHashMap<>();
        final Map<String, Boolean> segmentOn = new LinkedHashMap<>();

        SlotRead(int index, String type, BoxD box) {
            this.index = index;
            this.type = type;
            this.box = box;
        }

        JSONObject toJson() throws Exception {
            JSONObject scores = new JSONObject();
            for (String key : segmentScores.keySet()) {
                scores.put(key, segmentScores.get(key));
            }
            JSONObject on = new JSONObject();
            for (String key : segmentOn.keySet()) {
                on.put(key, segmentOn.get(key));
            }
            return new JSONObject()
                    .put("slot_index", index)
                    .put("slot_type", type)
                    .put("box", box.toJson())
                    .put("crop_path", cropPath)
                    .put("segment_scores", scores)
                    .put("segment_on", on)
                    .put("digit_pattern", pattern)
                    .put("decoded_digit", charValue)
                    .put("char", charValue)
                    .put("confidence", confidence)
                    .put("polarity_owner", polarityOwner)
                    .put("template_match", new JSONObject()
                            .put("template_scale_mode", "slot_scale_float")
                            .put("template_scale_x", templateScaleX)
                            .put("template_scale_y", templateScaleY)
                            .put("template_w", templateW)
                            .put("template_h", templateH)
                            .put("template_box_in_patch", new JSONArray().put(templateX).put(templateY).put(templateX + templateW).put(templateY + templateH)))
                    .put("valid", valid)
                    .put("rejection_reason", rejectionReason);
        }
    }

    private static class FieldRead {
        final FieldBox field;
        final List<SlotRead> slots = new ArrayList<>();
        String physicalAssembled = "";
        String semanticFieldName = "";
        String semanticOwner = "";
        String semanticDecodedSourceField = "";
        String assembled = "";
        boolean validFormat;
        String rejectionReason = "";
        JSONObject guardedFit;

        FieldRead(FieldBox field) {
            this.field = field;
        }

        JSONObject toJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (SlotRead slot : slots) {
                arr.put(slot.toJson());
            }
            String outputFieldName = semanticFieldName == null || semanticFieldName.isEmpty() ? field.name : semanticFieldName;
            String outputOwner = semanticOwner == null || semanticOwner.isEmpty() ? field.owner : semanticOwner;
            return field.toJson()
                    .put("field_name", outputFieldName)
                    .put("owner", outputOwner)
                    .put("physical_field", field.name)
                    .put("physical_owner", field.owner)
                    .put("semantic_owner", outputOwner)
                    .put("physical_assembled_field", physicalAssembled)
                    .put("semantic_decoded_source_field", semanticDecodedSourceField)
                    .put("slots", arr)
                    .put("decoded_value", assembled)
                    .put("raw_assembled_string", assembled)
                    .put("valid_format", validFormat)
                    .put("rejection_reason", rejectionReason)
                    .put("guarded_field_fit_retry", guardedFit == null ? JSONObject.NULL : guardedFit);
        }
    }

    private static class SlotDetails {
        final List<FieldRead> fields = new ArrayList<>();
        String yellowPlayerSlot = "";
        boolean swappedPlayerGhost;
        JSONObject guardedFitMeta;
        Boolean lapSumOk;
        JSONArray lapSumRepairs;

        JSONObject toJson() throws Exception {
            JSONArray arr = new JSONArray();
            for (FieldRead field : fields) {
                arr.put(field.toJson());
            }
            return new JSONObject()
                    .put("fields", arr)
                    .put("field_count", fields.size())
                    .put("lap_sum_ok", lapSumOk == null ? JSONObject.NULL : lapSumOk)
                    .put("lap_sum_repairs", lapSumRepairs == null ? new JSONArray() : lapSumRepairs)
                    .put("guarded_field_fit_retry", guardedFitMeta == null ? JSONObject.NULL : guardedFitMeta)
                    .put("yellow_player_slot", yellowPlayerSlot)
                    .put("semantic_owner_mapping", new JSONObject()
                            .put("swapped_player_ghost", swappedPlayerGhost)
                            .put("reason", swappedPlayerGhost
                                    ? "yellow/player card is in the top physical slot; physical player/ghost fields are remapped to semantic owners"
                                    : "physical and semantic player/ghost fields match"));
        }
    }

    public static class SegmentTemplate {
        final int width;
        final int height;
        final Map<String, List<PointI>> points;

        public SegmentTemplate(int width, int height, Map<String, List<PointI>> points) {
            this.width = width;
            this.height = height;
            this.points = points;
        }

        SegmentTemplate scaled(double scaleX, double scaleY) {
            int dstW = Math.max(1, (int) Math.round(width * Math.max(0.05, scaleX)));
            int dstH = Math.max(1, (int) Math.round(height * Math.max(0.05, scaleY)));
            Map<String, List<PointI>> scaled = new LinkedHashMap<>();
            for (String key : new String[]{"a", "b", "c", "d", "e", "f", "g"}) {
                Map<String, PointI> unique = new LinkedHashMap<>();
                List<PointI> src = points.get(key);
                if (src != null) {
                    for (PointI point : src) {
                        int x = Math.max(0, Math.min(dstW - 1, (int) Math.round(point.x * scaleX)));
                        int y = Math.max(0, Math.min(dstH - 1, (int) Math.round(point.y * scaleY)));
                        unique.put(x + "," + y, new PointI(x, y));
                    }
                }
                scaled.put(key, new ArrayList<>(unique.values()));
            }
            return new SegmentTemplate(dstW, dstH, scaled);
        }
    }

    public static class PointI {
        final int x;
        final int y;

        public PointI(int x, int y) {
            this.x = x;
            this.y = y;
        }
    }

    private static class SegmentCandidate implements Comparable<SegmentCandidate> {
        final Map<String, Double> values = new LinkedHashMap<>();
        final Map<String, Boolean> states = new LinkedHashMap<>();
        String pattern = "";
        String decoded = "?";
        boolean valid;
        int onCount;
        double confidence;
        double margin;
        int x;
        int y;
        int w;
        int h;
        double scaleX = 1.0;
        double scaleY = 1.0;

        @Override
        public int compareTo(SegmentCandidate other) {
            int validCompare = Boolean.compare(valid, other.valid);
            if (validCompare != 0) {
                return validCompare;
            }
            double thisMargin = valid ? margin : -1.0;
            double otherMargin = other.valid ? other.margin : -1.0;
            int marginCompare = Double.compare(thisMargin, otherMargin);
            if (marginCompare != 0) {
                return marginCompare;
            }
            int confidenceCompare = Double.compare(confidence, other.confidence);
            if (confidenceCompare != 0) {
                return confidenceCompare;
            }
            return Integer.compare(onCount, other.onCount);
        }
    }

    // Select-a-Ghost-paneelregistratie (ADR-0203).
    private double[] ghostRegistration = null;
    private JSONObject lastGhostRegistration = null;
    /**
     * MK8DX ecosystem overlay (ADR-0203; CENTRAL_RECOGNITION section 8.6, phase 5). The badge column
     * fixes a ghost panel's position, turn and height, but not its width or perspective, so digits far
     * from the badges drift out of their template slots. The panel's constant parts (every ':' and
     * '.', the lap badges, the X button and the magnifier) are found in the canonical near their spot
     * on the clean reference of the same variant (gradient cross-correlation), and one homography
     * through them (RANSAC) maps this canonical onto the reference. The decision (search windows,
     * sub-pixel peak, how many anchors must agree, how far the warp may move the panel) is the central
     * PanelRegistration (the same specification as the Web scanner and Python); the gradient match and
     * findHomography are this engine's pixel work. Null when the canonical stays as it was.
     */
    private Mat ghostPanelRegistration(Mat canonical, String raceKey) throws Exception {
        GhostPanelReference.Anchor[] anchors = "race7".equals(raceKey) ? GhostPanelReference.RACE7 : GhostPanelReference.RACE3;
        List<int[]> boxes = new ArrayList<>();
        for (GhostPanelReference.Anchor a : anchors) {
            boxes.add(new int[]{a.left, a.top, a.right, a.bottom});
        }
        int m = GhostPanelReference.MARGIN;
        Mat grad = gradientMagnitude(canonical);
        nl.mariokart8.iconmatcher.PanelRegistration.Result decision;
        try {
            decision = nl.mariokart8.iconmatcher.PanelRegistration.registerPanel(raceKey, boxes, grad.cols(), grad.rows(),
                    new nl.mariokart8.iconmatcher.PanelRegistration.Pixels() {
                        @Override
                        public double[] match(int index, int[] w) {
                            GhostPanelReference.Anchor a = anchors[index];
                            Mat patchGray = new Mat(a.height, a.width, CvType.CV_8UC1);
                            patchGray.put(0, 0, android.util.Base64.decode(a.data, android.util.Base64.DEFAULT));
                            Mat patchGrad = gradientMagnitude(patchGray);
                            Mat patch = patchGrad.submat(m, m + (a.bottom - a.top), m, m + (a.right - a.left));
                            Mat window = grad.submat(w[1], w[3], w[0], w[2]);
                            Mat res = new Mat();
                            try {
                                Imgproc.matchTemplate(window, patch, res, Imgproc.TM_CCOEFF_NORMED);
                                Core.MinMaxLocResult mm = Core.minMaxLoc(res);
                                int x = (int) mm.maxLoc.x;
                                int y = (int) mm.maxLoc.y;
                                return new double[]{mm.maxVal, x, y, at(res, y, x - 1), at(res, y, x + 1), at(res, y - 1, x), at(res, y + 1, x)};
                            } finally {
                                patchGray.release();
                                patchGrad.release();
                                patch.release();
                                window.release();
                                res.release();
                            }
                        }

                        @Override
                        public nl.mariokart8.iconmatcher.PanelRegistration.Homography homography(List<double[]> found, List<double[]> reference) {
                            Point[] src = new Point[found.size()];
                            Point[] dst = new Point[reference.size()];
                            for (int i = 0; i < src.length; i++) {
                                src[i] = new Point(found.get(i)[0], found.get(i)[1]);
                                dst[i] = new Point(reference.get(i)[0], reference.get(i)[1]);
                            }
                            MatOfPoint2f srcMat = new MatOfPoint2f(src);
                            MatOfPoint2f dstMat = new MatOfPoint2f(dst);
                            Mat inlierMask = new Mat();
                            Mat h = Geometry.findHomography(srcMat, dstMat, Geometry.RANSAC,
                                    nl.mariokart8.iconmatcher.PanelRegistration.RANSAC_THRESHOLD, inlierMask);
                            srcMat.release();
                            dstMat.release();
                            int inliers = inlierMask.empty() ? 0 : Core.countNonZero(inlierMask);
                            inlierMask.release();
                            if (h == null || h.empty()) {
                                if (h != null) {
                                    h.release();
                                }
                                return new nl.mariokart8.iconmatcher.PanelRegistration.Homography(null, inliers);
                            }
                            double[] r = new double[9];
                            h.get(0, 0, r);
                            h.release();
                            return new nl.mariokart8.iconmatcher.PanelRegistration.Homography(r, inliers);
                        }
                    });
        } finally {
            grad.release();
        }
        JSONObject info = new JSONObject();
        for (Map.Entry<String, Object> entry : decision.info.entrySet()) {
            info.put(entry.getKey(), entry.getValue());
        }
        lastGhostRegistration = info;
        if (decision.h == null) {
            return null;
        }
        Mat h = new Mat(3, 3, CvType.CV_64F);
        h.put(0, 0, decision.h);
        return h;
    }

    /** A match-result value, NaN outside the map (no sub-pixel step at the border). */
    private static double at(Mat res, int y, int x) {
        if (x < 0 || y < 0 || x >= res.cols() || y >= res.rows()) {
            return Double.NaN;
        }
        return res.get(y, x)[0];
    }

    /** Gradient magnitude of a grey or BGR image: 3x3 Gaussian, then 3x3 Sobel (CV_32F). */
    private static Mat gradientMagnitude(Mat image) {
        Mat gray = new Mat();
        if (image.channels() == 3) {
            Imgproc.cvtColor(image, gray, Imgproc.COLOR_BGR2GRAY);
        } else {
            image.copyTo(gray);
        }
        Mat f = new Mat();
        gray.convertTo(f, CvType.CV_32F);
        gray.release();
        Imgproc.GaussianBlur(f, f, new org.opencv.core.Size(3, 3), 0);
        Mat gx = new Mat();
        Mat gy = new Mat();
        Imgproc.Sobel(f, gx, CvType.CV_32F, 1, 0);
        Imgproc.Sobel(f, gy, CvType.CV_32F, 0, 1);
        Mat mag = new Mat();
        Core.magnitude(gx, gy, mag);
        f.release();
        gx.release();
        gy.release();
        return mag;
    }

    // GENERATED ghost panel reference: tooling/qa/ghost_panel_reference.py
    static final class GhostPanelReference {
        static final int MARGIN = 2;
        static final class Anchor {
            final String name; final int left, top, right, bottom, width, height; final String data;
            Anchor(String name, int left, int top, int right, int bottom, int width, int height, String data) {
                this.name = name; this.left = left; this.top = top; this.right = right; this.bottom = bottom;
                this.width = width; this.height = height; this.data = data;
            }
        }
        static final Anchor[] RACE3 = {
            new Anchor("ghost_lap_1:colon2", 626, 194, 645, 229, 23, 39, "V1paW1taVlBQVlpbXFxdW1pbWllWVVhYWVpbXFlTUVVWV1lcXFxcXFxcWllXV1dZWVtcWFJUV1dXWFpcXVxcW1xaWlhWV1hcXVtXUVRaWFdXWFpcXFtcW1lZVlRweFhbW1ZQU1laVldYWVxbW1tYZnN2c9zcsVNcVVBVWl1XVldZW1tbWlCt3NzZ6uzMm2xZTVZZW1dWVlhaWltbWMvs6uvrx5PK01hQVldbWVdWV1lZWltZZ8Tu6sqNwezzfkxTVVdWU1NXWllZW1xXW8bti8rr6e9/TFFTYoyQXlBXV1dXV1dXZpZt7Ojt8H9OUlWm5+vPT1ZVVFRUVFRTV2ns6uvvgU5TVNft7PJ0VVVWVlVVVFNTaO3r6++CUVNP1ezt7WpWWFdXV1ZWVFRn7ezs7oJUVVN7yc6WTVxaWFpZWVdVVGnu6evugFJWVVdiXlhUW1lYWVlaWFVUWd/q7O6EUVhUVVdUVFVaWVhZWFhXVGBSbtru74ZVWFdUVlRUVllZWFhYVHCwullYZ93YcFNZWFZVVFRWWFdXWVdnyOzqWFpVoJ5OWFhXVlRTVFVWV1dujHzt6epZV2fQ42NWWFZWU1NUVVdYR7i+ibjv61Rv0OrviVVYWFZTU1RVVldDwLq3jaOyX8nq6u6OVlZVVVNUVFVWV0K/u7e+eFVW7Ovs7pFVVFNPa3BWVVdWQL65uLqOUVTt7Ozsj1ZSTnzO3KlNVlM+v7i3uo9RVe7s7O6MT05Gvu3r8GpQUTy/uLi5kVNR7uzr7o1NSz/Z7Ov0g0pQO764uLqSUlHr7OvukE5RSJTi4MVOS088vbe3uo9Rc9Ht6+2RUlRUV3t/ZExNTT2+tbqqTJPkhc/s75ZWVVVWVlVUUlFTQLy4omK04+3mh8vabVNVVlZVU1JRUVJRa69Ive3s6+rpe29RVVVVVlVTUVFSU1NQQ5vs6+vj49NoUVRUVVVVVFFRUFJUU1JGftzh32tpZUxUVFRUVFVVUVFRVFRVT01LbnBwUE9MT1RUVFRVVVNQUFJUVVRNTE1UVFRQTktRVFNUVFRTU09OUlRUU05MTVNUVFNOTFFTU1RTUlRST09TVVRRTExNU1NUVU5MUlRTWFZSVlJPT1RVVFFMTE5UU1RTTU1SVFNWVFNWUk5PU1RSUE1LT1RUVVFNT1FTU1NTVFRRTk5SVFJQTUtQVFVU"),
            new Anchor("ghost_lap_1:dot5", 677, 194, 696, 229, 23, 39, "VFZXVlVUVFRUVlVSUVRUV1pbW11YUVNYWltZV1RVWFZUUlBSUlFSVlhXWFZSUllcXVpXU1ZZWllUUlZXUlNWVFRVUlFSWVxbWlZUWFtbV1RWWllWVVhZWllVU1SLjHNXVVNZXFpWU1dbWVdWWFpYZ5uSl9vZ1GJTUllbWVRWWVtaVlZaXVuu3Nja6uzJc2pRWVpXVFdZWltWVlloepXk7OruyJKXr1pYW1ZUV1lZWlVVW4eNjH/k6MiBjrm6blVZVlRXWltYVVZbhoqMdZ3Zepe5urpwVlhVVVhaWldVV1qEiomHb4Fburq4u3JWWFRVWFpZVlZYWoSJiIdqW1u8uba8c1ZZVFZYWVhVVllahImHhmlXXLu6t710V1hUVVlaWFVXWVmDioeGalZbvLm3vXNVV1RVV1lWVlhYWYOKh4hsVVm5ubi+clJXU1VXV1RXWFhYg4mHh2lXZ465uL1xU1ZSUlVVVFdXWFiBiod6XWe5pJe2u21PU1BQUlJUVVZXV32LdUuJl7i6moukYVFSTk5QUFJSUlJVWHpch7q6ubmWdMBUVVRRUFBSU1JRUVBtunWzuLi7kXvI63FTV1RSUlRWVVZWUZ24tJapt111zOjxhFBYVlJSVFdWVlZVn7i2v4uLVtDt6/CGUFhXU1JTVVZXVlKduLe6jldZ6+zr8IZPV1ZUU1NUVVZVU5y2trqRUVjq7Ovwh01WVlVUVFNTVFRSnLW1uZJSWOrr6++JSlZWVVVWVFNTU1CbtLW6lFJX6uvr74pJVVZWVlZWVFNSTpa1truVUlfr6+rwiUhSVFVbiWJQVFJOlbS3u5BWmKPj6u+LSFFRf7zWwGJUVE2UtrqhbKrhvKXq8IVMTk677O/rh1FUT5C5oUi/4O3ut6XFZVJPSrrt6u2FUlNVXIhruO7s6uvqj2hUVFJNcc7hvmFVU1NNS3/r7uzMy8JkT1JTVk5Mcn9vUVdUUk1NaLq7u2doZEpNTU9QTFBRU1RVVVJSTE9Ra2tsTk1OSUtOTU5MSk1QUFNTUU9MUVFPT1FMTFNOUFNQUU9MTU5PT05OTUxOUE5OTUtPVVBQVFRTUE5OUVFQUE9MTE5NTk1NS1BVUU9SU1NSUk5TVFRSUExNUFFPT09MUVRTT1BTVFNOT1RVVFRQS05UU1RUU0xRU1NQT1JTU05OU1RUVE9KTlRTVFVS"),
            new Anchor("ghost_lap_1:badge", 580, 197, 610, 226, 34, 33, "VlVVVFVZWVlYV1NQU1RST1RWU1RTVFVYWFhaW1xbW1paW1ZVU1NVXFpdXFlWVVlaV1NVWVRXU1FRU1VUVlhYWFhYWFtVVFFSV1tcW1tYVVdbW1lWWFtYVFNXU1ZXVlZXVlZVVlZXeXt8fH94bFpbVldYW1pYVVhhWFRVWVZYW1pYV1ZWVlZUVWZoamlpcoaGblpWWVtbW1ZYW1dSV1tXV1xaWVlYWFhZU49ISEhISEpYX3d0WlpcXFhUWFtVU1dcWFVZWFpaWVlZWkrfR0dHR0dGRkhQZ3hfWFpWVFlZVVJWW1lXVVhYWVlZWVlK4UdHR0hHR0dHR0pac11YVlRYWVRTVlpZWlRYV1hZWVlYSeJHR0ZGR0dFRkREQ1dnWVZWWVlRVFhZWVlXV1dYWFhYWEji4OHh4eFYQ0RDRENDW1tTWVlXUVRYWVlYWVhYWFdXWFdH4ezt7OvsY0BDQkJCQ0haTllZVVBSWFlZWFlZWFdXV1ZXR+HFwdvr7WU+QkFBQEFBUFBVW1VQVFhZWVlYWVhYWFdWV0fhQjOj7e5kPkFAQEBAQEZSSlhTUFZYWFlYWFhYWFhXV1dH4kEzo+3vZD5AQEBAQD9ATkRXU1BWWFhYWFhYWFhYWFhZSOE/MaPv72g+QD8/P0A/PkVCVlJRWFlZWFhYWFdYV1dZWU+cPi+i7+9nPD49Pj4+Pj0/QFNRUVZYWVhYWFdWVlZWVVRUUD0uoe/wZjs8PD09PT08Oz1OUU9TVVZVVVVUU1NUVFRUSpU9LaLw8Gc4Ozs7PDw7Ozo7TlBQUFBQUE9PT1BRUVJUVkTdPCyg8PBoNzs7Ozs6OTk5PE9PVFNQTkxOUFBQUE9PUlFF4Tsrn/DwZjY6Ojo7Ojk4Nz5PUFNUUFBSVVNUUlBQT1FSROE5Kp/w8Gk1OTo5Ojg2NTVAT1FTU1JUVlZXV1ZTUlJTVEPhOCqg8fBrNDc3Nzc2NTQ1Sk5PUVNUVldWVVVWVFNTVFRC4jcpnPDwazQ3NzY2NTUzO05OTVBTVVZWVVZWVlRRUlRVQuM2JJrs6WgzNTU1NDQxM0xSS09QUlVWVVZWVlVTUVJUVEHhNTQzNzM0NTU1NDQxLzxUUk1PUFJWVlZWVlZWU1FSVFNB4DQzNDQ1NDQ0NDQyLjxPVVFNU1JQVVVVV1ZVVVNRUlNVP9wyMTEyMjEwMTExMDhPU1RPTVVUT1NVVVVVVlVTUVJTWUeDLzAvMDAvLSwrMj5LUlVTT05VU1BSVVVVVVZVVFJSU1BMTykqKiosKyswOENMT1FSUE5OVFNQUFNVVFVWVVRSUlJSTVMyMjIyMzU7Q0hNT09QUFFMTlVTUVBRU1RUVFRUVFNTUE9URUhGRURGSUxNT09PT09QTk9TU1JQT1BTVFNTVFRVU01OVUxMTEpISElJSktNTU5NTExSVFRSU1FPT1FRU1JUVFJMTlNSU1FPTUtLS0lKSkpJSUlKTVBSUVNTUE5OT09QUFFPS01R"),
            new Anchor("ghost_lap_2:colon2", 627, 235, 646, 270, 23, 39, "TU1NTU1OTU1OTktLUU5PT0tNU1NTVFRLTk9PTU5MS0tKSEdKS05PS01RUlJUU05RVFNSUE9PT01JSElLTk1NTU1PTlFSTVBTUlFRUFBSUk5MTE9PTU5OTVFTU1ObeExTUlFQUVNUUU1OUFBPTVBfo6imqO7pfFJVUlFSU1RRTk5QUE1MQsTw7Ozr7MORo1VSUVJTVFJRUE5NTE9Le9vs6+uuhdvujVFSU1JVVFNQTktKTVJOfOrs643Z7O+vTlFSUVpjVFBPTEdPUlNPeczL1evu7a5OVFJdusmZR1JKSEtOU1BJaGrv6+vtrU1RRKzs7OtvTktJTU5NTUxRUuzs6+2xTlM+1u3q8pxOTEtQT05OTVBR7evr7rFNUEmU5+jdTU5LTFFRUE5NUFHs7OvvsExRUVSIjXRLTUlNUVBQT09QUOrs6/CwTFFRUVFSUVBMSkxQUFBPTE1Pl+rq8LVKUVBQUFBPT0xKTVBQUVBEeHdFlurxpkZLTU1OT09NTElNUFFRd8PY1UdClcRWQ0VISEpLTExLSE9NS17a7OrqTER9w0ZKSklISElKSkpJSlnAWdbv7etGdOPvnUVLSEhISEhISUk53ezPgODu63Hi6/C4Q0tKSkpKSkhGRjbv7ezGdYGB3err771BSkpJSUpLRUJINvLs6uu4Qk7u7Oztu0FJSEh2mWRFQ0g38+vr7tU7TO7s6+y8QklCdeHp10lBSTfx6+vu1TpK7uzr7bxCSjfM8Or0jzxKN/Hr6+7UOUrt7OrtwUJIO6Pv6vJoP0k48Ovr79E5S+js6+7BQ0tFVrnRpzlESDjt6+ztwUdXlOXv7cFDS0tNWVxPQUVJOe3s7cVmwMHEhOfwsEdLS05NS0hFRkw52u3TZNHr6uvJkbVOTUxNTk5LSEdITEhXqWXJ7Ovr7O6mRk1MS0xOTUtHR0lNTk1EjvPu7Oy9s0xLTEpKSkxMSUdHSk5OTkxRoKyppkdGRkdISEdISkpIR0hLTUxMTU9NTExNR0ZFRUVEREVHR0ZFRklKSktLS05OTU9KSUhHR0dHR0dHRUNER0RFR0dISUpKS0tKSUhISElISEhFQ0RFRUVFRURFRkdHS0pKSklJSUlJSERDR0lJSEdGRUVFR0VLSkpLSUlJSUlIQ0NISUlKSUlKSUlISEtKSktKSUlISEhCRElJSUlKSUlKS0pL"),
            new Anchor("ghost_lap_2:dot5", 678, 235, 697, 270, 23, 39, "VFVUU1NRUVNQUVRTVFNNTVFYVlJSU1NWVFRUVFJRUVBRU1NTUk5NUlVTUlFRUlVUU1VUU1FQUFNUU1NRTU9TU1JSUlJSWldTVVVUUU9RU1RUVFJNTlNTU1pbXFyLiFlUVVRRT1JUVFRUUU5QU1Jcjo2Ojrm2aF5TUk9QU1RTVVNPTVFSX224uLi4uqJ1lFZPTVFTVFNUUk5NU1mehqG3uLedeKi3akdNT1BRUVNSTU5Ofr6ajZe5t3qitLR3Q0tMS0xOT1BNTUqKubeZjJOdo7m1uHpGTUxNTEtMTExOR4a3tbaSZ2uttba5f0tRUFFSTU1LS01Ghre0tZ1NTa21t7p/TFNSUlNRUUxJTEeGuLa1oUtLrre3u39OVFNSUlJRTEpOSYe5t7ejTkyuuLe5gE1TVFNTUlFMSlBLibm5tqJLTaS5uLuATFFTUlJSUE1MUk6JuLi3nkZLi6e5uYBNU1FRUlJPSktRS4a3tqR+lI7DoKW7dk5RUVFRUU1ISU1Ld7aulrO2t+rLibJWUU5PT05LR0ZJS0pjpmmutri37rmI3HhNT01MS0lFRUhMSluwb3e8t7m2jOXqm0VLTEpKSURESEpGgreiZGiZm4/c6+6jQ0pJS0lHQ0RISUSHtrifb0pOv+zr7KNASUpKS0dDREhIQ4a2tLeUSUnI6+rso0FJSUpLR0NFSElChra1tp5KS8jr6u2mQElJSkpIREZISkOHtrS1nktNw+vq7aU/RkZISEhERkhJQ4e2tbWfTE7F6uztpD5DQ0VDSUZFR0lChba3t59NTrTq6uymPkZESnelklBESEKEtra2i1dlg7zu66hASkhr3ePam0ZJRYS2taFelZWUi7vsk0dMSJXu7OyxSU5JebWgbpa4tbWhj4ZYS09Lg+vr8ZtKT0xlhmObtrW1s7WASU5OT0xilrClVk9PTk5QYKu0s7KJhFpNTU5PTkxWWldMTU1NTUxTfX5+f01NTU1NTk9OTElHTk5NTk1NTEtMTExOTExMTExNTk1KR0hMTUxNTExMSktLTE1LS0tMS0xNTElFSEtMS0tMS0tKS0tLTEpKSkpLS0tMSEZIS0tLSktLSkpKSkpLSUlJSkpKSktHREhLS0pLS0pKSUpKSUpJSElJSUlJSUZESEpKSktKSUlJSUlJSUlJSEpJSUhJRkRJSktKSUlJSUlISEhI"),
            new Anchor("ghost_lap_2:badge", 581, 238, 611, 267, 34, 33, "UlJTU1JRUVJSUE5MSUpMTU1MTU1NTU1NT05QUE5MTlJRUlJRU1NTU1JSU1FPTUlLTU1NTU5OTE1NTE1OTk5LTE5SVFNeXVxfWVdUVFJSUE1KS0xMTE1NTUxMTEtMTEtMSktQUVFNmZiYmomCXlJRUU9NSk1PS0pLTExMSktLTEtKSklJTlFQoFFQUE9adIB9XlNRTEtOUU9MTE1MTE1LTE1LSkhHSU1FpPBJSUlJSUxNZHdtVEpLUFBQTkxMTExMTExMSklIR0lLQc7rSEhHR0ZHR0pWcWxLSlFQUFBPTUxMTEtMTEtKSEdJTELK7ERDRENESUVERklnYEtPTk1PTk5NTExLS0xLS0lHSkxCy+yIiIWFcnBCQ0JASGNYS0tJS0tLSk1KS0pKSkpISEpMQszs6+rr5+7mqT1EQkFPXEpLSktKSUlJS0lJSElIRkdJSkHG69jT1tjp6+6EOkJBQlNOTU9NTU1MS0xLSkhIR0VFR0g/xuxbV1pbi/Du2S9BQD5IUEROTk9OTk5OT01NS0hFRkdHPMXrQD8+QDLd6/ArQEBAQVA+TU5OTk9OT1BOT01KR0hJST3E7D8/Pz8u2+3wKUBAQD9JPUtNTU1OTE5OTk5OSkhJS0o/uus+P0FShOvt1i1AP0A+QjxKTk5OT05NTk5NTkhHTE5NSl/PdZCmzOfs8GY4Pz4+PT46Sk5OTE1OTU1NTk1HSE1OTk4/xOXn6urq6K46PT4+Pjw8OElLTUtNTU5NTU5MRkhNTU5HnvDr5+fPeX40Ojw7PDw7OjdJSk9NTU1NTE1NS0VHTE1QRbzteENIRDg7Ozk5OTs6Ojg0SUtMTU1LTU5NTUlGSExNTUW+7Ts5OTk6Ojo6ODk5OTg3MklMTE1NTExNTU1IRUlOTU5FuexCRkZGSElKSDM3NzY1NTpLTU1NTk1MTU1NSEVJTk9PRrrs4eDi4+Tl6NgiNzY1NDNITUxNTE1NTU5NTEhFSk5PUEe66+np6urr6+zgIzc1MzE7S01MTU1NTE1NTUxHRUtNTk5HuuuYlJSUlJGSiCk2Mi0xR0lLS0xMTExNTE1LREZNT05NRrXsNDQ0MzQ0NDQzMS0pOElHSEhISkpKS0tMSEVGTU5OTUe16zQ0NDQzMzMyMS4rN0VIR0ZGRUdHR0dISUdERUlLTU1KqvIyMjIyMC4tLCsrOUZKSklKSUdKSEhHR0ZGRURGR0hJSU3HLy8vLy0rKigvO0hLTExKS0pLS0pJSUlIRkVFR0hHR0VHQyMjJSUlJzM5QEZJSktMS0xLS0tKSkpLSUVFSEhISUhJRkc3Nzk4Oj9DREdHSkpLS0tLSkpKSkpKS0pERUhKSkpKSUtLRkhISEdISEdGR0pKSUpKSUlKS0pKSktJREVJSkpKSkpMS0tLSklJSUhFRUhJSUlKSklJSUpKSUpKR0NGSklJSkpKSkpKSklJSklIR0VISUlJSktJSklJSUlJSUVDR0lJSUlJSUlK"),
            new Anchor("ghost_lap_3:colon2", 627, 274, 646, 309, 23, 39, "S0pJSklJSUhIR0NESEhISUlJSUpKSktKSUlJSUhISEhGQURHSEhJSEhISUlKSkpJSUlJSElIR0VBRUdIR0hISEdISUlKSUlJSUlISUhHRENGR0hISEhISUhISUpJSUlJSUhISEdDQUdHR0dISElJSEhJSl1PR0hJSUlJR0RERkZHR0hHR0RdYGJk0L4/SUpMSUlGREJHR0dHR0dFYdHOzs/s7o1hRUpJSEZDQ0hHR0hISUCX8ezr6+ujjtxnRUhHRkRESEZHSEhIRk+g6Onrno/t79A4RkZFQ0RHRkhISEdGRlao7+uB6u3x2DNAREBQf19HSEdGRkVHSFKdqOns6e3ZNEI+V9niylk9RERDQ0ZGR1JR8Ovo7do4QzS17unvnzVCQ0JCQkJDQ0Tw7Ovt3DlIOKnw6/KIOkVEQ0JBQUFBQfHt6+3cOklBTcvh0D9GR0ZFQ0JCQUBC7u/q7Nw6R0JDWFtTRUZHRkZFQ0NEREPG7u7u3jlFQUJFRUZFRUVGRkZDQkVJRVi98OveOENAQkVGRkVFRkZISURDbaijRFrB8Z47Qj9BRUdGRUVFR0dHQYDx7OtEQ1W3QkRCPkBFRkZFRUZGQHZb6err60Y+leN8PEE9QUVFRkVFRUJw5ZFx7+jsPonq79k1QD1AQ0NFRUVFOrrt5a6ix8GN7ers4DU/PUJCQ0NDREQ5wers35RSU+ju6+3fNT0+Q0ZXTUFEQzjA6evu1DVC6O3r7d8yPkA3o8ekTEJDOL7p6+3fMkDq7evt4DA+N4Py7OmAPEM5u+rr7d4zQOnu6+3gLz8yrvHr7qs1RDi76+vs3jJA4u3r7eAuPDZs5ejpYj5BN7rr6+zdMj+o7uvs3y47PUJ5j3M5PT82suzq76lvfb+W6u3dKzxAQUE/Pj08PzW07Oy1W93d4qWk74w2Oz9BQUFAQEBAOILxrXLk7Ovt5b5hOz49P0FCQUFBQUJCP29S5+zq6+bojjs/PTw/QUJBQUBBQUFCPmHV5+TkcG08QD49PT9BQUBAQEBAQEBCPmZsaGtBQEBAPTw9P0BAQEA/P0A/QUFBQT48PkA/QD88PD4/QEBAPz8/QEBAQUFAPjw9Pz8/Pjs8Pj8/QD8/Pz8/QEFBQEA9PD4/Pj89Ojo+Pz8+Pz8/Pz8/QEFBQDw7PT8/Pz06PD09Pz8/Pz8/Pz8/P0A/Ozs9"),
            new Anchor("ghost_lap_3:dot5", 678, 274, 697, 309, 23, 39, "R0hISUhHSUhEREpKS0pJSklJSUlISEhFR0VFRUVIRkRESElJSUpJSklJSUhISEVFRUNERUREQ0NFR0dISUhISUlJSElJSElIR0dIRkNDREVFRUZGRUZGRkhISUlJSklJSUlKRkRGSEZHR0VFRkZERkVHRm1vSUpLS0lGRkhISUhISEhHR0Rjd3p80MqDR0xISEVESEpKSUlKSkpHXMzPzM7s7H1lREhHREVISUpKSkpKR1hg1Ovs6+iSZ6RwSUdERElJSkpKSkpNgomR0u3qlHOztoVJRkJESElKSkpKSVSCf4d40OJStrW2i0dGQ0VISElJSUlHUoGAfomBjpG2tLWNRkRBRUdISEhHSEZSgX5+glVPkLW0tY1FREFFR0dHR0dHRlKBfX6BTkeStbS2jURCQkZGRkZGRkdFUYF9foFLQpK2tLaMQ0FBRUdFRkZGRkVQgH1+gUtBkra1to5CQEFERkZGRUVGRE9/fX6ASkGHr7W2jkFAQUREREVFRkZFTn98fGNcWa+LtbaMQEBCREVERUVGRkRNfn5pj8G9sL2GrXM5QUJBQkJDQ0NDRUBnZm7q7O2xtH/CUD5BQUFBQEBAP0BEPWdYuevs7LN1nOOpPUFERUNDQkFBQT9RtomYvu3rYqfs7rhERUhKSUhHRkZGP3Ozp42FkJl+7untw0dIS0xLSktKSklEeLezsYdQU6Xu7OzDSUlLSktLS0tKSER2trOzn0hFpe7s7cRHSElISEhJSUhIQ3a1s7OkR0ej7uzsxUZHSEhISUlHR0ZDdLSysqRJR6Hu7O3FRUZHRkZHRkZGRkJztbOypEhHoO7r7MVGRkdHQnNkR0ZGQXK1s7KkSEWc2ursyEVHRjuS0L2AP0dCc7a0tH5cnMWs0+7IQUZDVfDr6sJCRkJut7SNfN3ds8aa2n09RENb7+vszjVFQ2WZi1ri6+u0ssdvQkRGQ2Kz3913P0ZET3NC6O3r66itbkFDQ0VFSW53Z0VDRURERFp90c7NQ0VDQkJDQ0JERENDRENDQ0NCPWhlY2RCQUFBQUJDQkRDQkJFQ0NBQD40KSIgH0JCQkFBQkJBQUFBQkNCQj45LiMeGxoZQ0NDQkFCQ0FBQUFBQT86Ny8hHRocHR5CQ0JCQUJDQkJBQUI/ODUtIR4cGx8eHEBAQD9AQUJCQUFBQTc1LykhIB0eIB0d"),
            new Anchor("ghost_lap_3:badge", 580, 277, 610, 306, 34, 33, "QkJCQkJCQkJCRUVGR0dISEhISEhISEdEQUZHR0hISEhJSEVERERDQ0JBQkJCQkNDREVGR0dGR0ZHQ0FGR0dISUhISEdHR0dGRkVDQUNCQ0JBQEFBQkFBQ0NEQ0FAREdGRkpHR0dGR0hHSEhIREBERkVFRUREQ0NDQkJCQ0FAQENDRENFRUZGSGdrbGtraVtIRUZGRkZHRkdGRkVERERBP0FEQkJDQkNDQ0N8fX5+fHx/c2NMR0dHSEdHRkdGRkZFQ0BCR0RDQ0RDQkBJSktKSUpNXWN2cVdFRUdHR0ZGRUZGRkI/Q0dFRERFREVDjkhISEhJSUlIU2R1W0VHR0dGR0VGRkVBQENGRkVFRUVGQ5hHSEhISEdHRkdLWHVXREdHRkZGRkZFQD9DRkZGRkZGR0OVRFFSU0hFRURFQkNRZlBGR0ZGRkZFREBARUVGRkZGRkdDlc7X1dbT0dE0Q0NDQ1VfRkRGRkZFRUM+QEVGRkVFRUZHQ5Xr6urp6ejs52BEQ0NGW0xERkZFRUVDPkBGRkZGRkZGR0ORsp2Lj5zP7eytMUJCQEpSQUVFRUNEQz5CRUZFRkVGRkdCkT1EQkNDRM7q1SxBQT9CUD1DREREQ0E+QkVGRUVFRUVGQZA+Pj8/Pzi169wrQEA+P0o9QERDRERAQENFRUVEREREREOLOj4/QDpX4Oy0NEA/Pj9DPT5EREVEPj5DRUVERENERERDfLa4t7q32+nwYD8/Pj49Pj07RERHQj4/Q0ZFREREREREREfs7Ovq6+nxqUY9PT09PTw9OkNDREE+P0NGREJDQ0NERERLop2enq7e7OyjMjw8PDw7OjhCQEFBQEBEQ0NDQ0JCQ0RAfz09PT08P7zp4yY6Ojo6OTY4QT8+P0E+QT9AQEBAQkJEP4c9PTw7PTSd6/MmOTk5OTgxO0FAQD8/Pj8/Pj4/P0A/QT+FOTs5OTkwpu3yJDk5OTc2Lz5CQkE+PUFCQUBAQD8/Pz89f1pST05Sb+Du5CI4ODc1MzZBQkJBPz1GQkNDREJBQUA/PX/h4uLi4uTr754qODc3MzM9QkFCQT09QUFCQUJCQkFBQT6A6+3s7Ozr5Z08NDU0My82QEJBQkA9PkBCQUFBQUFBQUE/f32FiYmBdDw3NDU1My8sO0JBQUNBPUBCQkNBQUFBQUJCQH00NDQ0NDQ0NTQzMy4pLzs9PD08Ozg7PTw8PDw7PD08PT12MjIyMzIyMzQzLikhJCssLCsrLCsrKyssLCwrLCssLCwoVi8xMTIxMi8vKiUiIygqKysqKysoKSsrKysrKiorKysrKyQrLS0uLislJCIiJCorKywrKysqJykrKyoqKioqKisrKysrKCYmJCMiIycqLjEwMDEyMjIyMS8vMTIzMzMzMzMzNDQ0NTg2MjI3OTo7PD0+Pz4/P0BAQDw5O0BAQEBAQEBAQEA/P0A7Ozk5Ozs7Ozs8PDs6Oz08PTw5Nzo7PDw8PDs8Ozw8Ozs7"),
            new Anchor("ghost_total:colon2", 656, 126, 676, 167, 24, 45, "c3l7dXR3d3Z3dHBvbm9tcnV2c3BubHJ0dnl9d3J4e3t7d3NycXFvc3V2cG5ta21xdHh7dXJ4fHx7enV3c3R0eHh6dHBsbW9wdHd6dXF5fX18enV1dHR0enx8eXFscXNzc3l5cnJ6fHt8eXV0c3RzeXt9enBvcnSHcnd4bnh7enp6eXVzdHRzenx9enFvcpufc3Z0icecdnt8eXRzc3R2eXx9em5vc5SgcnJ+xO7wd3p5dnJ0dHR2en5+em1vc3KTcIrG6vbzind4dXR2dHZ7e35+eG5vc3V2fMTt8fP2hHN2dXSbvKF8e31+eG9vdHRzeeb08vP2hHJ1brHY6+3Jc3x7dnFydXV2eub08vP1hHJ2c8jz8/T0iHt6c3BzdXN0euXz8vP1g3Fyb8b28/PqiXl5dHB2e3d2e+X08vP2hHFzeHHu8vCiiHt5cnN4en16e+Xz8fL0hHR4d3mLr6STeXl3cXN5e316c+b08/LygXFzc3R0e3t4eHp2cXV5eXt6c63z8/Lzg25ycXBxcnNzc3V0cHd4d3l5dm6r8vPxiHR3dXRyc3Bwb29ubnJ0cnJycWprrPXGh3B2dHFzdHJvbm1sa21sam12bmpsatWVcHFxcHBvcG9yc21paW1wbnqXbWdrmtS1Zm9wb25ub25vcWxpbG+Dfoyca2OY0O3wdGxvbm5sbW1tbW1na3qamXqIZpbQ7+/yg2xvbW1rbWxtbWtnan2cm557Ysvs7+/wg2xvbGxsbWxra2llan2bmpuYYuDw7u7vg2xvbWx8gH5tbWllbX2cm5ycYuDv7u3uhG5zb5LF1NKqaWxocH+fnZ6eZODv7e3thm10bbjp7e7scWppcYGcnp6fX+Du7e3thWtwbrzv7u3vgWhpcYCanJ2eX97t7e3shm1xaprv6+vNd2Vqcn+am5qcYM/u7e3thmlucm2nwryUbGNodH+bmZqcZnrp7u3uiWprbG1we4FwaGNobICZm5qaZmSA1O7mgmxrbG5tbHBxa2dsbnmWmZmDamxoeO+zfGVoampsamlqamxxbHaVlXJ9a29va4aDamxramlpaWlmZmhra2h8eneUbW5ucXBvb25vbm1tbGtoZWZqa2hlZo2QbW5vcG9wb29vbm9vbW9tZ2hsb21raWiHbnBub3BubXBvb29vbm9sZ2lrcXBxb21scG9vb25vbnBubm5ubm5oZ2tpcW9wc3BucW9ubm9ubm5vbW5tbm1nZm1rbHNwcW9wb29ubm5ubm1tbm1tbmxmZ21saHJwcHFwbm5ub25ubW5tbW1tb2tkaGxtaHByb3NxbW1tbW1tbW1ubG1ubmplaG1sZ21vb3BtbW1tbW1tbG1sbW1ra2llZ21rZ2xtb3Btb2xsbWxsa21sbWtsbGdkZ21tZ2xtbHBtbGxrbW5sbGttbGtramViaWxoZ2tsam1t"),
            new Anchor("ghost_total:dot5", 713, 126, 733, 167, 24, 45, "fHx7fHx8e3x8e3t8dnJ5fHx8e3x8d3N0e317e3t7e3t8e3t7dHN5e3x7e3t9e3R0fX18e3t8e3x7e3t5cnN5enx6e3t8e3d0kZGSkXt8e3t7e3p3c3R5e3t6e3p7fHSjs7OzuY55fHp7e3l3c3V6fXt6e3t7eZ3WzczOzaKddHp5enl2cnd6fHp7enpzo3vqycrHqb7IuXh/enp0cXd6enp6eXq42amwycmsxM/Ox311dnVycnV3eXl6eoLK8++tvaW6ysfHxntyc3F1cHN2dXZ3d33c9fTqmonNysnKxn10c3Jvb3Jyb3Jzc3jc9PL0e23NzsvKyYF4eXZtc3R0c3NzcXbe8/D2fW7OzMrMyoR6enVvcnh4dnd1cnjb8vH0fG3Ny8rJy4Z6eXRvdXl5eXh2dnvb8/L0fW3NysrJy4Z6enJxdXp6eXh3dnrb8/Lzem3My8rKyoZ7eHBxeHp4eXd3d3jb8/LyenG6ysrJyoV7eXByeXl7eXh3d3ra8vL0mZyJvszJyoZ4eHBzenx7eXh5d3ja8/Dl19nGhbnLyYF2dm5vdXp6d3Z2dHTT9N+n8vHwx3+4j3BvcGpucnN0c3Nzc26T5ZfR8fHw6pShgW5xbGhscHJxcG9xcW+F1pa/8PDrrsfF03twa2htb29xcW5xcHO8x8CV0tK9vNfu849ta2ltcG9vb3BwcHK9w8W8joTHyezv86BqZ2pwbm5wbnJub3G+wsLFalnT7u7u9J9paGpwb3Bvbm9ucHO9w8TFbl/f7+7t9aFoaWxtbnBxb2xvb3C+w8TFdGfe8O/t8qNpbG9ubG1vbmlqbG68xMPEdm3g8O7s8KZrbnRzcG9ybWloa226w8PCdWve7+3r8KdrbnZ4d3V2cmpqa2y4wMLAdGfb7u3r8aVob3R3doJ4dm9ubGy3wL/AgXOy7e3r8KRmbXR7s8K/jm5tbWy2wcHDpaaMx+3q8qFlaW6d1OjnyWpqbG23wsSjxMSxhsHt8JZna2mv7+vs7HNrbGqjwqZswcTDvI65rH1mbm+l7+zt231obGtyg3e2wsPBxa2BimpobnJ2zNzZqnFsb25raYLTt7e4uKJ/c2lrcXNug52Zg2hsa2xsa2qelZSUlYpydGtsc3Jyc3d2cWxsa2tra2pzeHh7e3d1cmpudHRzdHV0c2trbG1tbWxmc3JzcnV0cWlxc3R0dHV0dG1sa2tsa2pkb3FycnJybWhvdHV0dXNydGxta2tsa2pja2xrbW5tbGhvcnFwc3Nwcm5qamtramdgamhnaWlqaWlrbW1tbm9vb25qampraWZiampqamhoa2dpamtpaWhpamtoZmhqaGRha2xtbW5ramZqampqaGhnaGhmYWJkZGJgbG1sb3BtZmdubGxta2tsbGhnY2FfX19gbGxsa29sZ2pubm5tbW1tbWxrZ2RjX1xe"),
            new Anchor("x_button", 823, 103, 858, 138, 39, 39, "hIKBgHt6fYB/gH9+fX19fXx8fH19e3l6gH5+gIGBgoKCg4SEhHx5hYOEgn13fYGCgYB/gH9+f4B+fn58d3l6e317fHt8fH1+f3+Ag3t4g4KEgnp3foKDgoKDgoGBgYCAgH98dnt9f31+fXx8e3x8fH17fXl4goKCgnt3f4GCg4KFhISEgoSDg4F+dnyAgIJ/f39/fX1/fn19e3h2goKCf3l3gIKCgoGCgYGDg4KDgoF7dHyBg4KBgX+AgH+Cf35+end4goKCfXd4gYKCgYGBgYKCfYF8fX53cXt/g4KCgYKCgoKBgn5/enV7goGCe3V5gIKCgYKCgH9+fomTlpiTiYN/e4CAgYGCgoKDgoKAfHZ9gYGBenV7goGBgX99eoafqq6xsrKxra+qk316fn+AgYGCgYF/enZ9gYGBenV8gYKBgH16nbOzqqOgmpubnqays66PfH2AgIGBgYB/eHd/gICAeXZ+gYCBdoass6uahXl2dnZ2dHuLqLSwqXN9gICAgIB+eHiIf4B+dXd/gIB4era5pHlxamZeXFxdXmJqcYu5tqt4fn9/f4B9dnmggIB8dXiAf3qCsa6jdmxaSEVCRERFRUJFV2mAuribdH2Af4B9dYHGfH56dXmAfnWjtrF0YkhBR0I+Pj9AQEdIQUVhg8m2hnd+f397cpXWenp5dnd9doKxw31aQDlthms5Ojo5ToF+TTk8V4PNrHl6fn96bqXpeXl2dnV1cqDDllY9NjRjopxWNTY4e6N/QTY1O1e2xYh3fX94bLjwe3l1dXh0drnCaTc0NTNMlr6POS9OnK1vPzM1MTON0KFwfH52asTye3t0dHpziMWfTiovLzA4ZrO3ZCmBsY9WNS0uLypSzL1ye3x1a8jzfXt0dXpzlsyDOCkqKysqOH3DlGSeoGY7KCoqKystwc13d3p0bLvxfHp0dnt1o8l1LScmKCYqKUGSx5exdkEoJyYmJyokptB/bnZycKLrfXpzeX1xo8dsJiQiJCMjIyFo0Li1VCkkIyMjIyUdms+EbXZzcYrTfXd0eHxwospoICEgICAfHhx9zcHJYhsfICAfHyAamcyGcHR0dXqpfnV0eXlzm8tsHR0bHBwcHUePr4TFgDMdHBwcHR0XpsiBcnNzeXaTenNze3pyjMiEGxoYGRUUO3OpeESgqmQhGBkYGBonsL15dXRzenqBe3J0fHx0esWtGBYUFRMcYJWORiJZpZFFEhMTExVCtK93dXFzenp8eXJ0fHp5cau+SxEQEQpAhZ1bKg0se6h4LxEQDxRytpl6dnJ1enp8enJzfnp5cYa7mCkNDBtekH02CgsLPJWRVRQNDkOTr4V3d3F1enp8dXB1e3p5dXWitGcXCg04UEYXCQgKF0ZHKQoJKoyqint4dHB2e3t5dHB4ent6eHODtp5ZFQsrNCQGBAQDBSU0Lg0ocpihg3V8dHB5enp5cm95fHp7eXZ0irGTXhEJCQcCAQECAwQFBCZ3jaaHd3R8c294enl6cW92eXl5eXl1e4agj3I/GgwCAQEBAhInUneFkIaDeHp4cnJ6enp5cXBxc3V0dHV1b3yGlHt4cmBPRkFJV2d3dXSJiYZzeXh2b3J6fHt7b3FzcnJzc3NzcWx1fn+DfHh1eHR4cnR7foCDf3R5e3h2bnJ5e3t8bXJ1dXR1dHR0c3BucHeAgH9/fHZ8fn2ChIB4dXp7fHl2b3R7enp8bXN4dXZ2dnZ1dnV0bnB1eXh7f36AfHt4eHBzdXR3enpzcXV5eXl6bXV4d3d2d3d2dnZ2c3R1bWhwc3Rzcm9wcXNzc3Jyc3VxcHZ6eHh4bnZ4eHh3d3h3eHd4d3Z2cWtwc3N1dHVzdHZ1dXR0c3Nxb3Fzc3V1bnZ4d3d2eHd3dnR2eHh4cG5ydXh4eHh2c3R1dHV2dXRub3R1dXV2b3Z3dnd3d3d3d3Z2dndzbm10dnZ2d3l5dnh1dnZ2eHZxcXV3eHd3cHZ2dXZ3d3Z2dnZ3dXZzbG56fX19e3Vzdnd3eHl4dnVwc3d4eHd3"),
            new Anchor("magnifier", 857, 102, 894, 139, 41, 41, "g4ODf3d+goODg4ODg4ODhIODg4J5eYCGg4ODg4ODg4ODg4KEvMHL0dGEhIR8eX2EgoOEg4OEhoODg4WDgHl6gYSEg4OCg4ODg4ODgYS6wc3T0n+Ag3t4foOFgoKDg4SGhIaDg4N9eHqHhYSDg4OCg4ODgoOBg7fB0NLSfXt9eXh9gIGBgoKDhISDhYWFhH14fYSFhYWEhISDhIKCg4KDtsLV0dJ9fXt4dnl7fHt8foCAgIODhISFf3p+hISDg4SFhYSHg4SCgIG1xdPS0n5+end4fXx7e3t+fYOKg31+f4B+e4CDgYWGhIWFhYaFhYSAgbXF1dPSfn96dXt+gICAjJ6pr7ewpKCNfnp3fH5/goKBgYKDg4WFhISCuMjU09KCgHx2fYGCiqa7xMvP0dDLxr2ohHd9fX+BgH5+e4B+f3+Af363ztbU04F/enZ9gY66z9Tb4OPn5uHe08y+jICAgn6Af319fHx8fXl6fLfK09DTgH94d3+Qu9Hc5+zq5eHk6fDt4NK/kIGAgX9+f3+AgoB9fX17t8fLzM+Afnh4iLbT6PPt2MSwqLDC2Oz07NfAiH9/f4CEgn5/gH9+fnm7zs3Pz4B9dnmg0ub068Gro6KgoaOrwOf07tmshIKCgICAgYB+gYJ9ervQ0NDSgH11gcbk8+69oZqRiIWFj5ehuun07ciTgYKDgoKFgX+BgHx4utPV0tF/e3KV1vT21qWQhoGCgH6AgIua1u/y46h9goKBgYOCgX+Be3e+1Nba1396bqXp9PG9kn9/gH99f31/fX2u6/PzvH+BgIB/gH+BgIF8eMLV19rgf3hsuPD06qyBf4CBgH5+fH96dI/k8/TLhIB+f35/gICAgnh5wdXb19V+dmrE8vPkn319fYJ+fn98fXdzfNvz9tGFf4B/fn5+gX9+d3jF19XW2nx1a8jz8eqhe319f4F/f31/eXGI3fP10oh/gH9/f31/fn13ecPV1tfXenRsu/Hx7qx/fX2AfX9/foB4cZjf8vHHgIB/fn6AfH59enV7xdXV1tR2cnCi6/PwyIN6fnt8fHx+fXd8uOjx7rV/goB+fn9/fn53dHzF1drY1XZzcYrT8vHeqnZ5e3t8fH18eaDR7PHjnnl+gX+CgH5+gHZzfMPV2tjYdHR1eqnt8O3NsIl8eHh4hYinxeDw8LqNen19foCAgn58dnJ8xNba29pzc3l2k8nr8OLFu6yclpmru8PW6+/tpIZ5fH17fH6Af352dX3D1dzY23RzenqBo8vp7ufPxsbGxsfM2+zp6u66qpV3dnd4eX19fnV0fsfU2NXccXN6enyKo77e7uji1tHS2uLs5b/C7czKwph1dXV2d3Z5dHN6wNDV2tVydXp6fH6MoK/D2ujp6+jm3MWxo6bt293Swpp9dnd4dnV0dHm7zM3Q0HF1enp8e3yKnKSrr7e/uaynoZ6OkNfs7erXwJx8eXl5dHJ1eb7Oz8/McHZ7e3l8eYKDi5mgoKGhnJSIhX19qNrr7ezXwaN9eHl0cHZ5wNDR0dJweXp6eXp7fHx9gYOGj4uBenh6e3uYr9jv7OnZx6l6eHBxeXu/0dXV1W94enl6enx7fH97e3p8fHVyeHl5en+Zr9fr7OrYyq5/cHJ5fMPQ1NnVcnp6enl6fXx7fHx9fHt7dW93eXh5eX+Wstjr7evbxad4dHt6xNXS1ttyenx7e3l5e3p6eHt8fHt1cHh6eXl5eICWq9Tm6uncw5Zxe3nA0tTT1HJ5e3t8fHp7enp5eXt8enNweXp6eHh4eYKWoMrn6+rXm3F5esLT1tTVdHt6enx9fH17e3l5e3p4cnF5eXp5eXh3eYKZpM3m6deRcHl7wtHW1dd1eXl5eoB8fX59fXt7enhvcnp6enl5eHd3eHiSpbe8p4V0eHrB09HY1HZ6eHh4eXl8fX19fHt6dm9yeHp4eHh5eHh4d3yQnqGTfHN2ecDV1NTTcXNzdXV1dHV4eXl5eHh0bXV8d3h4eHl4d3d2eH2KinlvdXV5vtPZ1tR0dXV1dnRzdHV0dXV1dXFud3l5dnZ3eHh3dnd3dnh3bnB2dna70dXX1nV3eHd3dnZ0dHR1dHRzcXBzdHV0dHV2dnZ2d3Z2dXNtcHZ4drrS1dTVd3h4d3d4d3V2dXZ1fI6JiY2NjY2Ojo16cnJyc3N2c21vdXV2utLV1NV5enl4eHl4d3Z3d3CeyMjIycnKysrLyZ1scG9wcHBubG9ycnO6ztLW0w=="),
        };
        static final Anchor[] RACE7 = {
            new Anchor("ghost_lap_1:colon2", 619, 136, 638, 171, 23, 39, "P0A9PD9BPDtBQ0NBQEA/QUJBQD8+PkBTVVVTT09QU1ZWV1ZTUVBUVVVVUlFTUVpaWlpYVFJXX19eXltYWFhZWVlbXl5ZXV5fX1tWVFtgYGBhYWFdW1tYWVxfXlqiaV5gXVdTWF1fXmBfYF9cWmeEhYqKiuvKUV5cVFNYW1xfX15dXl5TpaKioqGf3onCfVlUVVhZXV9fYF5dcoxvnaGhoaBh1enPUlNYWVZcX15hX1GnpZVmpqGgn9Ds6txQVVlZWm9pX19dUqmjo41sjYqM7Ovr209RWl/D6tV1Xl5SqaOjpoRWU1bs6+vcT1ZRlu7t8a1dXFKpo6SniFFQUuzs7N9NV1Ol6OnvvFtbT6mko6WKUVBS7Ovs30xTXG7S5d91WVtQqaOipIlRU1Ts6+7fTlNbW2NiXVZaWVCqo6KljFFUV+zs7uJOU1VUVlNRUldZTqiioqV7UVNYwu/u4U5SVVdVU1BRVVZKpaKhgFNTU1dow+zNUlJWWFhYVFRVVk2WoIRZVFRUVVxor29OVFZYWV1VVldaWFl8V1dVVVNVWm7ai1JWV1hZXFVWWFpXcJ5oWFZWVVht4O/hVFhYV1hbVVZYWVGmo6FoWFVXW97r7OZUWVhWV1lVVVhZUaiipJ9jUlhZ7uvs51RbWVZWV1ZWWVpRqaOgpYtNVFbt7OzpV1pbV4e+pmRXWlGoo6KkjkxUVezr7OpYW1V34+zto1ZaUaijoqKLS1VY7Ozs6lhbVJDs6u/JYVxRqaOioo1NWFrs7OztW1pYat3s8JVWWlCpoqGii09YW+fr6+1bXFpWeqOPXVdZUKihoJ9nZm9xju/t62BbWFVUU1paWVtOqKCfcW6fpKG4o+fCXFlWVFVVWVpYWVF9onV3oaCkouzDcV1VWFNSVlhaWVhWVFJbcKGdoaKh6MVUTk9QUFBTVVVWVFNSVFRnmpqen517Vk1QUFFSUlJQUlFQUFBRU1NYV1pcV1dQUVRVVlZWVVVUUlBQUU9OUVNRUlJSVU5PVldZV1dXVlVUUlNVUlFRUlFRUE1WT1FYWFhYWFhYVlRUVVdUUlFSVVVXUlJPU1hYWFhYWVhWVFVWV1ZSVFNVVVZWjlJRWFhYWFlZWFVUVVdXVlNOjauvr6/tzVxYWFhYWVhWVVRVV1hXS4jq6urq6uiTp3xXWFlZV1ZUVFdYWFuikLHp7O3s"),
            new Anchor("ghost_lap_1:dot5", 670, 136, 689, 171, 23, 39, "TU1LRUJHS09OTU5MSklKTU1PTktIRktaWFZRUFJVVlZXV1VTUlRWWFdXU09RVllZWlhUWlpbW1tYV1hZWlxbXF1ZVFZaYlZcWlZaXV9dW1lXWV1bYFxhZmRiY2e8dllZV1xdXV1aV1ZZWlpbYZ+loaCho9yXaFJYWVtaV1ZWVlhYWVqBo6OhoaKilZnMhlRWWFdVVFZXV1dZVaK7pqChoaO16+qdWltbWlhWV1lXVlVjo5ywmZ6hoens6J9bXFtaV1lcXFpZWWiln52scXh47evpn1xdWlpWWVxcW1paaaeinqZZWVru6+ihW1pZVldZXVxbWVppqKOdp1tcXu3r6aNbW1lVV1pcWlhaWWeoop6kXV1g7uvro1xbV1ZZWltZWFhYZ6agoKNcXF3u6+ykXltYV1laW1pYWFlnpp+gpltZW+7t7KdfW1hZWltbWlhZWGWmop+RWF9hsuvvqWBaWFlbXFxaWVpYZKedrKbLyMlco+OTVlpYWFtcXFpZW1lPn7Wn6+vp64t3f15eW1hZW11cWltcXFtZmNjt7OvraLTno1tbWVlbXlpXXF1cXV1qo9/v7OzB8fCrYFpXV1tcV1hbXFxdW1hphaKkpOrp76xeWFVVV1lYWlxcXFxbWFhZX1xb7u3xq1xUU1FVVlhbW1xcXFpYV15hXlzu6vGrXFNST1BSVFVVWFlYWFdbW1ldW+7r8a1dW1RRUlRVU1ZVVVVTU1VXWFlZ7uvxrl5aV1VVVlhXWVhVVlRSU1VSU1Tv6/GtX1hZU2NzZllaWlhXVVJVU1FSU9rr8a5fWFV5xOa2dlhaWVlWUE1vhYaIsODzrV9YU5/v7fOhU1lZWFJRb6OioqK3osGCUFhPne/t8qBLWVdTTnWgoqWko+6sXVNSWlKCyd28dVBZVlFJn6CioaKiyoRUVVNYV1dgZFxVU1NUT0xxmpuYmZpVU1VVU1RYWFhYWFdVVVRPTlRYWFhYWFRSVVZTU1VYWFlZWFdWVE5QVFlZWFlZVFNVV1RTVFhZWFhYWFdVTlBVWFhYWFlTUlVYU1RVV1lZWVhYWFdQUVVXWFdYWVpUVFhYVFNWWFhYWFhZVlFPVFZhYmJiq3FQV1hVU1VWV1ZXWFdVUVBOep+eoJ/npVhXVlRTUlNUVlZYWFVSUV+aoqGhoaCauIBKUE9PUFFTVVVVU02PlUmWn6Gh"),
            new Anchor("ghost_lap_1:badge", 573, 139, 603, 168, 34, 33, "V1dYVlhdXFxdXl1eWVhbYF1eXldUW11cXlxcXFxcXFxdW1dYWVRYXl1cXV1dWlpWW11cXVtXVVldXV1cXFxcXF9dXV1gYWVhYWFcW1xbWVpXV1lcW1pbVVRbXl1dXF1dXV1cXVxcmpucnIt+XF5dW1pWV1lXXFxcWlVUW1xcXFxdXFxdW1mAsE9OT09ed4B3YFdUU1hXVl5aW1dTVVtcXFxcXVxcXF1c4OpIR0dHSUxRZHhqTlRWVFFWV1dWVFZaW1xdXFxbXVxdYPPsR0dHR0dHSEpacWNSWVdQVFVUVlJTVldYWFhcWltbW1zz6kdHR0dHR0ZFQ0hsZFxfVlpaWFJTUVBUVFVWV1dXWFhY8ep9fX2EUUVERERCTmVbWFdbXVdUVllVWFlYV1dXVlZVWPHr6uvs7GNDQ0RDQkJUXVNWWFxYUlZbVldbW1xbWllYV1fx6+Pm7u5hQEJCQ0JCQVdPVlxaWVJXW1hWWVpbXFtbXFla8+tRqe/vZT5CQkJCQkFKUU9cXFZSWFtYVVlZWVpbXF1bW/TqM57x8Wc/QEBBQUA/QlFKW1xVUlhaWlpWWVlaXF1eXFn06TKe8O9nP0BAQEA/PT5MR1xcVlVZW1laWlhZW1pbXV1a6O8ynfDvaj8/Pz8/QD09QUddXFVXXV1aWVlZWFlbW11eW4G5MZvw8Gw/PT0+PT49PTxFXVpUWF5eXFpaW1pYWltcXFeJ1zGa8PBrPTw8PD09PT07Ql1ZVVheXl1eXVxcW1tbW1tU5+4wmu/vbTo7PDw8PDs7OkFdWFZZXl1dXl1cXF1dXFtdUvTsL5jv73A5Ojo6Ozs6ODhCXFdWWl1dXV5eXV1dXV1cXlP17S6V7+9vODo6Ojo5OTY2QVlUVltdXl5dXF1dXFxcXF5U9ewtk/Ducjc4OTk5ODc1Nk9ZU1VaXF1eXV1dXFxbWVlaTfPtLZPv7XY2Nzc3NzY2NDlQU1NRWFpcXFxbXFpZWFZUWEnx7SuS8PB1Mjc2NjY1MzNHUlJSUlVTU1ZUVFVVVVVWV1pN8uwzSWJeQTQ1NTQ0MyxBWllUUVRTUFBPTlBRVFNUVldXS/TsNTU0MjUzNDQ0MTAzS1xZVVFVV1RQU1VVVVRUU1NTVEnw7jQzMzMzMjIxLyw1R1RYV1RRVVZUVllbWVlXVVRVVFVIz+4zMjIxMDAvLTA7TFJUVVdSUVNVV1pZWlhZWFZWV1hZUlySLy8uLywpKS9FUFpYV1VUT1BSVVdYWFlZWFhVVVdYWVJUUyUnJycrMkJJUllaWFpYU01PUlRXWVlZWVlXVFNVV1dSU1dDRUVDR01PUFNXWVdZWFROUVJVWFhYWFtZV1RRU1dXUldYT1BRUVFTVFZTVVdXWVhTT1RVVFlYWFlZWldVUlNWWFJUVlJVU1JSU1NUUlNWV1hXU09WV1NXWFlaWFlYVVNUV1ZQU1dWU1VVU1JUU1NTU1dYWVJPV1ZSVVdYWllZWFVVVldUUFZX"),
            new Anchor("ghost_lap_2:colon2", 620, 168, 639, 203, 23, 39, "UFFUVVZWVlVVVFJQUFFPTlFTUVJSUlROT1ZXWVdXV1ZVVFJTVVJRUVJRUVBNUE9RWFhYWFhYWFZUVFVXVFJRUlVVV1JRT1NYWFhYWFlYVlRVVldWUlRTVVVWVlZSUVhYWFhZWVhVVFVXV1ZTTo2rr6+vss1cWFhYWFlYVlVUVVdYV0uI6urq6urqk6d8V1hZWVdWVFRXWFhbopCx6ezt7Oyv6OBhVlhZV1VUVFZYUonp64+38O7r6+zo8WlYV1hYYl1TVllQiu7o4JSpzc3L6uvyaVdXT5vVyXRVVlCL7uvs4nNbX13q7PFsWFJy3Ozsw1xYUIjv6uvjeVVXV+rs8WtYU37i7ezWaFVPh+/q7OR2U1dX6uzwaldWXMXn5Z1OVk6G8Ors5HdTV1fp7O9sVVRVZXdxXVVVToPx6uzkelRXV+ru72pSUlJRUU5QUVJOhfLt7NlzUlZW7u3vaVFSUlJQTk5PUU1/8e3jhVZWVla67OVsVVNTU1BOTk9RTHPp349PUVRUVFiwj1hYVlVUUlBPUlNSS5OFUE9PUFBPVb2fTlpWVVdUUlFSVVJWtLJXVFRSUU+27O1uVVZWV1ZUUlJWTnzt7bJXVVNSUezt83BWVlZXVVVSUVNMffHr67BTUlJT7e3xcFZVVVhWVVNSU0t38uzr5XVOVVbs7fF0VlVTaaunYVFVSnbx7OvnfFBVVezs8XJWWWDH6+y6VFVLefHr6+Z8UFZW7OvxdlZUb+Ts7dlrUkx18evs5X1RV1br6/F2VlZb0evuuldTS3fx6+vjflFVU+vq8XVYVlRssa1vUVNLePHs682Bb3Jz6e3xeFZaV1dWWFdYUkt38O3bgLTg4uKG7dpyVVhXWVZZV1dRT2fk1I217+vq6sx+e1FUVFVWV1dWV1BRU2N/rufs7Ovr4WlITFBRU1VVVFRVUVBVV13E6ebl5OR4RUtNTExNTlFRUVFPUFNXVFx1d3RycU9PTk5OTU1NTk5NTU1PUFBRU1JRUE9PT1BQT05OT09OTk1MTU9QUFBPUVFOTU5OT09PT09PT1BPT01MTlBQUFBSUVFST05MTk9PUFBQUE9QTExNT1BSUFJSU1RUUFJPT09PUFBQUE5MSkxPUVFykZiYmZ3XVU5QUE9QUFBQTkxKTU9PZ9Ts6+vr67qXfk5QUVFSUU9OTEtOUomRmuzt6evs"),
            new Anchor("ghost_lap_2:dot5", 670, 168, 689, 203, 23, 39, "VFJVVlNTVVhYWVlYV1ZUTlBUWVlYWVlUU1VXVFNUWFlYWFhYV1VOUFVYWFhYWVNSVVhTVFVXWVlZWFhYV1BRVVdYV1hZWlRUWFhUU1ZYWFhYWFlWUU9UVmFiYmKrcVBXWFVTVVZXVldYV1VRUE56n56gn+elWFdWVFNSU1RWVlhYVVJRX5qioaGhoJq4gEpQT09QUVNVVVVTTY+VSZafoaGt2/SoXlRQT09QUVJSUVBZpJ+WZJifn9Ht8KteVlRRUlRUU1NTUFiknp2TR3p48e3xq19WVVJUVlZWVlRQWaSfn6FWU1Dx7PCrX1VWU1RWVldVU1Bap6GipGBUV/Hs8KpfVVVTU1VWV1VUUFmmoaGkXVRW8Ovwql5UVFNSVVZXVVNQWaegn6NgU1fw6/CqXlRVU1JUVlZVU1FZqKCgpGBUVuvq7qpdU1RSUlRVVlVTUFiooKChT1lWpOnwrF9SUlJTVVVWVFFRWaign3CFhIKZsOSbUlVRU1VVVlVTUFBPnKdVk6KhoZ6mamZUU1BSVFVWVVJQUlZOZ4yjoaGhqbfWi1VSUFJUVVZVUlBSV1VUUo2hoaGj3PKrYE9PU1VWVlRSUFJWVVVWWI6Mjdvr7atdTlJVV1ZWU1JQUlVVVVVXVVlY8u3xqVtNU1ZWVVZTUVFSVFVVVVVWVlbx6++nWUxOT1BQUVJQUVJTVFVVVVVVVvLr76ldTU9PT09OT09OUFFSUlNTU1NT8uzvq19RUVRUUlJNTk9OT09OTk5PTk/y7O+rX1NWVl9mXFNRUlRUVFNRT09OTd3t8KtgVFJop9O5bktSVFVVVFNTTnpzluDuqWFRUJ7y6/CUSVBUVFVVVFKTnp6gsceRUVNOpPLr8JJLUFJRUlBIhZ+bm5+kXlJSV1B30+TQh0dRUVFQSo+fnZ6cnZVeU1JVU1RbdmxXTk9QT09OXJiXl5dWVVRUVVNSVVRPSktMT09PT09NUE5OTlVWVVRUUlJSU09LSkpPUE9PTlBQT09PU1NSUlFQUFFQTkpKS09PT09PT1BPT1BRUVFQT09PUE9MSUlLT09PT09PT1BQUFBRTk9PT05PT0xJSUtPT05NTltcXV1dp2ZMT09PTk5OS0pJS09PTk1us9fW2dnrpF9KTk1NTk1NSUlNTk5LWpbp7err67umoHZDSkxMTE1JSktQSoOYSqTo7Ozr"),
            new Anchor("ghost_lap_2:badge", 573, 171, 603, 200, 34, 33, "VlNVVVNSVFNTU1NXWFlST1dWUlVXWFpZWVhVVVZXVFBWV1dVVVRSU1RSU1NSVVhXUlBYVlFTVllZWFlYV1dXWFNQWldfXFxbWVdVVFRUUlJUVFBSWFdTU1VXWFlbWFhYWFhUUFVNkpKUlYh9X1NWVFNTVFFQU1hYVVNSVVdYWFhYWFhWUlFep1JSU1JceoV/YFVSVFJRUVNZWVZVUlRUVlhXWFhXVVFEu+5KSUhJR09RZ3hqUE5OUE5VVVZXVlZUUlRVVVZWVVJPQuTqSEhISEVJSEhac2lMT05OT1FRU1JTUlNSUlNUU1NRTTvm6kZFRklHSEhFREdoZFBOTk9SUlJSU1JQUFFSUlJQUE484up4eHd7ZGZERkRBSmpcTk5SVFVVVlZVU1NTU1JSUFBPPeLr7Ozq6+rrqUZDQ0JPX0lPVFRTVlhbWlhZV1dVVFNRUT7i693d3d/o7PGJOkNCQVZLUFVUU1VWWVlaWllZWFhVU1NC4etkX15kg+vs2y5CQkJIU0ZUU1RUVFVYWVpZWVpaVlNTRODsQD9AQDbP6+soQEBAQlI9VFNUVFNUVVhYW1pZWVZSU0Te6z8+Pj4xy+zvJj8/P0BOPlBRVFNUU1RVVFdYWFlVUVVF3Oo7PT5PdO/v1yk/Pz4/Qj1MUVRTUlJSVFRVVldYU1JWVHXNdY+n0Ofr7286Pj4+Pj49TFJSUVJSUlJTU1VWV1JRV1hc2evq6+ru6LpAOz09PT0+OU1SUlJRUVFQUlRUVFNPUVlKxvDt6ejSdHAyPTg7Ozs7OzZOU1JRUVFSUVFSU1RSTlBWSNvsd0o5Ojo5Ozo7Ojo5OTg3UVVTUlJSUlFRUVJRT0xPU0XW7Do6OTs7Ozk4Ojk4Nzc1OFNXU1JTUlNSUlJRUE5KTlJD1u1DREZISU9RTi44Njc2NEVVV1VTUlJTU1NSUVBNS09RQtXt4uPj5uXn694jNTU1MzRQUVZVVlJRUVJRUlJQTkxQUULT7ezs6+vr6+feIDU0My87TU5QUVFSUFBQUFFSUE1NUFFB0+2AgH17eXh1bik0MzA2TVBPT1FNUE5QTU1OT05MTk9QQdPtNDU0NDI1MjQzMi8vQlhWVVNTUlFRUU9PTkxLS0xNT0DQ7DMzMzMzNDMyMSwtPVFVVVZVVVVVVFRTU1JPS0pMTU09uPMyMjExMjEwLi4yQExWWFVUVVNTVFVVVVRUVE9KTlFOUEioMDAvLi0qKi46SkxPVldVVFNTVFVVVFVVU1RQTlJVUU9OSyIiIiMmKjxGTlJPUFVWVVRSU1VUVFRTU1RTTU5SU1NSUE9BRERERElMUlJTTFNWV1ZVU1dVVVVVVFVVVE1OU1RUVVVTUlNTU1NTU1NVUUtSVVdXVlRUVVdWVlZWVVROT1VVVVVWVlZVVVVUVFRUVFBMUVVVVldWVFNVV1ZXV1dUTlFWVldWVlZWVlVWVVRUVFRNS1FVU1RVVlZWVlZVVlZWVFBRVlZWVlVX"),
            new Anchor("ghost_lap_3:colon2", 620, 200, 639, 234, 23, 38, "T09OTk5NTU1OTk1NTU9QUFFTUlFQT09PUFBPTk5PT05OTUxNT1BQUE9RUU5NTk5PT09PT09PUE9PTUxOUFBQUFJRUVJPTkxOT09QUFBQT1BMTE1PUFJQUlJTVFRQUk9PT09QUFBQTkxKTE9RUXKRmJiZnddVTlBQT1BQUFBOTEpNT09n1Ozr6+vrupd+TlBRUVJRT05MS05SiZGa7O3p6+yU2edjTVFRUlBOTkxOT2fe6YOm8urr7Nvr74FPU1JRV1RNS05NavHs8Zud2dnY7evwgVBTUXi2x3ZIUVBm8uvs5XNgZGLt6++ET1Nfx+3v1E5NUWjz6+vrikZPT+zr8INRVWPi7urjcU5TaPTr6+mHRU1N7Orvg09TVbzs7b5HVVNp9Ovr6odHTk7s6vCJTVNRYIqQbEpUVGrw6+nriklRUOzp8IdKUFJUUE9PUFFSZvDp6OSPS1JS6+/xhkhNTU9NTk1OT1Bl7+ntpV9QUlOr7uuNSlFPTkxMTU1OTl3s5rZcUVFRUFGts1xRUFBOTU1NTk1PSpOjV0lMTU5OU5iwR1JRUFBPTU5QT1JUjb5NTU5NTk2L5/CDTVFRUU9LT1JRVF/g779TT09OTuDs7pNMUFFSTklOU1FTYOvr779NUlBQ7u3ulkxRUlJPSk1RUVJf6O3r641LUVTs6u6ZTFJSWIufYFBPUlzm7OvrlUlSUuzq7plMUVSd7O7OUFJSXObr6uqUR1NS7OrvoEtTWdLt7OiATFNd4+vr6pZHUlHr6u+gS1JUxe/q1WxOUlrj6+vplkhRUOvp76BKVFBcscOGTlBSWuTr696ZWmRk5+vwpkxRUU1KUFFSUFJc4OznkpnV1teG6+iXTlFQTUxOUFBRVFXW5J6V4Ozr6tVxnUdUUFBNS05RUVFUUlqUld7s7Ovr6JVHTVBPTkxJUVJSUVFQUVGq7+no6OeePElKS0xKSEpMTU1OTk5STlOFj4uJiFBNTU5NTEpHSUlJSUpKS01NTU9QUE9OUE9PTk5OTEhLS0pKSkpKSkpITExMTUxPTk9PT05LSEtNTU1NTU1NTUtLSkpJSk9OTk9QT0tITE5PTk5PT09PT09OTUxMVU9OT09PSklNT09OTk9PT09kg4uKiIrhVU9QUE1JSU5PT05OTk9NTazt7Ozr6w=="),
            new Anchor("ghost_lap_3:dot5", 670, 200, 689, 234, 23, 38, "VVZVVFRSUlJTT0tKSk9QT09OUFBPT09TU1JSUVBQUVBOSkpLT09PT09PUE9PUFFRUVBPT09QT0xJSUtPT09PT09PUFBQUFFOT09PTk9PTElJS09PTk1OW1xdXV2nZkxPT09OTk5LSklLT09OTW6z19bZ2eukX0pOTU1OTU1JSU1OTktalunt6uvru6agdkNKTExMTUlKS1BKg5hKpOjs7OuavvGsU0dKSkpLSktJTVOdnplll+vs66nt7a5YS0tLS0pLTU1NUpudnZVGibGq7uzusVtLT09OS01PUE9Ump2dn19KTEzw6+2yXFBSUVBNTlBSUladnp6hZFBRUPDq7LJfT1NSUE5PUFJTV52fn6FoUFJT7evttGNQU1NQTlFSUlNWm56eoGdQUlPt7e60ZFJUU1BOUlFSUlWbnp6hZk9SVe7u7bRmUlRTUE5RUVFRVJqenp1WUFJUmu/xtmhTVFJPTVJRUVFUmZ6eaE9VUlRVrOmmYVNVUE5NUVJRU0+JolxRUVFRUVJShHtTVlRRTU1RUlJTUVSCUFBRUlJQVo/JkVNSVlJOT1FSUlFOi6FwTFFRUVGEye63YlJUUE5RVFNTUlSWn59xUVFRUMru77tlUlNPTlFUU1RSVZWenp5mUFFP5+zsuGdPUU9QUVRUVFJUlp+en21OUVDm6+y3Y0lOTU1OUVNSUlOWn56fcE1RUOfr7LpiSEpMTExNT09OT5Genp9vTVBP5evtu2hLTEpLTk1NTkxMkJ2cnmtITE3l6u27aU5OSU5dVU9TTk6Rnp2ebEdKStzr7L1pTU1WjrDAdFNSUZGgn5lUgHt7iNvtvWlPS4PI7O+yZVVPkaGWX42gnp5SgtuoZ05KgNPs77JxUVFxn1iQoZ6gnk5QXmZRT0dlvujfomBQU1NQgKGhn6CfUE9PUE9NS0hWgYlpTFFSUVFWmpmZmZdQUFBQT0xJSk5PUk9OUlNQUVFSUVBQTlBQUFBPS0lKTlBPTlBRUVJRUVJSUVBOUE9PT05KSEtPT09QUFBRUVBQUFFRT0xPUU5QTEpIS09PT1BQUFBQUFFRUVFOTFFOT09MSUhLT09PT09PT09PUFlZWFlXomlOTUxJSExOTk5OTk9PT01hmJWWlpfrwXBLSkhJS05NTk5OUE5NX3qenJydnA=="),
            new Anchor("ghost_lap_3:badge", 574, 203, 603, 231, 33, 32, "VlVWVVRUVFRNS1FVU1RVVlZWVlZVVlZWVFBRVlZWVlVXVlZaU1ZWVFNNTFJUU1RVVVZVVlRUVFVVUU5UV1dWVVVUWVlfVlZVVlNPTlJUVFRUVVVWVlZVVVVUUU1UVlZVVVdViYyLg3lgVVlPTlVVVVVUVFRWVVZWVVVVUE9TVlVVU0yTXFpbXnuJgltMTlRVVlVUVFVUVVVWVlVTTk5UVlVVUZPvSEhISFBRZHZqUE5SU1JSUlJUVFVVVVVTT09VVlZUTcjsR0hIRkdISVFwb0tNT05OTk5QU1BSUlRSTlBWWFZUS8jsSEhHR0dGR0ZLYmdOTU5NTk1NTUxLTU5PTU1TU1NTS8Psbm5gUVJERURCRGNeTlBQT1BQTk5NTUxNTU1OT09QSMHs6+vq6uucTkJCQkpeUVNSUlJSUVJRUE5MTE1PT05OR7zs4+Lj6OzwlkJCQUJRU09TVFFTVVNSU1FLTE9QT1BRSb/uYWFmd+br1DVBQUBDU0hRU1NUU1JSUlBLTVJTUlFTTMHuQUA/Pozu5DZBQUA+TUFOVFRQU1BTUU5KTFJTU1JTTL7uPjw/NK/u4TdAQEA+Rj9MUVJSUlFSUU5KTVNTU1NTTL7rR0lBju3unj5BQEA+PzxKUVJRUlFTUk5LTlJTUlNVUWDU5eXm6uzNVz4/Pz89PDpIUVFRUlJTUk1MTlJTUFVVU0a95ePk5+rugzk+PT09OzhHUVFRUlFRUUxLUFNTUlRVTaLwZWJoitLu2zE8PDw8OjZGUlBQUVFRUEtMUFNTU1RVTbTuOzo5Onft8TM7PDs5ODNKUlJQUlFRT0tNU1NTVFRVTbHvOzs7Omjv8D07OTk4NjRIU1FRUVJUT0xOU1VUVFRVTa7vODk5Mpzv7To6OTc2NDxLUVJRVVRTT0xPVFNTU1RTTa/wl5edsO/q1Dk4NzYyM0RRUVJSVFRTT0tSU1NUVFNTTq3v6+vp7+rqgDI3NjQvN0lRT1BSUlJSTkxRWlRTU1NTUKrvx8fEuphfMjQ0NDIwQUtNTE1OTU5PTUxQUlFRU1NRTajuQ0JBPzI4NDMyMTI5T1FPT09PTU1NTExOTU9NT09NSqTuMzMzNDQzMjEuLThMU1NTUlNQUVBNS0xOT09NTU1NSZDxMjIyMTEvLi0uOEpRU1NTU1NTU1NPS09RUlFQT05OTECmLzAvLiwqKzJBSlBRUlNTU1NTVFNPS05SU1JTUlFQT1BOJSUkJCYuO0ZRUFBRUlNTU1NVUlNPS09RUlJSUVNSUVFQPj4+Pj5CS05PTlFRUlJSUlJTU1FOS1BRUlJSUlFRUFFQTU1NS0hKUFFPT1FQUVFRUlJSUlFMTFFSUlJSUlBQT1BRUE9OTEhLT1BPT1BQUFFRUVFRUlBLTVJSUlJSUlBPT09P"),
            new Anchor("ghost_lap_4:colon2", 620, 233, 639, 268, 23, 39, "UE9PTk5OTEhLS0pKSkpKSkpITExMTUxPTk9PT05LSEtNTU1NTU1NTUtLSkpJSk9OTk9QT0tITE5PTk5PT09PT09OTUxMVU9OT09PSklNT09OTk9PT09kg4uKiIrhVU9QUE1JSU5PT05OTk9NTazt7Ozr69WafkxPTUlKTk5OT09NTXGUnO/s7OrrmbjveU1MSkpOT09PTU9Ht+6Zjujr7Ou77O2uQEpJSVFUT09NT0rT7e6mmOTf3u/s7bNDTUtfl7F8TU1OStTs6+2NaXJt7+zus0NHRJ3o7udoS05G0evr7qlHSkTu7O6zREZByPHp7ZJGTkfS6+vtqkNMSO7r7rdESEWh7urcZ0xORNHr6+2qQklH7ezutkJIR0+XpJJOTU5Ezuvq7KpDSUjs6+61P0dKTk9PT05NTkTP7OnuqD9JSPHs7rg+R0pMTE1NTUxNQc7p7bp5RUhJlOvstj1GSkpKSkpKSUtBxuvDck5LSUlImNJ0RUZKSUlJSUhIRkR/xnVASUhISExswU9IRktMS0tLSkpJRXHNWkZHRkVFa8vyoD9GTU9MTk1NTU4/ve7MQEpGRkfG7O28OUhNS0tNTU1NTj3J6e7UWUhHSu3r7745SE1LS0xNTU1NOcbv6e+qOkhO7OvtvTlJTkx3kV5LTk05xu3r7bI6Sk/s6+3AOEpHdeXt6l5NTTnG6+vutDxLTu3s7cA4SkCx8enxmEdNOsPq6+60O0tO7ezuwDlKRKLy6/GGRU06w+rq7rY+TE3t7O7DOExNU7rLoVxNTjvE7OztqlNbXOzs7sM7TEtJSlFRTEpKO8Ht6qGXv8zMXODwtTxLS0xMTExLTEpAru20l8Ds6+vegL1aSUtMTUxLS0tMTExNq5PF7urr6++yPEhISUpLS0pLS0xNTU1Hi+7p6Ojosl1FRkdISElJSUpKTEtMS01MjaWioJ9IR0VGR0dHR0ZHSEdHR0hLSklGRUhKS0lIQ0ZIR0ZGRkZFRUZFR0dHR0VGSElKSUdDR0pKSUlKSUlJR0dHSEdGRUVGSEhLRkNISkxMTExMTExLSklJSUZFR0hISFNGRkhKS0tLTExNTEtLSktLVnJ7fH1+3GxGSktMS0xMS0tMTUxMTEKT3ujp6erpnXJNTU5RT0xMTExMTUtfhn/m7O3q66um65RHT0xNTU1MTEtNPp3ns3/w7Ons"),
            new Anchor("ghost_lap_4:dot5", 670, 233, 689, 268, 23, 39, "UE9PT05KSEtPT09QUFBRUVBQUFFRT0xPUU5QTEpIS09PT1BQUFBQUFFRUVFOTFFOT09MSUhLT09PT09PT09PUFlZWFlXomlOTUxJSExOTk5OTk9PT01hmJWWlpfrwXBLSkhJS05NTk5OUE5NX3qenJydnNK2o5VHSElLS0xMTU5QS2edXoyenJyclKnZxmlESUpKSklLS0xIhJuaV4Gem5ul5O3Hc0RLTEtKSUlISEWAm5uYX3p2ds7s68d1RU1PTk5MTEtKRoCZmpl3RUdI1uzsynRFTVBQT1BOTkxHgpubmnpER0jX6+zIdUVMT05OTk9PTkiAnJycfENISdXr68l3RU1PTk1NTU5OSYGdnJ18REhJ1evry3dFTU9QTk1NTU1JgJ2dnYBESUvT6+rKdURMT05OTU1OTUmAnZygbkdLS6rr7cp3RU9OTk5NTU1OSoCcnnpGSktMlnvqwXtGT01OTU1NTU5LbKJ6S0hJTE6elaKMWE1PTlBOTU1NTUxQkU1MSUpMTpfIsbpUTlBPT05OTU1OSm6gf0pJSkxOsrTe031LT09PT09OTk5Jep6ee0pJS0+q7enOf0tPT09PT05PTkl6np2deEhOTsrr6dSBTE9QT05PT09PSXqem5uDSE1Ozerq0n9KTE1NTU1OTk5JeJ2cm4JITU7K6uvSfUVISEpLSktMTEh4nZybgklMTsrr69SARkhFR0dJSkhKRnScm5uFSk1Oy+vr1IJKTktKVU1LSElFcpuam4RFRkfF7OzVhUpMUHuPwWxKTUZzm5ubZ2t3dJTX7taESUxhqOju03FNSXSemmNpnJmblIjUvIZKTmK67O7UjExJXJxpeJudnZ2YmW92WUxLVJ3n57mBSU1NTVqcnJycnZmZiEdLTExLVIKfgEtOTUxMSomWl5aVdnpXSEtMS01OTExMS0xMTExKSkxNTU1IR0hKSkpKTE1LTExMTExNTUhKS0xNTUhHR0lKS0tMS0pLS0tMS0xLR0pKTExMSEdISktKSkpKSkpKSkxMS0pHSktMTExKRklKS0lLSkpLS0pLTEtLSkdJS0xMTJZiR0tJSkpKSUpLSkpLS0tJSElXY2Vk7Nx3RkpKSktKS0pKSktKSkhFTpabm5reqLiIQkhLSkpJSkpJSkpKRmQ7k5qcn5jLsuF/QUZHSEdISEpJSkhKmpVhkJ2b"),
            new Anchor("ghost_lap_4:badge", 573, 236, 603, 265, 34, 33, "T09PTklITk9QT09PUFBQT1BQUVFPSk1RUlFRUE9PT05OTFFRUVFMS09OT1BPT09PUE9PUFBRTUlOUVFRUVFQUE9PT056fH1+em5fUlBSUE5PT09PT09QUExJTlFRUVFRUE9QT0p4ZGVlZmV1hX5eU05OT05PTk5QUVFKSU9RUU9QUFBPTk1s10tJSUlHUFdldW1QTU5MUE5OUFFQS0lQUFFQUE9QT05Jh+5HR0hISEhIS1Fvc0xISUpLTE5SUUpKUVBQUFBPUE9PS4PwRkZHR0dHR0dHSGFuS0ZHSElKTE1LTFBPTk5OT09OTkt/70ZFRkdOT1JKRURCZV9KSktKSkpJSUlKS0tMTU1NTExJf+9DQj9h3OjxgD1EQ0VdU0xPTk1NSUlLTkxMS0pLS0pKR3rvQ0Bs5urp84I7QkNDTllJTU9OT0lLT1FQUFBPTk5NS0d27z5O0+vc7vOBOUJCQkJTSlFOTk9HSU9QUFBRUE9QT01IdvBF0+7mkfXzgzhAP0A/SkhJTU1MR0hOUFFQT09PUVBOSXHywOrlj1T184Q2Pj4/PkJGRE1OTElJTlFRUFBPUVFPT0ty8OzpfDVb8/GFNj4/Pz9AP0BMTktGSkxOT05NTU5NTEtLTMbvozU/X/XzhjY+Pz8/Pz40PkA8ODs8PD4+Pj49PT08PDKYkzU6PmDz8ok2PT49PD0+LTU0MjAzNDQ0NDU1NTU1NTRW2TY7Ozti8PGMNTo7Ozs8Oyw0NDIxMjQ0NDQ0NDQ0NTMyWO6GhoeImfDuuZp8NTg6OjctODYzNDU3ODg4ODg4ODg4N1Ht5ufo6ent7uvvqS49Ojk0PUlGQkNGSElJSUlJSUlISEZf7+Lh4d7e7Oze3J4tNzg2NEZOTEVITE1NTU1NTU1MTEtLZu9AQDw7XfDxjyw4MzQ3MTA8QD03Ojw9PT09PDw8PD07PFTvNjc3Nlvv8Y0sNTQ2NCwtMjIyMDEzMzM0NDQ0NDQ1NTRN7jU1NTVIt7l5Ljc0MywnMTAxMTAyMjMzMzMzMzMzNDQ0TO40NDQ1NTM0NTY1NC4nKzQzNDMyMjIyMjIzMjIzNDU1NUzvMzMzNDM0NDQyMDAuO0VIRUJBQUREQ0RDQkJDQ0NDQ0RS8jEyMjIyMjIyLCwwP0pLTEpJRUdLS0pKSUlISElIR0dFPJ0vMDAwMC4tKiYtNTw+Pj49Ozg6Pj89PTw7Ozs7PDs8Ojg3JSYnJiQgISUqMDEzNDQ0MzEuMTQ0NDQ0MzMzMzQzNDQyMDQxODEkJyouMTIyMzM0NDMxLzE0MzMzMzMzMzMzMzMzMjFGQUtFLjEyMzQ1NTQ0NDQzMjEzNTU2NjU1NTQ0NDU2NjQzSUlOTUNDQ0REREREREREQ0JBQ0VFRUVFRkVFRERERUVBQEhNUE5MS0xMTExMS0tLS0pHSEtNTEtLSktLS0pLSkpKRkZITU9KPz8/Pz4/Pj09PT49OTo8Pj49PT08PT08PDw8Ojk4"),
            new Anchor("ghost_lap_5:colon2", 620, 264, 639, 299, 23, 39, "SEdFRkdHR0dGR0hHR0dIS0pJRkVISktJSENGSEdGRkZGRUVGRUdHR0dFRkhJSklHQ0dKSklJSklJSUdHR0hHRkVFRkhIS0ZDSEpMTExMTExMS0pJSUlGRUdISEhTRkZISktLS0xMTUxLS0pLS1Zye3x9ftxsRkpLTEtMTEtLTE1MTExCk97o6enq6Z1yTU1OUU9MTExMTE1LX4Z/5uzt6uurpuuUR09MTU1NTExLTT6d57N/8Ozp7JDh5tM5TkxLTlFNTEtLP7Tq76KJ3OPh4+vs1DlKS1J/n31FSko8s+vs7axogX/u7OvXOExFgd7v9HdJSzuw7OzuzUFCRu7s69c6TUKj7+7ysEhKPLHs6+3KQjQ87uvr1jpMSnzr7Ot+Skw4puzr7cs/KzLw7OzaOE5LS5mxpl9JRiyf7evuyjwsK+3q7No7Sk5LTExMS0c9J5/u7O/FSjku6+zq2jtJSUtLS0lIPjQfnuzwy4lJR0KD7u3bOklISUhHRj82LReT79qISD9DRUGC2JRDSUlJSEg/NSsgGVnFiEpEQUNESU7EVEdMSkpJQjcuJB46TL1fPUNCQ0Rbpey9QUtMS0U4MCMiNjSh6NlSQkREQ5fp7eBASklFNjElIzNAM6Xs8NlPQ0VF6+3t5EBLRjozKSEtPj8xnu7r78xGREXr6+3jQEY8MUVnRj49Py+a7Ovs10Q7Q+zr7ONDOi1AseHfYD0/J5fs6u7WRS8+7Ozs5zYzH3/p5/C7Ozkhk+zr7dpDLTXt6+3nNC0bZe7s7phCNh2T7Ovt2EMqM+3r7eczIiA4q9KzcTw2HJPt6+3AVj8/1e3t6i8dOT5DV1RBPjUbkevvvKOfsrdZ6/DZMiE5Ozs6PD4/OB1478+ilt/s7eKIuXsoHTo9PTw8PD4+Mi2TnaPo6urr6tpFLh0eOjw/P0BEREVDQ0Fp2urp6em7fjwsHRsxPkFCQ0NFRERFQz6AqKelpEI6MyocHDVDRUVFRUVFRUVFR0dFRUREOzAnHCQ2QURFRUVGRkZFRkVHR0REQ0IyKR4nP0FGR0ZGRkZGRUZGRUVFRENCQCgfKT5ER0hHR0dGRkZFRkZGQ0ZFRURBLylCQUVJSEdHR0dHR0ZGRkZGaW9ubnDIdDxFRkhISEdHSEhHRkZGQoW/2NjY2uyTf0JHSEhHSEdIR0dDRkN8T+ju7Ozr"),
            new Anchor("ghost_lap_5:dot5", 670, 264, 689, 299, 23, 39, "SEdISkpKSkxNS0xMTExMTU1ISktMTU1IR0dJSktLTEtKS0tLTEtMS0dKSkxMTEhHSEpLSkpKSkpKSkpMTEtKR0pLTExMSkZJSktJS0pKS0tKS0xLS0pHSUtMTEyWYkdLSUpKSklKS0pKS0tLSUhJV2NlZOzcd0ZKSkpLSktKSkpLSkpIRU6Wm5ua3qi4iEJIS0pKSUpKSUpKSkZkO5OanJ+Yy7Lhf0FGR0hHSEhKSUpISpqVYZCdm7nB7OGNSkVEQ0RFRkdGRkNZnJuTN4+Yp+rr45BMSkdGRkZGRkVEQleZl5iVTVy76+jjkUxLS0pLSUlIR0dDWJyZmZ9JRLzt6+WSTEtKSkpKS0pJSERZnpuaoEtHuu3q5ZRMSkpJSkpJTExHQVaempqgTku57erllUxKSklJSklLTUdBVp2amaBQTLns6OeVS0lJSEhJSkpKRUFVnZmXoU9JgOjq5JdKSEhHSUlJSEhEQFWcmptzRUiJh+TbkktJR0ZISEhJSEVBVJ2bcktJSpuRdYl4REpJSEhHSEhHRUM8hnZDSklJl7O3r1FHSklJR0hIR0ZGREB5ZUZJSUmuyb/tlkpKSEhISEhHRkVBUZ+cZ0dISa7K7uuaTEhISUhIR0ZFREBYnJqaZEZJrevq65tMSEhISUhIR0VDQleempqeTUmz7erqm0tHR0lJSEhHREJDV5+amJ9OSK3u6+6cSUZGRkdGRkVEQkNXn5qZn05Iq+7r75xKRURERENFRERCQ1WcmZieTkis7evynk5HRkROR0NFRUJBUpqWl5xMRpzu6/KhTUdGaI2pbUJEQUNSm5aXmkhAcdPp8p9LSDmY0erzakBBQ1ObmZVoYoaVfMzQmkpGQJnt7PKWQkFGUJ2dZnSbm5mbY4JwRUg9gevp05I4Q0hDdG5hmpmamJudUUhGSEZKiKSLWUJFSUpKQJqampuMkm5CR0ZGSEdGSEZERkZJSUlJT39/fTVGSEZHRkZHSEhIRkVGRkhKSEhJSUlKOkdGRkZFRkdHR0ZEREZGSElISUdISEk+R0ZHRkZHR0dGRkRDR0dISEdISEhISD9FRkhGR0ZHR0dGRENGSEhKSktQUVFRh2xCR0dGRkdIR0ZFREdJSUlEdo6NjY/n8X9BR0dHR0dHRkRDR0lISlicnJubmuqzjFNCRUZFRkZFRENHSEKHgGmdm5ya"),
            new Anchor("ghost_lap_5:badge", 573, 267, 603, 296, 34, 33, "SE1QTkxLTExMTExLS0tLSkdIS01MS0tKS0tLSktKSkpGRkhNT0o/Pz8/Pj8+PT09Pj05Ojw+Pj09PTw9PTw8PDw6OThHTU9JLzM0MzMyMzIyMjIwLi8yMzQ0NDQzMjIyMjIxMDAwcnZ4dWthUDQxMjMxMzIyLy8xMTIyMzMyMjIyMjIyMS8tUHVycnJydYNxVDQxNDM1MjAvMjM0NDQ0NDQ0NDQ1NDQ0Pa1JSUlKS1FdZXZoSkFFQ0U+PkFDQ0NERERERUVFRkZEQUnzSEdISEhISkpSbXVPSU1IRkVISkpKSkpLS0tLS0tLS0RJ8kZHRkZGRkZGRkldb0Y5ODg4OTs7Ozs7Ozs7Ozs7PDs3PfFFRUVISEhLSURCQF5lMy4tLi4vLy8vLzAwLy8vLzAwLjXvz9DP0tLS17E2QkJFXk8tLjAwMC8vLy4vLi8vLzAvLzEz7uvr6+vr6+7FMUJCQUxZNi0wMzMzMjExMzMzMzIyMjIyNu+vraysqqmrkzVBQUE+UUk5QENDQ0JCQkNDRERFRUNBQkDzQT8/Pj0+REE/QUFAPUZRPEhISUhHRkdISElJS0pJR0VH9E5YW1tVPT5AQEBAQD9BUDI9PDs7Ojo6OTk7Ozw8Ozk3O/O0y9LSxqySRj0/PkA/QEUuMTEyMTExMDExMTEyMjEyLyq56ufm5uvs57ksPj4+Pj8/LzAyMTExMTExMTExMTEwLy0tZ4eCf3yJ4+rzXDs9PDw9PTAxMzMzMjIzMjMzMzQ0MzIyNaw8Ozs7O2n286g0PDs7Ozs4QUNDQkJBQ0JCQkJDQj8+QD7yPDw8PD0h9/C3MTs7Ojo6OUlLSkpISUlJR0hJSEhFQ0ZC8j47Ozs8L/bvuS87Ojk5NzE9Pz08PDs8PDs7Ojo5NzY5MvI4Nzc3NX/z76MvOTg4NzQmMDEyMTEwMDAwMDAvLy8wMyzxg3+AgZLY7u1ZMzg4NzIsLTIwMjExLzAvMDAwLy8uMDMt8uvq6uvr6+yUKjg4NzUvKTExMjIyMjEyMTIzMzIxLzE4LfHP0dLRybV9QDQ3NjMxLzc+QEFAQEFBQUFBQUFBQD0/RDr0WVZXV08vMTMzNDMuKjQ/RkZFRUVFRkZGRkZHRURCREc78zMyMzQzMzUzMzMvKi0zOTs7Ojo4ODk4Nzc3Nzc4ODo9Mu0yMzMyMjEyMi8rJCUpLS8wMDEwLzAwLy8vLi8vMDI1NjKDLy8vMTAuLSolJScrLS0xMDExLzAvMDAvLzExMDEyNjg6OCgoKCgnJCIiJSssLi4vMTAxMTAxMTIyMTEzMzMzNTk8PD4xMTMxLy8wNTo/Pj06PD9AP0BCQUJCQUBAQEBAQD9DR0VGRUREQkRDSEhJSUdGQ0VISEhISEhISEhHR0dGRENERkVEREdISEU8PD08PD07OTg6PDw7PDs6Ojs7OTs7Ozk4Ozw8OztIR0hEKTAvLi0tLCwrLS4vLi4uLi4tLi0uLzAyMzQ4ODk5"),
            new Anchor("ghost_lap_6:colon2", 620, 296, 639, 331, 23, 39, "QjozKhwcNUNFRUVFRUVFRUVHR0VFREQ7MCccJDZBREVFRUZGRkVGRUdHRERDQjIpHic/QUZHRkZGRkZFRkZFRUVEQ0JAKB8pPkRHSEdHR0ZGRkVGRkZDRkVFREEvKUJBRUlIR0dHR0dHRkZGRkZpb25ucMh0PEVGSEhIR0dISEdGRkZChb/Y2Nja7JN/QkdISEdIR0hHR0NGQ3xP6O7s7Ouzp9OvQkVISEhISEdHRz6GzMd56+rn65PN7/NSR0hHSEpIR0ZDP4zr7rhn4uPiyOvr8VJHSUJyk4A/SEc8hu/r77VhiIft6erzUUdCbb7t8o0/RjuF7uvt41w5OO7q6/NTRUGA5O3u0klDO4Pv6+3lXDQ07evr81NHQlTq8PCXUEE7f+7r7OVbNDPt7OvzU0ZFPIy0r3k7Qjl/7uzr5Vs0Mu/n7PJVRUVFSElEPz1BOH3v7ezdXjIw4e3r81REREVFQ0A+PkA3eu7u3qRTLC507+/zU0JDQ0NBPj09PjZ18OihWicuLD522KlUQUFBQUA9PT07OTbMpF4tLS0tQTW0akJCQkFBPz49PDo3NJ1pJy0sLC1GiNLVPEFAPz89PDs7ODF1xeNXKC0uLorY7fRSPj8+Pjw7OTk2L2jw7uZCLzIyze7s8lQ9PT09Ozk3NjUraPHr79k7NDjs6+zyVT48O0VyVzQ0MiZm8Ovs6GI1PO3q7fJVOzpHmc3VZy0uJ2Lv6+zmYzZA7evt8lQ7OGnS7u3VMiknY/Dr7OZmO0Tu7O3yVTk4ReTu7bdNKSdk8Ovs52M4Pe7s7fJUNzcrldnJlCkrKWLw7O3YckRIwO3s81Q1NDM4X2BCLC0wZe/u2qikoaKM2e3oWDIzMS4qKi0xNDJb8+GYmsXr7OZ4tJpQNDAtKiksMTU3OCydqKvK7Orr7uBUTTAwLSooLDA0OTk9RDVlw+jq6+m+nFExLiopKSswNzo9QEU7O0N+rquqp0lOMS4pJCYuMjU8QEJERT1IRkpSPTcwMTIxLScmLjU4O0JERUVFRUhHR0k2MSAwMTAoKzA3OjxDRUVFRUZGSUZHRjgyKi4uLCMxPD5CREVFRkhGRkdGR0dHOTYxTSgpL0BGR0ZFRURGR0dHR0lIXmxjU1u5aiU8SEdFRURERUNERkdGQWGgxcjDw+20hEhDRUREQ0NEQ0NHRD+AVuXs6uzr"),
            new Anchor("ghost_lap_6:dot5", 671, 296, 690, 331, 23, 39, "RkhGR0ZGR0hISEZFRkZISkhISUlJSklHRkZGRUZHR0dGRERGRkhJSElHSEhJSUdGR0ZGR0dHRkZEQ0dHSEhHSEhISEhKRUZIRkdGR0dHRkRDRkhISkpLUFFRUVFsQkdHRkZHSEdGRURHSUlJRHaOjY2PjvF/QUdHR0dHR0ZEQ0dJSEpYnJybm5qbs4xTQkVGRUZGRURDR0hCh4BpnZucmpqLM5CKPEJFRUZERERHRlWY68pmmpiamlmQl5xMRENDRERDREZEVarx6sVlfHt7kJmWnU5ERUREQkNERENTqe/q8Jo+RkWclpmdTkRFRkRCQ0VGQ1Oq8Ovxo0pCQ5yamJ5OREVFRURERkZCU6jw6/GjTEFCnZiXnE9ERUVEQkRFRkFTqPDr8KRNREScmJedUERERUNCRUZGQ1Op8evwpFBGSJyal51RRERFQ0JFRkZDUqjx6OqZT0RFl5qYnVBDRERCQkVFRkRSp/Hnq8VxeXpYkJqbUERFREJCREVFQ0Kj8qTTuNrW2OE8mZk8RERDQkFERUVFRkaQ2Yjm7uvqvMCaWj9ERUNBQUNERUREREJXxO/r6+zOrO2lRkJEQkA/QkNERkVDQ0NDx9/c3Kzl8KpOQUNCQEBCQ0NERUVFRUZNcXhz6ezvq09CQ0FBQUJCQkRFRkVGR0ZKRkfw7fCrT0FCQEBBQ0JCQ0VGRkZHR0hGRfDr8KhOQEA/P0BDQkFCRERFRkVGR0ZG8Ovwqk4/QD9AQEFAQEJCQkRGRkZFRUTu6vCrTzw/PUNBQD4/QT8/QEJCQ0VEQ/Dr8K1QQT9QgJJzQEBBQD8/P0A+bGtrwu3wqlBBOZmy5u9oO0JCQUNBQZqWlZWFxeOdUD88l/Ls75E8Q0NDRD+KmJaVlu55fIRCQjV68OvdjTdEREY9nJyXmZeX4KZRQkNCQDaLrJl5PUVERUFbl5WUlJKRf0RDQ0E/P0JLTEVDRURFRUZGRUREQz5BQkNBQD4+QEJBQ0RERUVFRUVEQkNCP0BCQkFAPj5BQkNERERFRUVGRURDQkE+P0JCQT89P0FCQ0NDRERFRkVEQ0JBQD5CQEJBPz5AQUJEQ0RERUVERUpJR0ZEajhEQkI/PkBBQkNEQ0RFRkJsiJCPj5DdgTdAQD4+QUJDQ0NEREVGVZjD5uXl5cuQUENAPT9BQkNDQ0NDRERBWOHr6urr"),
            new Anchor("ghost_lap_6:badge", 574, 299, 604, 328, 34, 33, "R0hEKTAvLi0tLCwrLS4vLi4uLi4tLi0uLzAyMzQ4ODk5OUhIRCwuLy8uLi0sKy4vLy4uLi8uLi4uLi8xMTM0Nzc4ODdJSUUtLi8uLS8uLSwwLy8vLy8vLy8vLzAxMjM1Njk5Ojs2bW5sZl1UQD06Ojk6PD0+PT08PT09PT0+Pj4+P0JERENRaHt7e356hXFeSUBAREZGR0VFRUZHRkVFRUVDQUFDREU5htFNS0xNUWNsdWVMNTo7Ozo5OTk5Ojk4ODk5OTg4OTs7Id7rSUlHRUZOSVNrckQpKy0sLCwsLS0sLCwtLjEzNTU3Nx7t7kZHR0VISUlHT1xqRSwtLCwsLCwsLC0sLS4xMzY3Nzcf7excXV1WQUlGRUNDVGc5KiwsLC0tLS0tLS0vMzU4ODk7IOrrxMjGw7i1XEJEREReVTQ6ODk4ODg4Nzc4Ojw+Pz9AQins7Ovq7erq6dwzQUREQ1tFQkREQkJBQUFBQUFBQT8+P0En6OyFdXqXx+/yoDdCQkJQTzg4OTk5ODg4Nzc3Nzk5Nzk6IOfsREFCRVzx6dguQUFCR1YtKSwsLCsrLCwsLTA2NjY3NyDm7UBBQUFDbnFuOkBAQEFSMiosLS0sKywsLC0vNDY2NzYg4+2GjYyLi4U7QD1AQD8/RTcpLi4uLi0uLi8vMDQ2Nzg5Lajp6erq5+Xjo1A8Pz4+PT47Njo5Ojw7Ojs6ODs/QUBAQUFVx8a/wc7j6+2zLj49PT0+Oz9DQkZEREJBQT0/QkFBQEA2jONaWVlebOTv7iM8PDw8PTk1Ojg5OTg4ODc1Nzk4ODg5JNfvOjs7Oy/K7vYgOzs6OjozKC4tLCwtLCwsLS8zNDQ1NSLf7Dw7Oz0wwe72Hzk6OTg5LCgsLCwsLCssKysuMTQ0NDUi3ew3NTc5LMXt9h04OTg2NiIrLS0tLSwtLSwtLzI1NjY4Jd3sb1tid5DX7tUhODk4NDExNzo5Ojo6OTk2Njo8Pj8/Py3f7NvV1t/k6+h0LjY3NjIzPUJDQkNEQkJBPj1BQkJBQEAu2+3c3djXzrqFPDY1NTIrMDY4ODc5Ojg3NzU1ODk6ODc4Jtrtd3p0b2BFODI0NDQrIykrKiorLC0tKysqKy0vMTQzNCTa7TMzMjM3NTU0My8rJiQoKioqKisrKioqKissLTAxMjMkzvAzMzMzMjMyMCwlJCgqLCwrKysrKysrKissLS4vMjM0MG7VMDAwMDAuLCgpKzA1Nzg4ODg4ODg3NzU1Njc3ODo7PD86XSopKCgoJSorNj1AQUJDQUBBQUFBQEA9Oz5AQEA+Pz8+Pj8rKywlJCYqLzc4OTk5OTg4ODg3ODY2NDQ2NzY3Njc3NjU1Ozs6KSgpJissLS0tLCwsLCwsLCwrKikqKywsLS4wLjEyMkFBQCspKScpKyoqKysrKysrKysrKikpKisrKywsLS8xMzNCQkEuKigoKisrKisrLCsrKysrKysqKissKywtLS8xMzU1"),
            new Anchor("ghost_lap_7:colon2", 620, 328, 639, 363, 23, 39, "SU4xLikkJi4yNTxAQkRFPUhGSlI9NzAxMjEtJyYuNTg7QkRFRUVFSEdHSTYxIDAxMCgrMDc6PENFRUVFRkZJRkdGODIqLi4sIzE8PkJERUVGSEZGR0ZHR0c5NjFNKCkvQEZHRkVFREZHR0dHSUhebGNTW7lqJTxIR0VFRERFQ0RGR0ZBYaDFyMPD7bSESENFRERDQ0RDQ0dEP4BW5ezq7Ou6trCxO0dERENDQUJDRT5nqr5k1+3r66ew4vBfRUVFQ0NAPkFCPmTm8Nlu7ubmpeXq7GlERT9dg3xDPjw5X/Hq771QlZLj7OvvZT5BU6LS3ZgsNDNU8Oru6WIyOfLs6+9lOTlb0ezr3z4vKk7w6uzpdSot8+zr8GQ2NTnl7Om6YignTPDq7etxKCvz6+vvZDIzKXi8u5MhKShI8Ozr6mwhJfPp7PBnLS0tL05LPyQoJ0fx7OjncSAi3+vr8GcsMS8xMC4tLCopSPHq67J0Ki5T2uvwaCYmMzcyMTAwLi1E8u2wdzg0MDFk5r13HyAmMjEyMTAwMCzYuoc9NC0kOy+rnDooIyAgIiYlJScjHZCdLSIhISI4b5/cIjEqJyYlJSQjIR49jeZTHiUmKH2s6fFtNDMxLi4uLCsqKELs7utlLS8you3q7Xw1OTo4Nzg3NjQzR/Pr7+E5Nzfm7OnwgDg7PDRoYDQ5OTtJ7+vr6oAxOu3r6+97Mzs+jK/RfTc6O0vv6+zqgy438Ozq73spL0iu6+veMi8xQ+7r6+p/JzDu7OrueyIrL9ru6dVoJixB7Ovr6n4mLfDs6e97ISghe9zXmDcsKj/r6+vmhioyvu3p8IAiLSsoZH5bKi0qPOvr6KW8hIqYrevriC01ODg4NzY3NzdD7OmOuqTj4uuRv7d5MTs7PD08PDw8OjWmr8Wh6evr7eRSYCkvMDEyMzMyMjIyLyhgneXq6urCrXUhJygoKSkpKSkpKSoqJiNvsbCsrF1fHyUlJignKCgoKCgoKCclJyNJSkxLJicnJycoKSoqKSkpKSoqKiorLC0sLS4yMzIwMDIzMzIyMjIyMzMzMjMzMzMzNTo6OTg3OTk4ODg4ODc4Nzg4ODk4ODg4Pj8/Pj0+Pz8/Pz9APz8/P0BAP0A/P0FkZGRkY2NjY2NiY2NjY2NjZGNjZGNjZHBwbWxub25ubW1tbW1ubWxtbWxramtr"),
            new Anchor("ghost_lap_7:dot5", 670, 328, 689, 363, 23, 39, "PD5BQkNBQD4+QEJBQ0RERUVFRUVEQkNAP0BCQkFAPj5BQkNERERFRUVGRURDQj4+P0JCQT89P0FCQ0NDRERFRkVEQ0JBPz5CQEJBPz5AQUJEQ0RERUVERUpJR0Z5ajhEQkI/PkBBQkNEQ0RFRkJsiJCPj9jdgTdAQD4+QUJDQ0NEREVGVZjD5uXl7suQUENAPT9BQkNDQ0NDRERBWOHr6urSkF50gjc9PkBBQkJCQ0NDRENBV+Xu6o1qa5abUjk9PkBAQUFBQkJCQkE8WsvNYWuUmJpROj49Pj4/PT0+Pj8/QEBARnJGnJeZm1I6Pz8+P0A+Pj4+Pj49PEBAPUadl5eaUzk+QEBAQUA+Pz8/Pz09Pjo5RZuXl5pTOj9BQkFBQUBAQUBAPz8+PjlFm5eZm1U4P0JCQ0NBQUFBQUJBQUA+OkSbl5mZUzo/QUJDQkFBQUBAQUFBPz46PZaZmJlUOT9BQUJBQUFBQEBAQEA9PDu9QpGWmVY7P0FBQUFBQUBAQEBAPz5ib+niWZGYQTxAQUFBQUBBQEBAQD86fpOU7cfFfW45PkFBQUFBQUFAQEBAP3aVk5SyxL7Rr0A8QUFBQUFBQUBAQEA/QoCTlMalyO24UzpAQUBAQEBAQEFBQT49P3KBldDr7bhTOkBAQEBAQEBAQUFAPz87Oj+T7+ntulQ5Pz8/QEA/Pz9AQEBAPzs5O5Du6+y5VDg+Pz8/Pz8/Pz8/Pz89Ojs9jerr7blUNz07PT0+Pj4+PT09PTw6Oz6N6uvtu1Y2ODk6PTo5PTs9PD09Ozo5Pnvr6+y7VjY9RHCDcD46Ojo6Ojo6OT05c7Ps7btbPDqAocnffj46Ozo6OTg7Pmfph7brqGI5O37Y6++oUjw6Oj08OTxwl+vtlHuSTj04bNrr6J9SPTw8PD48epWV6OiyVzk+Pj44h7eljEk/PTw9O2yUl5KXk5FXNj5BPz06VGFSPD09PDw4T5GQj0NCQDs9QD8+PT08Ozw8PTw8PDk4Ozw7PTs6ODs+Pz48PTw8PT09PDw7ODY7PDw+Ozo6PD4/PTw8PDw9PT0+PDs4Nzs8Oz07OTw9PT49PTs8PD0+Pj09PDo7PD09VFNQU1VWVlZXVlZXV1hZWFhXVlhaW1t3dnN2eHh4eXh5eXl6enp7eXh4eXp8fIR/foOEg4SEhISCgYKBgIWAe3t+gIGA"),
            new Anchor("ghost_lap_7:badge", 573, 331, 603, 360, 34, 33, "QUJCQS4qKCgqKysqKyssKysrKysrKyoqKywrLC0tLzEzNUFCQkE4MzMyNTY2NjY2NjY3Nzc3NzY0Mzc4Nzg5OTo7PT5BQUFAPz06PEE/Pz8/Pz8/Pz8/QEBCOzo/QEBAQEBAQ0E/XGBgYmFdUz45Ojo4OTk4ODg3Nzc2NzMyNjg3Nzc3Nzk4N3J1dHR1cXhtVTEsLC4tLSwsLCwsLCsoKSssLCssLCwsJWFUT05MTlFkc3NbQSwqKysrKysqKyoqJycqLCsrKyssLCCtRkpIR0dHTEpUZG5PLCosLCsrKysrKSgrKywsLCwsLC4jxEZJRkZGRkdHSEtda0gyMjMzNTU2NjIxNDY2Nzc3Nzg5K8RGR0ZGRkZFRUZGRVFpSDc5Ojw+QTw5ODw+Pz8/QD9BQjXHm5udnp+hoaSTOENCVVs4MjUzNDc0MzM0NTU1NjY2Nzgrxenp6enq6uns0zVCQkVXRicqKyopKSkpKSgoKCkpKSkpIb2+vLu8uNft7MA5QkI/TFMoKSsqKikoJygnKCgoKSgoKR69X19dX2rV7eqCQEFBQD9TLygrKyopKSopKioqKiorKysdvEBAQT+M7e6vSz9AQD88TTkvMzU1MjAyNDQ1NTU2NjY3Lr0+QDho1O24Uzw/QD8+O0RBNj5APjo4Oz4+Pz4+Pj4+Pj95P0FPzu/pdDs/P0A/Pj09PzA5NjYzMTM2NTU1NTU1NDQ1NDw4oOjwoUE8PT0+PT08PD8lLCwpKCcrLCsrKysrKyoqI3I2ZePpyUI4Ozs8PDw8PDw8IyspJycmKiopKSkpKSkpKSGtXc7t7m42Ozs6Ojs7Ozs7OCEpKSgmJikrKisrKysrKywktq7u6qovODs6Ojo6Ojk5OTAuMzQyMDE0NTQ1NTU2NjU1MLLo67hLNTg7Ojo5OTk4ODYuOTw9Ojc7PD4/Pz09PT0+Pja27uRgNTc4OTk5OTk3NzcxKzQ4NzQxMzU1NTY1NTQ0NTYute2HKTc2Nzc5ODc2NjczKicqLCsoKCgqKysrKikpKSoqJKisLjI0NTY1NzY2NTUzKiUmJyknJCUmJygoKCcnJycoKSGnUzM0NTU1NTU1NTUyLCMhJSYnJyUmJycoKCgpKSkpKSoiozYyNDQ0NDQ0NDMxLSsmLS4uLi8uLy8wMDExMzIyMzMzLpUzMzQzMzIyMzEuKikwNjk5Ojg3NjY3Nzg3Nzg4OTk5OjtFLzAwMTEwLy0pJyYqMTY1NDQzMzE1MjI0MjEwMDAvMDExLicoKSkoJyMiIiIlKSorKioqKSkmKSkpKSopKSkpKSkoKCgnKCYmIh8dHyImJiYnJycoJycmJicnJycnJycnJycnJycnNTEvLikiJCUlJSYmJycnJiYlJSUmJycnKCgnJycnJycoJzo3NDYzLS4uLy8wLzAwMDEwLywuMTAxMTEzMjIyMjIyMTA6OTY5Ozo6OTo6Ojo6Ojs6Ojg1Nzo6OTo6Ojo5OTo6OTo5"),
            new Anchor("ghost_total:colon2", 649, 74, 669, 114, 24, 44, "eHd0dHV2dXJwb29ub3N4d3VwbW9yeXuFfXlzeHt6enZycXBub3N0dXJtbm1tdHh3fHdxeXx8fXx1dHhycnd4dnNvbWxtcHRzeXVyeHt8e3t2dHVzeHh6e3pubHJyf3x8xZt0eXt7e3p1c3Vxdnh6e3lwa3PN4ODi+cGEeHt7e3l0cnB1dHd6fXhtdbrz9fX17Y2nqoF7e3l0c3NzdXh6fHKNvcC+6/b0orb32q6HhHh0c3JzdHh7fYHH8snFuu7zrvP0+Kp9e3Z1dHJ0dnl6fojI9fjKv7vp9/L0+Kl1eHZ3iK+lh3h7fYPG9PTwwrKH9fLz+KVudnGP5O/swYp3eoHD8/P1455s9fHy+KZtdG628fXz25t6eYPD8/P15J9s9fHy96lscnSx8/Tx35R7e3/D8/P05J5q9vHy96lrcnCezvXyxnd8eoHC8/P05J5s9/Hx9qlsd3d4k62Tdnl6eH7B8vLz5aF29fHy9apqcXNzdnZ2dnZ2c3jA8/L05J532fPy9qhpcG9vcnJwcnNyb3i+8/Lzu4SLo9rz861td3VzcnJycG9xbna78u7AmdvgcZvd44NrcHFubXVycXBvbWyu4qqd6fPybHGglmptb29tcG5wcXJxa2qIjo/e8O7waX7Ux41qb3Btbm5wcXFvamxycm6p1PHwcdbz9aplbW1ubW1tcG9tam1yc3Nxo9Dm0vLx9qplbWxtbW5ubm5paWxxcnRyb3948u/w9almbWxubW1rbW1qZm1vcHJzcXBv8+3v9KprcG9wc4CAfG9rZ2xxcHFzcXNz8u3u86xudXN8zebdt4ZuanZ2dnZ2eHZ18u3t8qxsdm6o8O3v3ZdtcHV3d3Z3d3h48u3s8adlcHOv8O/t55ttcHh4d3Z3dnd17+zs8ahncWue2evt0H9uc3l6d3h4dHV25u3t8apkbG5vnbaydWtpcHV7dHl1d3qDtOfr8KpnbW5vcHZxcGxqbHBzdHd0c7XpsrTp8Z1kbG1tb2xtbWtrbW5xcHZym+zt3rO4t2ZlaWprbmppZ2Rmb3Jubmir7Ovq69yWam9sa2xra2xpZWRnaGhoZ47b7ezs6cBrbXFubm5ubm5tamVkZ2dpZ3Ou3eDflnZub29vbm9vb25ua2VlaW1uamp1f399cW9vbm5ubm5ub29uamVoaW1vbm1ua2xrbm5ubm5ubm5ub25taWZra21vb3BubGppbm5ubm5ubm5ubm9taGZrampvbm9vb2lnbm5ubm1tbW1tbm5rZ2dsa2htbm5uc2hobm5tbm1tbm1tbW9qZ2hubGhubm1ubWhqbW1tbW9tb25wbW9pZ2Vua2lsbm1ua2dpbW1sbG9tbW1tbGxpZ2ZsamtpbGxua2hrbWxsbWtsbG1ra2xoY2dsaWlsbWxva2dp"),
            new Anchor("ghost_total:dot5", 707, 74, 727, 114, 24, 44, "foB/f39/f4B7eHh8gIB/f359eHp5enh4fXx+f4B+f353dXh9gH+AgX99fHp7eHh3gH17fH5+f313dHZ8fn5/f399fHh6dnh1mYCAfn1+f3x4dHh8fXx8fXx8eHmZn56hwah7fn1+fnt3dXp9fHt7e3x4j8jx8vHw3aR+gn5+fHl1dHp9fHt6e3x3rsT29vb1rbbHtIZ+f3ZydXp8enp6eJung6rE7PX1ufHwvJd2e3Vwc3d6eXp5h7q4sHexxPP18/PyvZRxdXJycXR0dnZ0hre2t6eGpLTP9fPyvpRydHNycm9xcXBugLSwsbSkcG9v9PPxwJp3dnVzcnV0dXNwgrWxr7KiZmtq9PPywJh1d3FxdXh5eHd0hLi0tLWlZ2hr9PPxvpd1dW9xcnl4eHh1hLi1tbWnam1r9fPxvZh1c3Byc3h3d3l3hLe1s7OqbG9r9fPxv5lzcm9xc3Z3dnd1g7mzsrKqam5q9fPxvplxcnBxdHZ2dnZ1g7exsbGkaWxqz/bvvZxwc29wdHV3d3d1grexsaZ4gIB80M/zwYtvcW5vc3N0cnRwf7Swq3SpsrCsw8K0lWpra2psbm5ubm9wcZimcaKwsK+rr6h7jmtsaGpubm9ubm9vb29te6+ur62ros/ks45mZmpvbm5ubm1ubm1tboivsK2qxe/yuphmZ2psbW1ubW1tbW1sbWyHo6Cc8fDwvphkZmttbW5tbWxsbGxsbGxsbmls8O/wvZRiaGprbGxsbGtsbGtrbGxpZ2lv8O7wvJVjZ2pqa25sa2trbWtvbWxsZ2xv7+zwv5ZmaWtra21raGhnZ2ZqaWppaGtu7+zwwJhma29wbm5raGdmZmVmZmVjaGpv7u3vv5dmbHJzcHVvbGppaGhoZ2ZlZ2lq7Ozwv5dlbHBxdHh3bWprampqamloaGlr5ezwwJZmbHOZzd2vlmRqa2tsbGtpcn6CtOLxv5lkaZG+8OvWrnppampqa2h0oKqv1rvus4JnZ6DI8e3lp39paWppaW+vp6iuwsaCdGdoaJeq6+3WqGVpbWpnbaSqpqqu8LGBa2ZpanOcttGbemZoaGhklKuppqmspoJrbmhsbW1vdnFvaWpqa2hqZImVlJiacHFzamdsb29ub3BuamlpaGhpaGVjZ2xub3JvamhrbnBwb25uamloaGhnZ2NkZmxwcnJtamxrbm9ub3BtamhoaGdnZmNjZ2twcHBtaWpucG5ucHFta2hnZ2ZmaGJiaGxuamtqaWxtbW5vbXJra2hmZ2ZmZWBiZGhsZmVoaGpoaWpsa2tsa2pnZWZlZGJkY2hqamtoZ2doaWhoZ2ZmamRkYmNjYV9hZGZmampmZ2psbWxraWdnZ2NgXl9gX15gYWFmamplZmltbm5ubmtqaGdjYWFgX15dXl1e"),
            new Anchor("x_button", 813, 50, 849, 87, 40, 41, "g4F/fn16eXx9fX5+foGBgIKDgn19f35/g4SHhoWFhoWHhoeBgIF+f4eIhIKAf3yCgYGAgH9+f31+fn14en59fX5/goSDg4WEhIWGgIGCf3+FhoSBgn5/hYWGhYSEhIKAf398e3t5eXp4en5+fX1+gIKCf3yBgoGBg4OBf4B/gISEhoSEhoaEhIKDgXx/eHp9fHl7fHt5eHl5e394en5/goOCf3yAgIKFhIWFhYWFhYODgoF9gnx+hISCfX9/f39+e3l4enl8e3yBgn97fX6DhoSEhYSDgIKFg4J+fH59gIOEhIODgoKCgoGAfn1/eXp8goJ+fH17goODgoKCg4OAfX58d3d6eHyAgoKFhYSDgoKCg4F+gnx9f4OCfn18fICAgoOEg4F+f318g4eHhISCe3+AgoSEhIKBgoKAfYB9fYGDgX59fXyBgIGCgX5/haG2wcfJxriroZqUgnyAgIGBgoKBfn6CfoGXgn9+fnx8gYGAfoCMoMjPysK7tLO2vbitpKaVfHyAgYKBf3t7gYGgvoOAfX17fYGAeoeYuMy7lHNcUFBSZ4KLmamho5+He39+f355fIOdttSBfoR9e31/eIWgwb2iZERFRUZJSEhNYXeKi5Olqn19gn99enuPsMPrfXt8fnt9e4qks6qJWT1CQUJCQkJAQ0NEZomKh6KphH6AfnqEpbTb8H14e316f32jpaaIVkA9Pz1APD09PTpBQkZoiYSDppx7gXp5kba65+J5dnh7e3aVo5+MYjtRWVxtbEI3N1VaZXdcPWuEc5anhX18eqK4yejGd3d2dnR8pJ2AfEE0VHZ3fIFpOE94c4d/TTE7fHt0pZ56e3qps8/kv3t6eHNylJ+GfWYxMjxqgHNugFJwf5CAYTUzL2J9YJGogHR3qbXP37t9enl3cp+XfH9AMDAwQXR+ZX2SfnyGaTotLi5EemlzqI1zd6i1zuG8f3h8dHujkHt7ICopKShNeHVuzaB8ekcpKCcrJHt7X6OWc3iitcTlwX56fnaBo417ch8nJCUjKF15dL+gelApJyUkKCJxfl+bmnB1krS22dR6e3x1hqKCfGwcJCEiIx4vdWyihnc9IyMiISUgZHpblphxdIKzscrke3x5dYOjfXZpFiEfHx4YOHOJwIRwYiocHh4eGWJ2V5yXdHd4m7e13Hp9enV+oItschIeHBsbJ2B4kMZzW3RIHRoZGRRuclqhj3Z6doGqtsJ4enp4e5+QYXImGBgYHEZkgnOgZVVoYTgVFxgYc2duoIN3fHp7kbK3eHl5eXiZmGJtUREREDRedV9gQGFaXGJTIxMTL25Xj594eHt5fXyJq3d4dnp5kZ5sY20fDBZNa3NfRw5AYUlZXkESD0dmdJ+Qcnp9eH5+fIZ5eXV4eHudkl5mSRQ8VW5jThkKGE5WVldOIR1kb5GcenJ6enh9fH5+enl4eXpzhpqAZmY2PDsuFxQFBAQlOjAVChVWa4KbkHBzd3d5fnx8fXx7fX9+eXKRnHRjYi8IAwIBAgIBAwICAQpFboqVk3h2dXd1d3x+fnx6enmAgH97fJGXfGldMAQBAwIBAQABAg5DZJOhk3l4dnd3c3d7fX17c3V2ent9fXZ6j5R/d2VLJBIEAQECBSpoj52QinN2end1eHZ4ent7e3JycnJxcnd4cHSGjJaUhXFmWVVRbpWpraOJf3l3e3d1dnV2enp5e3t2dXRyc29vcHJxbHF+g4+fpKevrqyrmYN5dnd4enx1cXZ2dnt4eHh4eHd5e3Z2dnVzc29uZ2xwd3x9fn12cXBwdnh7eHl6dHF1dHR5e3p5eXd2en17enp4dnd1dHJybm9samxubW5vcHN1eHl4eXRxc3R1eHp7eXl0dnl5fHt6e3p4eHh5eHN0cnF0dHRzdHNzcXNzcnNwcHJxcnN1dnV2c3V4eHl5enp6enh6eXZwdHR0eHl5eX95eHZ1dHJxb29xcG5ub3BwcnJ2dnd2eHd5eXp6enl1cHRwcnd3d3t3enZ1dXV0cnFwcW9xcXBwb3Bydnh4dnd2d3l6enl6eHN3cXB1dnV0dXZ2dnZ3dXRxcnJzdnV0dHR0c3d3d3Z2dnZ7dXZ4d3Zze3N2eHp2dXZ0dHV1dnV0cnJxc3d2dnZ2d3B2dnZ2dXV2d3R0dXZ7i5idp6qnnZODenx2dnR1cnBzcnF1dXZ2d3g="),
            new Anchor("magnifier", 848, 49, 887, 88, 43, 43, "gn6Cf36Dg4OFg4ODg4ODg4F/f4B9goODg4ODg4ODg4GZoaPHyM3R0dHR0YGAgX5/g4KDg4OEgoSDg4R/gH9+fYODgoODg4ODg4OBmaGkxsnO0tHR0dGAgYJ/f4ODg4ODg4KFg4OEf3x/fn6DhIKFg4ODg4ODgZegpsXIztLR0dHRfIGCgYGDhYODg4ODg4OEgn59gHx+h4GCg4KDg4ODgoKWoKfEyNHS0dHR0Xh6fn+Cg4KFg4KCgYOChIF9fYF8foKDgoODg4ODgoKClp+ow8nR0dHR0dF6eXx7fH5/foGAgICAgoKCfH6BfX+Dg4GDg4KCg4KCf5OgqsDJ0tHS0dHRfX95enx6fHx7fHp8f4J9fHl5fXyAgIKBg4GBg4KCgn+Uoqi/y9PT0dHR0X6CfH1/f3+AhJumn6SjlI6CeHh5e3x8fX9/gYGCgYKAlKCowsrT1NLT0tN9gH19gY6ettDk7Onn28e5qpyGd3d2eHl5ent7fX1+fJCiqL/P09TT0tPSfoJ+gZe22PH19/f28/Ly3sK1r5B5f3t3enl5d3d3eXaMoKK/ys7Q0dDR0nuBgaC+1e/19PTw7erp7fHoybm2l3+AgX59fXp6ent3jZqcucPGx87Ly8t8g5221O/y7N3Kt7G1vc/a7OnEubSKgX6AgYCAf359eZGhnrbGx8nGxcXEe4+ww+vw28SoiYGEipazusbi3L65rIiDgICAgYGAf3mSpKO+z8/PzczJyYSltNvw3Limg4CCgIB9j7O8veTSub2ZfIGCgYCAgH15kqalv9HT0tbS0NGRtrrn4rqxkH+AgIJ/gHyPtbXN4Ly5p32BgYF/gIKAd5Koqb/R1NTS1NLTorjJ6Ma4pH6BgYCAf4B9dqa2uuTAt6+Af39/gH+BfnmTpqTC0dPU1NXT06mzz+S/uJ19gYCBgYB/e3qZuLXdzbeyint+fn5+gHx5kqSjwtPT09HT09Optc/fu7iYfX6Bf31/f3t5jrmz2NG2sIh9gH5+fH55dpGlpMbS09HV0tjQqLXO4by3n3t/f3x/f316eJK5uuLPt6+Fe4CAf3+AenaQoqTH1tbT09LV0qK1xOXBt6Z9fX18fn1+eHebtsDqxbeseYGBfH6BgHl2kKOjxNfY2NTT09SStLbZ1LSzlX2AfXx9eXd8qbHT5r27nnyAfn9/f4F6eJGjpMDR19XZ1NPWgrOxyuS3uK2He358fXp5oLDG7Ne6uox8fX6BgH+AfnmRoqTBz9XU2NnU0nibt7Xc5MGyqot8eHd5nLvQ6+jAtZd9fnx9fX1/fnp5j6GnwdDXz9PW2Nd2gaq2wuni08O0pp+quNLf7e/StbWHfnt5eXt8f3t5eo+gp8DR1dPU0tfbenuRsrfE4uvn4+Hk6+7w8O7v2MPBpJyTfnN1d3d1dnmPoqTA1NLS09PS1Xl9fImrucPY6e7w7+/v6+rc5NLE3dWwrZ19cXNzcnNziaCkvM7Q0dDP1NV4fn58hpqps8bZ5Ojn4NG4nKO6stbt0bSxnn93dXZ1cIWanLfIysrOz8/OeH18fn59g5GXpaqjo56GgHmGtbDL7OvWurOfgXh5eXWFnJy3yszKyMTJyXl+fHx9fH56fX+Bf3p2enh2gJ6ztdPr7NS3saOEdnx3iaKmvs7Rz9jMysp3fH5+fH59fX16fXx6d3l1eXx+orO30uvq2bq0pH96doqjp7/O19XV2tnKd3t9fXt9fnt7enp9eHV3dnV7eoCdtLfU6ezaua2hh3aHpaPD0NTU0tXX3Hh6e3t7e3t5fHt5eXZ1eHV4fHh6gJ6wttLp69u4rqaCiKWlwNHU09TW0dd6enl7e3t6enl9e3p1dHh3d3x7eXp/mq21zOPr1KuxmIKkpL3R1dPT1dLRe3h4eHh6eXp7eXt8d3d1c3l7e3t5d3qWr7LC592ss5mBpKS+0dPS1NLT1Hl7enl5eHp6e3t5eXZ6dnN3eXl6eXl6e5eus8nGqaiEg6OkvdLY097O3dd4ent5eXh3fnt7enZ0eXVzeHh4eXl5eXp8kJiTh4Z/dIempbzR0dbU0tXYc3V2dXZ5dnd6enp2dHh1dXp5d3d3d3h6enl7eXV2dG+Fo6W/09DY1dLW025vcHByc3J2enh3dHR5cnZ8enh2dnd5ent5eHR1enNxhqOlu9HW09XU1dRxcHBvcHBxcXNycm9yenR1fHh4end4eHl5eXZyc3l1cIikpbnU09PV09PTdXR0dHR0cnJ0c3BwcXFxcXJ0dHV2d3d2dXZ3c3N5cnGJp6K60dXU1NPU1HZ2dnZ3eHd4dnyBgYSHhYaHiYiEfH13dHV0c29ucnFwh6SjvNLV0trT09V1dnZ3eHl4eXuftrzJycnLzMzMvJOGg3JwcHBwbW9vbYCcn7jU19fX0tTVdXZ3d3d4eHh9sLa9zcrLzc3Nzc6iiIh1c3NxcnJwb2t8lpiwyNDS0tPP0g=="),
        };
    }
    // END GENERATED ghost panel reference
}
