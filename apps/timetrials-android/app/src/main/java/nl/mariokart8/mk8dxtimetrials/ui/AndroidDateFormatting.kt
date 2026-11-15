package nl.mariokart8.mk8dxtimetrials.ui

import java.text.DateFormat
import java.util.Date

// Dates and times follow the app's own language (Settings → Language), not only
// the phone's locale: a Dutch app on an English phone shows "15 nov 2026 13:06".
// The language's locale also decides the clock convention (24 h or 12 h).

/** A moment as date and time in the app language, for example "15 nov 2026 13:06". */
internal fun androidDateTimeText(
    language: AndroidProductLanguage,
    atMs: Long,
    dateStyle: Int = DateFormat.MEDIUM,
    timeStyle: Int = DateFormat.SHORT,
): String = DateFormat.getDateTimeInstance(dateStyle, timeStyle, language.locale).format(Date(atMs))

/** A day in the app language, for example "15 nov 2026". */
internal fun androidDateText(
    language: AndroidProductLanguage,
    atMs: Long,
    dateStyle: Int = DateFormat.MEDIUM,
): String = DateFormat.getDateInstance(dateStyle, language.locale).format(Date(atMs))
