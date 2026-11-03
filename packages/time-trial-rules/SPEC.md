# Time Trial validation specification

Rules version: **1.0.0** · Submission contract: **`mk8dx.time-trial-submission.v1`**
(`packages/domain/schemas/time-trial-submission-v1.schema.json`).

Status: design-system Phase 3 (POST_A_TIME_ARCHITECTURE §4, TESTING_STRATEGY §4.10).
The specification, the golden cases, both implementations and the runners exist.
**Nothing is wired into a form yet**: the web entry form, the Android manual screen
and the Android scan review keep their own checks until Phase 7 replaces them.

| Artefact | Path |
|---|---|
| This specification | `packages/time-trial-rules/SPEC.md` |
| Machine-readable rules and EN/NL messages | `packages/time-trial-rules/rules.json` |
| Golden conformance cases | `packages/time-trial-rules/conformance/cases.json` |
| TypeScript implementation (web, PWA, scanner service) | `packages/time-trial-rules/src/index.ts` |
| Kotlin implementation (Android) | `apps/timetrials-android/app/src/main/java/nl/mariokart8/mk8dxtimetrials/rules/TimeTrialRules.kt` |
| TS runner + rule-id guard | `packages/time-trial-rules/test/conformance.test.ts`, `test/guard.test.ts` |
| Kotlin runner | `apps/timetrials-android/app/src/test/java/nl/mariokart8/mk8dxtimetrials/rules/TimeTrialRulesConformanceTest.kt` |
| Server runner (payload subset) | `backend/api/test/time-trial-rules-conformance.test.ts` |

**The server stays the authority.** `validateTimeTrialSubmission`
(`backend/api/src/timetrials/submission-service.ts`) decides what is stored. This
specification describes the canonical *form* validation: it may be stricter than the
server (it knows the track's lap count and the Player's input), but a payload it
calls valid must always be accepted by the server; the server runner proves that for
every valid case. Where the spec and the server disagree the difference is listed in
§7 for a maintainer decision; neither side was changed to hide it.

## 1. Inputs

```
validateDraft(draft, context) → { valid, errors: [{ field, rule, messageKey, params }], payload | null }
```

**Draft** (the validation-relevant part of `SubmissionDraft`, POST_A_TIME §3):

| Field | Type | Meaning |
|---|---|---|
| `trackId` | string or null | Schema-9 track id from the page context or the TrackSelector; never from the scanner |
| `totalDigits` | string or null | The six entry digits `M SS mmm`: `"145912"` is 1:45.912 |
| `laps` | array of LapDraft | The lap rows the form shows (normally `trackLapCount` rows); may be empty |
| `laps[i].timeDigits` | string or null | Six digits; `""`/null is a blank row |
| `laps[i].coinChange` | integer or null | Signed coin change during the lap (canonical entry); null = not entered |
| `laps[i].mushroomsUsed` | integer or null | Mushrooms used in the lap; null = not recorded |
| `loadout` | object | `characterId`, `characterVariantId`, `bodyId`, `bodyVariantId`, `tireId`, `gliderId`, `gliderVariantId`; `""`/null = not recorded |
| `origin`, `corrected` | UI hints | **Ignored by validation.** Typed, scanned and scanned-then-corrected values obey the same rules |

**Context:** `engine` (the EngineContext value; 150 or 200), `trackLapCount` (3, or 7 on
the one 7-lap track, from the track catalogue), `connectivity` (ignored by validation).

## 2. Evaluation order (normative)

Both implementations produce errors **in this order**, and the runners compare the
list in order.

1. `track_required`
2. `engine_required`
3. Total: `total_required`, else `total_format`, else `total_seconds_range`, else `total_range` (at most one).
4. Laps. Let *anyTimes* = some row has a lap time; *anyCoins* = some row has a coin change.
   - Without lap times: `lap_details_require_lap_times` when any coin change or mushroom count is entered. Nothing else about laps is checked.
   - With lap times and a row count different from `trackLapCount`: `lap_count_matches_track`, and no further lap, coin or mushroom checks.
   - Otherwise, in this order:
     a. per lap in lap order: `lap_missing`, else `lap_time_format`, else `lap_seconds_range`, else `lap_time_range`;
     b. `lap_sum_equals_total`, only when the total and every lap are valid times;
     c. when *anyCoins*: `coin_change_range` for every out-of-range change; only if there is none, the running balance (start 0, a lap without a change adds 0) is checked and the **first** lap outside 0..10 raises `coin_balance_range`;
     d. `mushrooms_per_lap_range` per lap; only if there is none, `mushrooms_race_total`.
