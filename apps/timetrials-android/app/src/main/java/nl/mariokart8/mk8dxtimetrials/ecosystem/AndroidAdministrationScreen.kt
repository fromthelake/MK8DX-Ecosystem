package nl.mariokart8.mk8dxtimetrials.ecosystem

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.lazy.LazyColumn
import nl.mariokart8.mk8dxtimetrials.ui.ProductText as Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import nl.mariokart8.mk8dxtimetrials.ui.AndroidProductLanguage
import nl.mariokart8.mk8dxtimetrials.ui.androidText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButton
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxButtonVariant
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDisplayText
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxFactRow
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumberLanguage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxNumeric
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxPanel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSectionLabel
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxSpacing
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatBlock
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusMessage
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxStatusTone
import nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxTheme

/**
 * A13 Administration on the phone (DESIGN_SYSTEM §5 MINIMAL), on the design
 * system.
 *
 * Operational clarity and nothing else: no art, no accents, calm panels and
 * dense readable figures. The numbers first (waiting, registered, active
 * lately), then the accounts-and-Players surface the phone already had.
 * Reached from Settings, only offered when the server says the signed-in
 * account is an administrator — every capability, every word and every
 * permission check are exactly as they were.
 */
@Composable
internal fun AndroidAdministrationScreen(
    administration: AndroidAdministrationClient,
    identityLinks: AndroidIdentityLinkClient?,
    language: AndroidProductLanguage,
    onBack: () -> Unit,
) {
    var overview by remember(administration) { mutableStateOf<AndroidAdministrationOverview?>(null) }
    var message by remember(administration) { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }

    LaunchedEffect(administration, reload) {
        message = null
        runCatching { withContext(Dispatchers.IO) { administration.overview() } }
            .onSuccess { overview = it }
            .onFailure { failure ->
                message = if (failure is AndroidAdministrationException && failure.forbidden) {
                    androidText(language, "Administrator access is required.", "Beheerderstoegang is vereist.")
                } else {
                    androidText(language, "The overview could not be loaded.", "Het overzicht kon niet worden geladen.")
                }
            }
    }

    AndroidAdministrationContent(
        overview = overview,
        message = message,
        language = language,
        onBack = onBack,
        onReload = { reload += 1 },
        identityLinks = identityLinks?.let { client -> { AndroidIdentityLinkScreen(client) } },
    )
}

/**
 * What Administration looks like once its numbers have arrived. Split from the
 * loader above so the page itself can be rendered on a device against a fixture
 * — an administrator session cannot be had from a test, and the presentation is
 * exactly what this phase changed.
 */
