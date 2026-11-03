package com.mk8dx.mobileocr;

import org.json.JSONArray;
import org.json.JSONObject;

import nl.mariokart8.iconmatcher.CardRoi;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

public class AutoCardRoiSelector {
    private static final double LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX = 40.0;
    private static final double LARGE_LAP_INDEX_WIDTH_SCALE = 1.012;
    private static final double SMALL_LAP_INDEX_WIDTH_SCALE = 1.014;
    private static final double OWNER_CONSTRAINT_X_MARGIN_RATIO = 0.12;
    private static final double OWNER_CONSTRAINT_TOP_MARGIN_RATIO = 0.04;
    private static final double OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO = 0.12;

    // Ghost-detail layout (Select-a-Ghost detailpaneel, één rijder): de ROI
    // wordt geprojecteerd vanuit de badge-CENTRA en de rij-pitch (rowGap).
    // Bewust centrums- i.p.v. randgebaseerd: detectieboxranden blazen op bij
    // wazige input (+-3,5% gemeten op een geüpscaled referentiebeeld), centra
    // niet. Dezelfde projectie definieert de canonieke targetbox in de
    // pipeline (stage 18) — de twee moeten samen wijzigen.
    // 3-laps: [cx-1g, c1-1g, cx+5g, c3+1g]; 7-laps: [cx-1g, c1-1g, cx+6g, c7+1g],
    // waarbij c1..cN het GECOMPLETEERDE rooster is: de onderste 7-laps-badge
    // haalt de detectiedrempel vaak niet, dus het rooster wordt uit rij-pitch
    // en span afgeleid; bij ontbrekende randbadges levert de route een tweede
    // ROI-hypothese (altRoi) die de pipeline als reserve-seed probeert.
    // Zie docs/scanner-layouts.md.
    static final double GHOST_DETAIL_LEFT_ROWGAP = -1.0;
    static final double GHOST_DETAIL_TOP_ROWGAP = -1.0;
    static final double GHOST_DETAIL_RIGHT_ROWGAP_RACE3 = 5.0;
    static final double GHOST_DETAIL_RIGHT_ROWGAP_RACE7 = 6.0;
    static final double GHOST_DETAIL_BOTTOM_ROWGAP = 1.0;

    // MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 5): the selection is the central
    // CardRoi (packages/icon-matcher, the same specification as the Web scanner and Python; it is this
    // class's former logic made product-neutral). This class keeps the engine's types and diagnostics.
    public Selection select(List<RfDetrDetector.Detection> detections, int width, int height) {
        return select(detections, width, height, (Box) null);
    }

    public Selection select(List<RfDetrDetector.Detection> detections, int width, int height, Box yellowReference) {
        List<Box> yellowReferences = new ArrayList<>();
        if (yellowReference != null) {
            yellowReferences.add(yellowReference);
        }
        return select(detections, width, height, yellowReferences);
    }

    public Selection select(List<RfDetrDetector.Detection> detections, int width, int height, List<Box> yellowReferences) {
        List<CardRoi.Box> refs = new ArrayList<>();
        if (yellowReferences != null) {
            for (Box ref : yellowReferences) {
                refs.add(new CardRoi.Box(ref.left, ref.top, ref.right, ref.bottom));
            }
        }
        return selection(CardRoi.select(central(detections), width, height, refs));
    }

    public Selection selectGhostDetail(List<RfDetrDetector.Detection> detections, int width, int height) {
        return selection(CardRoi.selectGhostDetail(central(detections), width, height));
    }

    /** The selection reason when the badge column stood in for the ghost box (ADR-0203). */
    public static final String GHOST_DETAIL_BADGE_COLUMN_ONLY = CardRoi.GHOST_DETAIL_BADGE_COLUMN_ONLY;

    private static List<CardRoi.Detection> central(List<RfDetrDetector.Detection> detections) {
        List<CardRoi.Detection> out = new ArrayList<>();
        for (RfDetrDetector.Detection d : detections) {
            out.add(new CardRoi.Detection(d.label, d.score, d.left, d.top, d.right, d.bottom));
        }
        return out;
    }

