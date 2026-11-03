package com.mk8dx.mobileocr;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import org.json.JSONArray;
import org.json.JSONObject;
import org.opencv.android.Utils;
import org.opencv.core.Core;
import org.opencv.core.CvType;
import org.opencv.core.Mat;
import org.opencv.core.MatOfDouble;
import org.opencv.core.Rect;
import org.opencv.imgproc.Imgproc;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Fase-1-port van de server-identiteitsmatcher (workflow_lab _match_icon/_match_flag,
 * v1-icon-grid-pad): character/kart/wheel/glider via alpha-gemaskeerde 3-kanaals-NCC
 * (gain/offset-invariant — de ghost-kaart dimt zijn iconen) met geërodeerd masker en
 * ±zoekmarge (icon-grid heeft ~1-2% spreiding + canonieke-align-residu), vlag via
 * patroon-eerst gray-NCC met gedeelde positie + kleurzweem-tiebreak.
 *
 * NIET geport (fase 2+): deploy-registratie, tekst-OCR-tweede-bewijs, kleurvariant-
 * refinement, naamstrip. Guards die wél meekomen: contrastpoort (icoon std<21.5,
 * vlag std<20 op de uitgelijnde slot-crop), patroon-gate 0.55, shortlist-tiebreak.
 */
public final class KartConfigMatcher {

    private static final String ASSET_ROOT = "kart_config";
    private static final int SEARCH_PAD_PX = 10;
    // Whether a slot holds a picture is the central slot-presence decision (SlotPresence, source
    // "photo": grey-value standard deviation); this engine measures the slot.
    private static final double FLAG_POS_PENALTY = 0.010;
    private static final double ICON_SCORE_MIN = 0.62;
    private static final double ICON_MARGIN_MIN = 0.02;
    private static final double WHEEL_SCORE_MIN = 0.35;
    /** Pseudo-racekeys voor het Select-a-Ghost detailpaneel (één rijder): 3- en 7-laps. */
    public static final String RACE_KEY_GHOST_DETAIL = "ghost_detail";
    public static final String RACE_KEY_GHOST_DETAIL7 = "ghost_detail7";

    /** (icoonvak-naam, asset-map, uitvoer-key) — zelfde mapping als de server. */
    private static final String[][] KINDS = {
            {"character_icon", "character", "character"},
            {"kart_icon", "body", "kart"},
            {"wheel_icon", "tire", "wheel"},
            {"glider_icon", "glider", "glider"},
            {"flag_icon", "mk8_flags", "flag"},
    };

    private static KartConfigMatcher instance;

    public static synchronized KartConfigMatcher get(Context context) throws Exception {
        if (instance == null) {
            instance = new KartConfigMatcher(context.getApplicationContext());
        }
        return instance;
    }

    private final Context context;
    /** The pack's Time Trial frame geometry (frame-definitions-v1.json; central FrameGeometry, phase 5). */
    private final nl.mariokart8.iconmatcher.FrameGeometry geometry;
    private final JSONObject names;
    private final CleanAssetsMatcher cleanAssets;
    private final TextEvidence textEvidence = new TextEvidence();

    public CleanAssetsMatcher cleanAssets() {
        return cleanAssets;
    }
    private final Map<String, List<IconAsset>> assetCache = new HashMap<>();
    private final Map<String, List<SizedIcon>> sizedIconCache = new HashMap<>();
    private final Map<String, List<FlagTemplate>> flagCache = new HashMap<>();
    // deploy-registratie (server grid_mode=deploy_registered, taak #17)
    private final Map<String, Mat> regTemplateCache = new HashMap<>();

    private KartConfigMatcher(Context context) throws Exception {
        this.context = context;
        // The staging checked that the frame definitions describe exactly the icon_grid.json,
        // reg.json and time grids staged beside them.
        this.geometry = new nl.mariokart8.iconmatcher.FrameGeometry(
                new JSONObject(readAssetText(ASSET_ROOT + "/frame-definitions-v1.json")));
        this.names = new JSONObject(readAssetText(ASSET_ROOT + "/names.json"));
        this.cleanAssets = new CleanAssetsMatcher(context);
        // The last console language read with confidence breaks ties in the locale vote (phase 3).
        String remembered = context.getSharedPreferences(LOCALE_PREFS, Context.MODE_PRIVATE).getString(LOCALE_KEY, null);
        if (remembered != null && !remembered.isEmpty()) preferredLocales.add(remembered);
    }

    private String readAssetText(String path) throws Exception {
        InputStream in = context.getAssets().open(path);
        try {
            byte[] buffer = new byte[in.available()];
            int off = 0;
            int read;
            while (off < buffer.length && (read = in.read(buffer, off, buffer.length - off)) > 0) {
                off += read;
            }
            return new String(buffer, 0, off, StandardCharsets.UTF_8);
        } finally {
            in.close();
        }
    }

    // ------------------------------------------------------------------
    // Deploy-registratie — port van cam.register_card/deploy_slot_boxes:
    // per-kaart 2D-registratie via edge-magnitude-NCC op de kaarttemplates
    // (grof op halve resolutie met kleine sx/sy-sweep, dan full-res-verfijning)
    // + deploy-anker-slotboxen. Dicht het gemeten dy-gat (med -8..+3, p90 27px)
    // van de lap-index-anchor-route.
    // ------------------------------------------------------------------

    private synchronized Mat cardTemplate(String owner, String laps) {
        String key = owner + "_" + laps;
        if (!regTemplateCache.containsKey(key)) {
            Mat tmpl = null;
            try {
                InputStream in = context.getAssets().open("clean_assets/reg/" + key + ".png");
                Bitmap bmp;
                try {
                    bmp = BitmapFactory.decodeStream(in);
                } finally {
                    in.close();
                }
                if (bmp != null) {
                    Mat rgba = new Mat();
                    Utils.bitmapToMat(bmp, rgba);
                    bmp.recycle();
                    Mat gray = new Mat();
                    Imgproc.cvtColor(rgba, gray, Imgproc.COLOR_RGBA2GRAY);
                    rgba.release();
                    tmpl = new Mat();
                    gray.convertTo(tmpl, CvType.CV_32F);
                    gray.release();
                }
            } catch (Exception ignored) {
                tmpl = null;
            }
            regTemplateCache.put(key, tmpl);
        }
        return regTemplateCache.get(key);
    }

    private static Mat edgeMagnitude(Mat grayF32) {
        Mat gx = new Mat();
        Mat gy = new Mat();
        Imgproc.Sobel(grayF32, gx, CvType.CV_32F, 1, 0, 3);
        Imgproc.Sobel(grayF32, gy, CvType.CV_32F, 0, 1, 3);
        Mat mag = new Mat();
        Core.magnitude(gx, gy, mag);
        gx.release();
        gy.release();
        return mag;
    }

    /** -> {dx, dy, sx, sy, score, fallback(0/1)} of null als er geen template is. */
    // MK8DX ecosystem overlay (CENTRAL_RECOGNITION section 8.6, phase 5): the decision (scale grid,
    // score, refinement) is central (FrameGeometry.registerCard, the same specification as the Web
    // scanner and Python); the edge map and the template match stay this engine's pixel work.
    private double[] registerCard(Mat canonical, double px1, double py1, double pw, double ph, String templateOwner, String laps) {
        Mat templ = cardTemplate(templateOwner, laps);
        if (templ == null) {
            return null;
        }
        nl.mariokart8.iconmatcher.FrameGeometry.Panel panel =
                new nl.mariokart8.iconmatcher.FrameGeometry.Panel(px1, py1, pw, ph, "static_canonical");
        int[] window = geometry.registerWindow(panel, canonical.cols(), canonical.rows());
        CardEdges edges = new CardEdges(canonical, window, templ);
        try {
            return geometry.registerCard(panel, window, edges);
        } finally {
            edges.release();
        }
    }

    /** The registration's pixel work: the edge map of the window (built on first use) and the template match. */
    private final class CardEdges implements nl.mariokart8.iconmatcher.FrameGeometry.RegisterMatcher {
        private final Mat canonical;
        private final int[] window;
        private final Mat templ;
        private Mat edgesFull;
        private Mat region;

        CardEdges(Mat canonical, int[] window, Mat templ) {
            this.canonical = canonical;
            this.window = window;
            this.templ = templ;
        }

        private void build() {
            if (edgesFull != null) {
                return;
            }
            Mat crop = new Mat(canonical, new Rect(window[0], window[1], window[2] - window[0], window[3] - window[1]));
            Mat gray8 = new Mat();
            Imgproc.cvtColor(crop, gray8, Imgproc.COLOR_BGR2GRAY);
            Mat grayF = new Mat();
            gray8.convertTo(grayF, CvType.CV_32F);
            gray8.release();
            edgesFull = edgeMagnitude(grayF);
            grayF.release();
            int[] size = geometry.registerCoarseSize(window);
            region = new Mat();
            Imgproc.resize(edgesFull, region, new org.opencv.core.Size(size[0], size[1]), 0, 0, Imgproc.INTER_AREA);
        }

        private double[] match(Mat image, int tw, int th, int interpolation) {
            Mat t = new Mat();
            Imgproc.resize(templ, t, new org.opencv.core.Size(tw, th), 0, 0, interpolation);
            Mat res = new Mat();
            Imgproc.matchTemplate(image, t, res, Imgproc.TM_CCOEFF_NORMED);
            Core.MinMaxLocResult mm = Core.minMaxLoc(res);
            t.release();
            res.release();
            return new double[]{mm.maxVal, mm.maxLoc.x, mm.maxLoc.y};
        }

