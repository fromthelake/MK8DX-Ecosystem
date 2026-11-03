package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.IntStream;

/**
 * Masked RGB rank on normalized tensors (sharedIconScorer.ts matchIconTensor,
 * center_shortlist): centre, then ±2 px over the top-8 centre families. The
 * same pixel order and double accumulation, stored as float like the
 * Float32Array, so the scores are identical.
 */
public final class IconScorer {
    private IconScorer() {
    }

    /** One match (IconTensorMatch). Scores are float32 values. */
    public static final class Match {
        public String status;
        public String top1Id;
        public String acceptedId;
        public double score;
        public double margin;
        public Double familyMargin;
        public int[] offset = {0, 0};
        public final List<String> topIds = new ArrayList<>();
        public final List<String> topFamilies = new ArrayList<>();
        public final List<Double> topScores = new ArrayList<>();
    }

    static float scoreAt(float[] query, IconGroup group, int index) {
        int rgbBase = index * group.width * group.height * 3;
        float[] rgb = group.rgb;
        double distance = 0;
        for (int offset : group.masked[index]) {
            int reference = rgbBase + offset;
            distance += Math.abs(rgb[reference] - query[offset]);
            distance += Math.abs(rgb[reference + 1] - query[offset + 1]);
            distance += Math.abs(rgb[reference + 2] - query[offset + 2]);
        }
        return (float) (1 - distance / (group.count[index] * 3 + 1e-6));
    }

    static float[] shifted(float[] query, int width, int height, int dx, int dy) {
        float[] out = new float[query.length];
        for (int y = 0; y < height; y++) {
            int sy = Math.max(0, Math.min(height - 1, y - dy));
            for (int x = 0; x < width; x++) {
                int sx = Math.max(0, Math.min(width - 1, x - dx));
                int target = (y * width + x) * 3;
                int source = (sy * width + sx) * 3;
                out[target] = query[source];
                out[target + 1] = query[source + 1];
                out[target + 2] = query[source + 2];
            }
        }
        return out;
    }

    static Integer[] ranked(float[] scores) {
        Integer[] order = new Integer[scores.length];
        for (int i = 0; i < order.length; i++) order[i] = i;
        Arrays.sort(order, (left, right) -> {
            int byScore = Float.compare(scores[right], scores[left]);
            return byScore != 0 ? byScore : Integer.compare(left, right);
        });
        return order;
    }

    /** Best centre-only score over the group (TS matchIconTensorCenter().score). */
    public static double centreScore(float[] query, IconGroup group) {
        if (query.length != group.width * group.height * 3) {
            throw new IllegalArgumentException("Incompatible icon tensor shape");
        }
        float[] scores = new float[group.ids.length];
        IntStream.range(0, scores.length).parallel().forEach(i -> scores[i] = scoreAt(query, group, i));
        float best = -Float.MAX_VALUE;
        for (float score : scores) best = Math.max(best, score);
        return best;
    }

    public static Match match(float[] query, IconGroup group) {
        int count = group.ids.length;
        if (query.length != group.width * group.height * 3) {
            throw new IllegalArgumentException("Incompatible icon tensor shape");
        }
        float[] scores = new float[count];
        int[][] offsets = new int[count][];
        for (int i = 0; i < count; i++) offsets[i] = new int[]{0, 0};
        IntStream.range(0, count).parallel().forEach(i -> scores[i] = scoreAt(query, group, i));
        Integer[] centre = ranked(scores);
        Set<String> families = new HashSet<>();
        for (int i = 0; i < Math.min(8, centre.length); i++) families.add(group.families[centre[i]]);
        List<Integer> selected = new ArrayList<>();
        for (Integer i : centre) {
            if (families.contains(group.families[i])) selected.add(i);
        }
        for (int dy = -2; dy <= 2; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                if (dx == 0 && dy == 0) continue;
                float[] moved = shifted(query, group.width, group.height, dx, dy);
                final int fdx = dx;
                final int fdy = dy;
                selected.parallelStream().forEach(i -> {
                    float candidate = scoreAt(moved, group, i);
                    if (candidate > scores[i]) {
                        scores[i] = candidate;
                        offsets[i] = new int[]{fdx, fdy};
                    }
                });
            }
        }
        Integer[] order = ranked(scores);
        Match match = new Match();
        int first = order[0];
        match.score = scores[first];
        match.margin = (double) scores[first] - (double) scores[order[1]];
        match.status = match.score >= 0.80 && match.margin >= 0.02 ? "accepted" : "unknown";
        match.top1Id = group.ids[first];
        match.acceptedId = "accepted".equals(match.status) ? match.top1Id : null;
        match.offset = offsets[first];
        for (Integer i : order) {
            if (!group.families[i].equals(group.families[first])) {
                match.familyMargin = (double) scores[first] - (double) scores[i];
                break;
            }
        }
        for (int i = 0; i < Math.min(3, order.length); i++) {
            match.topIds.add(group.ids[order[i]]);
            match.topFamilies.add(group.families[order[i]]);
            match.topScores.add((double) scores[order[i]]);
        }
        return match;
    }
}
