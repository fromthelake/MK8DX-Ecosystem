package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The central lap-row anchor grid (CENTRAL_RECOGNITION section 8.6, phase 5): the Java port of
 * python/mk8dx_icon_matcher/lap_grid.py (the reference) and ts/sharedLapGrid.ts, kept equal by the
 * parity vectors (tooling/recognition/lap_grid_vectors.py). Where every time digit of a Time Trial
 * card is cut, from the lap-index badges on the canonical frame and the pack's time grid. Boxes are
 * double pixels; rounding is Math.round; detection coordinates are multiplied in double.
 */
public final class LapGrid {
    public static final double MAX_ANCHOR_DISTANCE_PX = 48.0;
    private static final int[] PLAYER_TOTAL_X = {0, -3, 0, -2, -3, -2, -3, -1, -2};
    private static final int[] GHOST_TOTAL_X = {0, -2, 1, -2, -3, -1, -2, -1, -2};
    private static final int[] LAP_X = {0, -2, -1, -2, -1, -2, -1, -2, 0};

    private LapGrid() {
    }

    /** A normalised detection (0..1). */
    public static final class Detection {
        public final String label;
        public final double score;
        public final double left;
        public final double top;
        public final double right;
        public final double bottom;

        public Detection(String label, double score, double left, double top, double right, double bottom) {
            this.label = label;
            this.score = score;
            this.left = left;
            this.top = top;
            this.right = right;
            this.bottom = bottom;
        }
    }

    public static final class Box {
        public final double left;
        public final double top;
        public final double right;
        public final double bottom;

        public Box(double left, double top, double right, double bottom) {
            this.left = Math.min(left, right);
            this.top = Math.min(top, bottom);
            this.right = Math.max(left, right);
            this.bottom = Math.max(top, bottom);
        }

        Box clipped(int width, int height) {
            return new Box(Math.max(0, Math.min(width - 1, left)), Math.max(0, Math.min(height - 1, top)),
                Math.max(1, Math.min(width, right)), Math.max(1, Math.min(height, bottom)));
        }

        double width() {
            return Math.max(1.0, right - left);
        }

        double height() {
            return Math.max(1.0, bottom - top);
        }

        public double centerX() {
            return (left + right) * 0.5;
        }

        public double centerY() {
            return (top + bottom) * 0.5;
        }
    }

    public static final class Match {
        public final int detIndex;
        public final int rowIndex;
        public final Box canonical;
        public final Box detected;
        public final double distance;
        public final double score;

        Match(int detIndex, int rowIndex, Box canonical, Box detected, double distance, double score) {
            this.detIndex = detIndex;
            this.rowIndex = rowIndex;
            this.canonical = canonical;
            this.detected = detected;
            this.distance = distance;
            this.score = score;
        }
    }

    public static final class Field {
        public final String name;
        public final String owner;
        public final String type;
        public final int lapIndex;
        public final Box box;
        public final List<Box> slots;

        Field(String name, String owner, String type, int lapIndex, Box box, List<Box> slots) {
            this.name = name;
            this.owner = owner;
            this.type = type;
            this.lapIndex = lapIndex;
            this.box = box;
            this.slots = slots;
        }
    }

    public static final class OwnerMatches {
        public final int inferredLapCount;
        public final List<Match> matches;

        OwnerMatches(int inferredLapCount, List<Match> matches) {
            this.inferredLapCount = inferredLapCount;
            this.matches = matches;
        }
    }

    public static final class Grid {
        public boolean available;
        public String status = "implemented";
        public String reason = "";
        public String raceKey;
        public int activeLapCount;
        public int expectedFieldCount;
        public final List<String> activeOwners = new ArrayList<>();
        public final List<Field> fields = new ArrayList<>();
        public final Map<String, double[]> ownerAnchors = new LinkedHashMap<>();
        public int matchedLapIndexCount;
        public final Map<String, OwnerMatches> ownerMatches = new LinkedHashMap<>();
    }

    private static final class Ref {
        double anchorX;
        double anchorY;
        double refinedX;
        double refinedY;
        double scaleX = 1.0;
        double scaleY = 1.0;
    }

