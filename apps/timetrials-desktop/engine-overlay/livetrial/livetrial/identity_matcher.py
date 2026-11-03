#!/usr/bin/env python3
"""Kart-config-herkenning gedreven door de MK8DX Clean Assets deploy-database.

De deploy-map (database.json schema 6 + images/) is de LEIDENDE bron — geen
lokale templates of assetkopieën. Techniek = de bewezen Icon Matcher-aanpak
(zelfde auteur/database, zie 'MK8DX Icon Matcher'):
- referenties worden bij het laden uit images/ in hun detectie-box gebakken
  (alpha behouden; geen pixels in de database);
- whole-box match: query wordt ALLEEN op de niet-transparante referentiepixels
  vergeleken (score = 1 - gemiddeld |dRGB|), dus de kaartachtergrond telt niet;
- body/glider-kleurvariant wordt met ZEKERHEID uit het herkende karakter
  afgeleid (relatedCharacterIds/relatedCharacterVariantIds) i.p.v. per pixel;
- vlaggen: alleen de 110 isMk8Country-vlaggen (RGB, whole-box).

Locatie van de deploy-map: env MK8_CLEAN_ASSETS_ROOT of de standaardlocatie
hieronder. Alleen cv2+numpy; workflow_lab koppelt dit param-gated aan
kart_config_recognition="v2_clean_assets".
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np

PACKAGED_ROOT = Path(__file__).resolve().parents[2] / "MK8DX Clean Assets"
DEFAULT_ROOT = PACKAGED_ROOT if PACKAGED_ROOT.is_dir() else Path(r"path\to\clean-assets - deploy")


def assets_root() -> Path:
    override = os.environ.get("MK8_CLEAN_ASSETS_ROOT", "").strip()
    return Path(override) if override else DEFAULT_ROOT


_STATE: dict[str, Any] = {}


def _load_db() -> dict:
    return json.loads((assets_root() / "database.json").read_text(encoding="utf-8"))


def _load_rgba_into_box(path: Path, wh: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
    im = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if im is None:
        raise FileNotFoundError(path)
    if im.ndim == 2:
        im = cv2.cvtColor(im, cv2.COLOR_GRAY2BGRA)
    elif im.shape[2] == 3:
        im = np.dstack([im, np.full(im.shape[:2], 255, np.uint8)])
    im = cv2.resize(im, wh, interpolation=cv2.INTER_AREA)
    rgb = cv2.cvtColor(im[:, :, :3], cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    a = im[:, :, 3].astype(np.float32) / 255.0
    if a.max() < 0.05:
        a = np.ones_like(a)
    return rgb, a


def _reference_sources(db: dict):
    """(groep, id, pad, weergavenaam) per referentie, volgens detection.referenceAssets."""
    root = assets_root()
    names = {}

    def name_of(rec: dict) -> str:
        nm = rec.get("names") or {}
        return str(nm.get("nl-NL") or nm.get("en-US") or rec.get("slug") or rec.get("id"))

    def name_en_of(rec: dict) -> str:
        nm = rec.get("names") or {}
        return str(nm.get("en-US") or nm.get("en-GB") or rec.get("slug") or rec.get("id"))

    for c in db["collections"]["characters"]:
        a = (c.get("assets") or {}).get("score")
        if a:
            yield "characters", c["id"], root / a["path"], name_of(c)
    for v in db["relationships"]["characterVariants"]:
        a = (v.get("assets") or {}).get("score")
        if a:
            yield "characters", v["id"], root / a["path"], name_of(v)
    for b in db["collections"]["vehicleBodies"]:
        a = (b.get("assets") or {}).get("default") or next(iter((b.get("assets") or {}).values()), None)
        if a:
            yield "bodies", b["id"], root / a["path"], name_of(b)
    base_names = {}
    for coll in ("vehicleBodies", "vehicleGliders"):
        for rec in db["collections"][coll]:
            base_names[rec["id"]] = name_of(rec)

    def variant_name(v: dict, base_key: str) -> str:
        if v.get("names"):
            return name_of(v)
        base = base_names.get(v.get(base_key), v.get(base_key, ""))
        slug = str(v.get("variantSlug", "")).replace("_", " ")
        return f"{base} ({slug})" if slug else base

    for v in db["relationships"]["bodyVariants"]:
        if v.get("variantSlug") == "default":
            continue
        yield "bodies", v["id"], root / v["asset"]["path"], variant_name(v, "bodyId")
    for g in db["collections"]["vehicleGliders"]:
        a = (g.get("assets") or {}).get("default") or next(iter((g.get("assets") or {}).values()), None)
        if a:
            yield "gliders", g["id"], root / a["path"], name_of(g)
    for v in db["relationships"]["gliderVariants"]:
        if v.get("variantSlug") == "default":
            continue
        yield "gliders", v["id"], root / v["asset"]["path"], variant_name(v, "gliderId")
    for t in db["collections"]["vehicleTires"]:
        a = (t.get("assets") or {}).get("default") or next(iter((t.get("assets") or {}).values()), None)
        if a:
            yield "tires", t["id"], root / a["path"], name_of(t)
    for c in db["collections"]["countries"]:
        a = (c.get("assets") or {}).get("mk8Flag")
        if c.get("isMk8Country") and a:
            yield "flags", c["id"], root / a["path"], name_of(c)


def _ensure_loaded() -> dict[str, Any]:
    """Lazy: db + gebakken templates + relatie-indexen, één keer per proces."""
    if _STATE.get("loaded"):
        return _STATE
    t0 = time.perf_counter()
    db = _load_db()
    det = db["detection"]
    box = {g: tuple(wh) for g, wh in det["boxSizes"].items()}
    alpha_thr = float(det["params"].get("alphaThreshold", 0.15))

    groups: dict[str, dict[str, Any]] = {}
    display_names: dict[str, str] = {}
    asset_paths: dict[str, str] = {}
    for group, rid, path, name in _reference_sources(db):
        wh = box[group]
        try:
            rgb, a = _load_rgba_into_box(path, wh)
        except FileNotFoundError:
            continue
        g = groups.setdefault(group, {"ids": [], "rgb": [], "mask": []})
        g["ids"].append(rid)
        g["rgb"].append(rgb)
        g["mask"].append((a > alpha_thr).astype(np.float32))
        # de villagers heten in de database BEIDE "Dorpsbewoner" — zonder
        # suffix is jongen/meisje in de UI niet te onderscheiden
        if rid == "character.villager_male":
            name += " (jongen)"
        elif rid == "character.villager_female":
            name += " (meisje)"
        display_names[rid] = name
        try:
            asset_paths[rid] = str(path.relative_to(assets_root()))
        except ValueError:
            asset_paths[rid] = str(path)
    for g in groups.values():
        g["rgb"] = np.stack(g["rgb"])
        g["mask"] = np.stack(g["mask"])
        g["masksum"] = g["mask"].sum((1, 2))
        # gemaskeerde saturatie per template: kleurloze sjablonen (Metal
        # Mario e.d.) winnen anders op uitgewassen GEKLEURDE crops
        sats = []
        for i in range(len(g["ids"])):
            bgr = (g["rgb"][i][:, :, ::-1] * 255.0).astype(np.uint8)
            sat = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)[:, :, 1].astype(np.float32) / 255.0
            sats.append(float((sat * g["mask"][i]).sum() / (g["masksum"][i] + 1e-6)))
        g["sat"] = np.asarray(sats, dtype=np.float32)

    # Karakter -> kleurset voor body/glider (variant met zekerheid, geen pixels).
    char_to_parts: dict[str, dict[str, dict[str, str]]] = {}

    def register(char_id: str, group: str, base_id: str, variant_id: str) -> None:
        char_to_parts.setdefault(char_id, {}).setdefault(group, {})[base_id] = variant_id

    for group, coll, rels in (("bodies", "vehicleBodies", "bodyVariants"), ("gliders", "vehicleGliders", "gliderVariants")):
        for v in db["relationships"][rels]:
            if v.get("variantSlug") == "default":
                continue
            base = v.get("bodyId") or v.get("gliderId")
            for cid in (v.get("relatedCharacterIds") or []):
                register(cid, group, base, v["id"])
            for cid in (v.get("relatedCharacterVariantIds") or []):
                register(cid, group, base, v["id"])

    # Familie-diagnostiek voor kleurvarianten wanneer het karakter zelf een
    # variant is (Yoshi-kleuren): diagnostische pixels per familie.
    fam_members: dict[tuple[str, str], list[int]] = {}
    for group, g in groups.items():
        for i, rid in enumerate(g["ids"]):
            fam = _family_of(rid)
            fam_members.setdefault((group, fam), []).append(i)
    family_masks: dict[tuple[str, str], tuple[list[int], np.ndarray, float]] = {}
    for (group, fam), idxs in fam_members.items():
        if len(idxs) < 2:
            continue
        g = groups[group]
        shared = g["mask"][idxs].mean(0) >= 0.8
        var = g["rgb"][idxs].std(0).sum(2)
        if shared.sum() >= 8:
            thr = np.percentile(var[shared], 60)
            diag = shared & (var > thr)
            if diag.sum() < 8:
                diag = shared
        else:
            diag = shared
        dm = diag.astype(np.float32)
        family_masks[(group, fam)] = (idxs, dm, float(dm.sum()))

    # Verwisselgroepen: karakters met sterk overlappende vorm waar dRGB onder
    # dim/cast tussen flipt, terwijl de TINTHOEK ze scheidt (villager-haar
    # bruin 65,5° vs roze 27,6°, Isabelle-geel 92,8°; echte jongen-crops
    # lazen als meisje op 2026-07-13 en als Isabelle op 2026-07-14 terwijl
    # de hoek beide keren male aanwees). Zelfde diagnostiek-recept als
    # families; herrangschikking alleen bij >=8° hoekmarge.
    for pair in (("character.villager_male", "character.villager_female", "character.isabelle"),):
        try:
            grp = groups["characters"]
            idxs = [grp["ids"].index(rid) for rid in pair]
        except (KeyError, ValueError):
            continue
        shared = grp["mask"][idxs].mean(0) >= 0.8
        var = grp["rgb"][idxs].std(0).sum(2)
        if shared.sum() >= 8:
            thr = np.percentile(var[shared], 60)
            diag = shared & (var > thr)
            if diag.sum() < 8:
                diag = shared
        else:
            diag = shared
        dm = diag.astype(np.float32)
        if dm.sum() >= 8:
            family_masks[("characters", "pair." + pair[0])] = (idxs, dm, float(dm.sum()))
            for rid in pair:
                char_pair_of = _STATE.setdefault("sibling_pair_of", {})
                char_pair_of[rid] = ("characters", "pair." + pair[0])
            # VORM-evidence (gebruiker 2026-07-13: de siblings zijn níét
            # vormidentiek — alpha-IoU 0.80): de knotjes-regio zit alleen in
            # het meisje-silhouet en valt daardoor juist BUITEN het gedeelde
            # diagnostiekmasker. Op een meisje-crop is die regio roze haar
            # (chroma 34,5 / hoek 13,6°), op een jongen-crop kaartachtergrond
            # (echte crop: chroma 7,5) — aparte bevestigingscheck.
            anderen = np.zeros(grp["mask"][idxs[1]].shape, dtype=bool)
            for j in idxs:
                if j != idxs[1]:
                    anderen |= grp["mask"][j] > 0.5
            only_f = (grp["mask"][idxs[1]] > 0.5) & ~anderen
            only_f = cv2.erode(only_f.astype(np.uint8), np.ones((2, 2), np.uint8)).astype(bool)
            if only_f.sum() >= 24:
                f_ang, f_mag = _chroma_angle(grp["rgb"][idxs[1]], only_f.astype(np.float32))
                _STATE.setdefault("sibling_pair_shape", {})[("characters", "pair." + pair[0])] = {
                    "mask": only_f.astype(np.float32),
                    "female_angle": f_ang, "female_chroma": f_mag,
                    "male_rid": pair[0], "female_rid": pair[1],
                }

    # referentie-tinthoek per familielid op de diagnostische pixels
    # (kleurvariant-beslissing; None/zwak = achromatische variant)
    family_chroma: dict[tuple[str, str], dict[int, tuple[float | None, float]]] = {}
    for fkey, (idxs, dm, _dsum) in family_masks.items():
        grp = groups[fkey[0]]
        family_chroma[fkey] = {i: _chroma_angle(grp["rgb"][i], dm) for i in idxs}

    _STATE.update({
        "loaded": True,
        "db_schema": db.get("schemaVersion"),
        "detection": det,
        "box": box,
        "groups": groups,
        "display_names": display_names,
        "asset_paths": asset_paths,
        "char_to_parts": char_to_parts,
        "family_masks": family_masks,
        "family_chroma": family_chroma,
        "load_ms": round((time.perf_counter() - t0) * 1000.0, 1),
    })
    return _STATE


def _family_of(rid: str) -> str:
    # character_variant.yoshi.018_black -> character.yoshi; body_variant.x.y -> body.x
    parts = rid.split(".")
    if parts[0].endswith("_variant") and len(parts) >= 2:
        return parts[0].replace("_variant", "") + "." + parts[1]
    return rid


def _chroma_angle(rgb01: np.ndarray, mask: np.ndarray) -> tuple[float | None, float]:
    """Chroma-gewogen Lab-tinthoek (graden) + chroma-magnitude op de
    gemaskeerde pixels. De HOEK is gain- én offsetrobuust — precies wat de
    kaartdim/wash van |dRGB|-kleurbeslissingen breekt."""
    lab = cv2.cvtColor(np.clip(rgb01 * 255.0, 0, 255).astype(np.uint8), cv2.COLOR_RGB2LAB).astype(np.float32)
    a = lab[:, :, 1] - 128.0
    b = lab[:, :, 2] - 128.0
    w = mask * np.hypot(a, b)
    sw = float(w.sum())
    if sw < 1e-3:
        return None, 0.0
    aw = float((a * w).sum() / sw)
    bw = float((b * w).sum() / sw)
    return float(np.degrees(np.arctan2(bw, aw))), float(np.hypot(aw, bw))


def _prep_query(crop_bgr: np.ndarray, wh: tuple[int, int]) -> np.ndarray:
    q = cv2.resize(crop_bgr, wh, interpolation=cv2.INTER_AREA)
    return cv2.cvtColor(q, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0


def _shift(img: np.ndarray, dx: int, dy: int) -> np.ndarray:
    m = np.float32([[1, 0, dx], [0, 1, dy]])
    return cv2.warpAffine(img, m, (img.shape[1], img.shape[0]), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)


def _scores(q: np.ndarray, rgb: np.ndarray, mask: np.ndarray, masksum: np.ndarray, offsets,
            gains: np.ndarray | None = None) -> np.ndarray:
    best = None
    for dx, dy in offsets:
        sq = _shift(q, dx, dy) if (dx or dy) else q
        if gains is None:
            d = np.abs(rgb - sq[None]).sum(3)
        else:
            d = np.abs(rgb - np.clip(sq[None] * gains[:, None, None, None], 0.0, 1.0)).sum(3)
        s = 1.0 - (d * mask).sum((1, 2)) / (masksum * 3.0 + 1e-6)
        best = s if best is None else np.maximum(best, s)
    return best


# SHAPE (alpha cut-out) evidence — implemented, measured, DEFAULT OFF.
#
# The reference PNGs are cut-outs: a Mario silhouette is not a Yoshi silhouette,
# and the colour score never uses that. The blocker is that the QUERY has no
# alpha — it has to be recovered from the frame, and that only works on an
# OPAQUE card:
#
#   player card (opaque yellow) : recovered 2112 px vs true mask 1974 px
#                                -> IoU 0.929, true part ranked #1
#   ghost card  (TRANSLUCENT)   : recovered 2380 px vs true mask 1582 px
#                                -> IoU 0.362, true part ranked #218
#
# Through a translucent card "differs from the card colour" also catches the
# race scene showing through, so the recovered cut-out over-segments by ~50% and
# the IoU then favours whichever template is biggest/smallest by accident.
# Measured end-to-end, shape makes things WORSE:
#   as a 30% blend  : 86/87 real-frame labels (flips Buggybud -> GLA on a ghost)
#   as a tie-break  : bodies 245->230 clean, gliders 62->59, tires 22->21 with a
#                     cross-base misrank appearing (the serious kind)
# versus 87/87 and 245/22/62 with it off.
#
# This is NOT a dead end: with GOLDEN templates captured from the capture card
# itself (same renderer, same scale, card blend included) no recovery is needed
# — the shape is then exact and comes for free in the pixel comparison. Until
# then the code stays here, off, so the finding is not re-litigated.
# Set MK8_SHAPE_WEIGHT to experiment.
SHAPE_WEIGHT = float(os.environ.get("MK8_SHAPE_WEIGHT", "0.0"))
SHAPE_TOL = 0.10          # |q - card background| beyond this = icon pixel
SHAPE_MIN_FG = 0.03       # sanity band on the recovered cut-out (fraction of box)
SHAPE_MAX_FG = 0.92
SHAPE_TIE = float(os.environ.get("MK8_SHAPE_TIE", "0.03"))   # colour gap under which shape decides

# Colour-family hue is usually the right discriminator, but an achromatic
# variant (White Shy Guy, black/white variants) can look chromatic when the
# yellow player card bleeds through the diagnostic mask. If the normal pixel
# evidence on the same diagnostic mask still clearly confirms the achromatic
# raw winner, do not let hue pull it into a coloured sibling.
FAMILY_ACHROM_VETO_CHROMA = 20.0
FAMILY_ACHROM_VETO_MARGIN = 0.06


def _query_cutout(q: np.ndarray, mask: np.ndarray) -> np.ndarray | None:
    """The QUERY's own cut-out, recovered without an alpha channel.

    Pixels that NO candidate silhouette can ever occupy are card background by
    construction, so their median is a robust background estimate even when the
    icon touches the slot edge; everything far enough from it is icon. This is
    what makes the reference alpha shape usable as evidence: a Mario cut-out and
    a Yoshi cut-out differ, and comparing them only works if we know which
    pixels the frame itself considers icon."""
    outside = ~(mask > 0.5).any(0)
    if outside.sum() < 24:
        return None
    bg = np.median(q[outside], axis=0)
    fg = np.abs(q - bg[None, None]).sum(2) > SHAPE_TOL * 3.0
    frac = float(fg.mean())
    if frac < SHAPE_MIN_FG or frac > SHAPE_MAX_FG:
        return None       # crop is all background or all icon: no shape signal
    return fg


def _shape_scores(fg: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """IoU of each candidate's alpha cut-out with the query's recovered one."""
    m = mask > 0.5
    inter = (m & fg[None]).sum((1, 2)).astype(np.float32)
    union = (m | fg[None]).sum((1, 2)).astype(np.float32)
    return inter / np.maximum(union, 1.0)


def _edge_scores(q: np.ndarray, rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Correlation of the query's edge magnitude with each candidate's CUT-OUT
    EDGE (the alpha boundary) — shape evidence that needs no segmentation.

    Gradients are contrast-normalised by the correlation, so a dimmed ghost icon
    still shows its outline where the reference says the outline is; that is the
    part of the shape signal that survives the translucent card, unlike a
    thresholded silhouette."""
    g = cv2.cvtColor((np.clip(q, 0, 1) * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY).astype(np.float32)
    eq = cv2.magnitude(cv2.Sobel(g, cv2.CV_32F, 1, 0, 3), cv2.Sobel(g, cv2.CV_32F, 0, 1, 3))
    eq = (eq - eq.mean()).ravel()
    nq = float(np.sqrt((eq * eq).sum())) or 1.0
    out = np.zeros(len(rgb), np.float32)
    for i in range(len(rgb)):
        a = (mask[i] > 0.5).astype(np.float32)
        er = cv2.magnitude(cv2.Sobel(a, cv2.CV_32F, 1, 0, 3), cv2.Sobel(a, cv2.CV_32F, 0, 1, 3))
        er = (er - er.mean()).ravel()
        nr = float(np.sqrt((er * er).sum())) or 1.0
        out[i] = float((eq * er).sum() / (nq * nr))
    return out


def _per_template_gains(q: np.ndarray, rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Brightness alignment PER CANDIDATE, measured inside that candidate's own
    cut-out (its alpha mask) on both sides.

    The old code used ONE pooled gain: the mean of every candidate template
    divided by the mean of the WHOLE crop — card background included. Two things
    break on a real card:

      * the crop mean is dominated by the card, not the icon. On the bright
        yellow player card the gain clamps to its 0.6 floor and darkens the icon
        by ~37%, so its colours no longer match its own template. Measured on a
        real Peach card: the true body (Koopa Clown) fell to rank 11 and Master
        Cycle won; without the gain the same crop ranks Koopa Clown #1 at 0.797.
        Same story on a Funky Monster tyre (rank 5, Ancient won).
      * the pooled reference mean depends on WHICH OTHER CANDIDATES are in the
        pool, so the score of a candidate moved when unrelated ones were added
        or removed (measured: rank 11 pool-wide vs rank 1 on the character
        subset for the same crop). A scoring function must not do that.

    Per-candidate gain is what `_char_achromatic_rerank` (King Boo) and
    `_tire_button_rescue` (Button tyre) already did by hand as after-the-fact
    rescues; doing it in the scorer removes the reason those rescues existed."""
    qm = (q[None] * mask[..., None]).sum((1, 2, 3)) / (mask.sum((1, 2)) * 3.0 + 1e-6)
    rm = (rgb * mask[..., None]).sum((1, 2, 3)) / (mask.sum((1, 2)) * 3.0 + 1e-6)
    return np.clip(rm / np.maximum(qm, 1e-4), 0.6, 1.8).astype(np.float32)


def _gain_normalize(q: np.ndarray, ref_mean: float) -> np.ndarray:
    """Ghost-kaarten zijn gedimd en telefooncaptures hebben een kleurzweem; een
    milde globale gain-correctie op de query trekt de belichting naar het
    referentieniveau zonder de kleurverhoudingen te wijzigen."""
    m = float(q.mean())
    if m < 1e-4:
        return q
    gain = np.clip(ref_mean / m, 0.6, 1.8)
    return np.clip(q * gain, 0.0, 1.0)


def identify_crop(
    crop_bgr: np.ndarray,
    group: str,
    *,
    subset_ids: list[str] | None = None,
    offsets=None,
    gain_correct: bool = True,
    topk: int = 0,
) -> dict[str, Any]:
    """Identificeer één icoon-crop tegen een groep (of subset). Retourneert
    {id, name, asset, score, margin, top3, family}."""
    st = _ensure_loaded()
    g = st["groups"][group]
    wh = st["box"][group]
    q = _prep_query(crop_bgr, wh)
    if offsets is None:
        offsets = [(0, 0), (1, 0), (-1, 0), (0, 1), (0, -1)]

    if subset_ids:
        idx = [i for i, rid in enumerate(g["ids"]) if rid in set(subset_ids)]
        if not idx:
            idx = list(range(len(g["ids"])))
    else:
        idx = list(range(len(g["ids"])))
    rgb, mask, masksum = g["rgb"][idx], g["mask"][idx], g["masksum"][idx]
    q_raw = q  # PRE-gain: de tinthoek-refinement moet de rauwe kleuren zien
    # (gain-clipping roteert de tint: gedimd oranje x1.5 clipt R => geel)
    gains = _per_template_gains(q, rgb, mask) if gain_correct else None
    s = _scores(q, rgb, mask, masksum, offsets, gains)
    # SHAPE: the reference PNGs are cut-outs — a Mario silhouette is not a Yoshi
    # silhouette — but the colour score only ever samples INSIDE each candidate's
    # own alpha, so the cut-out itself was never evidence. A candidate whose
    # silhouette sits inside the true icon is scored on pixels that all match and
    # pays nothing for the icon area it fails to cover. Adding the IoU of the
    # candidate's alpha with the query's recovered cut-out makes shape count.
    # Applied as a TIE-BREAK, not a blend. Measured on 87 real-frame labels: a
    # flat 30% IoU blend scores 86/87 (it flips a Buggybud to a GLA on a ghost
    # card) because the query's cut-out has to be RECOVERED — on a dim
    # translucent card the threshold under-segments the icon, and IoU then
    # rewards the SMALLER silhouette. Where colour is already decisive that
    # noise can only hurt, so shape is consulted only when the top candidates
    # are within SHAPE_TIE of each other, which is exactly where the cut-out is
    # the deciding evidence.
    if SHAPE_WEIGHT > 0.0 and len(s) > 1:
        order0 = np.argsort(s)[::-1]
        if float(s[order0[0]]) - float(s[order0[1]]) <= SHAPE_TIE:
            fg = _query_cutout(q, mask)
            if fg is not None:
                near = [i for i in order0 if float(s[order0[0]]) - float(s[i]) <= SHAPE_TIE]
                sh = _shape_scores(fg, mask[near])
                edge = _edge_scores(q, rgb[near], mask[near])
                s = s.copy()
                for k, i in enumerate(near):
                    s[i] += SHAPE_WEIGHT * (0.5 * float(sh[k]) + 0.5 * float(edge[k]))
    order = np.argsort(s)[::-1]
    # Achromatische-winnaar-guard: een (bijna-)kleurloos sjabloon (sat<=0.06,
    # bv. Metal Mario) mag niet winnen van een duidelijk GEKLEURDE crop
    # (sat>=0.12): uitgewassen frames vervlakken kleuren en het egale grijs
    # wint dan op |dRGB| (live 2026-07-12: 3x confident-wrong). Herrangschik
    # naar de beste chromatische kandidaat; kleurloze CROPS blijven ongemoeid.
    sats = g["sat"][idx]
    if float(sats[order[0]]) <= 0.06:
        m0 = mask[order[0]]
        q_bgr = (q[:, :, ::-1] * 255.0).astype(np.uint8)
        q_hsv = cv2.cvtColor(q_bgr, cv2.COLOR_BGR2HSV)
        q_sat = q_hsv[:, :, 1].astype(np.float32) / 255.0
        # (b) sluit de KAART-GEEL-tintband uit (hue ~40-60 graden = OpenCV ~20-30):
        # de gele kaart-achtergrond schijnt door het template-masker en tilt de
        # crop-saturatie kunstmatig omhoog, waardoor een witte winnaar (Wolk-
        # ballonnen) ten onrechte als "gekleurd" gold. Alleen icoon-kleur telt.
        q_hue = q_hsv[:, :, 0].astype(np.float32)
        non_yellow = ((q_hue < 18) | (q_hue > 36)).astype(np.float32)
        w0 = m0 * non_yellow
        crop_sat = float((q_sat * w0).sum() / (w0.sum() + 1e-6))
        if crop_sat >= 0.12:
            chrom = [i for i in order if float(sats[i]) > 0.06]
            # (a) delta-gate: demoveer de achromatische winnaar ALLEEN als de beste
            # chromatische kandidaat binnen een kleine marge (0.02) zit. Wint de
            # achromatische duidelijk (>0.02), dan is het echt de kleurloze (witte)
            # kandidaat en houden we 'm (Wolkballonnen won met 0.033 marge, werd
            # onterecht gedemoveerd voor een 0.033 lager scorende kandidaat).
            if chrom and float(s[order[0]]) - float(s[chrom[0]]) <= 0.02:
                order = np.asarray(chrom + [i for i in order if float(sats[i]) <= 0.06])
    top = [(g["ids"][idx[i]], float(s[i])) for i in order[:3]]
    topk_list = [(g["ids"][idx[i]], float(s[i])) for i in order[:topk]] if topk else None
    rid, score = top[0]
    margin = float(top[0][1] - top[1][1]) if len(top) > 1 else 1.0
    # familie-EXTERNE marge: een runner-up binnen dezelfde kleurfamilie
    # betwist de IDENTITEIT niet (de kleur wordt apart beslist via de
    # tinthoek); identiteit concurreert pas met de beste kandidaat BUITEN
    # de familie. Kale top1-top2-marge onderschatte de zekerheid van
    # kleurfamilie-winnaars structureel (synth-audit 2026-07-14).
    fam_win = _family_of(str(rid))
    margin_ext = 1.0
    for oi in order[1:]:
        if _family_of(str(g["ids"][idx[oi]])) != fam_win:
            margin_ext = float(top[0][1] - float(s[oi]))
            break

    # familie-refinement op diagnostische pixels (karaktervarianten):
    # kleurvariant eerst via de TINTHOEK (gain/offsetrobuust — ghost-dim
    # maakte oranje->gele Yoshi op |dRGB|, avondronde 2026-07-13; hoekmarges
    # van de goede reads 12-20 graden), |dRGB| als fallback voor
    # achromatische varianten (zwarte Yoshi, chroma 14) en dunne hoekmarges
    # (uitgewassen rood, marge 4.7 graden)
    fam = _family_of(rid)
    fkey = (group, fam)
    if fkey in st["family_masks"] and (subset_ids is None):
        fidxs, dmask, dsum = st["family_masks"][fkey]
        if dsum >= 8:
            pick = None
            crop_ang, crop_mag = _chroma_angle(q_raw, dmask)
            if crop_ang is not None and crop_mag >= 20.0:
                cands = sorted(
                    (abs((crop_ang - ra + 180.0) % 360.0 - 180.0), i)
                    for i, (ra, rm) in st["family_chroma"][fkey].items()
                    if ra is not None and rm >= 20.0
                )
                if cands and (len(cands) == 1 or cands[1][0] - cands[0][0] >= 8.0):
                    pick = int(cands[0][1])
                    cur_i = g["ids"].index(rid)
                    cur_chroma = (st["family_chroma"][fkey].get(cur_i) or (None, 99.0))[1]
                    if cur_i != pick and cur_chroma < FAMILY_ACHROM_VETO_CHROMA:
                        kandidaten0 = list(fidxs)
                        kmask0 = np.broadcast_to(dmask, (len(kandidaten0),) + dmask.shape)
                        kgains0 = _per_template_gains(q, g["rgb"][kandidaten0], kmask0) if gain_correct else None
                        ds0 = _scores(q, g["rgb"][kandidaten0], kmask0,
                                      np.full(len(kandidaten0), dsum), [(0, 0)], kgains0)
                        if cur_i in kandidaten0 and pick in kandidaten0:
                            cur_s = float(ds0[kandidaten0.index(cur_i)])
                            pick_s = float(ds0[kandidaten0.index(pick)])
                            if cur_s - pick_s >= FAMILY_ACHROM_VETO_MARGIN:
                                pick = cur_i
            kandidaten = list(fidxs)
            # ghost-dim voegt een zwakke kleurwaas toe die achromatische varianten
            # (zwarte Yoshi, chroma-tmpl 5.5) op gedimde ghost-crops tot chroma
            # ~12-18 tilt -> in het 12-20-gat koos |dRGB| ten onrechte een gekleurde
            # variant (blauw). Ruimere achromatische-restrictie ALLEEN voor
            # characters (echte blauwe ghost-Yoshi meet >=19); voor bodies gaf een
            # bredere drempel synth-regressies op bodies/dim (nooit identiteit
            # flippen op kleur) -> die blijven op <12.
            achrom_mag_max = 18.5 if group == "characters" else 12.0
            if pick is None and crop_mag < achrom_mag_max:
                # (bijna-)kleurloze crop: alleen ACHROMATISCHE varianten doen
                # mee in de |dRGB|-fallback — de dRGB flipte zwart<->blauw op
                # gedimde pristine ghost-crops (avond 2026-07-13: zelfde ghost
                # las 19:24 zwart en 19:43 blauw; zwart meet chroma 6-10,
                # echte blauwe ghost >=19)
                achrom = [i for i in fidxs
                          if (st["family_chroma"][fkey].get(i) or (None, 99.0))[1] < 20.0]
                if achrom:
                    kandidaten = achrom
            if pick is not None:
                rid = g["ids"][pick]
            else:
                kmask = np.broadcast_to(dmask, (len(kandidaten),) + dmask.shape)
                # same per-candidate brightness alignment as the main score,
                # measured here on the family's diagnostic pixels
                kgains = _per_template_gains(q, g["rgb"][kandidaten], kmask) if gain_correct else None
                ds = _scores(q, g["rgb"][kandidaten], kmask,
                             np.full(len(kandidaten), dsum), [(0, 0)], kgains)
                fbest = int(np.argmax(ds))
                rid = g["ids"][kandidaten[fbest]]
    # sibling-paar (villager m/v): vormidentiek, alleen haarKLEUR verschilt —
    # de tinthoek op de paar-diagnostiek beslist, en alleen bij een sterke
    # hoekmarge (>=8 graden); anders blijft de whole-box-keuze staan
    pkey = (st.get("sibling_pair_of") or {}).get(rid)
    if pkey is not None and subset_ids is None and pkey in st["family_masks"]:
        pidxs, pmask, _psum = st["family_masks"][pkey]
        p_ang, p_mag = _chroma_angle(q_raw, pmask)
        if p_ang is not None and p_mag >= 20.0:
            pc = sorted(
                (abs((p_ang - ra + 180.0) % 360.0 - 180.0), i)
                for i, (ra, rm) in st["family_chroma"][pkey].items()
                if ra is not None and rm >= 20.0
            )
            # vorm-evidence (knotjes-regio, alleen in het meisje-silhouet):
            # roze knot => meisje-achtig; chroma<10 => zeker GEEN knot
            vorm = (st.get("sibling_pair_shape") or {}).get(pkey)
            meisjeachtig = zeker_geen_knot = False
            if vorm is not None:
                b_ang, b_mag = _chroma_angle(q_raw, vorm["mask"])
                meisjeachtig = (
                    b_ang is not None and b_mag >= 15.0 and vorm["female_angle"] is not None
                    and abs((b_ang - vorm["female_angle"] + 180.0) % 360.0 - 180.0) <= 30.0
                )
                zeker_geen_knot = b_mag < 10.0
            if len(pc) >= 2 and pc[1][0] - pc[0][0] >= 8.0:
                # tint beslist, vorm heeft veto: flip richting meisje alleen
                # bij meisje-achtige knot, en van meisje weg alleen zonder
                doel = g["ids"][int(pc[0][1])]
                akkoord = True
                if vorm is not None:
                    akkoord = meisjeachtig if doel == vorm["female_rid"] else not meisjeachtig
                if akkoord:
                    rid = doel
            elif vorm is not None and rid == vorm["female_rid"] and zeker_geen_knot and pc:
                # vorm beslist ZELF bij tegenstrijdigheid: een 'meisje'-winnaar
                # zonder enige knot-chroma bestaat niet — kies het beste
                # niet-meisje-lid volgens de tinthoek (192400: hoekmarge zakte
                # op het trio-masker tot 5.5° maar de knot-regio was leeg)
                for _d, i2 in pc:
                    if g["ids"][int(i2)] != vorm["female_rid"]:
                        rid = g["ids"][int(i2)]
                        break
    out = {
        "id": rid,
        "name": st["display_names"].get(rid, rid),
        "asset": st["asset_paths"].get(rid, ""),
        "score": round(score, 4),
        "margin": round(margin, 4),
        "margin_ext": round(margin_ext, 4),
        "top3": [(r, round(v, 4)) for r, v in top],
        "family": fam,
    }
    if topk_list is not None:
        out["topk"] = [(r, round(v, 4)) for r, v in topk_list]
    return out


def parts_subset_for_character(char_id: str, group: str) -> list[str] | None:
    """Kleurset van dit karakter voor bodies/gliders: één template per basispart
    (variant als het karakter er één heeft, anders het basispart)."""
    st = _ensure_loaded()
    mapping = (st["char_to_parts"].get(char_id) or {}).get(group) or {}
    g = st["groups"][group]
    base_ids = [rid for rid in g["ids"] if not rid.split(".")[0].endswith("_variant")]
    subset = []
    for base in base_ids:
        subset.append(mapping.get(base, base))
    return subset or None


def state_summary() -> dict[str, Any]:
    st = _ensure_loaded()
    return {
        "root": str(assets_root()),
        "schema": st["db_schema"],
        "groups": {g: len(v["ids"]) for g, v in st["groups"].items()},
        "load_ms": st["load_ms"],
    }


# --------------------------------------------------------------------------
# Grid-registratie: deploy-geleide slotboxen + per-kaart 2D-uitlijning.
#
# De PerspectiveWarp levert geen perfecte screencapture: per kaart resteert een
# translatie (ghost tot ~40 px omlaag gezien) en een anisotrope schaal (de
# rijafstand krimpt onafhankelijk van de breedte). Registratie = edge-magnitude
# TM_CCOEFF_NORMED van een empirisch kaarttemplate (mediaan van uitgelijnde
# kaarten) in een zoekvenster rond de nominale kaartbox; gemeten op 48 kaarten:
# slot-residu mediaan 1 px, p90 3-5 px (was p90 4-14, max 43). Zwakke correlatie
# (semi-transparante kaart boven drukke scène) => identiteit als fallback.
# --------------------------------------------------------------------------

KIND_GROUP = {"character": "characters", "kart": "bodies", "wheel": "tires", "glider": "gliders", "flag": "flags"}
# deploy-anchorruimte -> kaartruimte: kaartmaat in deploy-px (kalibratie
# 2026-07-12 op de v1-grid-slotcentra; alle 5 centra passen binnen ~1 px)
DEPLOY_CARD = {"3laps": (682.0, 227.0), "7laps": (682.0, 297.4)}
_TEMPLATE_DIR = Path(__file__).resolve().parent / "data" / "kart_config_card_templates"
_REG_HALF = 0.5
_REG_PAD_X, _REG_PAD_UP, _REG_PAD_DOWN = 26, 34, 50


def deploy_slot_boxes(laps: str, cw: float, ch: float) -> dict[str, tuple[float, float, float, float]]:
    """Volledige deploy-iconboxen (x,y,w,h) in kaartpixels, per kind."""
    det = _ensure_loaded()["detection"]
    offs = det["anchor"]["offsets"]["3lap" if laps == "3laps" else "7lap"]
    sizes = det["boxSizes"]
    dw, dh = DEPLOY_CARD[laps]
    return {k: (offs[g][0] / dw * cw, offs[g][1] / dh * ch, sizes[g][0] / dw * cw, sizes[g][1] / dh * ch)
            for k, g in KIND_GROUP.items()}


def _edge_mag(gray_f32: np.ndarray) -> np.ndarray:
    gx = cv2.Sobel(gray_f32, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray_f32, cv2.CV_32F, 0, 1, ksize=3)
    return cv2.magnitude(gx, gy)


def _card_template(owner: str, laps: str) -> np.ndarray | None:
    key = f"tmpl_{owner}_{laps}"
    if key not in _STATE:
        p = _TEMPLATE_DIR / f"{owner}_{laps}.png"
        im = cv2.imread(str(p), cv2.IMREAD_GRAYSCALE)
        _STATE[key] = im.astype(np.float32) if im is not None else None
    return _STATE[key]


def register_card(image_bgr: np.ndarray, card_box, owner: str, laps: str, *, score_min: float = 0.35) -> dict[str, Any] | None:
    """Per-kaart transform (content_x = cx1 + dx + sx*x_nom). None = geen
    template voor deze modus (caller valt terug op het oude pad)."""
    templ = _card_template(owner, laps)
    if templ is None:
        return None
    cx1, cy1, cx2, cy2 = card_box
    cw, ch = cx2 - cx1, cy2 - cy1
    H, W = image_bgr.shape[:2]
    rx1 = max(0, int(cx1 - _REG_PAD_X)); ry1 = max(0, int(cy1 - _REG_PAD_UP))
    rx2 = min(W, int(cx2 + _REG_PAD_X)); ry2 = min(H, int(cy2 + _REG_PAD_DOWN))
    if rx2 - rx1 < 32 or ry2 - ry1 < 32:
        return {"dx": 0.0, "dy": 0.0, "sx": 1.0, "sy": 1.0, "score": 0.0, "fallback": True}
    gray_full = cv2.cvtColor(image_bgr[ry1:ry2, rx1:rx2], cv2.COLOR_BGR2GRAY).astype(np.float32)
    edges_full = _edge_mag(gray_full)
    region = cv2.resize(edges_full, (int(edges_full.shape[1] * _REG_HALF), int(edges_full.shape[0] * _REG_HALF)), interpolation=cv2.INTER_AREA)
    best = None
    for sy in np.linspace(0.94, 1.04, 6):
        for sx in (0.97, 1.0, 1.03):
            tw = int(round(cw * _REG_HALF * sx)); th = int(round(ch * _REG_HALF * sy))
            if tw < 8 or th < 8 or tw > region.shape[1] or th > region.shape[0]:
                continue
            t = cv2.resize(templ, (tw, th), interpolation=cv2.INTER_AREA)
            res = cv2.matchTemplate(region, t, cv2.TM_CCOEFF_NORMED)
            _, mx, _, mxloc = cv2.minMaxLoc(res)
            score = float(mx) - 0.25 * (abs(sy - 1.0) + abs(sx - 1.0))
            if best is None or score > best[0]:
                best = (score, mxloc[0], mxloc[1], float(sx), float(sy), float(mx))
    if best is None or best[5] < score_min:
        return {"dx": 0.0, "dy": 0.0, "sx": 1.0, "sy": 1.0, "score": 0.0 if best is None else best[5], "fallback": True}
    _, lx, ly, sx, sy, raw = best
    # full-res-verfijning in een klein venster rond de grove vondst
    tw = int(round(cw * sx)); th = int(round(ch * sy))
    t_full = cv2.resize(templ, (tw, th), interpolation=cv2.INTER_LINEAR)
    fx = int(round(lx / _REG_HALF)); fy = int(round(ly / _REG_HALF))
    m = 5
    wx1 = max(0, fx - m); wy1 = max(0, fy - m)
    wx2 = min(edges_full.shape[1], fx + tw + m); wy2 = min(edges_full.shape[0], fy + th + m)
    win = edges_full[wy1:wy2, wx1:wx2]
    if win.shape[0] >= th and win.shape[1] >= tw:
        res = cv2.matchTemplate(win, t_full, cv2.TM_CCOEFF_NORMED)
        _, mx2, _, loc2 = cv2.minMaxLoc(res)
        if mx2 >= raw - 0.05:
            fx, fy, raw = wx1 + loc2[0], wy1 + loc2[1], float(mx2)

    def _half_score(x_van: int, x_tot: int) -> float:
        """NCC van een template-HELFT op de gevonden positie: de tijden lezen
        bewijst alleen de RECHTERkant (digitstrips); een lage linkerscore
        verraadt het faalpatroon 'rechts goed, icoonkolom links scheef'
        (gebruikersobservatie 2026-07-14, 3/40 label-frames)."""
        t_h = t_full[:, x_van:x_tot]
        y2c = min(edges_full.shape[0], fy + th)
        x2c = min(edges_full.shape[1], fx + x_tot)
        r_h = edges_full[fy:y2c, fx + x_van:x2c]
        if r_h.shape[0] < 8 or r_h.shape[1] < 8 or r_h.shape != t_h[:r_h.shape[0], :r_h.shape[1]].shape:
            t_h = t_h[:r_h.shape[0], :r_h.shape[1]]
        if t_h.size < 64 or r_h.size < 64:
            return 0.0
        a = t_h - t_h.mean()
        b = r_h - r_h.mean()
        den = float(np.sqrt((a * a).sum() * (b * b).sum()))
        return float((a * b).sum() / den) if den > 1e-6 else 0.0

    helft = tw // 2
    return {"dx": float(rx1 + fx - cx1), "dy": float(ry1 + fy - cy1), "sx": sx, "sy": sy, "score": raw,
            "score_links": round(_half_score(0, helft), 3), "score_rechts": round(_half_score(helft, tw), 3),
            "fallback": False}


def _sized_group(group: str, tw: int, th: int):
    """Templates+3ch-maskers+maskersommen van een groep op slotmaat, gecachet.
    De slotmaat is constant per owner/laps-modus, dus dit bakt één keer."""
    st = _ensure_loaded()
    g = st["groups"][group]
    cache = _STATE.setdefault("sized_native", {})
    key = (group, tw, th)
    if key not in cache:
        rgbs = np.stack([cv2.resize(g["rgb"][i], (tw, th), interpolation=cv2.INTER_AREA) for i in range(len(g["ids"]))]).astype(np.float32)
        m1 = np.stack([(cv2.resize(g["mask"][i], (tw, th), interpolation=cv2.INTER_AREA) > 0.5).astype(np.float32) for i in range(len(g["ids"]))])
        m3 = np.ascontiguousarray(np.repeat(m1[:, :, :, None], 3, 3))
        cache[key] = (np.ascontiguousarray(rgbs), m3, m3.sum((1, 2, 3)))
    return cache[key]


def chars_for_part_variant(group: str, base_id: str, variant_id: str) -> list[str]:
    """Characters (incl. character-varianten) wier kleurset dit basispart in
    precies deze kleurvariant geeft — de omgekeerde relatie van
    parts_subset_for_character."""
    st = _ensure_loaded()
    return [cid for cid, groups in st["char_to_parts"].items()
            if (groups.get(group) or {}).get(base_id) == variant_id]


def identify_crop_search(image_bgr: np.ndarray, box, group: str, *, subset_ids: list[str] | None = None, search: int = 6, gain_correct: bool = True, topk: int = 0, scales: list[float] | None = None) -> dict[str, Any]:
    """Identificeer een slot met positie-zoek (±search px) in NATIEVE kaartpixels.

    Kandidaten komen uit een eerste (gevectoriseerde) identify_crop op de
    nominale positie; alleen de top-3 doet een masked TM_SQDIFF-positiezoek
    (mediaanpositie), waarna identify_crop op de her-gepositioneerde crop de
    definitieve uitslag geeft (zelfde score/marge-semantiek als het
    niet-zoekende pad). Retourneert extra: dx, dy.

    scales: optionele schaal-sweep (bv. [0.94,0.97,1.0,1.03,1.06]) om het
    SCHAAL-residu van de registratie-fit te vangen (translatie-zoek alleen kan
    dat niet). Per schaal wordt de box om het midden herschaald en de positie-
    zoek herhaald; de hoogst-scorende (positie,schaal) wint. None/[]/[1.0] =
    byte-identiek gedrag (2026-07-15: default UIT; dode-zone-bewijs op s06 =
    juiste character 0.77->0.84 bij de juiste lokale schaal)."""
    if scales and any(abs(float(s) - 1.0) > 1e-6 for s in scales):
        x, y, w, h = box
        cx, cy = x + w / 2.0, y + h / 2.0
        best_s = None
        for s in scales:
            w2, h2 = w * float(s), h * float(s)
            out = identify_crop_search(image_bgr, (cx - w2 / 2.0, cy - h2 / 2.0, w2, h2),
                                       group, subset_ids=subset_ids, search=search,
                                       gain_correct=gain_correct, topk=topk, scales=None)
            out["scale"] = float(s)
            if best_s is None or float(out.get("score", 0.0)) > float(best_s.get("score", 0.0)):
                best_s = out
        return best_s if best_s is not None else identify_crop_search(
            image_bgr, box, group, subset_ids=subset_ids, search=search,
            gain_correct=gain_correct, topk=topk, scales=None)
    st = _ensure_loaded()
    g = st["groups"][group]
    x, y, w, h = box
    tw, th = int(round(w)), int(round(h))
    H, W = image_bgr.shape[:2]
    x1 = int(round(x)); y1 = int(round(y))
    crop0 = image_bgr[max(0, y1):y1 + th, max(0, x1):x1 + tw]
    if crop0.size == 0:
        return {"id": None, "name": "", "asset": "", "score": 0.0, "margin": 0.0, "top3": [], "family": "", "dx": 0, "dy": 0}
    out0 = identify_crop(crop0, group, subset_ids=subset_ids, gain_correct=gain_correct, offsets=[(0, 0)], topk=topk)
    out0.update({"dx": 0, "dy": 0})
    wx1 = max(0, x1 - search); wy1 = max(0, y1 - search)
    wx2 = min(W, x1 + tw + search); wy2 = min(H, y1 + th + search)
    win = image_bgr[wy1:wy2, wx1:wx2]
    if tw < 8 or th < 8 or win.shape[0] < th or win.shape[1] < tw:
        return out0
    id_to_idx = {rid: i for i, rid in enumerate(g["ids"])}
    rgbs, m3s, msums = _sized_group(group, tw, th)
    q = cv2.cvtColor(win, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    if gain_correct:
        ref_mean = float((rgbs * m3s[:, :, :, :1]).sum() / (m3s.sum() + 1e-6))
        m = float(q.mean())
        if m > 1e-4:
            q = np.clip(q * np.float32(np.clip(ref_mean / m, 0.6, 1.8)), 0.0, 1.0).astype(np.float32)
    q = np.ascontiguousarray(q)
    # itereren: scheve crops kunnen in ronde 1 verkeerde kandidaten ranken;
    # na de verplaatsing worden de kandidaten opnieuw bepaald (convergeert)
    best = out0
    cur = (0, 0)
    for _ in range(2):
        cand = [id_to_idx[rid] for rid, _ in (best.get("top3") or []) if rid in id_to_idx]
        pos_best = None  # (genormaliseerde sqdiff-score, x, y)
        for i in cand:
            if msums[i] < 24:
                continue
            res = cv2.matchTemplate(q, rgbs[i], cv2.TM_SQDIFF, mask=m3s[i])
            res = np.nan_to_num(res, nan=1e12, posinf=1e12)
            mn, _, mnloc, _ = cv2.minMaxLoc(res)
            sc = 1.0 - float(mn) / float(msums[i])
            if pos_best is None or sc > pos_best[0]:
                pos_best = (sc, mnloc[0], mnloc[1])
        if pos_best is None:
            break
        bx, by = pos_best[1], pos_best[2]
        dx = wx1 + bx - x1; dy = wy1 + by - y1
        if (dx, dy) == cur:
            break
        crop = win[by:by + th, bx:bx + tw]
        out = identify_crop(crop, group, subset_ids=subset_ids, gain_correct=gain_correct, offsets=[(0, 0)], topk=topk)
        if float(out["score"]) < float(best["score"]):
            break  # verschuiving hielp niet; hou de beste uitslag tot nu toe
        out.update({"dx": dx, "dy": dy})
        best = out
        cur = (dx, dy)
    return best
