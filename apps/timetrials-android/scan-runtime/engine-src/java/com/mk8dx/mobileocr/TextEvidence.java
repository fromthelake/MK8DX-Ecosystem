package com.mk8dx.mobileocr;

import android.graphics.Bitmap;

import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import org.opencv.android.Utils;
import org.opencv.core.Mat;
import org.opencv.core.Rect;
import org.opencv.imgproc.Imgproc;

import java.util.Locale;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Tekst-tweede-bewijs (port van server kart_config_text_ocr=v1 / naamstrip):
 * de kaartrijen tonen de part-NAMEN letterlijk; sterke rijtekst (fuzzy >= 0.85,
 * marge >= 0.08) wint van een onzeker icoon, en de naamstrip is autoritair voor
 * de speler-character. easyocr (server) -> ML Kit (gebundeld Latijns model, offline).
 */
public final class TextEvidence {

    public static final double FUZZY_MIN = 0.85;
    public static final double MARGIN_MIN = 0.08;

    public static final String[] SCRIPTS = {"latin", "ja", "zh", "ko"};

    private final Map<String, TextRecognizer> recognizers = new java.util.HashMap<>();

    private synchronized TextRecognizer recognizer(String script) {
        TextRecognizer cached = recognizers.get(script);
        if (cached != null) {
            return cached;
        }
        TextRecognizer created;
        if ("ja".equals(script)) {
            created = TextRecognition.getClient(new com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions.Builder().build());
        } else if ("zh".equals(script)) {
            created = TextRecognition.getClient(new com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions.Builder().build());
        } else if ("ko".equals(script)) {
            created = TextRecognition.getClient(new com.google.mlkit.vision.text.korean.KoreanTextRecognizerOptions.Builder().build());
        } else {
            created = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        }
        recognizers.put(script, created);
        return created;
    }

    /** OCR van één rij-crop (BGR-canoniek gebied) naar platte tekst; "" bij falen. */
    public String ocrRegion(Mat canonicalBgr, int x, int y, int w, int h) {
        return ocrRegion(canonicalBgr, x, y, w, h, "latin");
    }

    public String ocrRegion(Mat canonicalBgr, int x, int y, int w, int h, String script) {
        try {
            Bitmap bitmap = regionBitmap(canonicalBgr, x, y, w, h);
            if (bitmap == null) {
                return "";
            }
            Text result = Tasks.await(recognizer(script).process(InputImage.fromBitmap(bitmap, 0)), 3, TimeUnit.SECONDS);
            bitmap.recycle();
            return result == null ? "" : result.getText().replace("\n", " ").trim();
        } catch (Exception exc) {
            return "";
        }
    }

    /** 2x-opgeschaalde BGR-crop van de regio (null bij te klein). */
    private Mat regionScaled(Mat canonicalBgr, int x, int y, int w, int h) {
        int cx = Math.max(0, Math.min(canonicalBgr.cols() - 2, x));
        int cy = Math.max(0, Math.min(canonicalBgr.rows() - 2, y));
        int cw = Math.min(w, canonicalBgr.cols() - cx);
        int ch = Math.min(h, canonicalBgr.rows() - cy);
        if (cw < 12 || ch < 8) {
            return null;
        }
        Mat crop = new Mat(canonicalBgr, new Rect(cx, cy, cw, ch));
        // 2x opschalen helpt het Latijnse model op de kleine rijteksten
        Mat scaled = new Mat();
        Imgproc.resize(crop, scaled, new org.opencv.core.Size(cw * 2, ch * 2), 0, 0, Imgproc.INTER_CUBIC);
        crop.release();
        return scaled;
    }

    private static Bitmap bitmapFromBgr(Mat bgr) {
        Mat rgba = new Mat();
        Imgproc.cvtColor(bgr, rgba, Imgproc.COLOR_BGR2RGBA);
        Bitmap bitmap = Bitmap.createBitmap(rgba.cols(), rgba.rows(), Bitmap.Config.ARGB_8888);
        Utils.matToBitmap(rgba, bitmap);
        rgba.release();
        return bitmap;
    }

    private Bitmap regionBitmap(Mat canonicalBgr, int x, int y, int w, int h) {
        Mat scaled = regionScaled(canonicalBgr, x, y, w, h);
        if (scaled == null) {
            return null;
        }
        Bitmap bitmap = bitmapFromBgr(scaled);
        scaled.release();
        return bitmap;
    }