    private static Box box(CardRoi.Box b) {
        return b == null ? null : new Box(b.left, b.top, b.right, b.bottom);
    }

    private static Selection selection(CardRoi.Selection central) {
        DetectionCounts counts = new DetectionCounts();
        counts.candidateCount = central.counts.candidateCount;
        counts.playerCount = central.counts.playerCount;
        counts.ghostCount = central.counts.ghostCount;
        counts.lapIndexCount = central.counts.lapIndexCount;
        Selection out = central.candidate == null
                ? Selection.blocked(central.status, central.reason, counts)
                : Selection.selected(candidate(central.candidate), central.selectedReason, central.fallbackUsed, counts);
        out.playerOwnerBox = box(central.playerOwnerBox);
        out.ghostOwnerBox = box(central.ghostOwnerBox);
        return out;
    }

    private static Candidate candidate(CardRoi.Candidate c) {
        Candidate out = new Candidate(box(c.roi), c.reason);
        out.selectedRoute = c.selectedRoute;
        out.score = c.score;
        out.rfdetrScore = c.rfdetrScore;
        out.lapIndexCount = c.lapIndexCount;
        out.playerLapIndexCount = c.playerLapIndexCount;
        out.ghostLapIndexCount = c.ghostLapIndexCount;
        out.lapIndexWidth = c.lapIndexWidth;
        out.lapIndexHeight = c.lapIndexHeight;
        out.rowGap = c.rowGap;
        out.projectedRowCount = c.projectedRowCount;
        out.sourceBox = box(c.sourceBox);
        out.altRoi = box(c.altRoi);
        out.yellowReference = box(c.yellowReference);
        out.yellowPanelBand = box(c.yellowPanelBand);
        out.ownerConstraintBox = box(c.ownerConstraintBox);
        out.roiBeforeOwnerConstraint = box(c.roiBeforeOwnerConstraint);
        out.roiBeforeDualOwnerGroupConstraint = box(c.roiBeforeDualOwnerGroupConstraint);
        out.otherLapGroupSourceBox = box(c.otherLapGroupSourceBox);
        out.yellowSupportScore = c.yellowSupportScore;
        out.yellowPanelBandOverlap = c.yellowPanelBandOverlap;
        out.yellowLegacyLeftScore = c.yellowLegacyLeftScore;
        out.yellowSupportPass = c.yellowSupportPass;
        out.yellowSupportReason = c.yellowSupportReason;
        out.ownerConstraintApplied = c.ownerConstraintApplied;
        out.ownerConstraintReason = c.ownerConstraintReason;
        out.dualOwnerGroupConstraintApplied = c.dualOwnerGroupConstraintApplied;
        out.dualOwnerGroupConstraintReason = c.dualOwnerGroupConstraintReason;
        out.dualOwnerGroupSeparatorY = c.dualOwnerGroupSeparatorY;
        return out;
    }

    /** Rauwe step-01-detecties + framemaat meegeven: de pipeline transformeert ze
     *  naar canonieke coördinaten zodat node 19 geen tweede inferentie hoeft. */
    // MK8DX ecosystem overlay (ADR-0203): the lap-index badge clean-up is the central specification
    // (packages/icon-matcher Detections, the same rules as the Web scanner and Python;
    // CENTRAL_RECOGNITION section 8.6, phase 5): on an end screen with exactly seven lap badges one
    // weak extra badge is dropped (a near-duplicate, an off-column badge, or one off two regular
    // three-lap lattices), each only when its pattern is unambiguous.
    static List<RfDetrDetector.Detection> withoutWeakLapIndexExtras(List<RfDetrDetector.Detection> detections) {
        List<nl.mariokart8.iconmatcher.Detections.Box> boxes = new ArrayList<>();
        for (RfDetrDetector.Detection d : detections) {
            boxes.add(new nl.mariokart8.iconmatcher.Detections.Box(d.label, d.score, d.left, d.top, d.right, d.bottom));
        }
        List<nl.mariokart8.iconmatcher.Detections.Box> kept = nl.mariokart8.iconmatcher.Detections.cleanLapIndex(boxes);
        if (kept.size() == boxes.size()) return detections;
        List<RfDetrDetector.Detection> out = new ArrayList<>();
        for (int i = 0; i < boxes.size(); i++) {
            if (kept.contains(boxes.get(i))) out.add(detections.get(i));
        }
        return out;
    }