        @Override
        public double[] coarse(int tw, int th) {
            build();
            return match(region, tw, th, Imgproc.INTER_AREA);
        }

        @Override
        public double[] fine(int x1, int y1, int x2, int y2, int tw, int th) {
            build();
            Mat win = new Mat(edgesFull, new Rect(x1, y1, x2 - x1, y2 - y1));
            return match(win, tw, th, Imgproc.INTER_LINEAR);
        }

        void release() {
            if (edgesFull != null) {
                edgesFull.release();
                region.release();
            }
        }
    }

    private static final Map<String, String> REG_GROUP = new HashMap<>();
    static {
        REG_GROUP.put("character_icon", "characters");
        REG_GROUP.put("kart_icon", "bodies");
        REG_GROUP.put("wheel_icon", "tires");
        REG_GROUP.put("glider_icon", "gliders");
        REG_GROUP.put("flag_icon", "flags");
    }

    /** Deploy-iconbox (x,y,w,h) in kaartpixels voor dit kind, of null. */
    /** The printed-name strip right of a slot (central FrameGeometry.textStrip). */
    private int[] textStrip(JSONArray slot, int right) throws Exception {
        return geometry.textStrip(new int[]{slot.getInt(0), slot.getInt(1), slot.getInt(2), slot.getInt(3)}, right);
    }

    private double[] deployBox(String iconKind, String laps, double cw, double ch) {
        return geometry.deployBox(iconKind, laps, cw, ch);
    }

    // ------------------------------------------------------------------
    // Publieke ingang: match alle 5 kinds voor één fysieke kaart-regio,
    // servergetrouw: character/kart/glider via de clean-assets-matcher
    // (character eerst — die bepaalt de kleurset van kart/glider), wheel via
    // de v1-tire-matcher, vlag via de patroon-eerst-vlagmatcher.
    // canonical = BGR-canoniek beeld (1280x720-ruimte), physOwner = fysieke
    // regio ("player"=onder, "ghost"=boven), raceKey = race3|race7.
    // anchorXY = per-frame owner-anker (mean center gedetecteerde lap-indexen);
    // null => statische canonieke panel-box (align-residu blijft dan staan).
    // ------------------------------------------------------------------
    public JSONObject matchCard(Mat canonical, String physOwner, String raceKey, double[] anchorXY) throws Exception {
        return matchCard(canonical, physOwner, raceKey, anchorXY, null);
    }

    /** Als cropDir != null worden per kind de slot-crops als PNG bewaard (voor de resultaat-UI). */
    public JSONObject matchCard(Mat canonical, String physOwner, String raceKey, double[] anchorXY, java.io.File cropDir) throws Exception {
        return matchCard(canonical, physOwner, raceKey, anchorXY, cropDir, false, null);
    }

    /** yellowCard = deze fysieke regio is de GELE spelerkaart (naamstrip toont de characternaam).
     *  localeSlot = gedeeld {script, locale} over beide kaarten (één taal per frame, server-principe):
     *  de gele kaart bepaalt hem, de ghostkaart erft hem (gedimde rijen kiezen anders een eigen taal). */
    /** Languages that break a tie in the locale vote, most preferred first (a remembered console language). */
    public java.util.List<String> preferredLocales = new java.util.ArrayList<>();
    private static final String LOCALE_PREFS = "mk8dx_scan_locale";
    private static final String LOCALE_KEY = "console_locale";

    /** Remember a console language read with confidence; it only breaks ties in later votes, so a
     *  friend's console in another language still reads as that language. */
    private void rememberLocale(String locale) {
        if (locale == null || locale.isEmpty() || (preferredLocales.size() == 1 && locale.equals(preferredLocales.get(0)))) return;
        preferredLocales.clear();
        preferredLocales.add(locale);
        context.getSharedPreferences(LOCALE_PREFS, Context.MODE_PRIVATE).edit().putString(LOCALE_KEY, locale).apply();
    }