    // letters waarvan hoofdletter en kleine letter alleen in GROOTTE verschillen
    // (c/o/s/u/v/w/x/z + k) — precies daar gokt het model de case vaak fout
    private static final String CASE_AMBIGUOUS = "ckosuvwxz";
    // referentie-glyphs met betrouwbare kaphoogte: hoofdletters, cijfers en
    // stok-letters (b/d/f/h/k/l/t)
    private static final String TALL_REF = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789bdfhlt";
    // gemeten op echte frames: x-hoogte-letters <= 0.85, echte caps >= 0.93
    private static final double CASE_RATIO_MAX_LOWER = 0.90;
    // MK8-namen bevatten vaak ★; ML Kit gokt er een letter voor (k/K). Een
    // 5-punts-ster is exacte geometrie: IoU met sterpolygon 0.70 op echte
    // frames vs <= 0.47 voor alle echte letters
    private static final double STAR_IOU_MIN = 0.60;
    private static final String NARROW_CHARS = "iljI1!.,'";
    private static final String WIDE_CHARS = "mwMW";

    private static double charWeight(char c) {
        if (NARROW_CHARS.indexOf(c) >= 0) {
            return 0.5;
        }
        if (WIDE_CHARS.indexOf(c) >= 0) {
            return 1.25;
        }
        return 1.0;
    }

    /** Debug van de laatste ocrNameCaseAware-aanroep (raw -> corrected + ratio's). */
    public String lastNameDebug = "";
    /** Niet-leeg: schrijf naamstrip-crop + inktmask als PNG's naar deze map. */
    public String debugDumpDir = "";

    /** Naamstrip-OCR met case-correctie op glyph-hoogte: ML Kit gokt de case van
     *  grootte-only letterparen (w/W, s/S...) vaak fout. LET OP: de symbol-boxen
     *  van ML Kit hebben REGEL-uniforme hoogte (live gemeten: alle ratio's 1.00),
     *  dus de echte glyph-hoogte wordt uit de PIXELS gemeten (inkt-extent per
     *  symbool-kolombereik) — raw pixels for evidence. */
    public String ocrNameCaseAware(Mat canonicalBgr, int x, int y, int w, int h, String script) {
        lastNameDebug = "";
        Mat scaled = null;
        Mat ink = null;
        try {
            scaled = regionScaled(canonicalBgr, x, y, w, h);
            if (scaled == null) {
                return "";
            }
            Bitmap bitmap = bitmapFromBgr(scaled);
            Text result = Tasks.await(recognizer(script).process(InputImage.fromBitmap(bitmap, 0)), 3, TimeUnit.SECONDS);
            // ja-model als SYMBOOL-bewijs: het leest Switch-symbolen (★ e.d.)
            // letterlijk waar latin een letter gokt — maar de w/W-case doet het
            // net zo fout als latin (live gemeten: ja='BAWSer'), dus case blijft
            // uit de pixel-meting komen
            String jaText = "";
            if ("latin".equals(script)) {
                try {
                    Text jaResult = Tasks.await(recognizer("ja").process(InputImage.fromBitmap(bitmap, 0)), 5, TimeUnit.SECONDS);
                    jaText = jaResult == null ? "" : jaResult.getText().replace("\n", " ").trim();
                } catch (Exception ignored) {
                    jaText = "";
                }
            }
            bitmap.recycle();
            if (result == null) {
                return "";
            }
            String plain = result.getText().replace("\n", " ").trim();
            String probePrefix = jaText.isEmpty() ? "" : "ja='" + jaText + "' ";
            if (!"latin".equals(script) || plain.isEmpty()) {
                return plain;
            }
            // beste regel = meeste letters (de naamstrip is één regel)
            Text.Line bestLine = null;
            int bestLetters = -1;
            for (Text.TextBlock block : result.getTextBlocks()) {
                for (Text.Line line : block.getLines()) {
                    int letters = 0;
                    for (char c : line.getText().toCharArray()) {
                        if (Character.isLetter(c)) {
                            letters++;
                        }
                    }
                    if (letters > bestLetters) {
                        bestLetters = letters;
                        bestLine = line;
                    }
                }
            }
            if (bestLine == null) {
                return plain;
            }
            ink = inkMask(scaled);
            if (!debugDumpDir.isEmpty()) {
                org.opencv.imgcodecs.Imgcodecs.imwrite(debugDumpDir + "/name_strip.png", scaled);
                org.opencv.imgcodecs.Imgcodecs.imwrite(debugDumpDir + "/name_ink.png", ink);
            }
            String corrected = caseCorrectLine(bestLine, ink);
            if (corrected.isEmpty()) {
                String merged = mergeSymbolEvidence(plain, jaText);
                lastNameDebug = probePrefix + "raw='" + plain + "' -> '" + merged + "' (geen kaphoogte-referentie)";
                return merged;
            }
            String merged = mergeSymbolEvidence(corrected, jaText);
            lastNameDebug = probePrefix + "raw='" + bestLine.getText() + "' -> '" + merged + "'" + lastRatioDebug;
            return merged;
        } catch (Exception exc) {
            return "";
        } finally {
            if (scaled != null) {
                scaled.release();
            }
            if (ink != null) {
                ink.release();
            }
        }
    }