    private static double opt(JSONArray rel, int i) {
        return i < rel.length() && !rel.isNull(i) ? rel.optDouble(i, 0.0) : 0.0;
    }

    private static Box ownerAbsBox(JSONObject ownerGrid, JSONArray rel) {
        JSONObject anchor = ownerGrid.optJSONObject("anchor");
        double ax = anchor == null ? 0.0 : anchor.optDouble("x", 0.0);
        double ay = anchor == null ? 0.0 : anchor.optDouble("y", 0.0);
        return new Box(ax + opt(rel, 0), ay + opt(rel, 1), ax + opt(rel, 2), ay + opt(rel, 3));
    }

    public static List<Box> canonicalLapIndexBoxes(JSONObject ownerGrid) {
        List<Box> boxes = new ArrayList<>();
        JSONArray rels = ownerGrid.optJSONArray("lap_index_boxes_rel");
        if (rels != null) {
            for (int i = 0; i < rels.length(); i++) {
                JSONArray rel = rels.optJSONArray(i);
                if (rel != null) boxes.add(ownerAbsBox(ownerGrid, rel));
            }
            return boxes;
        }
        JSONArray strips = ownerGrid.optJSONArray("lap_strips_rel");
        JSONObject anchor = ownerGrid.optJSONObject("anchor");
        if (strips == null || anchor == null) return boxes;
        double ax = anchor.optDouble("x", 0.0);
        double ay = anchor.optDouble("y", 0.0);
        for (int i = 0; i < strips.length(); i++) {
            JSONArray rel = strips.optJSONArray(i);
            if (rel == null || rel.length() < 4) continue;
            double cy = ay + (opt(rel, 1) + opt(rel, 3)) * 0.5;
            boxes.add(new Box(ax - 12.5, cy - 12.5, ax + 12.5, cy + 12.5));
        }
        return boxes;
    }

    private static Box detectionBox(Detection d, int width, int height) {
        return new Box(d.left * width, d.top * height, d.right * width, d.bottom * height);
    }

    public static List<String> activeOwnerCandidates(List<Detection> detections, int lapIndexCount, boolean ghostDetail) {
        List<String> owners = new ArrayList<>();
        if (ghostDetail) {
            owners.add("ghost");
            return owners;
        }
        for (String owner : new String[]{"ghost", "player"}) {
            for (Detection d : detections) {
                if (!(owner + "_timetrail_box").equals(d.label)) continue;
                String physical = (float) ((d.top + d.bottom) * 0.5) < 0.5f ? "ghost" : "player";
                if (!owners.contains(physical)) owners.add(physical);
            }
        }
        if (!owners.isEmpty()) {
            owners.sort((a, b) -> ("ghost".equals(a) ? 0 : 1) - ("ghost".equals(b) ? 0 : 1));
            return owners;
        }
        if (lapIndexCount >= 10) {
            owners.add("ghost");
            owners.add("player");
        } else if (lapIndexCount >= 2) {
            owners.add("player");
        }
        return owners;
    }

    private static final class Candidate {
        final int index;
        final Detection detection;
        final Box box;

        Candidate(int index, Detection detection, Box box) {
            this.index = index;
            this.detection = detection;
            this.box = box;
        }
    }

    private static final class Search {
        final List<Box> rows;
        final List<Candidate> candidates;
        List<Match> best = new ArrayList<>();
        double bestDistance = Double.MAX_VALUE;
        double bestScore = -Double.MAX_VALUE;

        Search(List<Box> rows, List<Candidate> candidates) {
            this.rows = rows;
            this.candidates = candidates;
        }