5. Loadout: `loadout_id_format` per entered id in the key order of §1; then `loadout_variant_requires_base` for character, body, glider variants in that order.

## 3. Rules

`field` uses the draft path. Messages are the EN/NL catalogue in `rules.json`;
placeholders are the error `params`. A parameter ending in `Ms` is rendered as
`M:SS.mmm`, `change` with its sign (`+4`, `−2`). "Server reason" is the
`TimeTrialSubmissionError` message the server gives for the equivalent payload;
"client only" means the condition cannot be expressed as a payload.

| Rule id | Field | Condition | Message key(s) | Server reason |
|---|---|---|---|---|
| `track_required` | `trackId` | present, ≤ 255 chars, matches `^track\.[a-z0-9]+(?:_[a-z0-9]+)*$` | `tt.rules.track_required` | submission scalar is invalid |
| `engine_required` | `mode` | engine is 150 or 200 | `tt.rules.engine_required` | submission scalar is invalid |
| `total_required` | `totalDigits` | not empty | `tt.rules.total_required` | client only |
| `total_format` | `totalDigits` | exactly six ASCII digits | `tt.rules.total_format` | submission scalar is invalid (e.g. 10:00.000 = 600000 ms) |
| `total_seconds_range` | `totalDigits` | seconds digits ≤ 59 | `tt.rules.total_seconds_range` | client only |
| `total_range` | `totalDigits` | 0:00.001–9:59.999 | `tt.rules.total_range` | submission scalar is invalid |
| `lap_details_require_lap_times` | `laps` | coins/mushrooms only with lap times | `tt.rules.lap_details_require_lap_times` | client only |
| `lap_count_matches_track` | `laps` | row count = track lap count (3 or 7) | `tt.rules.lap_count_matches_track` | laps are invalid (counts other than 0/3/7); **see D1** |
| `lap_missing` | `laps[i].timeDigits` | all laps or none | `tt.rules.lap_missing`, `tt.rules.lap_missing_suggested` | client only |
| `lap_time_format` | `laps[i].timeDigits` | six ASCII digits | `tt.rules.lap_time_format` | client only |
| `lap_seconds_range` | `laps[i].timeDigits` | seconds ≤ 59 | `tt.rules.lap_seconds_range` | client only |
| `lap_time_range` | `laps[i].timeDigits` | 0:00.001–9:59.999 | `tt.rules.lap_time_range` | laps are invalid |
| `lap_sum_equals_total` | `laps` | Σ laps = total, to the millisecond | `tt.rules.lap_sum_equals_total` | lap semantics are invalid |
| `coin_change_range` | `laps[i].coinChange` | integer −10..+10 | `tt.rules.coin_change_range` | client only (implied by the balance; see D2) |
| `coin_balance_range` | `laps[i].coinChange` | balance 0..10 after every lap | `tt.rules.coin_balance_below_zero`, `tt.rules.coin_balance_above_ten` | laps are invalid |
| `mushrooms_per_lap_range` | `laps[i].mushroomsUsed` | integer 0..3 | `tt.rules.mushrooms_per_lap_range` | laps are invalid |
| `mushrooms_race_total` | `laps` | Σ mushrooms ≤ 3 | `tt.rules.mushrooms_race_total` | lap semantics are invalid |
| `loadout_id_format` | `loadout.<key>` | schema-9 id of the right kind, ≤ 255 chars | `tt.rules.loadout_id_format` | loadout is invalid |
| `loadout_variant_requires_base` | `loadout.<variantKey>` | a variant needs its base part | `tt.rules.loadout_variant_requires_base` | loadout is invalid |

### Messages (EN / NL)