    private String lastRatioDebug = "";

    /** Merge: letters (mét pixel-case) uit de latin-lezing, symbolen (★ e.d.)
     *  uit de ja-lezing — alleen als beide hetzelfde letter-skelet zien.
     *  Switch-namen kunnen symbolen bevatten (symbool-toetsenbord: ★☆♡♥♪
     *  pijlen/Grieks); het latin-model gokt daar een letter voor. */
    private static String mergeSymbolEvidence(String latinText, String jaText) {
        if (jaText == null || jaText.isEmpty() || latinText == null || latinText.isEmpty()) {
            return latinText == null ? "" : latinText;
        }
        boolean jaHasSymbol = false;
        for (char c : jaText.toCharArray()) {
            if (!Character.isLetterOrDigit(c) && !Character.isWhitespace(c)) {
                jaHasSymbol = true;
                break;
            }
        }
        if (!jaHasSymbol) {
            return latinText;
        }
        // alignment: alnum-tekens moeten (case-ongevoelig) matchen; een
        // ja-symbool mag daarbij één latin-letter VERVANGEN (het latin-model
        // hallucineert een letter voor de glyph, bv. ★ -> 'k'); de case van
        // de letters komt uit de latin-lezing (pixel-gecorrigeerd)
        char[] latinAlnum = alnumSkeleton(latinText).toCharArray();
        String jaAlnum = alnumSkeleton(jaText);
        int li = 0;
        int jaRemaining = jaAlnum.length();
        StringBuilder out = new StringBuilder();
        for (char c : jaText.toCharArray()) {
            if (Character.isLetterOrDigit(c)) {
                if (li >= latinAlnum.length
                        || Character.toLowerCase(latinAlnum[li]) != Character.toLowerCase(c)) {
                    return latinText; // lezingen verschillen echt -> latin houden
                }
                out.append(latinAlnum[li]);
                li++;
                jaRemaining--;
            } else if (Character.isWhitespace(c)) {
                out.append(c);
            } else {
                out.append(c);
                // surplus-letter in latin = de hallucinatie voor dit symbool
                if (latinAlnum.length - li > jaRemaining) {
                    li++;
                }
            }
        }
        if (li != latinAlnum.length) {
            return latinText;
        }
        return out.toString().trim();
    }

