package nl.mariokart8.mk8dxtimetrials.posttime

import nl.mariokart8.mk8dxtimetrials.rules.RuleError
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric

/**
 * The EN/NL message catalogue of `packages/time-trial-rules/rules.json`, said in
 * the Player's own words. The rule ids and their parameters come from the
 * canonical Kotlin validator; nothing here decides what is valid.
 *
 * A parameter ending in `Ms` is rendered as `M:SS.mmm`, `change` and `balance`
 * with their sign and a true minus (SPEC §3).
 */
internal object AndroidPostTimeMessages {
    private fun timeParam(params: Map<String, Any>, key: String): String =
        (params[key] as? Int)?.toLong()?.let(Mk8dxNumeric::formatTime) ?: "—"

    private fun intParam(params: Map<String, Any>, key: String): Int = (params[key] as? Int) ?: 0

    private fun signed(value: Int): String =
        if (value < 0) "${Mk8dxNumeric.TRUE_MINUS}${-value}" else "+$value"

    private fun plain(value: Int): String =
        if (value < 0) "${Mk8dxNumeric.TRUE_MINUS}${-value}" else "$value"

    fun text(error: RuleError, language: AndroidProductLanguage): String {
        val params = error.params
        val lap = intParam(params, "lap")
        return when (error.messageKey) {
            "tt.rules.track_required" ->
                androidText(language, "Choose a track first.", "Kies eerst een circuit.")
            "tt.rules.engine_required" ->
                androidText(language, "Choose 150cc or 200cc.", "Kies 150cc of 200cc.")
            "tt.rules.total_required" ->
                androidText(language, "Enter the total time.", "Vul de totaaltijd in.")
            "tt.rules.total_format" -> androidText(
                language,
                "Enter the total time as six digits, for example 145912 for 1:45.912.",
                "Vul de totaaltijd in als zes cijfers, bijvoorbeeld 145912 voor 1:45.912.",
            )
            "tt.rules.total_seconds_range" -> androidText(
                language,
                "Check the total time — seconds go up to 59.",
                "Controleer de totaaltijd — seconden gaan tot 59.",
            )
            "tt.rules.total_range" -> androidText(
                language,
                "The total time must be at least 0:00.001.",
                "De totaaltijd moet minstens 0:00.001 zijn.",
            )
            "tt.rules.lap_details_require_lap_times" -> androidText(
                language,
                "Add the lap times to keep coins and mushrooms.",
                "Vul de rondetijden in om munten en paddenstoelen te bewaren.",
            )
            "tt.rules.lap_count_matches_track" -> androidText(
                language,
                "This track has ${intParam(params, "expected")} laps — you entered ${intParam(params, "actual")}.",
                "Dit circuit heeft ${intParam(params, "expected")} ronden — je hebt er ${intParam(params, "actual")} ingevuld.",
            )
            "tt.rules.lap_missing" -> androidText(
                language,
                "Lap $lap missing — type it, or clear all laps.",
                "Ronde $lap ontbreekt — vul hem in, of wis alle ronden.",
            )
            "tt.rules.lap_missing_suggested" -> androidText(
                language,
                "Lap $lap missing. From your total it would be ${timeParam(params, "suggestionMs")} — type it, or clear all laps.",
                "Ronde $lap ontbreekt. Volgens je totaaltijd is dat ${timeParam(params, "suggestionMs")} — vul hem in, of wis alle ronden.",
            )
            "tt.rules.lap_time_format" -> androidText(
                language,
                "Enter lap $lap as six digits.",
                "Vul ronde $lap in als zes cijfers.",
            )
            "tt.rules.lap_seconds_range" -> androidText(
                language,
                "Check lap $lap — seconds go up to 59.",
                "Controleer ronde $lap — seconden gaan tot 59.",
            )
            "tt.rules.lap_time_range" -> androidText(
                language,
                "Lap $lap must be at least 0:00.001.",
                "Ronde $lap moet minstens 0:00.001 zijn.",
            )
            "tt.rules.lap_sum_equals_total" -> androidText(
                language,
                "Your laps add up to ${timeParam(params, "lapSumMs")}, the total is ${timeParam(params, "totalMs")}.",
                "Je rondetijden tellen op tot ${timeParam(params, "lapSumMs")}, de totaaltijd is ${timeParam(params, "totalMs")}.",
            )
            "tt.rules.coin_change_range" -> androidText(
                language,
                "Coins change by ${Mk8dxNumeric.TRUE_MINUS}10 to +10 per lap — lap $lap has ${signed(intParam(params, "change"))}.",
                "Munten veranderen per ronde met ${Mk8dxNumeric.TRUE_MINUS}10 tot +10 — ronde $lap heeft ${signed(intParam(params, "change"))}.",
            )
            "tt.rules.coin_balance_below_zero" -> androidText(
                language,
                "Coins can't go below 0 — lap $lap would end at ${plain(intParam(params, "balance"))}.",
                "Munten kunnen niet onder 0 komen — ronde $lap zou eindigen op ${plain(intParam(params, "balance"))}.",
            )
            "tt.rules.coin_balance_above_ten" -> androidText(
                language,
                "Coins can't go above 10 — lap $lap would end at ${plain(intParam(params, "balance"))}.",
                "Munten kunnen niet boven 10 komen — ronde $lap zou eindigen op ${plain(intParam(params, "balance"))}.",
            )
            "tt.rules.mushrooms_per_lap_range" -> androidText(
                language,
                "Lap $lap: choose 0 to 3 mushrooms.",
                "Ronde $lap: kies 0 tot 3 paddenstoelen.",
            )
            "tt.rules.mushrooms_race_total" -> androidText(
                language,
                "Only 3 mushrooms in a race — you entered ${intParam(params, "total")}.",
                "Maximaal 3 paddenstoelen in een race — je hebt er ${intParam(params, "total")} ingevuld.",
            )
            "tt.rules.loadout_id_format" -> androidText(
                language,
                "This part isn't in the catalogue — choose it again.",
                "Dit onderdeel staat niet in de catalogus — kies het opnieuw.",
            )
            "tt.rules.loadout_variant_requires_base" -> androidText(
                language,
                "Choose the part before its colour variant.",
                "Kies eerst het onderdeel, daarna de kleurvariant.",
            )
            else -> androidText(
                language,
                "Check this value before publishing.",
                "Controleer deze waarde voordat je publiceert.",
            )
        }
    }
}