| Key | English | Nederlands |
|---|---|---|
| `tt.rules.track_required` | Choose a track first. | Kies eerst een circuit. |
| `tt.rules.engine_required` | Choose 150cc or 200cc. | Kies 150cc of 200cc. |
| `tt.rules.total_required` | Enter the total time. | Vul de totaaltijd in. |
| `tt.rules.total_format` | Enter the total time as six digits, for example 145912 for 1:45.912. | Vul de totaaltijd in als zes cijfers, bijvoorbeeld 145912 voor 1:45.912. |
| `tt.rules.total_seconds_range` | Check the total time — seconds go up to 59. | Controleer de totaaltijd — seconden gaan tot 59. |
| `tt.rules.total_range` | The total time must be at least 0:00.001. | De totaaltijd moet minstens 0:00.001 zijn. |
| `tt.rules.lap_details_require_lap_times` | Add the lap times to keep coins and mushrooms. | Vul de rondetijden in om munten en paddenstoelen te bewaren. |
| `tt.rules.lap_count_matches_track` | This track has {expected} laps — you entered {actual}. | Dit circuit heeft {expected} ronden — je hebt er {actual} ingevuld. |
| `tt.rules.lap_missing` | Lap {lap} missing — type it, or clear all laps. | Ronde {lap} ontbreekt — vul hem in, of wis alle ronden. |
| `tt.rules.lap_missing_suggested` | Lap {lap} missing. From your total it would be {suggestionMs} — type it, or clear all laps. | Ronde {lap} ontbreekt. Volgens je totaaltijd is dat {suggestionMs} — vul hem in, of wis alle ronden. |
| `tt.rules.lap_time_format` | Enter lap {lap} as six digits. | Vul ronde {lap} in als zes cijfers. |
| `tt.rules.lap_seconds_range` | Check lap {lap} — seconds go up to 59. | Controleer ronde {lap} — seconden gaan tot 59. |
| `tt.rules.lap_time_range` | Lap {lap} must be at least 0:00.001. | Ronde {lap} moet minstens 0:00.001 zijn. |
| `tt.rules.lap_sum_equals_total` | Your laps add up to {lapSumMs}, the total is {totalMs}. | Je rondetijden tellen op tot {lapSumMs}, de totaaltijd is {totalMs}. |
| `tt.rules.coin_change_range` | Coins change by −10 to +10 per lap — lap {lap} has {change}. | Munten veranderen per ronde met −10 tot +10 — ronde {lap} heeft {change}. |
| `tt.rules.coin_balance_below_zero` | Coins can't go below 0 — lap {lap} would end at {balance}. | Munten kunnen niet onder 0 komen — ronde {lap} zou eindigen op {balance}. |
| `tt.rules.coin_balance_above_ten` | Coins can't go above 10 — lap {lap} would end at {balance}. | Munten kunnen niet boven 10 komen — ronde {lap} zou eindigen op {balance}. |
| `tt.rules.mushrooms_per_lap_range` | Lap {lap}: choose 0 to 3 mushrooms. | Ronde {lap}: kies 0 tot 3 paddenstoelen. |
| `tt.rules.mushrooms_race_total` | Only 3 mushrooms in a race — you entered {total}. | Maximaal 3 paddenstoelen in een race — je hebt er {total} ingevuld. |
| `tt.rules.loadout_id_format` | This part isn't in the catalogue — choose it again. | Dit onderdeel staat niet in de catalogus — kies het opnieuw. |
| `tt.rules.loadout_variant_requires_base` | Choose the part before its colour variant. | Kies eerst het onderdeel, daarna de kleurvariant. |

`rules.json` is the source for the messages; this table mirrors it for reading.
The Dutch terms follow the existing product copy (`circuit`, `ronde`/`ronden`,
`rondetijden`, `totaaltijd`, `munten`, `paddenstoelen`).

### Missing-lap suggestion

`suggestMissingLap(totalDigits, lapDigits)` returns `{ lap, timeMs, digits }` only
when exactly one lap row is blank, the total and every other lap are valid times,
and the remainder is itself a valid time (1..599999 ms). It is carried in the
`lap_missing` error params (`suggestionMs`, `suggestionDigits`, message key
`tt.rules.lap_missing_suggested`) and is **never auto-filled**.

## 4. Normalisation (draft → payload)

Only for a valid draft. The payload is the validation subset of
`TimeTrialSubmissionV1`: `{ mode, trackId, totalTimeMs, laps, loadout? }`. The
envelope (`schemaVersion`, `submissionId`, `revision`, `playerReference`, `source`,
`timestamps`, provenance) is added by the publisher and is not part of this module.

1. `mode` = `context.engine`; `trackId` as given; `totalTimeMs` = parsed total.
2. No lap times → `laps: []` (blank rows are dropped). Otherwise one entry per row:
   `lapNumber` = 1-based row index, `timeMs` = parsed lap time.