@Composable
internal fun AndroidAdministrationContent(
    overview: AndroidAdministrationOverview?,
    message: String?,
    language: AndroidProductLanguage,
    onBack: () -> Unit,
    onReload: () -> Unit,
    identityLinks: (@Composable () -> Unit)? = null,
) {
    Mk8dxTheme(Mk8dxTheme.appearance) {
        val colors = Mk8dxTheme.colors
        val type = Mk8dxTheme.type
        val numbers = if (language == AndroidProductLanguage.DUTCH) {
            Mk8dxNumberLanguage.NL
        } else {
            Mk8dxNumberLanguage.EN
        }
        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .background(colors.surfaceApp)
                .testTag("administration-screen"),
            contentPadding = PaddingValues(Mk8dxSpacing.lg),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
        ) {
            item {
                Column(verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xs)) {
                    Mk8dxSectionLabel(androidText(language, "OPERATIONS", "OPERATIONEEL"))
                    Mk8dxDisplayText(
                        androidText(language, "Administration", "Beheer"),
                        type.display6,
                    )
                    Text(
                        androidText(
                            language,
                            "Who is here, who was around lately, and what is waiting.",
                            "Wie er is, wie er onlangs was, en wat er wacht.",
                        ),
                        style = type.bodyS,
                        color = colors.textSecondary,
                    )
                }
            }
            message?.let { text ->
                item { Mk8dxStatusMessage(text, tone = Mk8dxStatusTone.Error) }
            }
            overview?.let { current ->
                item {
                    Mk8dxPanel(androidText(language, "WAITING", "IN DE WACHT")) {
                        Mk8dxStatBlock(
                            androidText(language, "Link requests waiting", "Koppelverzoeken in de wacht"),
                            Mk8dxNumeric.formatCount(current.pending.playerClaims.toLong(), numbers),
                            Modifier.testTag("administration-pending-claims"),
                            hint = androidText(
                                language,
                                "Somebody asked to be linked to an existing Player. Decide on the website under Administration › Claims.",
                                "Iemand vroeg om gekoppeld te worden aan een bestaande speler. Besluit op de website onder Beheer › Claims.",
                            ),
                            large = true,
                        )
                    }
                }
                item {
                    Mk8dxPanel(androidText(language, "REGISTERED", "GEREGISTREERD")) {
                        Mk8dxStatBlock(
                            androidText(language, "Registered", "Geregistreerd"),
                            Mk8dxNumeric.formatCount(current.registered.signInIdentities.toLong(), numbers),
                            Modifier.testTag("administration-registered"),
                            hint = androidText(
                                language,
                                "people who have signed in at least once · ${Mk8dxNumeric.formatCount(current.registered.accounts.toLong(), numbers)} active accounts",
                                "mensen die minstens één keer zijn aangemeld · ${Mk8dxNumeric.formatCount(current.registered.accounts.toLong(), numbers)} actieve accounts",
                            ),
                            large = true,
                        )
                        Mk8dxStatBlock(
                            androidText(language, "Players", "Spelers"),
                            Mk8dxNumeric.formatCount(current.registered.players.toLong(), numbers),
                            Modifier.testTag("administration-players"),
                            hint = androidText(
                                language,
                                "${Mk8dxNumeric.formatCount(current.registered.linkedPlayers.toLong(), numbers)} linked to an account · ${current.registered.administrators} administrator(s)",
                                "${Mk8dxNumeric.formatCount(current.registered.linkedPlayers.toLong(), numbers)} gekoppeld aan een account · ${current.registered.administrators} beheerder(s)",
                            ),
                            large = true,
                        )
                    }
                }
                item {
                    Mk8dxPanel(androidText(language, "ACTIVE", "ACTIEF")) {
                        ActivityRow(language, numbers, androidText(language, "Last 24 hours", "Laatste 24 uur"), current.active.last24h, "administration-active-24h")
                        ActivityRow(language, numbers, androidText(language, "Last 7 days", "Laatste 7 dagen"), current.active.last7d, "administration-active-7d")
                        ActivityRow(language, numbers, androidText(language, "Last month", "Laatste maand"), current.active.last30d, "administration-active-30d")
                        Text(
                            androidText(
                                language,
                                "Active means a signed-in session was started or refreshed in the window; sessions refresh at most every twelve hours.",
                                "Actief betekent dat er in die periode een aangemelde sessie is gestart of ververst; sessies verversen hooguit elke twaalf uur.",
                            ),
                            style = type.bodyS,
                            color = colors.textTertiary,
                        )
                    }
                }
            }
            if (identityLinks != null && overview != null) {
                item { identityLinks() }
            }
            item {
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm),
                ) {
                    Mk8dxButton(
                        androidText(language, "Back", "Terug"),
                        onBack,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "administration-back",
                    )
                    Mk8dxButton(
                        androidText(language, "Refresh", "Vernieuwen"),
                        onReload,
                        variant = Mk8dxButtonVariant.Secondary,
                        tag = "administration-refresh",
                    )
                }
            }
        }
    }
}

/**
 * One window of activity: two counts that are each a number in its own right,
 * so neither is a combination of the other (§7 "no silent combining").
 */
@Composable
private fun ActivityRow(
    language: AndroidProductLanguage,
    numbers: Mk8dxNumberLanguage,
    label: String,
    window: AndroidAdministrationWindow,
    tag: String,
) {
    Mk8dxFactRow(
        label,
        androidText(
            language,
            "${Mk8dxNumeric.formatCount(window.signedIn.toLong(), numbers)} signed in · " +
                "${Mk8dxNumeric.formatCount(window.submitted.toLong(), numbers)} submitted",
            "${Mk8dxNumeric.formatCount(window.signedIn.toLong(), numbers)} aangemeld · " +
                "${Mk8dxNumeric.formatCount(window.submitted.toLong(), numbers)} ingestuurd",
        ),
        Modifier.testTag(tag),
    )
}