        void visit(int rowPos, int minDet, List<Match> current, double distanceSum, double scoreSum) {
            if (rowPos >= rows.size()) {
                if (current.size() > best.size()
                    || (current.size() == best.size() && distanceSum < bestDistance - 1e-6)
                    || (current.size() == best.size() && Math.abs(distanceSum - bestDistance) <= 1e-6 && scoreSum > bestScore)) {
                    best = new ArrayList<>(current);
                    bestDistance = distanceSum;
                    bestScore = scoreSum;
                }
                return;
            }
            visit(rowPos + 1, minDet, current, distanceSum, scoreSum);
            Box row = rows.get(rowPos);
            for (int detPos = minDet; detPos < candidates.size(); detPos++) {
                Candidate c = candidates.get(detPos);
                double dx = c.box.centerX() - row.centerX();
                double dy = c.box.centerY() - row.centerY();
                double distance = Math.sqrt(dx * dx + dy * dy);
                if (distance > MAX_ANCHOR_DISTANCE_PX) continue;
                current.add(new Match(c.index, rowPos + 1, row, c.box, distance, c.detection.score));
                visit(rowPos + 1, detPos + 1, current, distanceSum + distance, scoreSum + c.detection.score);
                current.remove(current.size() - 1);
            }
        }
    }

    public static List<Match> matchOwnerLapRows(List<Detection> detections, JSONObject ownerGrid, int width, int height, List<Integer> used) {
        List<Box> canonical = canonicalLapIndexBoxes(ownerGrid);
        if (canonical.isEmpty()) return new ArrayList<>();
        List<Candidate> available = new ArrayList<>();
        for (int i = 0; i < detections.size(); i++) {
            if (used.contains(i)) continue;
            available.add(new Candidate(i, detections.get(i), detectionBox(detections.get(i), width, height)));
        }
        available.sort((a, b) -> Double.compare(b.detection.score, a.detection.score));
        List<Candidate> distinct = new ArrayList<>();
        for (Candidate c : available) {
            boolean duplicate = false;
            for (Candidate k : distinct) {
                double ox = Math.max(0, Math.min(c.box.right, k.box.right) - Math.max(c.box.left, k.box.left));
                double oy = Math.max(0, Math.min(c.box.bottom, k.box.bottom) - Math.max(c.box.top, k.box.top));
                if (ox >= 0.7 * Math.min(c.box.width(), k.box.width()) && oy >= 0.7 * Math.min(c.box.height(), k.box.height())) {
                    duplicate = true;
                    break;
                }
            }
            if (!duplicate) distinct.add(c);
        }
        distinct.sort((a, b) -> {
            double ya = a.box.centerY();
            double yb = b.box.centerY();
            if (ya != yb) return ya < yb ? -1 : 1;
            return Double.compare(b.detection.score, a.detection.score);
        });
        Search search = new Search(canonical, distinct);
        search.visit(0, 0, new ArrayList<>(), 0.0, 0.0);
        for (Match m : search.best) used.add(m.detIndex);
        return search.best;
    }

    public static int inferActiveLapCount(List<Match> matches, int totalLapIndexCount) {
        if (matches.size() < 2) return 0;
        int maxRow = 0;
        for (Match m : matches) maxRow = Math.max(maxRow, m.rowIndex);
        if (matches.size() <= 3 && totalLapIndexCount <= 8) return 3;
        if (matches.size() >= 5 || totalLapIndexCount >= 10 || maxRow >= 5) return 7;
        if (maxRow <= 3) return 3;
        return 0;
    }

    private static int commonLapCount(Map<String, Integer> counts) {
        int value = 0;
        for (int count : counts.values()) {
            if (count <= 0) return 0;
            if (value == 0) value = count;
            else if (value != count) return 0;
        }
        return value;
    }

    private static double range(List<Double> values) {
        if (values.isEmpty()) return 0.0;
        double min = Double.MAX_VALUE;
        double max = -Double.MAX_VALUE;
        for (double v : values) {
            min = Math.min(min, v);
            max = Math.max(max, v);
        }
        return max - min;
    }

    private static double median(List<Double> values) {
        if (values.isEmpty()) return 0.0;
        List<Double> s = new ArrayList<>(values);
        Collections.sort(s);
        int mid = s.size() / 2;
        return s.size() % 2 == 1 ? s.get(mid) : (s.get(mid - 1) + s.get(mid)) * 0.5;
    }