    public JSONObject matchCard(Mat canonical, String physOwner, String raceKey, double[] anchorXY, java.io.File cropDir, boolean yellowCard, String[] localeSlot) throws Exception {
        // ghost_detail (Select-a-Ghost detailpaneel): eigen panel/slot-sectie in
        // icon_grid.json; geen deploy-registratie (die templates zijn kaart-
        // specifiek) dus de v1-slotroute geldt altijd. Zie docs/scanner-layouts.md.
        boolean ghostDetail = RACE_KEY_GHOST_DETAIL.equals(raceKey) || RACE_KEY_GHOST_DETAIL7.equals(raceKey);
        String race = ghostDetail ? raceKey : ("race7".equals(raceKey) ? "race7" : "race3");
        String laps = ghostDetail ? raceKey : ("race7".equals(race) ? "7laps" : "3laps");
        JSONObject out = new JSONObject();
        double px1;
        double py1;
        double pw;
        double ph;
        // The card: from the lap-index anchor, else the static panel (central FrameGeometry).
        nl.mariokart8.iconmatcher.FrameGeometry.Panel panel = geometry.panelBox(raceKey, physOwner, anchorXY);
        if (panel == null) {
            return out.put("status", "no_panel_for_" + race + "_" + physOwner);
        }
        px1 = panel.x;
        py1 = panel.y;
        pw = panel.w;
        ph = panel.h;
        out.put("panel_source", panel.source);
        // deploy-registratie: per-kaart dx/dy/sx/sy op edge-NCC — template
        // volgt de LOGISCHE kaart (geel=speler, ook in de ghost-regio bij swap)
        double[] reg = ghostDetail ? null : registerCard(canonical, px1, py1, pw, ph, yellowCard ? "player" : "ghost", laps);
        boolean registered = reg != null && reg[5] == 0.0;
        if (reg != null) {
            out.put("grid", new JSONObject()
                    .put("mode", registered ? "deploy_registered" : "v1_fallback")
                    .put("dx", Math.round(reg[0] * 10.0) / 10.0)
                    .put("dy", Math.round(reg[1] * 10.0) / 10.0)
                    .put("sx", reg[2]).put("sy", reg[3])
                    .put("score", Math.round(reg[4] * 1000.0) / 1000.0));
        }
        String charId = null;
        for (String[] kindRow : KINDS) {
            String iconKind = kindRow[0];
            String assetDir = kindRow[1];
            String outKey = kindRow[2];
            int[] box = geometry.slotBox(physOwner, iconKind, laps, panel,
                    registered ? new double[]{reg[0], reg[1], reg[2], reg[3]} : null);
            if (box == null) {
                continue;
            }
            int x1 = box[0];
            int y1 = box[1];
            int slotW = box[2];
            int slotH = box[3];
            // vlag: klein venster — driekleuren aliassen één band verschoven
            // (NL wit-blauw + rode TV-kaart eronder = letterlijk Rusland op
            // dy>=+7; registratie plaatst sloten op p90 3-5px, dus pad 5 volstaat)
            int[] searchWindow = geometry.searchWindow(iconKind, box, canonical.cols(), canonical.rows());
            int wx1 = searchWindow[0];
            int wy1 = searchWindow[1];
            int wx2 = searchWindow[2];
            int wy2 = searchWindow[3];
            if (wx2 - wx1 < 8 || wy2 - wy1 < 8 || slotW < 8 || slotH < 8) {
                out.put(outKey, new JSONObject().put("ok", false).put("reason", "slot_outside_canonical"));
                continue;
            }
            JSONObject result;
            if ("flag_icon".equals(iconKind)) {
                Mat window = new Mat(canonical, new Rect(wx1, wy1, wx2 - wx1, wy2 - wy1)).clone();
                try {
                    result = matchFlag(window, assetDir, slotW, slotH);
                } finally {
                    window.release();
                }
                result.put("name", displayName(assetDir, result.isNull("index") ? null : result.getInt("index")));
            } else if ("wheel_icon".equals(iconKind)) {
                Mat window = new Mat(canonical, new Rect(wx1, wy1, wx2 - wx1, wy2 - wy1)).clone();
                try {
                    result = matchIconWindowed(window, assetDir, slotW, slotH, true);
                } finally {
                    window.release();
                }
                result.put("name", displayName(assetDir, result.isNull("index") ? null : result.getInt("index")));
            } else {
                // clean-assets-route (server: score_min 0.62, marge op de
                // familie-EXTERNE marge; character krijgt ±10 zoek en bepaalt
                // de kleurset van kart/glider met zekerheid)
                String group = "character_icon".equals(iconKind) ? "characters"
                        : ("kart_icon".equals(iconKind) ? "bodies" : "gliders");
                Set<String> subset = null;
                if (("bodies".equals(group) || "gliders".equals(group)) && charId != null) {
                    List<String> subsetList = cleanAssets.partsSubsetForCharacter(charId, group);
                    if (subsetList != null) {
                        subset = new java.util.HashSet<>(subsetList);
                    }
                }
                // contrastpoort (zelfde klasse/drempel als de server, vóór de match)
                Mat slotCrop = new Mat(canonical, new Rect(
                        Math.max(0, Math.min(canonical.cols() - 1, x1)),
                        Math.max(0, Math.min(canonical.rows() - 1, y1)),
                        Math.min(slotW, canonical.cols() - Math.max(0, Math.min(canonical.cols() - 1, x1))),
                        Math.min(slotH, canonical.rows() - Math.max(0, Math.min(canonical.rows() - 1, y1)))));
                Mat slotGray = new Mat();
                Imgproc.cvtColor(slotCrop, slotGray, Imgproc.COLOR_BGR2GRAY);
                double cropStd = matStd(slotGray);
                slotGray.release();
                slotCrop.release();
                if (!nl.mariokart8.iconmatcher.SlotPresence.present("photo", "icon", cropStd)) {
                    result = new JSONObject().put("ok", false).put("reason", "low_contrast")
                            .put("crop_std", Math.round(cropStd * 10.0) / 10.0)
                            .put("id", JSONObject.NULL).put("name", "").put("score", 0.0).put("margin", 0.0)
                            .put("evidence", "contrast_gate");
                    out.put(outKey, result.put("slot_xywh", new JSONArray().put(x1).put(y1).put(slotW).put(slotH)));
                    continue;
                }
                int kindSearch = "character_icon".equals(iconKind) ? 10 : 6;
                int wantTopk = "character_icon".equals(iconKind) ? 12 : 0;
                if ("character_icon".equals(iconKind)) {
                    // ghost-avatar is GEDIMD: de verzadiging wordt weggedrukt en
                    // een kleurloze lookalike (Dry Bones) is daar ongevoelig voor
                    // — die won moes-vergelijkingen met 0.004. Saturatie-herstel
                    // herbewapent het kleurbewijs (Baby Luigi 0.788 vs 0.747)
                    Mat charSource = canonical;
                    int roiX = 0;
                    int roiY = 0;
                    Mat boosted = null;
                    if (!yellowCard) {
                        int margin = SEARCH_PAD_PX + 8;
                        roiX = Math.max(0, x1 - margin);
                        roiY = Math.max(0, y1 - margin);
                        int roiW = Math.min(canonical.cols() - roiX, slotW + 2 * margin);
                        int roiH = Math.min(canonical.rows() - roiY, slotH + 2 * margin);
                        Mat roi = new Mat(canonical, new Rect(roiX, roiY, roiW, roiH));
                        Mat hsv = new Mat();
                        Imgproc.cvtColor(roi, hsv, Imgproc.COLOR_BGR2HSV);
                        double meanSat = Core.mean(hsv).val[1];
                        if (meanSat > 1.0 && meanSat < 80.0) {
                            List<Mat> ch = new ArrayList<>();
                            Core.split(hsv, ch);
                            ch.get(1).convertTo(ch.get(1), -1, Math.min(2.0, 90.0 / meanSat), 0);
                            Core.merge(ch, hsv);
                            boosted = new Mat();
                            Imgproc.cvtColor(hsv, boosted, Imgproc.COLOR_HSV2BGR);
                            charSource = boosted;
                            for (Mat m : ch) {
                                m.release();
                            }
                        } else {
                            roiX = 0;
                            roiY = 0;
                        }
                        hsv.release();
                    }
                    // server icon_scale_search=v1: ±6% schaal-sweep alléén op het
                    // character-slot — de verste anker-extrapolatie (bovenkant kaart);
                    // schaal-residu clipt daar het icoon (server: 0.77->0.84 op juiste schaal)
                    // center-out + vroege stop (taak #18): de typische treffer zit
                    // op schaal ~1.0; bij een overtuigende score+marge zijn de
                    // buitenste schalen ballast (benchmark bewaakt kwaliteit)
                    // GEEN sweep-vroege-stop: gemeten 2026-07-19 — kost 2-5
                    // exact-id-kleurvarianten en levert geen meetbare wall-clock
                    // op; de winst zit in de unanimiteit-stop op stemframes
                    JSONObject best = null;
                    for (double scale : new double[]{0.94, 0.96, 0.98, 1.0, 1.02, 1.04, 1.06}) {
                        double w2 = slotW * scale;
                        double h2 = slotH * scale;
                        double sx1 = x1 + (slotW - w2) / 2.0 - roiX;
                        double sy1 = y1 + (slotH - h2) / 2.0 - roiY;
                        JSONObject candidate = cleanAssets.identifyCropSearch(charSource, sx1, sy1, w2, h2, group, subset, kindSearch, wantTopk);
                        candidate.put("scale", scale);
                        if (best == null || candidate.optDouble("score", 0.0) > best.optDouble("score", 0.0)) {
                            best = candidate;
                        }
                    }
                    if (boosted != null) {
                        boosted.release();
                    }
                    result = best;
                } else {
                    result = cleanAssets.identifyCropSearch(canonical, x1, y1, slotW, slotH, group, subset, kindSearch, wantTopk);
                }
                double margeId = result.optDouble("margin_ext", result.optDouble("margin", 0.0));
                boolean ok = result.optDouble("score", 0.0) >= ICON_SCORE_MIN && margeId >= ICON_MARGIN_MIN;
                if ("character_icon".equals(iconKind)) {
                    // lookalike-set Inkling-boy/girl/Birdo: marge-eis 0.05 (server)
                    String fam = CleanAssetsMatcher.familyOf(result.optString("id", ""));
                    if (ok && ("character.inkling_girl".equals(fam) || "character.inkling_boy".equals(fam) || "character.birdo".equals(fam)) && margeId < 0.05) {
                        ok = false;
                        result.put("reason", "lookalike_set_margin");
                    }
                    if (ok) {
                        charId = result.optString("id", null);
                    }
                }
                result.put("ok", ok);
                result.put("evidence", "clean_assets");
                result.put("crop_std", Math.round(cropStd * 10.0) / 10.0);
            }
            result.put("slot_xywh", new JSONArray().put(x1).put(y1).put(slotW).put(slotH));
            if ("character_icon".equals(iconKind) && result.optBoolean("ok", false)) {
                charId = result.optString("id", charId);
            }
            // referentie-icoon (asset-pad) + kaart-crop voor de resultaat-UI
            // (server toont crop -> gematcht icoon + naam per onderdeel)
            String assetRef = null;
            if ("flag_icon".equals(iconKind)) {
                if (!result.isNull("index")) {
                    assetRef = ASSET_ROOT + "/mk8_flags/" + result.getInt("index") + ".png";
                }
            } else if ("wheel_icon".equals(iconKind)) {
                if (!result.isNull("index")) {
                    assetRef = ASSET_ROOT + "/tire/" + result.getInt("index") + ".png";
                }
            } else if (!result.isNull("id")) {
                String group = "character_icon".equals(iconKind) ? "characters"
                        : ("kart_icon".equals(iconKind) ? "bodies" : "gliders");
                assetRef = cleanAssets.assetRefFor(result.getString("id"), group);
            }
            if (assetRef != null) {
                result.put("asset_ref", assetRef);
            }
            if (cropDir != null) {
                java.io.File cropFile = new java.io.File(cropDir, physOwner + "_" + outKey + "_crop.png");
                // crop op de GEVONDEN positie snijden (dx/dy/schaal uit de zoek)
                // i.p.v. het nominale slot — de cut-out toont dan exact wat de
                // matcher beoordeeld heeft (gebruikersvraag 2026-07-20)
                double cropScale = result.optDouble("scale", 1.0);
                int cw = Math.max(8, (int) Math.round(slotW * cropScale));
                int ch = Math.max(8, (int) Math.round(slotH * cropScale));
                int cx = (int) Math.round(x1 + (slotW - cw) / 2.0) + result.optInt("dx", 0);
                int cy = (int) Math.round(y1 + (slotH - ch) / 2.0) + result.optInt("dy", 0);
                if (saveCropPng(canonical, cx, cy, cw, ch, cropFile)) {
                    result.put("crop_path", cropFile.getAbsolutePath());
                }
            }
            out.put(outKey, result);
        }
        try {
            // debug: dump de ghost-naamstrip + inktmask naast de part-crops
            textEvidence.debugDumpDir = (!yellowCard && cropDir != null) ? cropDir.getAbsolutePath() : "";
            applyTextEvidence(canonical, out, yellowCard, px1, pw, charId, localeSlot, ghostDetail);
        } catch (Exception exc) {
            out.put("text_evidence_error", String.valueOf(exc.getMessage()));
        }
        try {
            rescueCharacterViaParts(canonical, out);
        } catch (Exception ignored) {
        }
        return out;
    }