3. Coins: when any coin change is entered, **every** lap gets `coinsCollected` = the
   running balance at the end of that lap (a lap without a change adds 0). When no
   change is entered, no lap has `coinsCollected`. This is today's web and Android
   manual behaviour (`manual-details.ts`, `buildManualLaps`).
4. Mushrooms: `mushroomsUsed` only on laps where a count was entered.
5. Loadout: `""`/null values are dropped; an empty loadout is omitted (the server
   refuses `loadout: {}`); keys are emitted in the order of §1.

## 5. Scanner-populated and corrected values

Validation is identical for typed, scanned and scanned-then-corrected values; there
is no scanner truth model. `origin` and `corrected` never change the result.

Since Phase 8 the module also answers **how the draft was filled in**,
beside — never inside — validation:

- `submissionProvenance(draft, "web" | "android")` returns `source.kind`
  (`web_manual` / `web_scan` / `android_manual` / `android_scan`), the optional
  `source.captureLayout` mapped from the draft's own `scan.source`
  (`endscreen` → `time_trial_result`, `ghost_detail` → `ghost_details`), and the
  `verification` a scan carries: `producer_check_passed` with method
  `tt_scan_web_v1` / `tt_scan_lap_sum_v1` when nothing was corrected, or
  `not_checked` with method `player_corrected_after_tt_scan` and the corrected
  field groups when something was.
- `scanConflicts(draft, fill)` returns the field paths a new scan must ask about
  rather than overwrite (POST_A_TIME §7).
- Provenance **never** affects legitimacy, ranking, score or any trust indicator,
  and the function never produces `producer_check_failed` or `needs_review`, so a
  scan publishes exactly as a typed submission does.
- The Kotlin mirror of `submissionProvenance` is not written yet; Android builds
  the same values in `AndroidPostTimeSubmission.kt`. The Kotlin runner therefore
  checks these cases' validation half only.

## 6. Conformance cases

`conformance/cases.json` follows TESTING_STRATEGY §4.10. Per case:

```json
{ "id": "…", "category": "lap_totals", "note": "optional",
  "deferred": "phase-7-offline | phase-7-form-state (optional)",
  "context": { "engine": 200, "trackLapCount": 3, "connectivity": "online" },
  "draft": { "trackId": "…", "totalDigits": "145912", "laps": [ { "timeDigits": "035392", "coinChange": 4, "mushroomsUsed": 1 } ],
             "loadout": { … }, "origin": { "laps[1]": "scanned" }, "corrected": ["laps"] },
  "serverProbe": { "mode": 200, "trackId": "…", "totalTimeMs": 105912, "laps": [ … ] },
  "expect": { "valid": false,
              "errors": [ { "field": "laps", "rule": "lap_sum_equals_total", "messageKey": "…", "params": { … } } ],
              "payload": null, "sourceKind": null,
              "server": { "accepts": false, "reason": "lap semantics are invalid" } } }
```

- `errors` are compared in order on `field` and `rule`; `messageKey` and `params`
  are compared when the case states them.
- `payload` is compared exactly (the normalised payload of §4, or null).
- `sourceKind`, `captureLayout`, `verificationStatus` and `correctedFields` are the
  provenance expectation. A runner evaluates each key the case states, and
  reads the platform from `sourceKind`'s prefix, so one case file states both
  clients' answer for the same draft. `sourceKind: null` means "this case is not
  about provenance". The Kotlin runner evaluates none of them yet (§5).
- `pendingProposal` is the set of field paths a `steps[].action: "rescan"` must ask
  about instead of overwriting (`scanConflicts`).
- `serverProbe` is the payload a non-validating client would send for a
  payload-expressible invalid case; `expect.server` says how today's server answers
  it. `accepts: true` on an invalid case names an open discrepancy (`D…`, §7).
- `deferred` cases are skipped by every runner and counted in its output.

Required categories: `valid`, `invalid`, `edge_times`, `lap_totals`,
`engine_context`, `required_fields`, `optional_fields`, `scanner_populated`,
`corrected_scanner_fields`, `offline`. The guard fails when a category has no
case, when a rule id is not raised by at least one runnable case, or when a rule id
exists in one of `rules.json`, TypeScript and Kotlin but not the others.

### Running the runners

