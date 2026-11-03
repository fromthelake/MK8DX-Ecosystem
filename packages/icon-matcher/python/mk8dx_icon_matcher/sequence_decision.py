"""The central sequence decision for a Time Trial scan (CENTRAL_RECOGNITION section 8.6, phase 6).

One specification in Python (this reference), TypeScript (``ts/sharedSequenceDecision.ts``) and
Java (``SequenceDecision.java``): the agreement over the frames of one scan, which the Web scanner
(``scanSession.ts``) and Android (``ScanConsensusSession.kt``) each carried as a line-for-line port.

Times, an evidence ladder; the first rung a frame reaches locks the times:

1. ``direct_lap_som`` — a frame whose lap sum closes without repair and that read every expected
   field (at least two);
2. ``bevestigd_na_reparatie`` — two consecutive repaired frames that read the same fields;
3. ``veld_stemming`` — per field, the value with at least 3 votes and a lead of at least 2 over the
   runner-up (a frame whose lap sum closes counts double), for every expected field.

A time counts only as ``d:dd.ddd``; a lap whose seconds start above 5 is repaired to 0 when that
makes the laps add up to a sane total, otherwise dropped.

Identity, a vote per slot (``owner|kind``) on the ID (else the index), an accepted read counting
double; the best-scoring accepted observation of the winning key describes it. A slot is accepted
when its winner is not contested (runner-up below the winner) and its observation was accepted;
an unaccepted slot keeps its observation's alternatives. The printed rider name is a plain vote.
Identity is settled (the scan can stop early) when every slot's winner has at least 2 votes, all
votes agree and the winner was accepted, over at least two identity frames.

Iteration order is insertion order everywhere (first best wins on ties), as in both products.
"""

from __future__ import annotations

import re

FIELD_MIN_SUPPORT = 3
FIELD_MIN_MARGIN = 2
ACCEPTED_VOTE_WEIGHT = 2
KINDS = ("character", "kart", "wheel", "glider", "flag")
_TIME = re.compile(r"[0-9]:[0-9][0-9]\.[0-9][0-9][0-9]")
_TRIM = " \t\r\n"


def _millis(value: str) -> int:
    return (ord(value[0]) - 48) * 60000 + (ord(value[2]) - 48) * 10000 + (ord(value[3]) - 48) * 1000 + \
        int(value[5:])


def _repair_impossible_seconds(valid: dict) -> None:
    for owner in ("player", "ghost"):
        total = valid.get(f"{owner}_total")
        if total is None or total[2] > "5":
            continue
        lap_keys = []
        for lap in range(1, 8):
            key = f"{owner}_lap_{lap}"
            if key not in valid:
                break
            lap_keys.append(key)
        if len(lap_keys) < 2:
            continue
        total_sum = 0
        broken = None
        for key in lap_keys:
            value = valid[key]
            if value[2] > "5":
                if broken is not None:
                    return
                broken = key
            total_sum += _millis(value)
        if broken is None:
            continue
        value = valid[broken]
        fixed = value[:2] + "0" + value[3:]
        if total_sum - _millis(value) + _millis(fixed) == _millis(total):
            valid[broken] = fixed


def field_vote(values, min_support: float = 0.0, min_margin: float = 0.0) -> dict | None:
    """The shared multi-frame vote for one field: ``values`` are ``(value, weight)`` per frame (empty
    values are skipped, negative weights count as 0, as Tournament Live did). Weights sum per value in
    first-seen order; the highest sum wins, the first on a tie (the first value when every weight is 0). The winner needs ``min_support`` and a lead
    of ``min_margin`` over the runner-up, else None. Presets: the Time Trial ladder's field vote uses
    support 3 and lead 2 with weight 2 for a frame whose lap sum closed; Tournament Live uses 0/0 with
    OCR confidence as the weight. Returns the value, its weight, the runner-up's and its share."""
    sums: dict = {}
    total = 0.0
    for value, weight in values:
        if value is None or value == "":
            continue
        w = max(0.0, float(weight))
        sums[value] = sums.get(value, 0.0) + w
        total += w
    if not sums:
        return None
    value, best, second = _best(sums)
    if value is None:  # every weight 0: the first value, with no support
        value, best, second = next(iter(sums)), 0.0, 0.0
    if best < min_support or best - second < min_margin:
        return None
    return {"value": value, "weight": best, "second": second, "share": best / total if total > 0 else 0.0}


def _best(votes: dict) -> tuple:
    best_key, best, second = None, 0, 0
    for key, count in votes.items():
        if count > best:
            second, best, best_key = best, count, key
        elif count > second:
            second = count
    return best_key, best, second