    /** Twijfelgeval-redding (gebruikersidee 2026-07-16): de KLEURVARIANT van
     *  kart/glider hoort bij specifieke characters (relatedCharacterIds) — bij
     *  een onzeker character-icoon beperkt die relatie de shortlist en matchen
     *  we opnieuw. Alleen bij ok=false (identiteit flipt nooit op kleur bij een
     *  al-zekere read); tekst/naamstrip heeft al eerder gewonnen indien sterk. */
    private void rescueCharacterViaParts(Mat canonical, JSONObject out) throws Exception {
        JSONObject character = out.optJSONObject("character");
        if (character == null || character.optBoolean("ok", false)) {
            return;
        }
        JSONArray slot = character.optJSONArray("slot_xywh");
        if (slot == null) {
            return;
        }
        java.util.LinkedHashSet<String> candidates = new java.util.LinkedHashSet<>();
        for (String[] part : new String[][]{{"kart", "bodies"}, {"glider", "gliders"}}) {
            JSONObject entry = out.optJSONObject(part[0]);
            String rid = entry == null ? "" : entry.optString("id", "");
            if (rid.contains("_variant.")) {
                candidates.addAll(cleanAssets.charsForPartVariant(part[1], rid));
            }
        }
        if (candidates.isEmpty()) {
            return;
        }
        JSONObject rescued = cleanAssets.identifyCropSearch(canonical,
                slot.getInt(0), slot.getInt(1), slot.getInt(2), slot.getInt(3),
                "characters", candidates, 10, 0);
        double marge = rescued.optDouble("margin_ext", rescued.optDouble("margin", 0.0));
        if (rescued.optDouble("score", 0.0) >= ICON_SCORE_MIN && !rescued.isNull("id")) {
            String rid = rescued.getString("id");
            character.put("id", rid)
                    .put("name", cleanAssets.displayName(rid, "characters"))
                    .put("asset_ref", cleanAssets.assetRefFor(rid, "characters"))
                    .put("ok", marge >= ICON_MARGIN_MIN)
                    .put("score", rescued.optDouble("score", 0.0))
                    .put("margin_ext", Math.round(marge * 10000.0) / 10000.0)
                    .put("evidence", "clean_assets+part_color_constraint")
                    .put("constraint_candidates", candidates.size());
        }
    }

    // ------------------------------------------------------------------
    // Tekst-tweede-bewijs (server kart_config_text_ocr=v1 + naamstrip):
    // taal-slot per kaart (één taal per frame), rijteksten voor kart/wheel/
    // glider, naamstrip autoritair voor de speler-character op de gele kaart.
    // ------------------------------------------------------------------
    // Cyrillic on Android: ML Kit has no Cyrillic recognizer, and its Latin reader
    // prints a Russian card as Latin look-alikes ("TpyóoTypóo" for Труботурбо,
    // "3onoTble" for Золотые). Folding the read and the ru-RU names onto one visual
    // skeleton lets those reads match: on the 2026-10-27 Russian recordings 5 of 7
    // rows matched strongly and correctly (0.83-1.00, margins 0.33-0.60), the other
    // two stayed below the strong rule and leave the icon in charge. A folded match
    // only replaces the plain one when it is strong and better, so a Latin card's
    // own reading is unchanged.
    private static final String RU_LOCALE_SUFFIX = "#ru-RU";
    private static final String[][] CYRILLIC_FOLD = {
            {"\u0430a@", "a"}, {"\u04316\u00f3\u00f2b\u0432v", "b"}, {"\u0433r", "r"}, {"\u0434g", "d"},
            {"\u0435\u0451e\u00e9", "e"}, {"\u0436\u0445x", "x"}, {"\u04373\u044d", "3"},
            {"\u0438\u0439u\u043c\u043b\u043fn", "n"}, {"\u043ak", "k"}, {"m", "m"}, {"\u043dh", "h"},
            {"\u043eo0\u00f4\u00f6", "o"}, {"\u0440p", "p"}, {"\u0441c", "c"}, {"\u0442t", "t"},
            {"\u0443y", "y"}, {"\u0444", "f"}, {"\u0446", "u"}, {"\u04474", "4"}, {"\u0448\u0449w", "w"},
            {"\u044a\u044c", "b"}, {"\u044e", "io"}, {"\u044f", "r"},
    };

    static String cyrillicSkeleton(String text) {
        StringBuilder out = new StringBuilder();
        for (char c : text.toLowerCase(java.util.Locale.ROOT).replace("\u044b", "bl").toCharArray()) {
            if (Character.isWhitespace(c)) {
                continue;
            }
            String folded = String.valueOf(c);
            for (String[] fold : CYRILLIC_FOLD) {
                if (fold[0].indexOf(c) >= 0) {
                    folded = fold[1];
                    break;
                }
            }
            out.append(folded);
        }
        return out.toString();
    }

    private static boolean hasCyrillic(String text) {
        for (char c : text.toCharArray()) {
            if (Character.UnicodeBlock.of(c) == Character.UnicodeBlock.CYRILLIC) {
                return true;
            }
        }
        return false;
    }

    private TextEvidence.VocabMatch matchText(String text, Map<String, String> vocab) {
        TextEvidence.VocabMatch plain = TextEvidence.matchVocab(text, vocab);
        if (text == null || vocab == null || hasCyrillic(text)) {
            return plain;
        }
        Map<String, String> folded = new HashMap<>();
        for (Map.Entry<String, String> entry : vocab.entrySet()) {
            if (entry.getKey().endsWith(RU_LOCALE_SUFFIX)) {
                folded.put(entry.getKey(), cyrillicSkeleton(entry.getValue()));
            }
        }
        if (folded.isEmpty()) {
            return plain;
        }
        TextEvidence.VocabMatch russian = TextEvidence.matchVocab(cyrillicSkeleton(text), folded);
        if (russian.id != null && russian.strong() && russian.fuzzy > plain.fuzzy) {
            russian.name = vocab.get(russian.id);
            return russian;
        }
        return plain;
    }

