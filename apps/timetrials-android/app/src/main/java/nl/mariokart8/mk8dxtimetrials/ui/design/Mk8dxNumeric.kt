package nl.mariokart8.mk8dxtimetrials.ui.design

/**
 * Design-system numeric typography (docs/design-system/DESIGN_SYSTEM.md §10),
 * the twin of the web's `ds-numeric.ts`: exact tabular values that never
 * abbreviate, a rank column sized from the largest rank in the dataset, and
 * hero ranks at four fixed display steps. Pure functions; the components use
 * them, and `Mk8dxNumericTest` holds the web's cases.
 */
enum class Mk8dxNumberLanguage { EN, NL }

enum class Mk8dxHeroRankStep { Display2, Display3, Display4, Display5 }

enum class Mk8dxDeltaDirection { Faster, Slower, Even }

object Mk8dxNumeric {
    const val TRUE_MINUS = "−"

    /** A whole number with the language's thousands separator: EN "1,000", NL "1.000". */
    fun formatCount(value: Long, language: Mk8dxNumberLanguage): String {
        val separator = if (language == Mk8dxNumberLanguage.NL) '.' else ','
        val digits = kotlin.math.abs(value).toString()
        val grouped = StringBuilder()
        digits.forEachIndexed { index, digit ->
            if (index > 0 && (digits.length - index) % 3 == 0) grouped.append(separator)
            grouped.append(digit)
        }
        return (if (value < 0) "-" else "") + grouped
    }

    /** "#1", "#1,000" / "#1.000". */
    fun formatRank(rank: Int, language: Mk8dxNumberLanguage): String {
        require(rank >= 1) { "a rank is a positive integer" }
        return "#" + formatCount(rank.toLong(), language)
    }

    /** Width of the rank column in characters: the formatted largest rank, separators included. */
    fun rankColumnChars(largestRank: Int, language: Mk8dxNumberLanguage): Int =
        formatRank(maxOf(1, largestRank), language).length

    /** The fixed display step for a hero rank: 1–2 digits, 3, 4, 5+ (DESIGN_SYSTEM §3). */
    fun heroRankStep(rank: Int): Mk8dxHeroRankStep = when (maxOf(1, rank).toString().length) {
        1, 2 -> Mk8dxHeroRankStep.Display2
        3 -> Mk8dxHeroRankStep.Display3
        4 -> Mk8dxHeroRankStep.Display4
        else -> Mk8dxHeroRankStep.Display5
    }

    /** M:SS.mmm below an hour, H:MM:SS.mmm from an hour (totals up to 16 h stay exact). */
    fun formatTime(milliseconds: Long): String {
        require(milliseconds >= 0) { "a time is a non-negative number of ms" }
        val ms = milliseconds % 1000
        val totalSeconds = milliseconds / 1000
        val seconds = totalSeconds % 60
        val totalMinutes = totalSeconds / 60
        val minutes = totalMinutes % 60
        val hours = totalMinutes / 60
        val tail = seconds.toString().padStart(2, '0') + "." + ms.toString().padStart(3, '0')
        return if (hours > 0) "$hours:${minutes.toString().padStart(2, '0')}:$tail" else "$minutes:$tail"
    }

    /**
     * A signed gap: "+0.412", "−1:02.004". Always a sign (a true minus),
     * never colour alone. Below a minute the minutes are dropped; zero is "±0.000".
     */
    fun formatDelta(milliseconds: Long): String {
        if (milliseconds == 0L) return "±0.000"
        val sign = if (milliseconds < 0) TRUE_MINUS else "+"
        val size = kotlin.math.abs(milliseconds)
        val body = if (size < 60_000) {
            "${size / 1000}.${(size % 1000).toString().padStart(3, '0')}"
        } else {
            formatTime(size)
        }
        return sign + body
    }

    /** Which way a delta points, for colour: faster (negative), slower (positive) or even. */
    fun deltaDirection(milliseconds: Long): Mk8dxDeltaDirection = when {
        milliseconds < 0 -> Mk8dxDeltaDirection.Faster
        milliseconds > 0 -> Mk8dxDeltaDirection.Slower
        else -> Mk8dxDeltaDirection.Even
    }
}
