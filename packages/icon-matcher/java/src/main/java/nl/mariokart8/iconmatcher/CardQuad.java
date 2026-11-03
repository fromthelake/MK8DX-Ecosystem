package nl.mariokart8.iconmatcher;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * The central card quad (CENTRAL_RECOGNITION section 8.6, phase 5): the Java port of
 * python/mk8dx_icon_matcher/card_quad.py (the reference) and ts/sharedCardQuad.ts, kept equal by the
 * parity vectors (tooling/recognition/card_quad_vectors.py, vectors/card-quad-v1.json). Which four
 * card edges the photographed result card has, from the Hough segments the product found in its
 * mask; and the Select-a-Ghost deskew seed from the lap-index badge column. Angles are
 * atan2 * 180 / PI.
 */
public final class CardQuad {
    public static final double HOUGH_MIN_LINE_LENGTH_PX = 45.0;
    public static final double SHORT_LINE_MIN_LENGTH_PX = 70.0;
    private static final double AXIS_TOLERANCE_DEGREES = 14.0;
    private static final double CLUSTER_DISTANCE_PX = 12.0;
    private static final double CLUSTER_ANGLE_DEGREES = 6.0;
    private static final double DESKEW_MIN_DEGREES = 0.2;
    private static final double DESKEW_MAX_DEGREES = 8.0;

    private CardQuad() {
    }

    /** A segment, or a cluster's weighted line (workflowLength: its longest member). */
    public static final class Line {
        public final double x1;
        public final double y1;
        public final double x2;
        public final double y2;
        public double workflowLength = Double.NaN;
        public double angle = Double.NaN;
        public double support = 0.0;
        public double count = 1.0;
        public String keyName = "";
        public double keyValue = Double.NaN;

        public Line(double x1, double y1, double x2, double y2) {
            this.x1 = x1;
            this.y1 = y1;
            this.x2 = x2;
            this.y2 = y2;
        }

        public double angleDeg() {
            return Math.atan2(y2 - y1, x2 - x1) * 180.0 / Math.PI;
        }

        public double length() {
            return Math.hypot(x2 - x1, y2 - y1);
        }

        public double workflowLen() {
            return Double.isNaN(workflowLength) ? length() : workflowLength;
        }

        public double centerX() {
            return (x1 + x2) * 0.5;
        }

        public double centerY() {
            return (y1 + y2) * 0.5;
        }
    }

    /** The guarded segments and which branch the short-line guard took. */
    public static final class Guard {
        public final List<Line> lines;
        public final boolean guardUsed;
        public final boolean fallbackUsed;

        Guard(List<Line> lines, boolean guardUsed, boolean fallbackUsed) {
            this.lines = lines;
            this.guardUsed = guardUsed;
            this.fallbackUsed = fallbackUsed;
        }
    }

    /** The turned ROI seed: corners tl, tr, br, bl as {x, y}, and the measured turn. */
    public static final class Deskew {
        public final double[][] quad;
        public final double degrees;

        Deskew(double[][] quad, double degrees) {
            this.quad = quad;
            this.degrees = degrees;
        }
    }

    public static double folded(Line line) {
        double angle = Math.abs(line.angleDeg());
        return Math.min(angle, Math.abs(180.0 - angle));
    }

    public static List<Line> filterAngles(List<Line> lines) {
        List<Line> out = new ArrayList<>();
        for (Line line : lines) {
            double f = folded(line);
            if (f <= AXIS_TOLERANCE_DEGREES || Math.abs(f - 90.0) <= AXIS_TOLERANCE_DEGREES) out.add(line);
        }
        return out;
    }

    public static Guard shortLineGuard(List<Line> axisLines) {
        List<Line> guarded = new ArrayList<>();
        for (Line line : axisLines) {
            if (line.workflowLen() >= SHORT_LINE_MIN_LENGTH_PX) guarded.add(line);
        }
        if (hasEnoughClusterSupport(guarded)) return new Guard(guarded, true, false);
        return new Guard(axisLines, false, true);
    }