    private void applyTextEvidence(Mat canonical, JSONObject out, boolean yellowCard, double px1, double pw, String charId, String[] localeSlot, boolean ghostDetail) throws Exception {
        // 1) taal-slot: kart-rijtekst met elk schrift proberen; beste vocab-match wint.
        // Als de gele kaart het slot al vulde, erft deze kaart script+locale (één taal per frame).
        JSONObject kart = out.optJSONObject("kart");
        JSONArray kartSlot = kart == null ? null : kart.optJSONArray("slot_xywh");
        if (kartSlot == null) {
            return;
        }
        // ghost_detail: de onderdeelnamen lopen bijna tot de paneelrand door
        // (bv. "Wolkballonnen"); de 0.52-grens van de kaartlayout knipt ze af
        nl.mariokart8.iconmatcher.FrameGeometry.Panel stripPanel =
                new nl.mariokart8.iconmatcher.FrameGeometry.Panel(px1, 0, pw, 0, "static_canonical");
        int rowTextRight = geometry.textRight(stripPanel, ghostDetail);
        String bestScript = null;
        String bestLocale = null;
        TextEvidence.VocabMatch bestKartMatch = null;
        String bestKartText = "";
        String[] scriptsToTry = TextEvidence.SCRIPTS;
        if (localeSlot != null && localeSlot[0] != null) {
            scriptsToTry = new String[]{localeSlot[0]};
            bestLocale = localeSlot[1];
        }
        boolean inheritedLocale = localeSlot != null && localeSlot[0] != null;
        for (String script : scriptsToTry) {
            int[] kartStrip = textStrip(kartSlot, rowTextRight);
            String text = textEvidence.ocrRegion(canonical, kartStrip[0], kartStrip[1], kartStrip[2], kartStrip[3], script);
            TextEvidence.VocabMatch match = matchText(text,
                    inheritedLocale ? filterLocale(cleanAssets.vocabOf("bodies"), bestLocale) : cleanAssets.vocabOf("bodies"));
            if (bestKartMatch == null || match.fuzzy > bestKartMatch.fuzzy) {
                bestKartMatch = match;
                bestScript = script;
                bestKartText = text;
                if (!inheritedLocale) {
                    bestLocale = match.id == null ? null : match.id.substring(match.id.indexOf('#') + 1);
                }
            }
            if (match.fuzzy >= TextEvidence.FUZZY_MIN) {
                break; // latin eerst = snel pad voor NL/UK; sterk = taal gevonden
            }
        }
        if (bestScript == null) {
            return;
        }
        if (!inheritedLocale && bestKartMatch.fuzzy >= TextEvidence.FUZZY_MIN) {
            // A kart name spelled alike in locales of different scripts ("GLA" in English and
            // Japanese) does not settle the reader for the other rows: read one more row with each
            // of those scripts and keep the one whose reading matches best (NameMatch
            // sameNameLocales, the same rule as the Web scanner).
            java.util.TreeSet<String> scripts = new java.util.TreeSet<>();
            List<String> available = java.util.Arrays.asList(TextEvidence.SCRIPTS);
            for (String loc : nl.mariokart8.iconmatcher.NameMatch.sameNameLocales(
                    new ArrayList<>(cleanAssets.vocabOf("bodies").entrySet()), bestKartMatch.id)) {
                String script = nl.mariokart8.iconmatcher.NameMatch.scriptForLocale(loc);
                if (available.contains(script)) scripts.add(script);
            }
            String probeRow = out.optJSONObject("glider") != null && out.optJSONObject("glider").optJSONArray("slot_xywh") != null ? "glider"
                    : out.optJSONObject("wheel") != null && out.optJSONObject("wheel").optJSONArray("slot_xywh") != null ? "wheel" : null;
            if (scripts.size() > 1 && probeRow != null) {
                JSONArray slot = out.optJSONObject(probeRow).optJSONArray("slot_xywh");
                Map<String, String> probeVocab = "wheel".equals(probeRow) ? tireVocab() : cleanAssets.vocabOf("gliders");
                double probeBest = -1.0;
                for (String script : scripts) {
                    int[] probeStrip = textStrip(slot, rowTextRight);
                    String text = textEvidence.ocrRegion(canonical, probeStrip[0], probeStrip[1], probeStrip[2], probeStrip[3], script);
                    TextEvidence.VocabMatch probe = matchText(text, probeVocab);
                    if (probe.fuzzy > probeBest + 1e-9) {
                        probeBest = probe.fuzzy;
                        bestScript = script;
                    }
                }
            }
        }
        // gezamenlijke taal-keuze: de kart-rij alleen is dubbelzinnig — namen
        // bestaan letterlijk in meerdere talen (Biddybuggy in en-US én nl-NL,
        // Tornado in nl-NL én es-ES) en dan viel de keuze op HashMap-volgorde.
        // De naamstrip van de gele kaart (character-naam) stemt mee: per taal
        // kart-fuzzy + naamstrip-fuzzy sommeren, hoogste som wint.
        JSONObject characterPre = out.optJSONObject("character");
        JSONObject flagPre = out.optJSONObject("flag");
        JSONArray charSlotPre = characterPre == null ? null : characterPre.optJSONArray("slot_xywh");
        JSONArray flagSlotPre = flagPre == null ? null : flagPre.optJSONArray("slot_xywh");
        String charStripText = "";
        if (yellowCard && charSlotPre != null && flagSlotPre != null) {
            int nx = charSlotPre.getInt(0) + charSlotPre.getInt(2) + 6;
            charStripText = textEvidence.ocrRegion(canonical, nx, charSlotPre.getInt(1),
                    flagSlotPre.getInt(0) - 6 - nx, charSlotPre.getInt(3), bestScript);
        }
        // wiel- en glider-rijteksten vooraf lezen: ze stemmen mee in de taal-
        // keuze (Waluigi + "Mach 8" zijn taal-neutraal -> tie tussen it/nl;
        // "Standaard" vs "Standard" beslist wel) en worden hieronder hergebruikt
        Map<String, String> rowTexts = new HashMap<>();
        for (String[] row : new String[][]{{"wheel", "tires"}, {"glider", "gliders"}}) {
            JSONObject entry = out.optJSONObject(row[0]);
            JSONArray slot = entry == null ? null : entry.optJSONArray("slot_xywh");
            if (slot == null) {
                continue;
            }
            int[] rowStrip = textStrip(slot, rowTextRight);
            rowTexts.put(row[0], textEvidence.ocrRegion(canonical, rowStrip[0], rowStrip[1], rowStrip[2], rowStrip[3], bestScript));
        }
        if (!inheritedLocale && bestKartMatch != null && bestKartMatch.id != null && !bestKartText.isEmpty()) {
            // The console language from every printed name at once: the central locale vote
            // (packages/icon-matcher NameMatch, the same rule as the Web scanner and Python). A
            // preferred language only breaks ties.
            List<String[]> voteRows = new ArrayList<>();
            voteRows.add(new String[]{"bodies", bestKartText});
            if (!charStripText.isEmpty()) voteRows.add(new String[]{"characters", charStripText});
            String wheelText = rowTexts.get("wheel");
            if (wheelText != null && !wheelText.isEmpty()) voteRows.add(new String[]{"tires", wheelText});
            String gliderText = rowTexts.get("glider");
            if (gliderText != null && !gliderText.isEmpty()) voteRows.add(new String[]{"gliders", gliderText});
            Map<String, List<Map.Entry<String, String>>> voteVocabs = new HashMap<>();
            voteVocabs.put("bodies", new ArrayList<>(cleanAssets.vocabOf("bodies").entrySet()));
            voteVocabs.put("characters", new ArrayList<>(cleanAssets.vocabOf("characters").entrySet()));
            voteVocabs.put("tires", new ArrayList<>(tireVocab().entrySet()));
            voteVocabs.put("gliders", new ArrayList<>(cleanAssets.vocabOf("gliders").entrySet()));
            nl.mariokart8.iconmatcher.NameMatch.Vote vote = nl.mariokart8.iconmatcher.NameMatch.vote(voteRows, voteVocabs,
                    nl.mariokart8.iconmatcher.NameMatch.vocabLocales(voteVocabs.get("bodies")), preferredLocales);
            if (vote.locale != null && vote.firstMatch != null) {
                bestLocale = vote.locale;
                TextEvidence.VocabMatch km = new TextEvidence.VocabMatch();
                if (vote.firstMatch.key != null) {
                    km.id = vote.firstMatch.key;
                    km.name = vote.firstMatch.name;
                }
                km.fuzzy = vote.firstMatch.fuzzy;
                km.margin = vote.firstMatch.margin;
                bestKartMatch = km;
            }
        }
        if (localeSlot != null && localeSlot[0] == null && bestKartMatch != null && bestKartMatch.fuzzy >= TextEvidence.FUZZY_MIN) {
            localeSlot[0] = bestScript;
            localeSlot[1] = bestLocale;
            rememberLocale(bestLocale);
        }
        out.put("text_locale", new JSONObject().put("script", bestScript).put("locale", bestLocale)
                .put("kart_text", bestKartText).put("fuzzy", Math.round(bestKartMatch.fuzzy * 100.0) / 100.0));
        // vocab per kind, gefilterd op de gevonden locale (server: één taal per frame)
        applyRowText(out, "kart", "bodies", bestKartMatch, bestKartText, bestLocale, charId);
        for (String[] row : new String[][]{{"wheel", "tires"}, {"glider", "gliders"}}) {
            String text = rowTexts.get(row[0]); // al gelezen tijdens de taal-keuze
            if (text == null) {
                continue;
            }
            Map<String, String> vocab = "tires".equals(row[1]) ? tireVocab() : cleanAssets.vocabOf(row[1]);
            TextEvidence.VocabMatch match = matchText(text, filterLocale(vocab, bestLocale));
            applyRowText(out, row[0], row[1], match, text, bestLocale, charId);
        }
        // 2) naamstrip autoritair voor de speler-character (alleen gele kaart)
        JSONObject character = out.optJSONObject("character");
        JSONObject flag = out.optJSONObject("flag");
        JSONArray charSlot = character == null ? null : character.optJSONArray("slot_xywh");
        JSONArray flagSlot = flag == null ? null : flag.optJSONArray("slot_xywh");
        if (charSlot != null && flagSlot != null && !yellowCard) {
            // ghostkaart: de naamstrip toont de GEBRUIKERSNAAM — OCR mét
            // case-correctie op glyph-hoogte (w vs W verschilt alleen in grootte).
            // ghost_detail: de vlag staat ONDER de naam i.p.v. rechts ervan; de
            // naam beslaat de bovenste helft van de character-slothoogte en loopt
            // tot de rijtekst-grens.
            int gx = charSlot.getInt(0) + charSlot.getInt(2) + 6;
            // ghost_detail: rechts begrensd vóór de X/Y-knoppen in de paneelkop
            int gWidth = ghostDetail
                    ? geometry.ghostNameRight(stripPanel) - gx
                    : flagSlot.getInt(0) - 6 - gx;
            int gHeight = ghostDetail
                    ? (int) Math.round(charSlot.getInt(3) * 0.5)
                    : charSlot.getInt(3);
            String ghostName = textEvidence.ocrNameCaseAware(canonical, gx, charSlot.getInt(1),
                    gWidth, gHeight, bestScript);
            if (!textEvidence.lastNameDebug.isEmpty()) {
                DebugConsole.log("NAME", "ghost naamstrip " + textEvidence.lastNameDebug);
                out.put("card_name_debug", textEvidence.lastNameDebug);
            }
            // Switch-nicknames zijn max 10 tekens (symbool-toetsenbord incl. ★
            // toegestaan); +2 marge voor een OCR-spatie — langer = misread
            if (!ghostName.isEmpty() && ghostName.length() <= 12) {
                out.put("card_name", ghostName);
            }
        }
        if (yellowCard && charSlot != null && flagSlot != null) {
            String text = charStripText; // al gelezen tijdens de taal-keuze
            TextEvidence.VocabMatch match = matchText(text, filterLocale(cleanAssets.vocabOf("characters"), bestLocale));
            if (match.id != null) {
                character.put("name_text", new JSONObject().put("text", text)
                        .put("id", stripLocale(match.id)).put("fuzzy", Math.round(match.fuzzy * 100.0) / 100.0));
            }
            if (match.fuzzy >= TextEvidence.FUZZY_MIN) {
                String rid = stripLocale(match.id);
                String iconId = character.optString("id", "");
                if (CleanAssetsMatcher.familyOf(rid).equals(CleanAssetsMatcher.familyOf(iconId))) {
                    character.put("ok", true);
                    character.put("evidence", character.optString("evidence", "clean_assets") + "+player_name");
                } else {
                    character.put("ok", true).put("id", rid)
                            .put("name", cleanAssets.displayName(rid, "characters"))
                            .put("asset_ref", cleanAssets.assetRefFor(rid, "characters"))
                            .put("evidence", "player_name_text");
                }
                // De kart/glider-KLEUR volgt in het spel met zekerheid uit het
                // character. Corrigeert de naamstrip het character hier (ná de
                // rijtekst-resolutie hierboven), dan kan een kleurvariant nog
                // met het oude, foute charId gekozen zijn — bewezen 2026-09-02:
                // Toad-icoon matchte als oranje-familie-character, waarna de
                // "Stadscooter"-rijtekst de orange i.p.v. Toads blauwe variant
                // kreeg. Daarom hier de varianten opnieuw afleiden.
                realignPartColors(out, character.optString("id", ""));
            }
        }
    }