```
node --test packages/time-trial-rules/test/conformance.test.ts packages/time-trial-rules/test/guard.test.ts
   (or: cd packages/time-trial-rules && npm test; Node ≥ 23.6 strips the TypeScript types)
cd backend/api && npx vitest run --config vitest.config.ts test/time-trial-rules-conformance.test.ts
cd apps/timetrials-android && gradlew :app:testDebugUnitTest --tests "nl.mariokart8.mk8dxtimetrials.rules.TimeTrialRulesConformanceTest"
   (ANDROID_HOME must point at the SDK)
```

## 7. Open discrepancies (maintainer decision)

Found by reading today's server, web and Android code (2026-09-19). The payload
truth is the server's accepted behaviour; none of these was changed in Phase 3.

| # | Topic | Spec (frozen table) | Today | Consequence / decision needed |
|---|---|---|---|---|
| D1 | Lap count per track | Laps: none, or exactly the track's lap count | **Server** accepts any 0-, 3- or 7-lap list for any track (it has no lap count per track): 3 laps on GCN Baby Park are stored. **Web** `manual-details.ts` builds 1–7 rows and would send 1, 2, 4, 5 or 6 laps (server refuses). Android manual uses the catalogue count; Android scan review keeps the scanned row count unchecked | Case `lap-count-3-laps-on-7-lap-track` records the server accepting. Decide whether the server should learn the per-track lap count (C-level change) or the rule stays client-side |
| D2 | Coin meaning | Entry is a change −10..+10; balance 0–10 after every lap | **Two meanings.** Web and Android *manual* entry: signed change, running balance 0..10 (`manual-details.ts` delta mode, `buildManualLaps`). Android *scan review* (`correctedScanSubmission`) and the web's re-parse of a stored payload (`manual-publication-client.ts`, `coinInput: "balance"`): an absolute balance 0..10 per lap with no relation between laps. **Server**: `coinsCollected` 0..10 per lap, independent, optional per lap | The spec follows the manual meaning; the stored value (balance) is what the server checks, so the change bound is input-only (a balance within 0..10 implies a change within ±10). The scan-review meaning retires with that screen (POST_A_TIME §3); confirm |
| D3 | Partial coins in a payload | Not stated | Server accepts `coinsCollected` on some laps only (LiveTrial, Android scan). The canonical form emits it on all laps or none (§4.3), matching today's manual entry | Confirm all-or-none for form output; server stays permissive for other producers |
| D4 | Lone coin sign | Not stated | **Android** manual treats a lone `+`/`-` (or any non-number) as an entered change of 0 (`toIntOrNull() ?: 0`), which makes every lap carry `coinsCollected`. **Web** rejects it (`Number("-")` is NaN) | The spec's `coinChange` is an integer or null; the canonical input must map a lone sign to null (not entered) or block it. Decide |
| D5 | Seconds ≥ 60 | Report "Check the total time — seconds go up to 59." | Web and Android input masks (`sanitizeWebManualDigits`, `sanitizeManualDigits`) silently clamp the tens-of-seconds digit to 5, and the web applies the same mask to **scanned** lap values (`manual-details.ts` prefill), so a misread `178000` becomes `158000` without a message | The spec reports `total_seconds_range`/`lap_seconds_range` and never changes a value. Decide whether the Phase 7 mask keeps clamping typed input (the rule then only fires for scanned values) |
| D6 | Total-only after a scan | Total only is valid | Android scan review requires every scanned lap row filled and summing to the total; a scan without laps cannot be published total-only | Retires with the scan review screen; confirm |
| D7 | Loadout catalogue | "Loadout ids from the catalogue" | Web checks membership in its loadout manifest; Android pickers only offer catalogue ids; the **server** checks only the id form | This module checks the form only (it has no catalogue). Decide whether catalogue membership becomes a rule with a catalogue in the context |
| D8 | Variants | Variant requires base | Server and spec support character/body/glider variants. The web form and the Android manual loadout have no variant fields (the web publication parser refuses variant keys); only Android scan carries variants | No conflict in behaviour; Phase 7 decides whether the canonical SetupPicker offers variants |
| D9 | Server reasons | Field-level messages | The server answers with five coarse reasons (`submission scalar is invalid`, `laps are invalid`, `lap semantics are invalid`, `loadout is invalid`, `submission shape is invalid`) and no rule id | `rules.json` maps each rule to its server reason; a field-level server answer would need an API change |
| D10 | Engine always present | Engine 150/200 present | The web entry state defaults an unknown mode to 150, so `engine_required` is unreachable on the web today | No behavioural conflict; kept for a missing EngineContext |