    public static boolean hasEnoughClusterSupport(List<Line> lines) {
        return countOrientationClusters(lines, true) >= 2 && countOrientationClusters(lines, false) >= 2;
    }

    public static int countOrientationClusters(List<Line> lines, boolean horizontal) {
        int count = 0;
        for (Line line : clusterLines(lines)) {
            if ((folded(line) <= 45.0) == horizontal) count++;
        }
        return count;
    }

    public static List<Line> clusterLines(List<Line> lines) {
        List<Line> horizontal = new ArrayList<>();
        List<Line> vertical = new ArrayList<>();
        for (Line line : lines) {
            if (folded(line) <= 45.0) horizontal.add(line);
            else vertical.add(line);
        }
        List<Line> out = new ArrayList<>(clusterOrientation(horizontal, true));
        out.addAll(clusterOrientation(vertical, false));
        return out;
    }

    private static double coord(Line line, boolean horizontal) {
        return horizontal ? line.centerY() : line.centerX();
    }

    private static List<Line> clusterOrientation(List<Line> lines, boolean horizontal) {
        List<Line> sorted = new ArrayList<>(lines);
        Collections.sort(sorted, (a, b) -> {
            double ca = coord(a, horizontal);
            double cb = coord(b, horizontal);
            return ca < cb ? -1 : ca > cb ? 1 : 0;
        });
        List<List<Line>> clusters = new ArrayList<>();
        for (Line line : sorted) {
            double c = coord(line, horizontal);
            double angle = line.angleDeg();
            boolean placed = false;
            for (List<Line> cluster : clusters) {
                double cCoord = 0.0;
                double cAngle = 0.0;
                for (Line l : cluster) {
                    cCoord += coord(l, horizontal);
                    cAngle += l.angleDeg();
                }
                cCoord /= cluster.size();
                cAngle /= cluster.size();
                if (Math.abs(c - cCoord) <= CLUSTER_DISTANCE_PX && Math.abs(angle - cAngle) <= CLUSTER_ANGLE_DEGREES) {
                    cluster.add(line);
                    placed = true;
                    break;
                }
            }
            if (!placed) {
                List<Line> cluster = new ArrayList<>();
                cluster.add(line);
                clusters.add(cluster);
            }
        }
        List<Line> out = new ArrayList<>();
        for (List<Line> cluster : clusters) {
            Line line = weightedLine(cluster);
            line.keyName = horizontal ? "y" : "x";
            line.keyValue = coord(line, horizontal);
            out.add(line);
        }
        return out;
    }

    private static Line weightedLine(List<Line> lines) {
        double weight = 0.0;
        double x1 = 0.0;
        double y1 = 0.0;
        double x2 = 0.0;
        double y2 = 0.0;
        double maxLength = 0.0;
        double support = 0.0;
        for (Line line : lines) {
            double len = Math.max(1.0, line.length());
            weight += len;
            x1 += line.x1 * len;
            y1 += line.y1 * len;
            x2 += line.x2 * len;
            y2 += line.y2 * len;
            maxLength = Math.max(maxLength, line.workflowLen());
            support += line.support * len;
        }
        double denom = Math.max(1.0, weight);
        Line out = new Line(x1 / denom, y1 / denom, x2 / denom, y2 / denom);
        out.workflowLength = maxLength;
        out.angle = 0.0;
        for (Line line : lines) {
            double len = Math.max(1.0, line.length());
            out.angle += line.angleDeg() * len / denom;
        }
        out.support = support / denom;
        out.count = lines.size();
        return out;
    }

