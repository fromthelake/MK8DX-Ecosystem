package nl.mariokart8.iconmatcher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/**
 * The central card ROI selection (CENTRAL_RECOGNITION section 8.6, phase 5): the Java port of
 * python/mk8dx_icon_matcher/card_roi.py (the reference) and ts/sharedCardRoi.ts, kept equal by the
 * parity vectors (tooling/recognition/card_roi_vectors.py, vectors/card-roi-v1.json). It is the
 * APK's AutoCardRoiSelector (the original the Web scanner's port came from), made product-neutral:
 * the card ROI from the RF-DETR detections and the image-derived yellow reference boxes, and the
 * Select-a-Ghost panel from its badge column and row pitch.
 * Box values are floats, as in the APK; where the APK original and the Web port rounded differently,
 * this port follows the reference (float32 rounding at the same places as card_roi.py).
 */
public final class CardRoi {
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

    /** A detection, normalised 0..1 to the frame (the detector's float values). */
    public static final class Detection {
        public final String label;
        public final float score;
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;

        public Detection(String label, float score, float left, float top, float right, float bottom) {
            this.label = label;
            this.score = score;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    private CardRoi() {
    }

    public static Selection select(List<Detection> detections, int width, int height) {
        return select(detections, width, height, (Box) null);
    }

    public static Selection select(List<Detection> detections, int width, int height, Box yellowReference) {
        List<Box> yellowReferences = new ArrayList<>();
        if (yellowReference != null) {
            yellowReferences.add(yellowReference);
        }
        return select(detections, width, height, yellowReferences);
    }

    public static Selection select(List<Detection> detections, int width, int height, List<Box> yellowReferences) {
        List<Box> yellowRefs = yellowReferences == null ? Collections.<Box>emptyList() : yellowReferences;
        DetectionCounts counts = countDetections(detections);
        List<Box> lapBoxes = lapIndexBoxes(detections, width, height);
        Detection player = bestDetection(detections, "player_timetrail_box");
        Detection ghost = bestDetection(detections, "ghost_timetrail_box");
        Box ghostBox = ghost == null ? null : detectionBoxPixels(ghost, width, height);
        Box playerOwnerBox = player == null ? null : detectionBoxPixels(player, width, height);
        if (player != null) {
            Box playerBox = playerOwnerBox;
            List<Box> playerLapBoxes = lapIndexesInside(lapBoxes, playerBox);
            Candidate playerCandidate = projectedRoiFromLapGroup(
                    playerLapBoxes,
                    width,
                    height,
                    "lap_index_projected_player_ref",
                    player.score,
                    playerBox
            );
            if (playerCandidate != null && playerCandidate.lapIndexCount >= 3) {
                playerCandidate.selectedRoute = ghost == null ? "player_box_supported" : "player_and_ghost_supported";
                playerCandidate.playerLapIndexCount = playerCandidate.lapIndexCount;
                playerCandidate.ghostLapIndexCount = ghostBox == null ? 0 : countLapIndexesInside(lapBoxes, ghostBox);
                playerCandidate.yellowSupportPass = true;
                playerCandidate.yellowSupportReason = "owner_box_route_does_not_require_yellow_fallback";
                return withOwnerBoxes(Selection.selected(playerCandidate, false, counts), playerOwnerBox, ghostBox);
            }
        }
        if (player == null && ghostBox != null && counts.lapIndexCount > 5) {
            List<Box> ghostGroup = lapIndexesInside(lapBoxes, ghostBox);
            List<Box> playerGroup = lapIndexesOutside(lapBoxes, ghostBox);
            if (ghostGroup.size() >= 2 && playerGroup.size() >= 2) {
                YellowSupport support = evaluateYellowSupport(playerGroup, yellowRefs, width, height);
                if (support.pass) {
                    Candidate candidate = projectedRoiFromLapGroup(
                            playerGroup,
                            width,
                            height,
                            "lap_index_projected_ghost_split_yellow_ref",
                            0.0f
                    );
                    if (candidate != null) {
                        candidate.selectedRoute = "ghost_box_lap_split";
                        candidate.playerLapIndexCount = playerGroup.size();
                        candidate.ghostLapIndexCount = ghostGroup.size();
                        candidate.yellowSupportScore = support.score;
                        candidate.yellowSupportPass = true;
                        candidate.yellowSupportReason = support.reason;
                        candidate.yellowReference = support.reference;
                        return withOwnerBoxes(Selection.selected(candidate, false, counts), playerOwnerBox, ghostBox);
                    }
                }
            }
        }
        if (player == null && ghost == null && (counts.lapIndexCount == 3 || counts.lapIndexCount == 7)) {
            YellowSupport support = evaluateYellowSupport(lapBoxes, yellowRefs, width, height);
            if (support.pass) {
                Candidate candidate = projectedRoiFromLapGroup(
                        lapBoxes,
                        width,
                        height,
                        "lap_index_projected_single_owner_yellow_ref",
                        0.0f
                );
                if (candidate != null) {
                    candidate.selectedRoute = "lap_index_single_owner_yellow";
                    candidate.playerLapIndexCount = candidate.lapIndexCount;
                    candidate.ghostLapIndexCount = 0;
                    candidate.yellowSupportScore = support.score;
                    candidate.yellowSupportPass = true;
                    candidate.yellowSupportReason = support.reason;
                    candidate.yellowReference = support.reference;
                    return withOwnerBoxes(Selection.selected(candidate, false, counts), playerOwnerBox, ghostBox);
                }
            }
        }
        if (player == null && ghost == null && (counts.lapIndexCount == 6 || counts.lapIndexCount == 14)) {
            List<List<Box>> groups = ownerGroupsFromLapIndexes(lapBoxes);
            Candidate best = null;
            YellowSupport bestSupport = YellowSupport.fail("no_lap_index_group_with_yellow_support");
            int bestIndex = -1;
            for (int i = 0; i < groups.size(); i++) {
                List<Box> group = groups.get(i);
                if (group.size() < 2) {
                    continue;
                }
                YellowSupport support = evaluateYellowSupport(group, yellowRefs, width, height);
                if (!support.pass || support.score <= bestSupport.score) {
                    continue;
                }
                Candidate candidate = projectedRoiFromLapGroup(
                        group,
                        width,
                        height,
                        "lap_index_projected_yellow_ref",
                        0.0f
                );
                if (candidate == null) {
                    continue;
                }
                candidate = constrainProjectedRoiAwayFromOtherLapGroups(candidate, group, groups, i, width, height);
                best = candidate;
                bestSupport = support;
                bestIndex = i;
            }
            if (best != null) {
                best.selectedRoute = "lap_index_dual_owner_yellow";
                best.playerLapIndexCount = best.lapIndexCount;
                best.ghostLapIndexCount = 0;
                for (int i = 0; i < groups.size(); i++) {
                    if (i != bestIndex) {
                        best.ghostLapIndexCount += groups.get(i).size();
                    }
                }
                best.yellowSupportScore = bestSupport.score;
                best.yellowSupportPass = true;
                best.yellowSupportReason = bestSupport.reason;
                best.yellowReference = bestSupport.reference;
                best.yellowPanelBand = bestSupport.panelBand;
                best.yellowPanelBandOverlap = bestSupport.panelBandOverlap;
                best.yellowLegacyLeftScore = bestSupport.legacyLeftScore;
                return withOwnerBoxes(Selection.selected(best, false, counts), playerOwnerBox, ghostBox);
            }
        }

        return withOwnerBoxes(Selection.blocked(
                "blocked_missing_supported_owner_lap_index_route",
                "Step 01 did not find a general supported route from owner boxes, lap-index grouping, and image-derived yellow panel evidence.",
                counts
        ), playerOwnerBox, ghostBox);
    }

    /**
     * Opt-in recovery when the detector sees two separated badge rows but no player box (the Web
     * scanner's sparse dual candidate); both the badge columns and the yellow panel are game pixels.
     */
    public static Selection selectSparseDualYellowCandidate(List<Detection> detections, int width, int height, List<Box> yellowReferences) {
        boolean ghostSeen = false;
        for (Detection d : detections) {
            if ("player_timetrail_box".equals(d.label)) return null;
            if ("ghost_timetrail_box".equals(d.label)) ghostSeen = true;
        }
        List<Box> lapBoxes = new ArrayList<>(lapIndexBoxes(detections, width, height));
        Collections.sort(lapBoxes, (a, b) -> Float.compare(a.centerY(), b.centerY()));
        if (lapBoxes.size() < 4 || lapBoxes.size() > 9) return null;
        if (lapBoxes.size() > 7 && ghostSeen) return null;
        List<Double> gaps = new ArrayList<>();
        for (int i = 0; i + 1 < lapBoxes.size(); i++) gaps.add((double) lapBoxes.get(i + 1).centerY() - lapBoxes.get(i).centerY());
        double largest = -Double.MAX_VALUE;
        int split = 0;
        for (int i = 0; i < gaps.size(); i++) {
            if (gaps.get(i) > largest) {
                largest = gaps.get(i);
                split = i + 1;
            }
        }
        List<Double> otherGaps = new ArrayList<>();
        for (int i = 0; i < gaps.size(); i++) if (i != split - 1) otherGaps.add(gaps.get(i));
        if ((split < 3 && lapBoxes.size() <= 7) || largest < median(otherGaps) * 2.2 || largest < height * 0.05) return null;
        List<List<Box>> groups = new ArrayList<>();
        groups.add(new ArrayList<>(lapBoxes.subList(0, split)));
        groups.add(new ArrayList<>(lapBoxes.subList(split, lapBoxes.size())));
        if (lapBoxes.size() > 7) {
            boolean sevenPlusFew = false;
            for (int i = 0; i < 2; i++) {
                int other = groups.get(1 - i).size();
                if (groups.get(i).size() == 7 && other >= 1 && other <= 2) sevenPlusFew = true;
            }
            if (!sevenPlusFew) return null;
        }
        List<Box> panelRefs = new ArrayList<>();
        for (Box ref : yellowReferences) {
            double aspect = (double) ref.width() / ref.height();
            if (aspect >= 2.2 && aspect <= 4.5) panelRefs.add(ref);
        }
        Candidate best = null;
        double bestScore = 0.0;
        for (int i = 0; i < groups.size(); i++) {
            List<Box> group = groups.get(i);
            if (group.size() < 3 || !isStraightBadgeColumn(group)) continue;
            double minGap = Double.MAX_VALUE;
            double maxGap = -Double.MAX_VALUE;
            List<Double> heights = new ArrayList<>();
            for (int j = 0; j < group.size(); j++) {
                heights.add((double) group.get(j).height());
                if (j + 1 < group.size()) {
                    double gap = (double) group.get(j + 1).centerY() - group.get(j).centerY();
                    minGap = Math.min(minGap, gap);
                    maxGap = Math.max(maxGap, gap);
                }
            }
            if (minGap < median(heights) * 0.55 || maxGap > minGap * 1.4) continue;
            YellowSupport support = evaluateYellowSupport(group, panelRefs, width, height);
            if (!support.pass || support.panelBandOverlap < 0.25) continue;
            Candidate candidate = projectedRoiFromLapGroup(group, width, height, "lap_index_sparse_dual_yellow_candidate", 0.0f);
            if (candidate == null) continue;
            candidate = constrainProjectedRoiAwayFromOtherLapGroups(candidate, group, groups, i, width, height);
            if (lapBoxes.size() > 7 && support.reference != null) {
                Box ref = support.reference;
                double margin = ref.height() * 0.03;
                candidate = copyCandidateWithRoi(candidate, new Box(
                        (float) Math.min(candidate.roi.left, ref.left - margin),
                        (float) Math.min(candidate.roi.top, ref.top - margin),
                        (float) Math.max(candidate.roi.right, ref.right + margin),
                        (float) Math.max(candidate.roi.bottom, ref.bottom + margin)).clipped(width, height));
            }
            candidate.selectedRoute = "lap_index_sparse_dual_yellow_candidate";
            candidate.playerLapIndexCount = group.size();
            candidate.ghostLapIndexCount = groups.get(1 - i).size();
            candidate.yellowSupportPass = true;
            candidate.yellowSupportReason = support.reason;
            candidate.yellowSupportScore = support.score;
            candidate.yellowReference = support.reference;
            candidate.yellowPanelBand = support.panelBand;
            candidate.yellowPanelBandOverlap = support.panelBandOverlap;
            if (best == null || support.score > bestScore) {
                best = candidate;
                bestScore = support.score;
            }
        }
        return best == null ? null : Selection.selected(best, false, countDetections(detections));
    }

    /**
     * Ghost-detail route (Select-a-Ghost detailpaneel): één rijder, geen gele
     * kaart, geen player-box. Vereist een ghost_timetrail_box (schermbewijs)
     * plus >=3 lap-badges; de ROI is de paneelprojectie vanuit de badge-groep.
     */
    public static Selection selectGhostDetail(List<Detection> detections, int width, int height) {
        DetectionCounts counts = countDetections(detections);
        List<Box> rawLapBoxes = lapIndexBoxes(detections, width, height);
        Detection ghost = bestDetection(detections, "ghost_timetrail_box");
        Box ghostBox = ghost == null ? null : detectionBoxPixels(ghost, width, height);
        // badge-kolomfilter: valse lap_index-detecties (bv. op de X/Y-knoppen
        // in de paneelkop, scores net boven de drempel) zitten ver rechts van
        // de badge-kolom; houd alleen boxen binnen 1.5 badge-breedte van de
        // mediane kolom-x
        List<Box> lapBoxes = rawLapBoxes;
        if (rawLapBoxes.size() >= 3) {
            List<Double> allCx = new ArrayList<>();
            List<Double> allW = new ArrayList<>();
            for (Box box : rawLapBoxes) {
                allCx.add((double) box.centerX());
                allW.add((double) box.width());
            }
            double medCx = median(allCx);
            double medW = median(allW);
            List<Box> column = new ArrayList<>();
            for (Box box : rawLapBoxes) {
                if (Math.abs(box.centerX() - medCx) < 1.5 * medW) {
                    column.add(box);
                }
            }
            lapBoxes = column;
        }
        // MK8DX ecosystem overlay (ADR-0203): the detector sometimes reports one
        // badge twice at the same spot (0.93 and 0.4 on a phone photo), which
        // made eight "badges" and blocked a 7-lap panel as ambiguous. Badges whose
        // centres lie within 0.4 badge height of each other are one badge.
        lapBoxes = withoutDuplicateBadges(lapBoxes);
        // MK8DX ecosystem overlay (ADR-0203): the model's ghost_timetrail_box is
        // the ghost's card on the END screen; on the Select-a-Ghost panel it fires
        // only by chance (0.4-0.6 on phone photos, often not at all), while the
        // badge column the ROI is projected from is found reliably. A clean,
        // straight badge column therefore stands in for the missing box - but
        // only when no player card is seen either, because an end screen scanned
        // in this layout always shows one and must still block and fall back.
        boolean badgeColumnOnly = ghost == null
                && bestDetection(detections, "player_timetrail_box") == null
                && lapBoxes.size() >= 3
                && isStraightBadgeColumn(lapBoxes);
        if ((ghost == null && !badgeColumnOnly) || lapBoxes.size() < 3) {
            return withOwnerBoxes(Selection.blocked(
                    "blocked_missing_ghost_detail_support",
                    "Ghost-detail layout requires a ghost_timetrail_box detection plus at least three lap-index detections.",
                    counts
            ), null, ghostBox);
        }
        List<Double> widths = new ArrayList<>();
        List<Double> heights = new ArrayList<>();
        List<Double> centersX = new ArrayList<>();
        List<Double> centersY = new ArrayList<>();
        for (Box box : lapBoxes) {
            widths.add((double) box.width());
            heights.add((double) box.height());
            centersX.add((double) box.centerX());
            centersY.add((double) box.centerY());
        }
        Collections.sort(centersY);
        List<Double> gaps = new ArrayList<>();
        for (int i = 0; i < centersY.size() - 1; i++) {
            gaps.add(centersY.get(i + 1) - centersY.get(i));
        }
        double rowGap = median(gaps);
        double cx = median(centersX);
        if (rowGap < 4.0) {
            return withOwnerBoxes(Selection.blocked(
                    "blocked_degenerate_ghost_detail_lap_geometry",
                    "Ghost-detail lap-index rows are too close together for a stable panel projection.",
                    counts
            ), null, ghostBox);
        }
        // rooster-completering: N = 3 of 7; ontbrekende randbadges (de onderste
        // 7-laps-badge haalt de drempel vaak niet) worden uit pitch+span afgeleid
        int n = lapBoxes.size();
        int lapCountProfile = n >= 5 ? 7 : 3;
        if (n == 4 || n > 7) {
            return withOwnerBoxes(Selection.blocked(
                    "blocked_ambiguous_ghost_detail_lap_count",
                    "Ghost-detail lap-index count " + n + " does not resolve to a 3-lap or 7-lap panel.",
                    counts
            ), null, ghostBox);
        }
        double span = centersY.get(centersY.size() - 1) - centersY.get(0);
        int spanRows = (int) Math.round(span / rowGap) + 1;
        int missingEdgeRows = lapCountProfile - spanRows;
        if (missingEdgeRows < 0) {
            return withOwnerBoxes(Selection.blocked(
                    "blocked_degenerate_ghost_detail_lap_geometry",
                    "Ghost-detail lap-index span exceeds the expected " + lapCountProfile + "-row lattice.",
                    counts
            ), null, ghostBox);
        }
        double rightRowGap = lapCountProfile == 7 ? GHOST_DETAIL_RIGHT_ROWGAP_RACE7 : GHOST_DETAIL_RIGHT_ROWGAP_RACE3;
        // hypothese A (primair): gedetecteerde span is boven-uitgelijnd (rij 1
        // aanwezig; in de praktijk faalt vrijwel altijd de ONDERSTE badge)
        Box roi = ghostDetailRoiForFirstRow(centersY.get(0), cx, rowGap, lapCountProfile, rightRowGap, width, height);
        // hypothese B (reserve-seed): de ontbrekende rijen zitten bovenaan
        Box altRoi = missingEdgeRows > 0
                ? ghostDetailRoiForFirstRow(centersY.get(0) - missingEdgeRows * rowGap, cx, rowGap, lapCountProfile, rightRowGap, width, height)
                : null;
        Candidate candidate = new Candidate(roi, badgeColumnOnly ? GHOST_DETAIL_BADGE_COLUMN_ONLY : "ghost_detail_lap_badge_projection");
        candidate.selectedRoute = "ghost_detail_panel";
        double ghostScore = ghost == null ? 0.0 : ghost.score;
        candidate.score = Math.min(2.0, n / 3.0) + ghostScore * 2.0;
        candidate.rfdetrScore = ghostScore;
        candidate.lapIndexCount = n;
        candidate.playerLapIndexCount = 0;
        candidate.ghostLapIndexCount = n;
        candidate.lapIndexWidth = median(widths);
        candidate.lapIndexHeight = median(heights);
        candidate.rowGap = rowGap;
        candidate.sourceBox = bounds(lapBoxes);
        candidate.altRoi = altRoi;
        candidate.yellowSupportPass = true;
        candidate.yellowSupportReason = "ghost_detail_route_does_not_use_yellow_support";
        return withOwnerBoxes(Selection.selected(candidate, false, counts), null, ghostBox);
    }

    /** One box per badge: boxes whose centres nearly coincide are the same badge (ADR-0203). */
    private static List<Box> withoutDuplicateBadges(List<Box> boxes) {
        if (boxes.size() < 2) {
            return boxes;
        }
        List<Double> heights = new ArrayList<>();
        for (Box box : boxes) {
            heights.add((double) box.height());
        }
        double limit = 0.4 * median(heights);
        List<Box> sorted = new ArrayList<>(boxes);
        Collections.sort(sorted, new java.util.Comparator<Box>() {
            @Override
            public int compare(Box a, Box b) {
                return Float.compare(a.centerY(), b.centerY());
            }
        });
        List<Box> kept = new ArrayList<>();
        for (Box box : sorted) {
            Box last = kept.isEmpty() ? null : kept.get(kept.size() - 1);
            if (last != null && Math.abs((double) box.centerY() - last.centerY()) < limit
                    && Math.abs((double) box.centerX() - last.centerX()) < limit) {
                continue;
            }
            kept.add(box);
        }
        return kept;
    }

    /** The selection reason when the badge column stood in for the ghost box (ADR-0203). */
    public static final String GHOST_DETAIL_BADGE_COLUMN_ONLY = "ghost_detail_lap_badge_column_only";

    /**
     * Whether the badge centres lie on one straight line x(y), within 0.2 badge
     * width RMS and within 8 degrees of vertical - the same test the deskew seed
     * uses before it trusts the column's angle.
     */
    private static boolean isStraightBadgeColumn(List<Box> boxes) {
        double meanX = 0.0;
        double meanY = 0.0;
        List<Double> widths = new ArrayList<>();
        for (Box box : boxes) {
            meanX += box.centerX();
            meanY += box.centerY();
            widths.add((double) box.width());
        }
        meanX /= boxes.size();
        meanY /= boxes.size();
        double sxy = 0.0;
        double syy = 0.0;
        for (Box box : boxes) {
            sxy += (box.centerY() - meanY) * (box.centerX() - meanX);
            syy += (box.centerY() - meanY) * (box.centerY() - meanY);
        }
        if (syy <= 0.0) {
            return false;
        }
        double k = sxy / syy;
        double residual = 0.0;
        for (Box box : boxes) {
            double off = box.centerX() - (meanX + k * (box.centerY() - meanY));
            residual += off * off;
        }
        return Math.sqrt(residual / boxes.size()) <= 0.2 * median(widths)
                && Math.abs(Math.atan(k) * 180.0 / Math.PI) <= 8.0;
    }

    private static Box ghostDetailRoiForFirstRow(double c1y, double cx, double rowGap, int lapCount, double rightRowGap, int width, int height) {
        double lastRowY = c1y + (lapCount - 1) * rowGap;
        return new Box(
                (float) (cx + GHOST_DETAIL_LEFT_ROWGAP * rowGap),
                (float) (c1y + GHOST_DETAIL_TOP_ROWGAP * rowGap),
                (float) (cx + rightRowGap * rowGap),
                (float) (lastRowY + GHOST_DETAIL_BOTTOM_ROWGAP * rowGap)
        ).clipped(width, height);
    }

    /**
     * Stempelt de rauwe RF-DETR owner-boxen op de Selection zodat de pipeline ze
     * als quad-seed kan gebruiken: de detectorbox IS de gele kaart, terwijl de
     * lap-index-geprojecteerde ROI de kaartrand kan afsnijden.
     */
    private static Selection withOwnerBoxes(Selection selection, Box playerOwnerBox, Box ghostOwnerBox) {
        selection.playerOwnerBox = playerOwnerBox;
        selection.ghostOwnerBox = ghostOwnerBox;
        return selection;
    }

    private static DetectionCounts countDetections(List<Detection> detections) {
        DetectionCounts counts = new DetectionCounts();
        counts.candidateCount = detections.size();
        for (Detection detection : detections) {
            if ("player_timetrail_box".equals(detection.label)) {
                counts.playerCount++;
            } else if ("ghost_timetrail_box".equals(detection.label)) {
                counts.ghostCount++;
            } else if ("lap_index".equals(detection.label)) {
                counts.lapIndexCount++;
            }
        }
        return counts;
    }

    private static Detection bestDetection(List<Detection> detections, String label) {
        Detection best = null;
        for (Detection detection : detections) {
            if (!label.equals(detection.label)) {
                continue;
            }
            if (best == null || detection.score > best.score) {
                best = detection;
            }
        }
        return best;
    }

    private static List<Box> lapIndexBoxes(List<Detection> detections, int width, int height) {
        List<Box> boxes = new ArrayList<>();
        for (Detection detection : detections) {
            if ("lap_index".equals(detection.label)) {
                Box box = detectionBoxPixels(detection, width, height);
                if (box.width() >= 2.0f && box.height() >= 2.0f) {
                    boxes.add(box);
                }
            }
        }
        return boxes;
    }


    private static Candidate projectedRoiFromLapGroup(
            List<Box> group,
            int width,
            int height,
            String reason,
            float referenceScore
    ) {
        return projectedRoiFromLapGroup(group, width, height, reason, referenceScore, null);
    }

    private static Candidate projectedRoiFromLapGroup(
            List<Box> group,
            int width,
            int height,
            String reason,
            float referenceScore,
            Box ownerConstraint
    ) {
        if (group.size() < 2) {
            return null;
        }
        List<Double> widths = new ArrayList<>();
        List<Double> heights = new ArrayList<>();
        List<Double> centersY = new ArrayList<>();
        List<Double> x1s = new ArrayList<>();
        List<Double> x2s = new ArrayList<>();
        float lapTop = Float.MAX_VALUE;
        float lapBottom = -Float.MAX_VALUE;
        for (Box box : group) {
            widths.add((double) box.width());
            heights.add((double) box.height());
            centersY.add((double) box.centerY());
            x1s.add((double) box.left);
            x2s.add((double) box.right);
            lapTop = Math.min(lapTop, box.top);
            lapBottom = Math.max(lapBottom, box.bottom);
        }
        Collections.sort(centersY);
        double lapW = median(widths);
        double lapH = median(heights);
        double rowGap = lapH * 1.28;
        if (centersY.size() >= 2) {
            List<Double> gaps = new ArrayList<>();
            for (int i = 0; i < centersY.size() - 1; i++) {
                gaps.add(centersY.get(i + 1) - centersY.get(i));
            }
            rowGap = median(gaps);
        }
        // The native ONNX detector reports lap-index boxes on a slightly
        // different width scale than the workflow-lab packet. Use the
        // image-derived median lap-index width to choose a small calibration
        // factor before projecting the card ROI; this does not depend on frame
        // identity, validation labels, or reference ROI boxes.
        double widthScale = lapW > LAP_INDEX_WIDTH_SCALE_BREAKPOINT_PX
                ? LARGE_LAP_INDEX_WIDTH_SCALE
                : SMALL_LAP_INDEX_WIDTH_SCALE;
        double effectiveLapW = lapW * widthScale;
        double effectiveLapH = lapH;
        double observedSpan = centersY.isEmpty() ? 0.0 : centersY.get(centersY.size() - 1) - centersY.get(0);
        double projectedRowCount = ownerConstraint == null ? 7.0 : Math.max(2.0, group.size());
        double missingSpan = Math.max(0.0, rowGap * (projectedRowCount - 1.0) - observedSpan);
        double medianX1 = median(x1s);
        double medianX2 = median(x2s);
        double sourceX1 = minFloat(group, "left");
        double sourceY1 = minFloat(group, "top");
        double sourceX2 = maxFloat(group, "right");
        double sourceY2 = maxFloat(group, "bottom");
        double cardLeft = medianX1 - effectiveLapW * 16.5;
        double cardTop = lapTop - missingSpan * 0.5 - effectiveLapH * 2.6;
        double cardRight = medianX2 + effectiveLapW * 7.4;
        double cardBottom = lapBottom + missingSpan * 0.5 + effectiveLapH * 0.75;
        double cardW = Math.max(1.0, cardRight - cardLeft);
        double cardH = Math.max(1.0, cardBottom - cardTop);
        Box roi = new Box(
                (float) (cardLeft - cardW * 0.02),
                (float) (cardTop - cardH * 0.08),
                (float) (cardRight + cardW * 0.02),
                (float) (cardBottom + cardH * 0.08)
        ).clipped(width, height);
        Box roiBeforeOwnerConstraint = roi;
        Box ownerConstraintBox = null;
        if (ownerConstraint != null) {
            ownerConstraintBox = new Box(
                    (float) (ownerConstraint.left - (float) (ownerConstraint.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
                    (float) (ownerConstraint.top - (float) (ownerConstraint.height() * OWNER_CONSTRAINT_TOP_MARGIN_RATIO)),
                    (float) (ownerConstraint.right + (float) (ownerConstraint.width() * OWNER_CONSTRAINT_X_MARGIN_RATIO)),
                    (float) (ownerConstraint.bottom + (float) (ownerConstraint.height() * OWNER_CONSTRAINT_BOTTOM_MARGIN_RATIO))
            ).clipped(width, height);
            roi = constrainToOwnerEnvelope(roi, ownerConstraintBox, width, height);
        }
        if ("lap_index_projected_yellow_ref".equals(reason)) {
            roi = roi.quantizedYellowReference(width, height);
        }
        double aspect = roi.width() / Math.max(1.0, roi.height());
        double aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 2.25) / 2.25);
        double rfdetrScore = referenceScore;
        double score = Math.min(2.0, group.size() / 3.0) + aspectScore + rfdetrScore * 2.0;
        Candidate candidate = new Candidate(roi, reason);
        candidate.score = score;
        candidate.rfdetrScore = rfdetrScore;
        candidate.lapIndexCount = group.size();
        candidate.lapIndexWidth = effectiveLapW;
        candidate.lapIndexHeight = effectiveLapH;
        candidate.rowGap = rowGap;
        candidate.sourceBox = new Box((float) sourceX1, (float) sourceY1, (float) sourceX2, (float) sourceY2);
        candidate.projectedRowCount = projectedRowCount;
        candidate.ownerConstraintApplied = ownerConstraint != null;
        candidate.ownerConstraintBox = ownerConstraintBox;
        candidate.roiBeforeOwnerConstraint = roiBeforeOwnerConstraint;
        candidate.ownerConstraintReason = ownerConstraint == null
                ? ""
                : "detected_owner_box_limits_lap_index_projection";
        return candidate;
    }

    private static Candidate constrainProjectedRoiAwayFromOtherLapGroups(
            Candidate candidate,
            List<Box> selectedGroup,
            List<List<Box>> allGroups,
            int selectedIndex,
            int width,
            int height
    ) {
        if (candidate == null || selectedGroup == null || selectedGroup.isEmpty() || allGroups == null || allGroups.size() < 2 || selectedIndex < 0) {
            return candidate;
        }
        Box selectedBounds = bounds(selectedGroup);
        float selectedCy = selectedBounds.centerY();
        List<Box> nearestOther = null;
        double nearestDistance = Double.MAX_VALUE;
        for (int i = 0; i < allGroups.size(); i++) {
            if (i == selectedIndex || allGroups.get(i).isEmpty()) {
                continue;
            }
            Box otherBounds = bounds(allGroups.get(i));
            double distance = Math.abs((double) otherBounds.centerY() - selectedCy);
            if (nearestOther == null || distance < nearestDistance) {
                nearestOther = allGroups.get(i);
                nearestDistance = distance;
            }
        }
        if (nearestOther == null) {
            return candidate;
        }
        Box otherBounds = bounds(nearestOther);
        Box roi = candidate.roi;
        Box constrained = roi;
        float separatorY;
        if (selectedBounds.bottom <= otherBounds.top) {
            separatorY = (selectedBounds.bottom + otherBounds.top) * 0.5f;
            constrained = new Box(roi.left, roi.top, roi.right, Math.min(roi.bottom, separatorY)).clipped(width, height);
        } else if (selectedBounds.top >= otherBounds.bottom) {
            separatorY = (otherBounds.bottom + selectedBounds.top) * 0.5f;
            constrained = new Box(roi.left, Math.max(roi.top, separatorY), roi.right, roi.bottom).clipped(width, height);
        } else {
            return candidate;
        }
        if (Math.abs((double) constrained.left - roi.left) < 0.01
                && Math.abs((double) constrained.top - roi.top) < 0.01
                && Math.abs((double) constrained.right - roi.right) < 0.01
                && Math.abs((double) constrained.bottom - roi.bottom) < 0.01) {
            return candidate;
        }
        Candidate updated = copyCandidateWithRoi(candidate, constrained);
        updated.roiBeforeDualOwnerGroupConstraint = roi;
        updated.dualOwnerGroupConstraintApplied = true;
        updated.dualOwnerGroupConstraintReason = "selected_lap_index_group_must_not_cross_other_owner_group";
        updated.dualOwnerGroupSeparatorY = separatorY;
        updated.otherLapGroupSourceBox = otherBounds;
        return updated;
    }

    private static Candidate copyCandidateWithRoi(Candidate source, Box roi) {
        Candidate copy = new Candidate(roi, source.reason);
        copy.selectedRoute = source.selectedRoute;
        copy.score = source.score;
        copy.rfdetrScore = source.rfdetrScore;
        copy.lapIndexCount = source.lapIndexCount;
        copy.playerLapIndexCount = source.playerLapIndexCount;
        copy.ghostLapIndexCount = source.ghostLapIndexCount;
        copy.lapIndexWidth = source.lapIndexWidth;
        copy.lapIndexHeight = source.lapIndexHeight;
        copy.rowGap = source.rowGap;
        copy.projectedRowCount = source.projectedRowCount;
        copy.sourceBox = source.sourceBox;
        copy.yellowReference = source.yellowReference;
        copy.yellowPanelBand = source.yellowPanelBand;
        copy.ownerConstraintBox = source.ownerConstraintBox;
        copy.roiBeforeOwnerConstraint = source.roiBeforeOwnerConstraint;
        copy.yellowSupportScore = source.yellowSupportScore;
        copy.yellowPanelBandOverlap = source.yellowPanelBandOverlap;
        copy.yellowLegacyLeftScore = source.yellowLegacyLeftScore;
        copy.yellowSupportPass = source.yellowSupportPass;
        copy.yellowSupportReason = source.yellowSupportReason;
        copy.ownerConstraintApplied = source.ownerConstraintApplied;
        copy.ownerConstraintReason = source.ownerConstraintReason;
        copy.roiBeforeDualOwnerGroupConstraint = source.roiBeforeDualOwnerGroupConstraint;
        copy.dualOwnerGroupConstraintApplied = source.dualOwnerGroupConstraintApplied;
        copy.dualOwnerGroupConstraintReason = source.dualOwnerGroupConstraintReason;
        copy.dualOwnerGroupSeparatorY = source.dualOwnerGroupSeparatorY;
        copy.otherLapGroupSourceBox = source.otherLapGroupSourceBox;
        return copy;
    }

    private static Box constrainToOwnerEnvelope(Box projected, Box ownerEnvelope, int width, int height) {
        float left = Math.max(projected.left, ownerEnvelope.left);
        float top = Math.max(projected.top, ownerEnvelope.top);
        float right = Math.min(projected.right, ownerEnvelope.right);
        float bottom = Math.min(projected.bottom, ownerEnvelope.bottom);
        if (right - left < (float) (ownerEnvelope.width() * 0.45) || bottom - top < (float) (ownerEnvelope.height() * 0.45)) {
            return ownerEnvelope.clipped(width, height);
        }
        return new Box(left, top, right, bottom).clipped(width, height);
    }


    private static int countLapIndexesInside(List<Box> lapBoxes, Box ownerBox) {
        return lapIndexesInside(lapBoxes, ownerBox).size();
    }

    private static List<Box> lapIndexesInside(List<Box> lapBoxes, Box ownerBox) {
        List<Box> inside = new ArrayList<>();
        Box expanded = ownerBox.expanded((float) (ownerBox.width() * 0.08), (float) (ownerBox.height() * 0.12));
        for (Box box : lapBoxes) {
            if (expanded.containsCenter(box)) {
                inside.add(box);
            }
        }
        return inside;
    }

    private static List<Box> lapIndexesOutside(List<Box> lapBoxes, Box ownerBox) {
        List<Box> outside = new ArrayList<>();
        Box expanded = ownerBox.expanded((float) (ownerBox.width() * 0.08), (float) (ownerBox.height() * 0.12));
        for (Box box : lapBoxes) {
            if (!expanded.containsCenter(box)) {
                outside.add(box);
            }
        }
        return outside;
    }

    private static List<List<Box>> ownerGroupsFromLapIndexes(List<Box> lapBoxes) {
        List<Box> sorted = new ArrayList<>(lapBoxes);
        Collections.sort(sorted, new Comparator<Box>() {
            @Override
            public int compare(Box a, Box b) {
                return Float.compare(a.centerY(), b.centerY());
            }
        });
        List<List<Box>> groups = new ArrayList<>();
        if (sorted.size() <= 7) {
            groups.add(sorted);
            return groups;
        }
        int splitAt = 1;
        float largestGap = -1.0f;
        for (int i = 0; i < sorted.size() - 1; i++) {
            float gap = sorted.get(i + 1).centerY() - sorted.get(i).centerY();
            if (gap > largestGap) {
                largestGap = gap;
                splitAt = i + 1;
            }
        }
        groups.add(new ArrayList<>(sorted.subList(0, splitAt)));
        groups.add(new ArrayList<>(sorted.subList(splitAt, sorted.size())));
        return groups;
    }

    private static YellowSupport evaluateYellowSupport(List<Box> lapGroup, List<Box> yellowReferences, int width, int height) {
        if (lapGroup == null || lapGroup.size() < 2) {
            return YellowSupport.fail("not_enough_lap_indexes_for_yellow_support");
        }
        if (yellowReferences == null || yellowReferences.isEmpty()) {
            return YellowSupport.fail("no_image_derived_yellow_reference");
        }
        Box groupBox = bounds(lapGroup);
        double groupH = Math.max(1.0, groupBox.height());
        double groupW = Math.max(1.0, groupBox.width());
        Box panelBand = new Box(
                (float) Math.max(0.0, groupBox.left - groupW * 12.0),
                (float) Math.max(0.0, groupBox.top - groupW * 1.5),
                (float) Math.min(width, groupBox.right + groupW * 2.0),
                (float) Math.min(height, groupBox.bottom + groupW * 1.5)
        );
        double panelBandArea = Math.max(1.0, (double) panelBand.width() * panelBand.height());
        YellowSupport best = YellowSupport.fail("yellow_reference_not_spatially_consistent");
        for (Box ref : yellowReferences) {
            double verticalOverlap = overlap1d(groupBox.top - groupH * 0.35, groupBox.bottom + groupH * 0.35, ref.top, ref.bottom)
                    / Math.max(1.0, Math.min(groupBox.height() + groupH * 0.70, ref.height()));
            double bandOverlap = overlapArea(panelBand, ref) / panelBandArea;
            double leftDistance = (double) groupBox.left - ref.right;
            double leftScore = ref.centerX() < groupBox.centerX()
                    ? Math.max(0.0, Math.min(1.0, leftDistance / Math.max(1.0, width * 0.18)))
                    : 0.0;
            double aspect = ref.width() / Math.max(1.0, ref.height());
            double aspectScore = Math.max(0.0, 1.0 - Math.abs(aspect - 1.15) / 1.15);
            double edgePenalty = (ref.top < height * 0.03 || ref.bottom > height * 0.97) ? 0.75 : 0.0;
            double bandScore = bandOverlap * 5.0 + verticalOverlap + aspectScore * 0.25 - edgePenalty;
            double leftReferenceScore = verticalOverlap * 2.5 + leftScore + aspectScore - edgePenalty;
            if (bandOverlap >= 0.25 && bandScore > best.score) {
                best = YellowSupport.pass(
                        bandScore,
                        "yellow_reference_overlaps_lap_index_panel_band",
                        ref,
                        panelBand,
                        bandOverlap,
                        leftReferenceScore
                );
            } else if (verticalOverlap >= 0.35 && leftScore > 0.0 && leftReferenceScore > best.score) {
                best = YellowSupport.pass(
                        leftReferenceScore,
                        "yellow_reference_left_of_lap_indexes_with_vertical_support",
                        ref,
                        panelBand,
                        bandOverlap,
                        leftReferenceScore
                );
            }
        }
        return best;
    }

    private static double overlapArea(Box a, Box b) {
        return overlap1d(a.left, a.right, b.left, b.right) * overlap1d(a.top, a.bottom, b.top, b.bottom);
    }

    private static double overlap1d(double a1, double a2, double b1, double b2) {
        return Math.max(0.0, Math.min(a2, b2) - Math.max(a1, b1));
    }

    private static Box bounds(List<Box> boxes) {
        float left = Float.MAX_VALUE;
        float top = Float.MAX_VALUE;
        float right = -Float.MAX_VALUE;
        float bottom = -Float.MAX_VALUE;
        for (Box box : boxes) {
            left = Math.min(left, box.left);
            top = Math.min(top, box.top);
            right = Math.max(right, box.right);
            bottom = Math.max(bottom, box.bottom);
        }
        return new Box(left, top, right, bottom);
    }


    private static double minFloat(List<Box> boxes, String field) {
        double value = Double.MAX_VALUE;
        for (Box box : boxes) {
            if ("left".equals(field)) {
                value = Math.min(value, box.left);
            } else {
                value = Math.min(value, box.top);
            }
        }
        return value == Double.MAX_VALUE ? 0.0 : value;
    }

    private static double maxFloat(List<Box> boxes, String field) {
        double value = -Double.MAX_VALUE;
        for (Box box : boxes) {
            if ("right".equals(field)) {
                value = Math.max(value, box.right);
            } else {
                value = Math.max(value, box.bottom);
            }
        }
        return value == -Double.MAX_VALUE ? 0.0 : value;
    }




    private static Box detectionBoxPixels(Detection detection, int width, int height) {
        return new Box(detection.left * width, detection.top * height, detection.right * width, detection.bottom * height);
    }

    private static double median(List<Double> values) {
        if (values.isEmpty()) {
            return 0.0;
        }
        List<Double> sorted = new ArrayList<>(values);
        Collections.sort(sorted);
        int mid = sorted.size() / 2;
        if (sorted.size() % 2 == 1) {
            return sorted.get(mid);
        }
        return (sorted.get(mid - 1) + sorted.get(mid)) * 0.5;
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

        private Selection(Candidate candidate, String status, String reason, String selectedReason, boolean fallbackUsed, DetectionCounts counts) {
            this.roi = candidate == null ? null : candidate.roi;
            this.status = status;
            this.reason = reason;
            this.selectedReason = selectedReason;
            this.fallbackUsed = fallbackUsed;
            this.counts = counts;
            this.candidate = candidate;
        }

        public static Selection selected(Candidate candidate, boolean fallbackUsed, DetectionCounts counts) {
            return new Selection(candidate, "implemented", "", candidate.reason, fallbackUsed, counts);
        }

        public static Selection selected(Candidate candidate, String selectedReason, boolean fallbackUsed, DetectionCounts counts) {
            return new Selection(candidate, "implemented", "", selectedReason, fallbackUsed, counts);
        }

        public static Selection blocked(String status, String reason, DetectionCounts counts) {
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

        public Candidate(Box roi, String reason) {
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

    private static class YellowSupport {
        final boolean pass;
        final double score;
        final String reason;
        final Box reference;
        final Box panelBand;
        final double panelBandOverlap;
        final double legacyLeftScore;

        private YellowSupport(boolean pass, double score, String reason, Box reference) {
            this(pass, score, reason, reference, null, 0.0, 0.0);
        }

        private YellowSupport(boolean pass, double score, String reason, Box reference, Box panelBand, double panelBandOverlap, double legacyLeftScore) {
            this.pass = pass;
            this.score = score;
            this.reason = reason;
            this.reference = reference;
            this.panelBand = panelBand;
            this.panelBandOverlap = panelBandOverlap;
            this.legacyLeftScore = legacyLeftScore;
        }

        static YellowSupport pass(double score, String reason, Box reference) {
            return new YellowSupport(true, score, reason, reference);
        }

        static YellowSupport pass(double score, String reason, Box reference, Box panelBand, double panelBandOverlap, double legacyLeftScore) {
            return new YellowSupport(true, score, reason, reference, panelBand, panelBandOverlap, legacyLeftScore);
        }

        static YellowSupport fail(String reason) {
            return new YellowSupport(false, 0.0, reason, null);
        }
    }

    public static class Box {
        public final float left;
        public final float top;
        public final float right;
        public final float bottom;

        public Box(float left, float top, float right, float bottom) {
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

        public float centerX() {
            return (left + right) * 0.5f;
        }

        public float centerY() {
            return (top + bottom) * 0.5f;
        }

        public boolean containsCenter(Box box) {
            float cx = box.centerX();
            float cy = box.centerY();
            return cx >= left && cx <= right && cy >= top && cy <= bottom;
        }

        public Box expanded(float dx, float dy) {
            return new Box(left - dx, top - dy, right + dx, bottom + dy);
        }

        public Box clipped(int width, int height) {
            return new Box(
                    Math.max(0.0f, Math.min(width - 1.0f, left)),
                    Math.max(0.0f, Math.min(height - 1.0f, top)),
                    Math.max(1.0f, Math.min(width, right)),
                    Math.max(1.0f, Math.min(height, bottom))
            );
        }

        public Box quantizedYellowReference(int width, int height) {
            return roundedClamp(width, height);
        }

        public Box roundedClamp(int width, int height) {
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