    private static String alnumSkeleton(String text) {
        StringBuilder sb = new StringBuilder();
        for (char c : text.toCharArray()) {
            if (Character.isLetterOrDigit(c)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** Binaire inkt-mask van de strip (tekst = 255): Otsu, polariteit zo dat
     *  inkt de minderheid is (witte naam op donkere ghost-strip of andersom). */
    private static Mat inkMask(Mat bgr) {
        Mat gray = new Mat();
        Imgproc.cvtColor(bgr, gray, Imgproc.COLOR_BGR2GRAY);
        Mat bin = new Mat();
        Imgproc.threshold(gray, bin, 0, 255, Imgproc.THRESH_BINARY + Imgproc.THRESH_OTSU);
        gray.release();
        if (org.opencv.core.Core.countNonZero(bin) > bin.rows() * bin.cols() / 2) {
            org.opencv.core.Core.bitwise_not(bin, bin);
        }
        return bin;
    }

    /** Case-correctie per letter op gemeten inkt-hoogte; "" bij te weinig
     *  referentie. Het KOLOMPROFIEL is autoritair voor de lettergrenzen: ML
     *  Kit-symboolboxen bleken op de kleine strip een halve letter verschoven
     *  (W-box over w+S), alleen de element-box (band + ruwe x-range) is
     *  betrouwbaar genoeg om te gebruiken. */
    private static final class CellStats {
        int[] heights;
        double[] starIou;
    }

    private String caseCorrectLine(Text.Line line, Mat ink) {
        java.util.List<String> texts = new java.util.ArrayList<>();
        java.util.List<CellStats> cellStats = new java.util.ArrayList<>();
        java.util.List<Integer> tall = new java.util.ArrayList<>();
        for (Text.Element element : line.getElements()) {
            String text = element.getText();
            android.graphics.Rect ebox = element.getBoundingBox();
            CellStats stats = (ebox == null || text.isEmpty()) ? null : measureCells(ink, ebox, text);
            texts.add(text);
            cellStats.add(stats);
            if (stats != null) {
                for (int i = 0; i < text.length(); i++) {
                    // ster-achtige glyphs niet als kaphoogte-referentie gebruiken
                    if (stats.heights[i] > 0 && stats.starIou[i] < STAR_IOU_MIN
                            && TALL_REF.indexOf(text.charAt(i)) >= 0) {
                        tall.add(stats.heights[i]);
                    }
                }
            }
        }
        if (tall.size() < 2) {
            return "";
        }
        java.util.Collections.sort(tall);
        double capHeight = tall.get(tall.size() / 2);
        if (capHeight < 8) {
            return "";
        }
        StringBuilder out = new StringBuilder();
        StringBuilder ratios = new StringBuilder();
        for (int e = 0; e < texts.size(); e++) {
            if (e > 0) {
                out.append(' ');
            }
            String text = texts.get(e);
            CellStats stats = cellStats.get(e);
            for (int i = 0; i < text.length(); i++) {
                char c = text.charAt(i);
                int ih = stats == null ? -1 : stats.heights[i];
                double star = stats == null ? 0.0 : stats.starIou[i];
                if (ih > 0 && star >= STAR_IOU_MIN && ih >= 0.95 * capHeight) {
                    ratios.append(String.format(Locale.US, " %c=star%.2f->★", c, star));
                    out.append('★');
                } else if (ih > 0 && CASE_AMBIGUOUS.indexOf(Character.toLowerCase(c)) >= 0) {
                    double ratio = ih / capHeight;
                    char corrected = ratio < CASE_RATIO_MAX_LOWER
                            ? Character.toLowerCase(c)
                            : Character.toUpperCase(c);
                    ratios.append(String.format(Locale.US, " %c=%.2f->%c", c, ratio, corrected));
                    out.append(corrected);
                } else {
                    out.append(c);
                }
            }
        }
        lastRatioDebug = ratios.length() == 0 ? "" : " | capH=" + (int) capHeight + " ratios:" + ratios;
        return out.toString().trim();
    }

    /** Celgrenzen + inkt-hoogte + ster-IoU per letter binnen de regelband.
     *  Grenzen: nul-gat-segmentatie is autoritair (segmenten == letters ->
     *  exacte cellen; lost brede ster + smalle i/l op); bij camera-bloom
     *  (letters aan elkaar geplakt) valt het terug op breedte-gewogen
     *  verdeling met dal-snap. Per cel: centrale 50% kolommen + dekkingseis
     *  (bloom-bruggen raken alleen randkolommen). Laptop-gevalideerd op echte
     *  device-masks: BAwSer w=0.78; Nin★Alice ster-IoU=0.70, c=0.85. */
    private static CellStats measureCells(Mat ink, android.graphics.Rect ebox, String text) {
        int n = text.length();
        int band0 = Math.max(0, ebox.top - 2);
        int band1 = Math.min(ink.rows(), ebox.bottom + 2);
        if (band1 - band0 < 8) {
            return null;
        }
        int ew = Math.max(1, ebox.right - ebox.left);
        int x0 = Math.max(0, ebox.left - (int) Math.round(0.2 * ew));
        int x1 = Math.min(ink.cols(), ebox.right + (int) Math.round(0.2 * ew));
        if (x1 - x0 < n * 4) {
            return null;
        }
        int[] col = new int[x1 - x0];
        for (int x = x0; x < x1; x++) {
            Mat colSlice = ink.submat(band0, band1, x, x + 1);
            col[x - x0] = org.opencv.core.Core.countNonZero(colSlice);
            colSlice.release();
        }
        // nul-gat-segmenten (glyph-runs)
        java.util.List<int[]> segs = new java.util.ArrayList<>();
        int runStart = -1;
        int runInk = 0;
        for (int i = 0; i <= col.length; i++) {
            boolean on = i < col.length && col[i] >= 1;
            if (on && runStart < 0) {
                runStart = i;
                runInk = 0;
            }
            if (on) {
                runInk += col[i];
            }
            if (!on && runStart >= 0) {
                if (i - runStart >= 3 && runInk >= 20) {
                    segs.add(new int[]{runStart, i});
                }
                runStart = -1;
            }
        }
        int[] bounds = new int[n + 1];
        if (segs.size() == n) {
            // exact: celgrens = midden van elk nul-gat
            bounds[0] = segs.get(0)[0];
            bounds[n] = segs.get(n - 1)[1];
            for (int i = 1; i < n; i++) {
                bounds[i] = (segs.get(i - 1)[1] + segs.get(i)[0]) / 2;
            }
        } else {
            int s0 = -1;
            int s1 = -1;
            for (int i = 0; i < col.length; i++) {
                if (col[i] >= 2) {
                    if (s0 < 0) {
                        s0 = i;
                    }
                    s1 = i + 1;
                }
            }
            if (s0 < 0 || s1 - s0 < n * 4) {
                return null;
            }
            double total = 0.0;
            for (int i = 0; i < n; i++) {
                total += charWeight(text.charAt(i));
            }
            int span = s1 - s0;
            bounds[0] = s0;
            bounds[n] = s1;
            double acc = 0.0;
            for (int i = 1; i < n; i++) {
                acc += charWeight(text.charAt(i - 1));
                int expected = s0 + (int) Math.round(span * acc / total);
                double cellLocal = span * charWeight(text.charAt(i - 1)) / total;
                int lo = Math.max(bounds[i - 1] + 2, expected - (int) Math.round(cellLocal * 0.4));
                int hi = Math.min(s1 - 1, expected + (int) Math.round(cellLocal * 0.4));
                int best = Math.min(lo, hi);
                for (int x = best; x <= hi; x++) {
                    if (col[x] < col[best]) {
                        best = x;
                    }
                }
                bounds[i] = best;
            }
        }
        CellStats stats = new CellStats();
        stats.heights = new int[n];
        stats.starIou = new double[n];
        for (int i = 0; i < n; i++) {
            int l = bounds[i];
            int r = Math.max(l + 1, bounds[i + 1]);
            int w = r - l;
            int l2 = l + (int) Math.round(0.25 * w);
            int r2 = r - (int) Math.round(0.25 * w);
            if (r2 <= l2) {
                l2 = l;
                r2 = r;
            }
            int need = Math.max(2, (int) Math.round((r2 - l2) * 0.2));
            int top = -1;
            int bottom = -1;
            for (int y = band0; y < band1; y++) {
                Mat row = ink.submat(y, y + 1, x0 + l2, x0 + r2);
                int count = org.opencv.core.Core.countNonZero(row);
                row.release();
                if (count >= need) {
                    if (top < 0) {
                        top = y;
                    }
                    bottom = y;
                }
            }
            stats.heights[i] = top < 0 ? -1 : bottom - top + 1;
            stats.starIou[i] = glyphStarIou(ink, band0, band1, x0 + l, x0 + r);
        }
        return stats;
    }

    /** IoU van de glyph-inkt (bbox binnen de cel) met een 5-punts-sterpolygon. */
    private static double glyphStarIou(Mat ink, int band0, int band1, int cellL, int cellR) {
        Mat cell = ink.submat(band0, band1, Math.max(0, cellL), Math.min(ink.cols(), Math.max(cellL + 1, cellR)));
        try {
            if (org.opencv.core.Core.countNonZero(cell) < 30) {
                return 0.0;
            }
            int gy0 = -1;
            int gy1 = -1;
            for (int y = 0; y < cell.rows(); y++) {
                Mat row = cell.submat(y, y + 1, 0, cell.cols());
                boolean any = org.opencv.core.Core.countNonZero(row) > 0;
                row.release();
                if (any) {
                    if (gy0 < 0) {
                        gy0 = y;
                    }
                    gy1 = y + 1;
                }
            }
            int gx0 = -1;
            int gx1 = -1;
            for (int x = 0; x < cell.cols(); x++) {
                Mat colSlice = cell.submat(0, cell.rows(), x, x + 1);
                boolean any = org.opencv.core.Core.countNonZero(colSlice) > 0;
                colSlice.release();
                if (any) {
                    if (gx0 < 0) {
                        gx0 = x;
                    }
                    gx1 = x + 1;
                }
            }
            if (gy0 < 0 || gx0 < 0 || gy1 - gy0 < 8 || gx1 - gx0 < 8) {
                return 0.0;
            }
            Mat glyph = cell.submat(gy0, gy1, gx0, gx1);
            int w = glyph.cols();
            int h = glyph.rows();
            Mat tpl = Mat.zeros(h, w, org.opencv.core.CvType.CV_8UC1);
            org.opencv.core.Point[] pts = new org.opencv.core.Point[10];
            for (int i = 0; i < 10; i++) {
                double ang = -Math.PI / 2 + i * Math.PI / 5;
                double radius = (i % 2 == 0) ? 1.0 : 0.42;
                pts[i] = new org.opencv.core.Point(
                        w / 2.0 + radius * (w / 2.0) * Math.cos(ang),
                        h / 2.0 + radius * (h / 2.0) * Math.sin(ang));
            }
            Imgproc.fillPoly(tpl, java.util.Collections.singletonList(new org.opencv.core.MatOfPoint(pts)),
                    new org.opencv.core.Scalar(255));
            Mat and = new Mat();
            Mat or = new Mat();
            org.opencv.core.Core.bitwise_and(glyph, tpl, and);
            org.opencv.core.Core.bitwise_or(glyph, tpl, or);
            double iou = org.opencv.core.Core.countNonZero(and)
                    / (double) Math.max(1, org.opencv.core.Core.countNonZero(or));
            glyph.release();
            tpl.release();
            and.release();
            or.release();
            return iou;
        } finally {
            cell.release();
        }
    }

    /** Beste vocab-match: [0]=id/sleutel, via out-params score/marge. */
    public static class VocabMatch {
        public String id = null;
        public String name = "";
        public double fuzzy = 0.0;
        public double margin = 0.0;

        public boolean strong() {
            if (id == null) {
                return false;
            }
            // randgeval: één OCR-fout in een kort woord ("Wormal"->Normal, 0.83)
            // valt nét onder 0.85 terwijl de marge enorm is — bij een ruime
            // andersnamige marge is de lagere fuzzy alsnog eenduidig
            return (fuzzy >= FUZZY_MIN && margin >= MARGIN_MIN)
                    || (fuzzy >= 0.78 && margin >= 0.25);
        }
    }

    /**
     * MK8DX ecosystem overlay: the central name matcher (packages/icon-matcher NameMatch, the same
     * rules as the Web scanner and Python; CENTRAL_RECOGNITION section 8.6 phase 3).
     */
    public static VocabMatch matchVocab(String ocrText, Map<String, String> vocab) {
        VocabMatch out = new VocabMatch();
        if (vocab == null) {
            return out;
        }
        nl.mariokart8.iconmatcher.NameMatch shared = nl.mariokart8.iconmatcher.NameMatch.match(ocrText,
                new java.util.ArrayList<>(vocab.entrySet()));
        if (shared.key != null) {
            out.id = shared.key;
            out.name = shared.name;
        }
        out.fuzzy = shared.fuzzy;
        out.margin = shared.margin;
        return out;
    }

    private static String normalize(String text) {
        if (text == null) {
            return "";
        }
        StringBuilder sb = new StringBuilder();
        for (char c : text.toLowerCase(Locale.ROOT).toCharArray()) {
            if (Character.isLetterOrDigit(c)) {
                sb.append(c);
            }
        }
        return sb.toString();
    }

    /** 1 - levenshtein/maxlen. */
    private static double similarity(String a, String b) {
        if (a.isEmpty() || b.isEmpty()) {
            return 0.0;
        }
        int[] prev = new int[b.length() + 1];
        int[] cur = new int[b.length() + 1];
        for (int j = 0; j <= b.length(); j++) {
            prev[j] = j;
        }
        for (int i = 1; i <= a.length(); i++) {
            cur[0] = i;
            for (int j = 1; j <= b.length(); j++) {
                int cost = a.charAt(i - 1) == b.charAt(j - 1) ? 0 : 1;
                cur[j] = Math.min(Math.min(cur[j - 1] + 1, prev[j] + 1), prev[j - 1] + cost);
            }
            int[] tmp = prev;
            prev = cur;
            cur = tmp;
        }
        return 1.0 - prev[b.length()] / (double) Math.max(a.length(), b.length());
    }
}