    /** {x, y}, or null for parallel lines. */
    public static double[] lineIntersection(Line a, Line b) {
        double den = (a.x1 - a.x2) * (b.y1 - b.y2) - (a.y1 - a.y2) * (b.x1 - b.x2);
        if (Math.abs(den) < 1e-4) return null;
        double leftCross = a.x1 * a.y2 - a.y1 * a.x2;
        double rightCross = b.x1 * b.y2 - b.y1 * b.x2;
        return new double[]{(leftCross * (b.x1 - b.x2) - (a.x1 - a.x2) * rightCross) / den,
            (leftCross * (b.y1 - b.y2) - (a.y1 - a.y2) * rightCross) / den};
    }

    private static double dist(double[] a, double[] b) {
        return Math.hypot(a[0] - b[0], a[1] - b[1]);
    }

    public static double quadAspect(double[][] quad) {
        double width = Math.max(dist(quad[1], quad[0]), dist(quad[2], quad[3]));
        double height = Math.max(dist(quad[3], quad[0]), dist(quad[2], quad[1]));
        return width / Math.max(1.0, height);
    }

    public static double quadArea(double[][] quad) {
        double total = 0.0;
        for (int i = 0; i < 4; i++) {
            double[] a = quad[i];
            double[] b = quad[(i + 1) % 4];
            total += a[0] * b[1] - b[0] * a[1];
        }
        return total * 0.5;
    }

    /** The best card quad {tl, tr, br, bl} from the clustered lines, or null. */
    public static double[][] selectQuad(int maskW, int maskH, List<Line> clusters) {
        List<Line> hClusters = new ArrayList<>();
        List<Line> vClusters = new ArrayList<>();
        for (Line line : clusters) {
            if (folded(line) <= 45.0) {
                line.keyName = "y";
                line.keyValue = line.centerY();
                hClusters.add(line);
            } else {
                line.keyName = "x";
                line.keyValue = line.centerX();
                vClusters.add(line);
            }
        }
        if (hClusters.size() < 2 || vClusters.size() < 2) return null;
        java.util.Comparator<Line> byLenDesc = (a, b) -> {
            double la = a.workflowLen();
            double lb = b.workflowLen();
            return lb < la ? -1 : lb > la ? 1 : 0;
        };
        Collections.sort(hClusters, byLenDesc);
        Collections.sort(vClusters, byLenDesc);
        int hLimit = Math.min(14, hClusters.size());
        int vLimit = Math.min(12, vClusters.size());
        double h = maskH;
        double w = maskW;
        double expectedAspect = w / Math.max(1.0, h);
        double bestScore = Double.NEGATIVE_INFINITY;
        double[][] bestQuad = null;
        for (int hi = 0; hi < hLimit; hi++) {
            Line topA = hClusters.get(hi);
            for (int hj = hi + 1; hj < hLimit; hj++) {
                Line bottomA = hClusters.get(hj);
                Line top = topA.centerY() <= bottomA.centerY() ? topA : bottomA;
                Line bottom = top == topA ? bottomA : topA;
                if (Math.abs(bottom.centerY() - top.centerY()) < h * 0.16) continue;
                for (int vi = 0; vi < vLimit; vi++) {
                    Line leftA = vClusters.get(vi);
                    for (int vj = vi + 1; vj < vLimit; vj++) {
                        Line rightA = vClusters.get(vj);
                        Line left = leftA.centerX() <= rightA.centerX() ? leftA : rightA;
                        Line right = left == leftA ? rightA : leftA;
                        if (Math.abs(right.centerX() - left.centerX()) < w * 0.16) continue;
                        double[] tl = lineIntersection(top, left);
                        double[] tr = lineIntersection(top, right);
                        double[] br = lineIntersection(bottom, right);
                        double[] bl = lineIntersection(bottom, left);
                        if (tl == null || tr == null || br == null || bl == null) continue;
                        double[][] quad = {tl, tr, br, bl};
                        double aspect = quadAspect(quad);
                        if (aspect <= 0.0) continue;
                        double ratio = aspect / Math.max(0.001, expectedAspect);
                        if (ratio < 0.45 || ratio > 2.2) continue;
                        double lengthScore = Math.min(1.0, (0.5 * (top.workflowLen() + bottom.workflowLen())) / Math.max(1.0, w));
                        lengthScore += Math.min(1.0, (0.5 * (left.workflowLen() + right.workflowLen())) / Math.max(1.0, h));
                        double aspectScore = Math.max(0.0, 1.0 - Math.abs(Math.log(Math.max(0.05, ratio))) / Math.log(2.0));
                        double areaScore = Math.min(1.0, Math.abs(quadArea(quad)) / Math.max(1.0, w * h * 0.45));
                        double score = 1.5 * lengthScore + aspectScore + 0.7 * areaScore;
                        if (score > bestScore) {
                            bestScore = score;
                            bestQuad = quad;
                        }
                    }
                }
            }
        }
        return bestQuad;
    }