    static Selection withDetections(Selection selection, java.util.List<RfDetrDetector.Detection> detections, int width, int height) {
        selection.detections = detections;
        selection.frameWidth = width;
        selection.frameHeight = height;
        return selection;
    }

    public static class Selection {
        public final Box roi;
        public final String status;
        public final String reason;
        public final String selectedReason;
        public final boolean fallbackUsed;
        public final DetectionCounts counts;
        public final Candidate candidate;
        public Box playerOwnerBox;
        public Box ghostOwnerBox;
        public java.util.List<RfDetrDetector.Detection> detections;
        public int frameWidth;
        public int frameHeight;
        /** Found only by an extra look (OfflineParityPackagedRunner); its detections then carry on to step 19. */
        public boolean extraLook;

        private Selection(Candidate candidate, String status, String reason, String selectedReason, boolean fallbackUsed, DetectionCounts counts) {
            this.roi = candidate == null ? null : candidate.roi;
            this.status = status;
            this.reason = reason;
            this.selectedReason = selectedReason;
            this.fallbackUsed = fallbackUsed;
            this.counts = counts;
            this.candidate = candidate;
        }

        static Selection selected(Candidate candidate, boolean fallbackUsed, DetectionCounts counts) {
            return new Selection(candidate, "implemented", "", candidate.reason, fallbackUsed, counts);
        }

        static Selection selected(Candidate candidate, String selectedReason, boolean fallbackUsed, DetectionCounts counts) {
            return new Selection(candidate, "implemented", "", selectedReason, fallbackUsed, counts);
        }

        static Selection blocked(String status, String reason, DetectionCounts counts) {
            return new Selection(null, status, reason, "", false, counts);
        }

        public boolean hasRoi() {
            return roi != null;
        }
    }

    public static class DetectionCounts {
        public int candidateCount;
        public int playerCount;
        public int ghostCount;
        public int lapIndexCount;
    }

    public static class Candidate {
        public final Box roi;
        public final String reason;
        public String selectedRoute = "";
        public double score;
        public double rfdetrScore;
        public int lapIndexCount;
        public int playerLapIndexCount;
        public int ghostLapIndexCount;
        public double lapIndexWidth;
        public double lapIndexHeight;
        public double rowGap;
        public double projectedRowCount;
        public Box sourceBox;
        /** ghost_detail: reserve-ROI-hypothese (ontbrekende randbadges bovenaan). */
        public Box altRoi;
        public Box yellowReference;
        public Box yellowPanelBand;
        public Box ownerConstraintBox;
        public Box roiBeforeOwnerConstraint;
        public Box roiBeforeDualOwnerGroupConstraint;
        public Box otherLapGroupSourceBox;
        public double yellowSupportScore;
        public double yellowPanelBandOverlap;
        public double yellowLegacyLeftScore;
        public boolean yellowSupportPass;
        public String yellowSupportReason = "";
        public boolean ownerConstraintApplied;
        public String ownerConstraintReason = "";
        public boolean dualOwnerGroupConstraintApplied;
        public String dualOwnerGroupConstraintReason = "";
        public double dualOwnerGroupSeparatorY;

        Candidate(Box roi, String reason) {
            this.roi = roi;
            this.reason = reason;
        }

        static Candidate fromBox(Box roi, String reason) {
            return new Candidate(roi, reason);
        }