    private static double linearEval(List<double[]> samples, double y, double fallback) {
        if (samples.isEmpty()) return fallback;
        List<Double> ys = new ArrayList<>();
        for (double[] s : samples) ys.add(s[0]);
        if (samples.size() >= 2 && range(ys) > 1.0) {
            double meanX = 0.0;
            double meanY = 0.0;
            for (double[] s : samples) {
                meanX += s[0];
                meanY += s[1];
            }
            meanX /= samples.size();
            meanY /= samples.size();
            double num = 0.0;
            double den = 0.0;
            for (double[] s : samples) {
                num += (s[0] - meanX) * (s[1] - meanY);
                den += (s[0] - meanX) * (s[0] - meanX);
            }
            if (den > 1e-6) {
                double slope = num / den;
                return slope * y + (meanY - slope * meanX);
            }
        }
        List<Double> values = new ArrayList<>();
        for (double[] s : samples) values.add(s[1]);
        return median(values);
    }

    private static Map<Integer, Ref> buildRowRefinements(JSONObject ownerGrid, List<Match> matches) {
        Map<Integer, Ref> out = new LinkedHashMap<>();
        if (matches.isEmpty()) return out;
        List<Double> canonY = new ArrayList<>();
        List<Double> detY = new ArrayList<>();
        for (Match m : matches) {
            canonY.add(m.canonical.centerY());
            detY.add(m.detected.centerY());
        }
        double rowSy = 1.0;
        if (matches.size() >= 2 && range(canonY) > 1.0) {
            rowSy = Math.max(0.85, Math.min(1.18, range(detY) / Math.max(1.0, range(canonY))));
        }
        List<Box> rows = canonicalLapIndexBoxes(ownerGrid);
        if (rows.isEmpty()) return out;
        List<double[]> dx = new ArrayList<>();
        List<double[]> dy = new ArrayList<>();
        for (Match m : matches) {
            dx.add(new double[]{m.canonical.centerY(), m.detected.centerX() - m.canonical.centerX()});
            dy.add(new double[]{m.canonical.centerY(), m.detected.centerY() - m.canonical.centerY()});
            Ref r = new Ref();
            r.anchorX = m.canonical.centerX();
            r.anchorY = m.canonical.centerY();
            r.refinedX = m.detected.centerX();
            r.refinedY = m.detected.centerY();
            r.scaleY = rowSy;
            out.put(m.rowIndex, r);
        }
        for (int i = 0; i < rows.size(); i++) {
            if (out.containsKey(i + 1)) continue;
            Box can = rows.get(i);
            Ref r = new Ref();
            r.anchorX = can.centerX();
            r.anchorY = can.centerY();
            r.refinedX = can.centerX() + linearEval(dx, can.centerY(), 0.0);
            r.refinedY = can.centerY() + linearEval(dy, can.centerY(), 0.0);
            r.scaleY = rowSy;
            out.put(i + 1, r);
        }
        return out;
    }

    private static int segmentOffsetX(String owner, String kind, int slot) {
        if ("total".equals(kind)) return ("ghost".equals(owner) ? GHOST_TOTAL_X : PLAYER_TOTAL_X)[slot];
        return LAP_X[slot];
    }

    private static int segmentOffsetY(String owner, String kind) {
        if ("total".equals(kind)) return "ghost".equals(owner) ? -4 : -3;
        return "ghost".equals(owner) ? -4 : -2;
    }

    public static Box canonicalSlotBox(JSONObject ownerGrid, JSONArray rel, String owner, String kind, int slot) {
        Box base = ownerAbsBox(ownerGrid, rel);
        int ox = segmentOffsetX(owner, kind, slot);
        int oy = segmentOffsetY(owner, kind);
        int[] size = SegmentDigits.canonicalSlotSize(kind, slot);
        return new Box(base.left + ox, base.top + oy, base.left + ox + size[0], base.top + oy + size[1]);
    }