    /** Herleidt de kart/glider-kleurvariant uit het (definitieve) character via
     *  char_to_parts; no-op als de gekozen variant al klopt of het character
     *  geen mapping heeft. Alleen kleur (id/naam/asset) wijzigt — score en
     *  marge blijven van de oorspronkelijke match. */
    private void realignPartColors(JSONObject out, String charId) throws Exception {
        if (charId == null || charId.isEmpty()) {
            return;
        }
        for (String[] row : new String[][]{{"kart", "bodies"}, {"glider", "gliders"}}) {
            JSONObject entry = out.optJSONObject(row[0]);
            String id = entry == null ? "" : entry.optString("id", "");
            if (id.isEmpty() || !id.contains("_variant.")) {
                continue;
            }
            String base = CleanAssetsMatcher.familyOf(id);
            String rid = cleanAssets.variantFor(charId, row[1], base);
            if (rid == null || rid.isEmpty() || rid.equals(id) || rid.equals(base)) {
                continue;
            }
            entry.put("color_realigned_from", id)
                    .put("id", rid)
                    .put("name", cleanAssets.displayName(rid, row[1]))
                    .put("asset_ref", cleanAssets.assetRefFor(rid, row[1]))
                    .put("evidence", entry.optString("evidence", "clean_assets") + "+char_color_realign");
        }
    }

    private void applyRowText(JSONObject out, String kind, String group, TextEvidence.VocabMatch match, String text, String locale, String charId) throws Exception {
        JSONObject entry = out.optJSONObject(kind);
        if (entry == null || match == null || match.id == null || text.isEmpty()) {
            return;
        }
        entry.put("text", new JSONObject().put("text", text).put("id", stripLocale(match.id))
                .put("fuzzy", Math.round(match.fuzzy * 100.0) / 100.0)
                .put("margin", Math.round(match.margin * 100.0) / 100.0));
        if (!match.strong()) {
            return;
        }
        // The icon's own choice before a strong printed name may replace it: the
        // Select-a-Ghost decision weighs the two as separate witnesses
        // (SharedFieldReader, kartConfig.ts old_visual).
        if (!entry.has("icon_visual")) {
            entry.put("icon_visual", new JSONObject().put("id", entry.opt("id") == null ? JSONObject.NULL : entry.opt("id"))
                    .put("index", entry.opt("index") == null ? JSONObject.NULL : entry.opt("index"))
                    .put("ok", entry.optBoolean("ok", false)));
        }
        if ("tires".equals(group)) {
            // banden hebben geen kleurvarianten: sterke tekst wint altijd (server-regel)
            int index = Integer.parseInt(stripLocale(match.id));
            entry.put("ok", true).put("index", index)
                    .put("name", displayName("tire", index))
                    .put("asset_ref", ASSET_ROOT + "/tire/" + index + ".png")
                    .put("evidence", entry.optString("evidence", "v1_tire_matcher") + "+text_ocr");
            return;
        }
        String baseId = stripLocale(match.id);
        String iconId = entry.optString("id", "");
        boolean familieAnders = !CleanAssetsMatcher.familyOf(baseId).equals(CleanAssetsMatcher.familyOf(iconId));
        if (!entry.optBoolean("ok", false) || familieAnders) {
            String rid = cleanAssets.variantFor(charId, group, baseId);
            entry.put("ok", true).put("id", rid)
                    .put("name", cleanAssets.displayName(rid, group))
                    .put("asset_ref", cleanAssets.assetRefFor(rid, group))
                    .put("evidence", "clean_assets+text_ocr");
        } else {
            entry.put("evidence", entry.optString("evidence", "clean_assets") + "+text_ocr");
        }
    }

    private static String stripLocale(String key) {
        int idx = key.indexOf('#');
        return idx < 0 ? key : key.substring(0, idx);
    }

    private static Map<String, String> filterLocale(Map<String, String> vocab, String locale) {
        if (locale == null || locale.isEmpty()) {
            return vocab;
        }
        Map<String, String> out = new HashMap<>();
        for (Map.Entry<String, String> entry : vocab.entrySet()) {
            if (entry.getKey().endsWith("#" + locale) || entry.getKey().indexOf('#') < 0) {
                out.put(entry.getKey(), entry.getValue());
            }
        }
        return out.isEmpty() ? vocab : out;
    }

    private Map<String, String> tireVocab() throws Exception {
        if (tireVocabCache != null) {
            return tireVocabCache;
        }
        Map<String, String> out = new HashMap<>();
        JSONObject table = names.optJSONObject("tire");
        if (table != null) {
            java.util.Iterator<String> keys = table.keys();
            while (keys.hasNext()) {
                String index = keys.next();
                JSONObject entry = table.optJSONObject(index);
                if (entry == null) {
                    continue;
                }
                String uk = entry.optString("uk", "");
                String nl = entry.optString("nl", "");
                if (!uk.isEmpty()) {
                    out.put(index + "#en-GB", uk);
                }
                if (!nl.isEmpty()) {
                    out.put(index + "#nl-NL", nl);
                }
            }
        }
        // The engine table only knows en-GB and nl-NL; the other game languages come
        // from Clean Assets (TireNameCatalog, generated), so a tire name printed in any
        // console language can match.
        for (Map.Entry<String, String> entry
                : nl.mariokart8.mk8dxtimetrials.scanruntime.TireNameCatalog.vocab().entrySet()) {
            if (!out.containsKey(entry.getKey())) {
                out.put(entry.getKey(), entry.getValue());
            }
        }
        tireVocabCache = out;
        return out;
    }

    private Map<String, String> tireVocabCache;