        public JSONObject toJson() throws Exception {
            JSONObject root = new JSONObject();
            root.put("reason", reason);
            root.put("selected_route", selectedRoute);
            root.put("score", score);
            root.put("rfdetr_score", rfdetrScore);
            root.put("lap_index_count", lapIndexCount);
            root.put("player_lap_index_count", playerLapIndexCount);
            root.put("ghost_lap_index_count", ghostLapIndexCount);
            root.put("lap_index_width", lapIndexWidth);
            root.put("lap_index_height", lapIndexHeight);
            root.put("row_gap", rowGap);
            root.put("projected_row_count", projectedRowCount);
            root.put("owner_constraint_applied", ownerConstraintApplied);
            root.put("owner_constraint_reason", ownerConstraintReason);
            root.put("dual_owner_group_constraint_applied", dualOwnerGroupConstraintApplied);
            root.put("dual_owner_group_constraint_reason", dualOwnerGroupConstraintReason);
            if (dualOwnerGroupConstraintApplied) {
                root.put("dual_owner_group_separator_y", dualOwnerGroupSeparatorY);
            }
            root.put("yellow_support_score", yellowSupportScore);
            root.put("yellow_support_pass", yellowSupportPass);
            root.put("yellow_support_reason", yellowSupportReason);
            root.put("yellow_panel_band_overlap", yellowPanelBandOverlap);
            root.put("yellow_legacy_left_score", yellowLegacyLeftScore);
            root.put("box_xyxy", roi.toJson());
            root.put("box", new JSONArray().put(roi.left).put(roi.top).put(roi.width()).put(roi.height()));
            if (sourceBox != null) {
                root.put("source_box_xyxy", sourceBox.toJson());
            }
            if (roiBeforeOwnerConstraint != null) {
                root.put("roi_before_owner_constraint_xyxy", roiBeforeOwnerConstraint.toJson());
            }
            if (ownerConstraintBox != null) {
                root.put("owner_constraint_box_xyxy", ownerConstraintBox.toJson());
            }
            if (roiBeforeDualOwnerGroupConstraint != null) {
                root.put("roi_before_dual_owner_group_constraint_xyxy", roiBeforeDualOwnerGroupConstraint.toJson());
            }
            if (otherLapGroupSourceBox != null) {
                root.put("other_lap_group_source_box_xyxy", otherLapGroupSourceBox.toJson());
            }
            if (yellowReference != null) {
                root.put("yellow_reference_box_xyxy", yellowReference.toJson());
            }
            if (yellowPanelBand != null) {
                root.put("yellow_panel_band_xyxy", yellowPanelBand.toJson());
            }
            return root;
        }
    }

    public static class Box {
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;

        Box(float left, float top, float right, float bottom) {
            this.left = Math.min(left, right);
            this.top = Math.min(top, bottom);
            this.right = Math.max(left, right);
            this.bottom = Math.max(top, bottom);
        }

        public float width() {
            return Math.max(1.0f, right - left);
        }

        public float height() {
            return Math.max(1.0f, bottom - top);
        }

        float centerX() {
            return (left + right) * 0.5f;
        }

        float centerY() {
            return (top + bottom) * 0.5f;
        }

        boolean containsCenter(Box box) {
            float cx = box.centerX();
            float cy = box.centerY();
            return cx >= left && cx <= right && cy >= top && cy <= bottom;
        }

        Box expanded(float dx, float dy) {
            return new Box(left - dx, top - dy, right + dx, bottom + dy);
        }

        Box clipped(int width, int height) {
            return new Box(
                    Math.max(0.0f, Math.min(width - 1.0f, left)),
                    Math.max(0.0f, Math.min(height - 1.0f, top)),
                    Math.max(1.0f, Math.min(width, right)),
                    Math.max(1.0f, Math.min(height, bottom))
            );
        }

        Box quantizedYellowReference(int width, int height) {
            return roundedClamp(width, height);
        }

        Box roundedClamp(int width, int height) {
            float qLeft = Math.max(0.0f, Math.min(width - 2.0f, Math.round(left)));
            float qTop = Math.max(0.0f, Math.min(height - 2.0f, (float) Math.ceil(top)));
            float qRight = Math.max(qLeft + 1.0f, Math.min(width, Math.round(right)));
            float qBottom = Math.max(qTop + 1.0f, Math.min(height, Math.round(bottom)));
            return new Box(qLeft, qTop, qRight, qBottom);
        }

        public JSONArray toJson() throws Exception {
            return new JSONArray().put(left).put(top).put(right).put(bottom);
        }

        public JSONObject toObjectJson() throws Exception {
            JSONObject root = new JSONObject();
            root.put("left", left);
            root.put("top", top);
            root.put("right", right);
            root.put("bottom", bottom);
            root.put("width", width());
            root.put("height", height());
            return root;
        }
    }
}