    /**
     * The ROI seed turned with the Select-a-Ghost panel, in ROI-crop coordinates, or null.
     * Detections: lap_index boxes {left, top, right, bottom} normalised (labels filtered by the caller).
     */
    public static Deskew ghostDetailDeskewSeed(List<double[]> lapIndex, int frameW, int frameH, double roiLeft,
                                               double roiTop, int cropW, int cropH) {
        if (frameW <= 0 || frameH <= 0) return null;
        List<double[]> boxes = new ArrayList<>();
        for (double[] d : lapIndex) {
            double w = (d[2] - d[0]) * frameW;
            if (w < 2.0) continue;
            boxes.add(new double[]{((d[0] + d[2]) / 2) * frameW, ((d[1] + d[3]) / 2) * frameH, w});
        }
        if (boxes.size() < 3) return null;
        double[] cxs = new double[boxes.size()];
        double[] ws = new double[boxes.size()];
        for (int i = 0; i < boxes.size(); i++) {
            cxs[i] = boxes.get(i)[0];
            ws[i] = boxes.get(i)[2];
        }
        Arrays.sort(cxs);
        Arrays.sort(ws);
        double medCx = cxs[cxs.length / 2];
        double medW = ws[ws.length / 2];
        List<double[]> column = new ArrayList<>();
        for (double[] b : boxes) {
            if (Math.abs(b[0] - medCx) < 1.5 * medW) column.add(b);
        }
        if (column.size() < 3) return null;
        double meanY = 0.0;
        double meanX = 0.0;
        for (double[] b : column) meanY += b[1];
        for (double[] b : column) meanX += b[0];
        meanY /= column.size();
        meanX /= column.size();
        double sxy = 0.0;
        double syy = 0.0;
        for (double[] b : column) {
            sxy += (b[1] - meanY) * (b[0] - meanX);
            syy += (b[1] - meanY) * (b[1] - meanY);
        }
        if (syy <= 0.0) return null;
        double k = sxy / syy;
        double residual = 0.0;
        for (double[] b : column) {
            double off = b[0] - (meanX + k * (b[1] - meanY));
            residual += off * off;
        }
        if (Math.sqrt(residual / column.size()) > 0.2 * medW) return null;
        double degrees = Math.atan(k) * 180.0 / Math.PI;
        if (Math.abs(degrees) < DESKEW_MIN_DEGREES || Math.abs(degrees) > DESKEW_MAX_DEGREES) return null;
        double n = Math.hypot(1.0, k);
        double ux = 1.0 / n;
        double uy = -k / n;
        double vx = k / n;
        double vy = 1.0 / n;
        double px = meanX - roiLeft;
        double py = meanY - roiTop;
        double[][] upright = {{0, 0}, {cropW - 1, 0}, {cropW - 1, cropH - 1}, {0, cropH - 1}};
        double[][] quad = new double[4][];
        for (int i = 0; i < 4; i++) {
            double dx = upright[i][0] - px;
            double dy = upright[i][1] - py;
            quad[i] = new double[]{px + dx * ux + dy * vx, py + dx * uy + dy * vy};
        }
        return new Deskew(quad, degrees);
    }
}