    private static Ref totalRefinement(JSONObject ownerGrid, Map<Integer, Ref> rowRefs) {
        JSONArray total = ownerGrid.optJSONArray("total_digits_rel");
        if (total == null || total.length() == 0) return null;
        JSONArray anchorRel = total.optJSONArray(Math.min(1, total.length() - 1));
        if (anchorRel == null) return null;
        Box anchor = canonicalSlotBox(ownerGrid, anchorRel, "", "total", Math.min(2, total.length()));
        List<double[]> dx = new ArrayList<>();
        List<double[]> dy = new ArrayList<>();
        List<Double> sy = new ArrayList<>();
        for (Ref r : rowRefs.values()) {
            dx.add(new double[]{r.anchorY, r.refinedX - r.anchorX});
            dy.add(new double[]{r.anchorY, r.refinedY - r.anchorY});
            sy.add(r.scaleY);
        }
        Ref out = new Ref();
        out.anchorX = anchor.centerX();
        out.anchorY = anchor.centerY();
        out.refinedX = anchor.centerX() + linearEval(dx, anchor.centerY(), 0.0);
        out.refinedY = anchor.centerY() + linearEval(dy, anchor.centerY(), 0.0);
        out.scaleY = sy.isEmpty() ? 1.0 : median(sy);
        return out;
    }

    private static Box transformAroundAnchor(Box box, Ref ref) {
        double x1 = ref.refinedX + (Math.round(box.left) - ref.anchorX) * ref.scaleX;
        double y1 = ref.refinedY + (Math.round(box.top) - ref.anchorY) * ref.scaleY;
        double x2 = ref.refinedX + (Math.round(box.right) - ref.anchorX) * ref.scaleX;
        double y2 = ref.refinedY + (Math.round(box.bottom) - ref.anchorY) * ref.scaleY;
        return new Box(Math.round(Math.min(x1, x2)), Math.round(Math.min(y1, y2)), Math.round(Math.max(x1, x2)), Math.round(Math.max(y1, y2)));
    }

    private static Box blendX(Box nominal, Box refined, double blend) {
        double b = Math.max(0.0, Math.min(1.0, blend));
        return new Box(Math.round(nominal.left + (refined.left - nominal.left) * b), refined.top,
            Math.round(nominal.right + (refined.right - nominal.right) * b), refined.bottom);
    }

    private static List<Box> slotsFromRow(JSONObject ownerGrid, JSONArray rels, String owner, String kind, Ref ref, int width, int height) {
        List<Box> slots = new ArrayList<>();
        for (int i = 0; i < rels.length(); i++) {
            JSONArray rel = rels.optJSONArray(i);
            if (rel == null) continue;
            Box canonical = canonicalSlotBox(ownerGrid, rel, owner, kind, i + 1);
            Box read = ref == null ? canonical : blendX(canonical, transformAroundAnchor(canonical, ref), 0.5);
            slots.add(read.clipped(width, height));
        }
        return slots;
    }

    private static Box union(List<Box> boxes) {
        if (boxes.isEmpty()) return new Box(0, 0, 1, 1);
        double l = Double.MAX_VALUE;
        double t = Double.MAX_VALUE;
        double r = -Double.MAX_VALUE;
        double b = -Double.MAX_VALUE;
        for (Box x : boxes) {
            l = Math.min(l, x.left);
            t = Math.min(t, x.top);
            r = Math.max(r, x.right);
            b = Math.max(b, x.bottom);
        }
        return new Box(l, t, r, b);
    }