class SequenceDecision:
    def __init__(self) -> None:
        self.locked = False
        self.accept_path = ""
        self.locked_fields: dict = {}
        self.frames_analyzed = 0
        self.accepted_frames = 0
        self.identity_frames = 0
        self._frames: list = []
        self._accepted: list = []
        self._repair_candidate: dict | None = None
        self._expected = 0
        self._votes: dict = {}
        self._meta: dict = {}
        self._names: dict = {}

    # ------------------------------------------------------------------ times
    def update_times(self, fields: dict | None, lap_sum_ok: bool, lap_sum_repairs: int, expected_fields: int) -> bool:
        """One analysed frame's times; True when this frame locked the times."""
        self.frames_analyzed += 1
        if not fields:
            return False
        if expected_fields > 0:
            self._expected = expected_fields
        valid = {key: value for key, value in fields.items()
                 if isinstance(value, str) and len(value) == 8 and _TIME.fullmatch(value)}
        _repair_impossible_seconds(valid)
        valid = {key: value for key, value in valid.items() if value[2] <= "5"}
        if not valid:
            return False
        self._frames.append(valid)
        self._accepted.append(bool(lap_sum_ok))
        if lap_sum_ok:
            self.accepted_frames += 1
        if self.locked:
            return False
        if lap_sum_ok and lap_sum_repairs == 0 and len(valid) >= max(2, self._expected):
            self._lock(valid, "direct_lap_som")
            return True
        if lap_sum_ok and lap_sum_repairs > 0:
            if self._repair_candidate is not None and self._repair_candidate == valid:
                self._lock(valid, "bevestigd_na_reparatie")
                return True
            self._repair_candidate = dict(valid)
        candidate = self._field_vote_candidate()
        required = self._expected if self._expected > 0 else len(valid)
        if required > 0 and len(candidate) >= required:
            self._lock(candidate, "veld_stemming")
            return True
        return False

    def _lock(self, fields: dict, path: str) -> None:
        self.locked = True
        self.accept_path = path
        self.locked_fields = dict(fields)

    def _field_vote_candidate(self) -> dict:
        votes: dict = {}
        for index, fields in enumerate(self._frames):
            weight = ACCEPTED_VOTE_WEIGHT if self._accepted[index] else 1
            for key, value in fields.items():
                votes.setdefault(key, []).append((value, weight))
        candidate = {}
        for key, values in votes.items():
            won = field_vote(values, FIELD_MIN_SUPPORT, FIELD_MIN_MARGIN)
            if won is not None:
                candidate[key] = won["value"]
        return candidate

    # --------------------------------------------------------------- identity
    def add_identity(self, owners: dict | None) -> None:
        """One frame's identity reads: ``{owner: {kind: observation, "card_name": text}}``; an
        observation carries ``id`` or ``index``, ``ok``, ``score`` and whatever the product shows
        (name, asset_ref, crop, alternatives)."""
        if owners is None:
            return
        self.identity_frames += 1
        for owner, match in owners.items():
            if not isinstance(match, dict):
                continue
            card_name = match.get("card_name")
            card_name = card_name.strip(_TRIM) if isinstance(card_name, str) else ""
            if card_name:
                votes = self._names.setdefault(owner, {})
                votes[card_name] = votes.get(card_name, 0) + 1
            for kind in KINDS:
                result = match.get(kind)
                if not isinstance(result, dict):
                    continue
                if result.get("id") is not None:
                    vote_key = str(result["id"])
                elif result.get("index") is not None:
                    vote_key = str(result["index"])
                else:
                    vote_key = ""
                if not vote_key:
                    continue
                slot = f"{owner}|{kind}"
                votes = self._votes.setdefault(slot, {})
                ok = result.get("ok") is True
                votes[vote_key] = votes.get(vote_key, 0) + (ACCEPTED_VOTE_WEIGHT if ok else 1)
                meta = self._meta.setdefault(slot, {})
                previous = meta.get(vote_key)
                if previous is None or (ok and previous.get("ok") is not True) or \
                        _score(result) > _score(previous):
                    meta[vote_key] = result

    def identity_settled(self) -> bool:
        if self.identity_frames < 2 or not self._votes:
            return False
        for slot, votes in self._votes.items():
            best_key, best, total = None, 0, 0
            for key, count in votes.items():
                total += count
                if count > best:
                    best, best_key = count, key
            if best_key is None or best < 2 or best != total:
                return False
            meta = self._meta.get(slot, {}).get(best_key)
            if meta is None or meta.get("ok") is not True:
                return False
        return True

    def identity_snapshot(self) -> dict:
        out: dict = {}
        for slot, votes in self._votes.items():
            owner, kind = slot.split("|", 1)
            best_key, best, second = _best(votes)
            if best_key is None:
                continue
            meta = self._meta.get(slot, {}).get(best_key)
            uncertain = second >= best or meta is None or meta.get("ok") is not True
            entry = {
                "id": "" if meta is None or meta.get("id") is None else str(meta["id"]),
                "index": -1 if meta is None or meta.get("index") is None else int(meta["index"]),
                "name": (meta or {}).get("name") or "",
                "asset_ref": (meta or {}).get("asset_ref") or "",
                "score": _score(meta),
                "ok": not uncertain,
                "votes": best,
                "frames": self.identity_frames,
            }
            for crop in ("crop_png", "crop_path"):
                if isinstance((meta or {}).get(crop), str):
                    entry[crop] = meta[crop]
            alternatives = (meta or {}).get("alternatives")
            if uncertain and isinstance(alternatives, list) and alternatives:
                entry["alternatives"] = alternatives
            out.setdefault(owner, {})[kind] = entry
        for owner, votes in self._names.items():
            best_name, best = None, 0
            for name, count in votes.items():
                if count > best:
                    best, best_name = count, name
            if best_name is not None:
                out.setdefault(owner, {})["card_name"] = best_name
        return out

    def result(self) -> dict:
        """The sequence decision as the central scan result reads it (``scan_result``)."""
        return {"locked": self.locked, "acceptPath": self.accept_path, "fields": dict(self.locked_fields),
                "identity": self.identity_snapshot(), "framesAnalyzed": self.frames_analyzed,
                "acceptedFrames": self.accepted_frames}


def _score(observation) -> float:
    if not isinstance(observation, dict):
        return 0.0
    score = observation.get("score")
    return float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else 0.0
