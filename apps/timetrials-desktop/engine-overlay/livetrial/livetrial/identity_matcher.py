#!/usr/bin/env python3
"""De MK8DX Clean Assets deploy-database voor de engine.

De deploy-map (database.json + images/) is de LEIDENDE bron. Deze module leest de
database (``_load_db``, ``_ensure_loaded``), noemt de referentie-afbeeldingen die het
dashboard onder /assets serveert (``_reference_sources``) en geeft de deploy-slotboxen
van een resultaatkaart (``deploy_slot_boxes``). De iconen zelf leest de centrale lezer
(packages/icon-matcher); de eigen matcher van de engine is weg (issue #99, fase 5).

Locatie van de deploy-map: env MK8_CLEAN_ASSETS_ROOT of de standaardlocatie
hieronder.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any


PACKAGED_ROOT = Path(__file__).resolve().parents[2] / "MK8DX Clean Assets"
DEFAULT_ROOT = PACKAGED_ROOT if PACKAGED_ROOT.is_dir() else Path(r"path\to\clean-assets - deploy")


def assets_root() -> Path:
    override = os.environ.get("MK8_CLEAN_ASSETS_ROOT", "").strip()
    return Path(override) if override else DEFAULT_ROOT


_STATE: dict[str, Any] = {}


def _load_db() -> dict:
    return json.loads((assets_root() / "database.json").read_text(encoding="utf-8"))


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
    """Lazy: the deploy database and its detection geometry, once per process."""
    if _STATE.get("loaded"):
        return _STATE
    db = _load_db()
    _STATE.update({"loaded": True, "db": db, "db_schema": db.get("schemaVersion"), "detection": db["detection"]})
    return _STATE


# The engine's own icon matcher (identify_crop, its crop search, the shape and
# card-registration experiments) was removed on 2026-11-14 (issue #99, phase 5):
# every field, the Select-a-Ghost panel included, is read by the central reader
# (packages/icon-matcher). Without it the identity fields stay unknown, as
# runner.py says. What remains here is what the engine still uses: the deploy
# database, its reference list (the dashboard's /assets) and the slot boxes.
# Measured and kept as a finding: shape evidence from a recovered cut-out made
# results worse through the translucent ghost card (IoU 0.36 against 0.93 on
# the opaque player card; 86/87 labels as a blend, 87/87 without).


# --------------------------------------------------------------------------
# Deploy-geleide slotboxen. (De per-kaart registratie is weg: op de vaste
# HDMI-grid van de capturekaart voegde ze alleen residu toe, zie identity.py.)
# --------------------------------------------------------------------------

KIND_GROUP = {"character": "characters", "kart": "bodies", "wheel": "tires", "glider": "gliders", "flag": "flags"}
# deploy-anchorruimte -> kaartruimte: kaartmaat in deploy-px (kalibratie
# 2026-07-12 op de v1-grid-slotcentra; alle 5 centra passen binnen ~1 px)
DEPLOY_CARD = {"3laps": (682.0, 227.0), "7laps": (682.0, 297.4)}


def deploy_slot_boxes(laps: str, cw: float, ch: float) -> dict[str, tuple[float, float, float, float]]:
    """Volledige deploy-iconboxen (x,y,w,h) in kaartpixels, per kind."""
    det = _ensure_loaded()["detection"]
    offs = det["anchor"]["offsets"]["3lap" if laps == "3laps" else "7lap"]
    sizes = det["boxSizes"]
    dw, dh = DEPLOY_CARD[laps]
    return {k: (offs[g][0] / dw * cw, offs[g][1] / dh * ch, sizes[g][0] / dw * cw, sizes[g][1] / dh * ch)
            for k, g in KIND_GROUP.items()}