    /** The digit slots of every active owner (Python build_dynamic_grid). */
    public static Grid build(JSONObject timeGrid, String raceKeyIn, boolean ghostDetail, int width, int height,
                             List<Detection> detections, List<Detection> lapRows, boolean nominal) throws JSONException {
        Grid grid = new Grid();
        grid.raceKey = raceKeyIn == null || raceKeyIn.isEmpty() ? "race7" : raceKeyIn;
        JSONObject race = timeGrid == null ? null : timeGrid.optJSONObject(grid.raceKey);
        JSONObject ownersRoot = race == null ? null : race.optJSONObject("owners");
        if (ownersRoot == null) {
            grid.status = "blocked_missing_relative_grid";
            grid.reason = "relative grid did not contain owners for " + grid.raceKey + ".";
            return grid;
        }
        if (lapRows.size() < 2) {
            grid.status = "blocked_insufficient_lap_index_support";
            grid.reason = "Need at least two native RF-DETR lap-index detections to build dynamic/refined grid.";
            return grid;
        }
        List<String> owners = activeOwnerCandidates(detections, lapRows.size(), ghostDetail);
        if (owners.isEmpty()) {
            grid.status = "blocked_unresolved_active_ocr_profile";
            grid.reason = "Could not resolve active player/ghost owner profile from Step 19 owner boxes or lap-index support.";
            return grid;
        }
        List<Integer> used = new ArrayList<>();
        Map<String, List<Match>> matchesByOwner = new LinkedHashMap<>();
        Map<String, Integer> lapCountByOwner = new LinkedHashMap<>();
        for (String owner : owners) {
            JSONObject ownerGrid = ownersRoot.optJSONObject(owner);
            if (ownerGrid == null) continue;
            List<Match> matches = matchOwnerLapRows(lapRows, ownerGrid, width, height, used);
            int inferred = inferActiveLapCount(matches, lapRows.size());
            grid.ownerMatches.put(owner, new OwnerMatches(inferred, matches));
            if (inferred <= 0) continue;
            matchesByOwner.put(owner, matches);
            lapCountByOwner.put(owner, inferred);
            if (!matches.isEmpty()) {
                double sx = 0.0;
                double sy = 0.0;
                for (Match m : matches) {
                    sx += m.detected.centerX();
                    sy += m.detected.centerY();
                }
                grid.ownerAnchors.put(owner, new double[]{sx / matches.size(), sy / matches.size()});
            }
        }
        if (matchesByOwner.isEmpty()) {
            grid.status = "blocked_insufficient_owner_lap_index_support";
            grid.reason = "No active owner had enough matched lap-index rows to build a scoped dynamic grid.";
            return grid;
        }
        int active = commonLapCount(lapCountByOwner);
        if (active <= 0) {
            grid.status = "blocked_ambiguous_active_lap_count";
            grid.reason = "Active owners did not agree on a supported 3-lap or 7-lap OCR profile.";
            return grid;
        }
        grid.available = true;
        grid.activeLapCount = active;
        for (Map.Entry<String, List<Match>> entry : matchesByOwner.entrySet()) {
            String owner = entry.getKey();
            List<Match> matches = entry.getValue();
            JSONObject ownerGrid = ownersRoot.optJSONObject(owner);
            if (ownerGrid == null) continue;
            grid.activeOwners.add(owner);
            grid.matchedLapIndexCount += matches.size();
            Map<Integer, Ref> rowRefs = nominal ? new LinkedHashMap<>() : buildRowRefinements(ownerGrid, matches);
            if (ghostDetail && !rowRefs.isEmpty()) {
                double sx = 0.0;
                double sy = 0.0;
                for (Ref r : rowRefs.values()) {
                    sx += r.refinedX;
                    sy += r.refinedY;
                }
                grid.ownerAnchors.put(owner, new double[]{sx / rowRefs.size(), sy / rowRefs.size()});
            }
            JSONArray lapRels = ownerGrid.optJSONArray("lap_digits_rel");
            for (int lap = 1; lap <= active; lap++) {
                if (lapRels == null || lapRels.length() < lap) continue;
                JSONArray slotRels = lapRels.optJSONArray(lap - 1);
                if (slotRels == null) continue;
                List<Box> slots = slotsFromRow(ownerGrid, slotRels, owner, "lap", rowRefs.get(lap), width, height);
                grid.fields.add(new Field(owner + "_lap_" + lap, owner, "lap", lap, union(slots).clipped(width, height), slots));
            }
            JSONArray totalRels = ownerGrid.optJSONArray("total_digits_rel");
            if (totalRels != null) {
                List<Box> slots = slotsFromRow(ownerGrid, totalRels, owner, "total", totalRefinement(ownerGrid, rowRefs), width, height);
                grid.fields.add(new Field(owner + "_total", owner, "total", 0, union(slots).clipped(width, height), slots));
            }
        }
        grid.expectedFieldCount = grid.activeOwners.size() * (grid.activeLapCount + 1);
        return grid;
    }
}