    private boolean saveCropPng(Mat canonical, int x1, int y1, int w, int h, java.io.File out) {
        try {
            int cx = Math.max(0, Math.min(canonical.cols() - 2, x1));
            int cy = Math.max(0, Math.min(canonical.rows() - 2, y1));
            int cw = Math.min(w, canonical.cols() - cx);
            int ch = Math.min(h, canonical.rows() - cy);
            if (cw < 4 || ch < 4) {
                return false;
            }
            Mat crop = new Mat(canonical, new Rect(cx, cy, cw, ch));
            Mat rgba = new Mat();
            Imgproc.cvtColor(crop, rgba, Imgproc.COLOR_BGR2RGBA);
            android.graphics.Bitmap bitmap = android.graphics.Bitmap.createBitmap(cw, ch, android.graphics.Bitmap.Config.ARGB_8888);
            org.opencv.android.Utils.matToBitmap(rgba, bitmap);
            rgba.release();
            crop.release();
            java.io.FileOutputStream stream = new java.io.FileOutputStream(out);
            try {
                bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, stream);
            } finally {
                stream.close();
                bitmap.recycle();
            }
            return true;
        } catch (Exception exc) {
            return false;
        }
    }

    private String displayName(String assetDir, Integer index) {
        if (index == null) {
            return "";
        }
        JSONObject table = names.optJSONObject(assetDir);
        JSONObject entry = table == null ? null : table.optJSONObject(String.valueOf(index));
        if (entry == null) {
            return "#" + index;
        }
        String uk = entry.optString("uk", "");
        String nl = entry.optString("nl", "");
        return uk.isEmpty() ? nl : uk;
    }

    // ------------------------------------------------------------------
    // Iconen (character/kart/wheel/glider): port van _match_icon.
    // ------------------------------------------------------------------
    private JSONObject matchIconWindowed(Mat windowBgr, String assetDir, int slotW, int slotH, boolean isWheel) throws Exception {
        JSONObject out = new JSONObject();
        Mat gray = new Mat();
        Imgproc.cvtColor(windowBgr, gray, Imgproc.COLOR_BGR2GRAY);
        // contrastpoort op de centrale slot-crop (scène zonder kaart haalt met
        // gain-genormaliseerde match alsnog hoge scores; server-drempel 21.5)
        int cx0 = Math.max(0, (windowBgr.cols() - slotW) / 2);
        int cy0 = Math.max(0, (windowBgr.rows() - slotH) / 2);
        Mat slotGray = new Mat(gray, new Rect(cx0, cy0, Math.min(slotW, gray.cols() - cx0), Math.min(slotH, gray.rows() - cy0)));
        double slotStd = matStd(slotGray);
        slotGray.release();
        gray.release();
        if (!nl.mariokart8.iconmatcher.SlotPresence.present("photo", "icon", slotStd)) {
            return out.put("ok", false).put("reason", "low_contrast").put("crop_std", Math.round(slotStd * 10.0) / 10.0)
                    .put("index", JSONObject.NULL).put("score", 0.0).put("margin", 0.0);
        }
        int cw = windowBgr.cols();
        int ch = windowBgr.rows();
        int tw = Math.min(slotW, cw);
        int th = Math.min(slotH, ch);
        float[] crop = matToFloatBgr(windowBgr);
        List<SizedIcon> sized = sizedIcons(assetDir, tw, th);
        if (sized.isEmpty()) {
            return out.put("ok", false).put("reason", "no_assets").put("index", JSONObject.NULL).put("score", 0.0).put("margin", 0.0);
        }
        // Fase 1: alle sjablonen op de centrale positie; fase 2: top-3 verfijnen
        // over de zoekmarge (stap 2) — zelfde structuur als de server.
        double[] centerScores = new double[sized.size()];
        Integer[] order = new Integer[sized.size()];
        for (int i = 0; i < sized.size(); i++) {
            SizedIcon icon = sized.get(i);
            centerScores[i] = maskedNcc(crop, cw, ch, cx0, cy0, icon, tw, th);
            order[i] = i;
        }
        final double[] scoresRef = centerScores;
        Arrays.sort(order, (a, b) -> Double.compare(scoresRef[b], scoresRef[a]));
        double bestScore;
        int bestIndex;
        double second;
        if (cw > tw || ch > th) {
            double[] refined = new double[Math.min(3, order.length)];
            for (int r = 0; r < refined.length; r++) {
                SizedIcon icon = sized.get(order[r]);
                double best = centerScores[order[r]];
                for (int dy = 0; dy <= ch - th; dy += 2) {
                    for (int dx = 0; dx <= cw - tw; dx += 2) {
                        if (dx == cx0 && dy == cy0) {
                            continue;
                        }
                        double s = maskedNcc(crop, cw, ch, dx, dy, icon, tw, th);
                        if (s > best) {
                            best = s;
                        }
                    }
                }
                refined[r] = best;
            }
            int bestR = 0;
            for (int r = 1; r < refined.length; r++) {
                if (refined[r] > refined[bestR]) {
                    bestR = r;
                }
            }
            bestScore = refined[bestR];
            bestIndex = sized.get(order[bestR]).index;
            second = 0.0;
            for (int r = 0; r < refined.length; r++) {
                if (r != bestR && refined[r] > second) {
                    second = refined[r];
                }
            }
        } else {
            bestScore = centerScores[order[0]];
            bestIndex = sized.get(order[0]).index;
            second = order.length > 1 ? centerScores[order[1]] : 0.0;
        }
        double margin = bestScore - second;
        boolean ok = isWheel
                ? bestScore >= WHEEL_SCORE_MIN
                : bestScore >= ICON_SCORE_MIN && margin >= ICON_MARGIN_MIN;
        return out.put("ok", ok)
                .put("index", bestIndex)
                .put("score", Math.round(bestScore * 1000.0) / 1000.0)
                .put("margin", Math.round(margin * 1000.0) / 1000.0)
                .put("crop_std", Math.round(slotStd * 10.0) / 10.0)
                .put("evidence", isWheel ? "v1_tire_matcher" : "v1_icon_ncc");
    }

    /** Alpha-gemaskeerde gezamenlijke 3-kanaals-NCC — regelrechte port van _ncc. */
    private double maskedNcc(float[] crop, int cw, int ch, int dx, int dy, SizedIcon icon, int tw, int th) {
        float[] tmpl = icon.bgr;
        float[] mask = icon.mask;
        double w = icon.maskSum * 3.0;
        if (w < 24.0) {
            return 0.0;
        }
        double sumC = 0.0;
        double sumT = 0.0;
        for (int y = 0; y < th; y++) {
            int cRow = ((dy + y) * cw + dx) * 3;
            int tRow = y * tw * 3;
            int mRow = y * tw;
            for (int x = 0; x < tw; x++) {
                float m = mask[mRow + x];
                if (m == 0f) {
                    continue;
                }
                int ci = cRow + x * 3;
                int ti = tRow + x * 3;
                sumC += m * (crop[ci] + crop[ci + 1] + crop[ci + 2]);
                sumT += m * (tmpl[ti] + tmpl[ti + 1] + tmpl[ti + 2]);
            }
        }
        double mc = sumC / w;
        double mt = sumT / w;
        double num = 0.0;
        double den1 = 0.0;
        double den2 = 0.0;
        for (int y = 0; y < th; y++) {
            int cRow = ((dy + y) * cw + dx) * 3;
            int tRow = y * tw * 3;
            int mRow = y * tw;
            for (int x = 0; x < tw; x++) {
                float m = mask[mRow + x];
                if (m == 0f) {
                    continue;
                }
                int ci = cRow + x * 3;
                int ti = tRow + x * 3;
                for (int c = 0; c < 3; c++) {
                    double dc = (crop[ci + c] - mc) * m;
                    double dt = (tmpl[ti + c] - mt) * m;
                    num += dc * dt;
                    den1 += dc * dc;
                    den2 += dt * dt;
                }
            }
        }
        double denom = Math.sqrt(den1 * den2);
        return denom > 1e-6 ? num / denom : 0.0;
    }

    // ------------------------------------------------------------------
    // Vlag: port van _match_flag (patroon-eerst, gedeelde positie, cast-tiebreak).
    // ------------------------------------------------------------------
    private JSONObject matchFlag(Mat windowBgr, String assetDir, int slotW, int slotH) throws Exception {
        JSONObject out = new JSONObject();
        int cwFull = windowBgr.cols();
        int chFull = windowBgr.rows();
        int tw = Math.min(slotW, cwFull);
        int th = Math.min(slotH, chFull);
        // het slot is ~2-3px ruimer dan de echte vlag (grijze kaartrand in de
        // crop); full-bleed-sjablonen drukten de ware match naar ~0.45 zodat
        // band-aliasing elders in het venster kon winnen (Japan->India).
        // Inset schaal-relatief: ware match springt naar ~0.97 (inset-probe)
        int inset = Math.max(2, (int) Math.round(0.055 * th));
        tw -= 2 * inset;
        th -= 2 * inset;
        if (tw < 8 || th < 8) {
            return out.put("ok", false).put("index", JSONObject.NULL).put("score", 0.0).put("reason", "slot_too_small");
        }
        List<FlagTemplate> flags = flagTemplates(assetDir, tw, th);
        if (flags.isEmpty()) {
            return out.put("ok", false).put("index", JSONObject.NULL).put("score", 0.0).put("reason", "no_assets");
        }
        Mat gray8 = new Mat();
        Imgproc.cvtColor(windowBgr, gray8, Imgproc.COLOR_BGR2GRAY);
        int x0 = (cwFull - tw) / 2;
        int y0 = (chFull - th) / 2;
        if (cwFull > tw || chFull > th) {
            // gedeelde positie over ALLE sjablonen (globale argmax-NCC met
            // afstandsstraf 0.003/px tegen band-aliasing) — server-semantiek,
            // maar in KLEUR: horizontale driekleuren (NL/RU/LT) zijn in grijs
            // per band vrijwel identiek, waardoor de positie een halve band
            // kon verschuiven en de kleurvolgorde-lezing kantelde
            double bestVal = -1.0;
            Mat result = new Mat();
            for (FlagTemplate flag : flags) {
                Imgproc.matchTemplate(windowBgr, flag.bgr8, result, Imgproc.TM_CCOEFF_NORMED);
                int rows = result.rows();
                int cols = result.cols();
                float[] row = new float[cols];
                for (int y = 0; y < rows; y++) {
                    result.get(y, 0, row);
                    double dyPen = FLAG_POS_PENALTY * Math.abs(y - y0);
                    for (int x = 0; x < cols; x++) {
                        double v = row[x] - dyPen - FLAG_POS_PENALTY * Math.abs(x - x0);
                        if (v > bestVal) {
                            bestVal = v;
                            x0 = x;
                            y0 = y;
                        }
                    }
                }
            }
            result.release();
        }
        Mat slotGray = new Mat(gray8, new Rect(x0, y0, tw, th));
        double slotStd = matStd(slotGray);
        if (!nl.mariokart8.iconmatcher.SlotPresence.present("photo", "flag", slotStd)) {
            slotGray.release();
            gray8.release();
            return out.put("ok", false).put("index", JSONObject.NULL).put("score", 0.0)
                    .put("reason", "low_contrast").put("crop_std", Math.round(slotStd * 10.0) / 10.0);
        }
        // herscoring van ALLE vlaggen op de gedeelde positie met eigen gray-NCC
        float[] sub = new float[tw * th];
        Mat slotGrayF = new Mat();
        slotGray.convertTo(slotGrayF, CvType.CV_32F);
        slotGrayF.get(0, 0, sub);
        slotGray.release();
        slotGrayF.release();
        double mean = 0.0;
        for (float v : sub) {
            mean += v;
        }
        mean /= sub.length;
        double gcDen = 0.0;
        for (float v : sub) {
            gcDen += (v - mean) * (v - mean);
        }
        gcDen = Math.sqrt(gcDen);
        double best = -2.0;
        double secondScore = -2.0;
        int bestIdx = -1;
        double[] all = new double[flags.size()];
        for (int i = 0; i < flags.size(); i++) {
            FlagTemplate flag = flags.get(i);
            double num = 0.0;
            for (int p = 0; p < sub.length; p++) {
                num += (sub[p] - mean) * flag.dt[p];
            }
            double s = gcDen * flag.dtDen > 1e-6 ? num / (gcDen * flag.dtDen) : 0.0;
            all[i] = s;
            if (s > best) {
                secondScore = best;
                best = s;
                bestIdx = i;
            } else if (s > secondScore) {
                secondScore = s;
            }
        }
        gray8.release();
        double g1 = best;
        out.put("index", flags.get(bestIdx).index).put("score", Math.round(g1 * 1000.0) / 1000.0)
                .put("pattern", "gray_ncc").put("crop_std", Math.round(slotStd * 10.0) / 10.0);
        if (g1 < 0.55) {
            return out.put("ok", false).put("margin", 0.0).put("reason", "pattern_gate");
        }
        List<Integer> shortlist = new ArrayList<>();
        for (int i = 0; i < flags.size(); i++) {
            if (all[i] >= g1 - 0.05) {
                shortlist.add(i);
            }
        }
        if (shortlist.size() == 1) {
            return out.put("ok", true).put("margin", Math.round((g1 - secondScore) * 1000.0) / 1000.0).put("shortlist", 1);
        }
        // kleurzweem-gecorrigeerde tiebreak binnen de shortlist
        Mat slotBgr = new Mat(windowBgr, new Rect(x0, y0, tw, th)).clone();
        float[] castCrop = castFeature(slotBgr);
        slotBgr.release();
        double bestCast = -Double.MAX_VALUE;
        double secondCast = -Double.MAX_VALUE;
        int bestCastIdx = -1;
        for (int i : shortlist) {
            float[] castTmpl = flags.get(i).cast;
            double diff = 0.0;
            for (int p = 0; p < castCrop.length; p++) {
                diff += Math.abs(castCrop[p] - castTmpl[p]);
            }
            double score = -diff / castCrop.length;
            if (score > bestCast) {
                secondCast = bestCast;
                bestCast = score;
                bestCastIdx = i;
            } else if (score > secondCast) {
                secondCast = score;
            }
        }
        double castMargin = bestCast - secondCast;
        return out.put("index", flags.get(bestCastIdx).index)
                .put("ok", castMargin >= 0.03)
                .put("margin", Math.round(castMargin * 1000.0) / 1000.0)
                .put("shortlist", shortlist.size());
    }

    /** Kleurzweem-feature: L en a/b gerefereerd aan het helderste kwart (eigen witbalans). */
    private float[] castFeature(Mat bgr8) {
        Mat lab = new Mat();
        Imgproc.cvtColor(bgr8, lab, Imgproc.COLOR_BGR2Lab);
        int n = lab.rows() * lab.cols();
        byte[] data = new byte[n * 3];
        lab.get(0, 0, data);
        lab.release();
        float[] lum = new float[n];
        for (int i = 0; i < n; i++) {
            lum[i] = data[i * 3] & 0xFF;
        }
        float[] sorted = lum.clone();
        Arrays.sort(sorted);
        float p75 = sorted[(int) Math.min(n - 1L, Math.round(0.75 * (n - 1)))];
        double lw = 0.0;
        double aw = 0.0;
        double bw = 0.0;
        int count = 0;
        for (int i = 0; i < n; i++) {
            if (lum[i] >= p75) {
                lw += lum[i];
                aw += data[i * 3 + 1] & 0xFF;
                bw += data[i * 3 + 2] & 0xFF;
                count++;
            }
        }
        lw = Math.max(lw / Math.max(1, count), 1e-6);
        aw /= Math.max(1, count);
        bw /= Math.max(1, count);
        float[] feat = new float[n * 3];
        for (int i = 0; i < n; i++) {
            feat[i * 3] = (float) (lum[i] / lw);
            feat[i * 3 + 1] = (float) (((data[i * 3 + 1] & 0xFF) - aw) / 40.0);
            feat[i * 3 + 2] = (float) (((data[i * 3 + 2] & 0xFF) - bw) / 40.0);
        }
        return feat;
    }

    // ------------------------------------------------------------------
    // Asset-caches
    // ------------------------------------------------------------------
    private static class IconAsset {
        int index;
        Mat bgr;
        Mat alpha;
    }

    private static class SizedIcon {
        int index;
        float[] bgr;
        float[] mask;
        double maskSum;
    }

    private static class FlagTemplate {
        int index;
        Mat gray8;
        Mat bgr8;
        float[] dt;
        double dtDen;
        float[] cast;
    }

    private List<IconAsset> loadAssets(String assetDir) throws Exception {
        List<IconAsset> cached = assetCache.get(assetDir);
        if (cached != null) {
            return cached;
        }
        List<IconAsset> items = new ArrayList<>();
        String[] files = context.getAssets().list(ASSET_ROOT + "/" + assetDir);
        if (files != null) {
            for (String file : files) {
                if (!file.endsWith(".png")) {
                    continue;
                }
                String stem = file.substring(0, file.length() - 4);
                boolean numeric = !stem.isEmpty();
                for (int i = 0; i < stem.length(); i++) {
                    if (!Character.isDigit(stem.charAt(i))) {
                        numeric = false;
                        break;
                    }
                }
                if (!numeric) {
                    continue;
                }
                InputStream in = context.getAssets().open(ASSET_ROOT + "/" + assetDir + "/" + file);
                Bitmap bitmap;
                try {
                    BitmapFactory.Options opts = new BitmapFactory.Options();
                    opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
                    bitmap = BitmapFactory.decodeStream(in, null, opts);
                } finally {
                    in.close();
                }
                if (bitmap == null) {
                    continue;
                }
                Mat rgba = new Mat();
                Utils.bitmapToMat(bitmap, rgba);
                bitmap.recycle();
                IconAsset asset = new IconAsset();
                asset.index = Integer.parseInt(stem);
                asset.bgr = new Mat();
                asset.alpha = new Mat();
                Imgproc.cvtColor(rgba, asset.bgr, Imgproc.COLOR_RGBA2BGR);
                if (rgba.channels() == 4) {
                    Core.extractChannel(rgba, asset.alpha, 3);
                } else {
                    asset.alpha = new Mat(rgba.rows(), rgba.cols(), CvType.CV_8UC1, new org.opencv.core.Scalar(255));
                }
                rgba.release();
                items.add(asset);
            }
        }
        assetCache.put(assetDir, items);
        return items;
    }

    private List<SizedIcon> sizedIcons(String assetDir, int tw, int th) throws Exception {
        String key = assetDir + "|" + tw + "x" + th;
        List<SizedIcon> cached = sizedIconCache.get(key);
        if (cached != null) {
            return cached;
        }
        int erodePx = Math.max(1, (int) Math.round(Math.min(tw, th) * 0.06));
        Mat kernel = Imgproc.getStructuringElement(Imgproc.MORPH_ELLIPSE, new org.opencv.core.Size(2 * erodePx + 1, 2 * erodePx + 1));
        List<SizedIcon> sized = new ArrayList<>();
        for (IconAsset asset : loadAssets(assetDir)) {
            Mat bgrResized = new Mat();
            Mat alphaResized = new Mat();
            Mat alphaEroded = new Mat();
            Imgproc.resize(asset.bgr, bgrResized, new org.opencv.core.Size(tw, th), 0, 0, Imgproc.INTER_AREA);
            Imgproc.resize(asset.alpha, alphaResized, new org.opencv.core.Size(tw, th), 0, 0, Imgproc.INTER_AREA);
            Imgproc.erode(alphaResized, alphaEroded, kernel);
            SizedIcon icon = new SizedIcon();
            icon.index = asset.index;
            icon.bgr = matToFloatBgr(bgrResized);
            Mat alphaF = new Mat();
            alphaEroded.convertTo(alphaF, CvType.CV_32F, 1.0 / 255.0);
            icon.mask = new float[tw * th];
            alphaF.get(0, 0, icon.mask);
            double sum = 0.0;
            for (float m : icon.mask) {
                sum += m;
            }
            icon.maskSum = sum;
            alphaF.release();
            bgrResized.release();
            alphaResized.release();
            alphaEroded.release();
            sized.add(icon);
        }
        kernel.release();
        sizedIconCache.put(key, sized);
        return sized;
    }

    private List<FlagTemplate> flagTemplates(String assetDir, int tw, int th) throws Exception {
        String key = assetDir + "|" + tw + "x" + th;
        List<FlagTemplate> cached = flagCache.get(key);
        if (cached != null) {
            return cached;
        }
        List<FlagTemplate> templates = new ArrayList<>();
        for (IconAsset asset : loadAssets(assetDir)) {
            Mat sizedBgr = new Mat();
            Imgproc.resize(asset.bgr, sizedBgr, new org.opencv.core.Size(tw, th), 0, 0, Imgproc.INTER_AREA);
            FlagTemplate flag = new FlagTemplate();
            flag.index = asset.index;
            flag.gray8 = new Mat();
            Imgproc.cvtColor(sizedBgr, flag.gray8, Imgproc.COLOR_BGR2GRAY);
            Mat grayF = new Mat();
            flag.gray8.convertTo(grayF, CvType.CV_32F);
            float[] gt = new float[tw * th];
            grayF.get(0, 0, gt);
            grayF.release();
            double mean = 0.0;
            for (float v : gt) {
                mean += v;
            }
            mean /= gt.length;
            flag.dt = new float[gt.length];
            double den = 0.0;
            for (int i = 0; i < gt.length; i++) {
                flag.dt[i] = (float) (gt[i] - mean);
                den += flag.dt[i] * flag.dt[i];
            }
            flag.dtDen = Math.sqrt(den);
            flag.cast = castFeature(sizedBgr);
            flag.bgr8 = sizedBgr; // positie-stage in kleur (bandvolgorde telt mee)
            templates.add(flag);
        }
        flagCache.put(key, templates);
        return templates;
    }

    // ------------------------------------------------------------------
    // Hulpjes
    // ------------------------------------------------------------------
    private static float[] matToFloatBgr(Mat bgr8) {
        Mat f = new Mat();
        bgr8.convertTo(f, CvType.CV_32FC3);
        float[] out = new float[(int) f.total() * 3];
        f.get(0, 0, out);
        f.release();
        return out;
    }

    private static double matStd(Mat gray) {
        MatOfDouble mean = new MatOfDouble();
        MatOfDouble std = new MatOfDouble();
        Core.meanStdDev(gray, mean, std);
        double v = std.toArray().length > 0 ? std.toArray()[0] : 0.0;
        mean.release();
        std.release();
        return v;
    }
}
