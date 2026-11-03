package nl.mariokart8.mk8dxtimetrials.ui.design

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/**
 * DEBUG BUILDS ONLY (src/debug): the Android component gallery for
 * Checkpoint 1 (IMPLEMENTATION_PLAN §3 Phase 3 item 5). The same tokens, type,
 * EngineSelector, buttons, TimingRow and TimeInput as the web gallery.
 *
 *   adb shell am start -n <applicationId>/nl.mariokart8.mk8dxtimetrials.ui.design.Mk8dxDesignGalleryActivity \
 *     --es appearance dark|light|hc --es language en|nl
 */
class Mk8dxDesignGalleryActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val appearance = when (intent.getStringExtra("appearance")) {
            "light" -> Mk8dxAppearance.Light
            "hc" -> Mk8dxAppearance.HighContrast
            else -> Mk8dxAppearance.Dark
        }
        val language = if (intent.getStringExtra("language") == "nl") Mk8dxNumberLanguage.NL else Mk8dxNumberLanguage.EN
        setContent { Mk8dxDesignGallery(appearance, language) }
    }
}

@Composable
private fun Mk8dxDesignGallery(initialAppearance: Mk8dxAppearance, initialLanguage: Mk8dxNumberLanguage) {
    var appearance by rememberSaveable { mutableStateOf(initialAppearance) }
    var language by rememberSaveable { mutableStateOf(initialLanguage) }
    Mk8dxTheme(appearance) {
        val colors = Mk8dxTheme.colors
        val nl = language == Mk8dxNumberLanguage.NL
        fun t(en: String, dutch: String) = if (nl) dutch else en
        Column(
            Modifier
                .fillMaxSize()
                .background(colors.surfaceApp)
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState())
                .padding(Mk8dxSpacing.gutterPhone)
                .testTag("ds-gallery"),
            verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.xxl),
        ) {
            Mk8dxDisplayText(t("Component gallery", "Componentengalerij"), Mk8dxTheme.type.display3)
            Mk8dxSegmentedControl(
                t("Appearance", "Weergave"),
                listOf(Mk8dxAppearance.Dark to t("Dark", "Donker"), Mk8dxAppearance.Light to t("Light", "Licht"), Mk8dxAppearance.HighContrast to t("High contrast", "Hoog contrast")),
                appearance, { appearance = it },
            )
            Mk8dxSegmentedControl(
                t("Language", "Taal"),
                listOf(Mk8dxNumberLanguage.EN to "English", Mk8dxNumberLanguage.NL to "Nederlands"),
                language, { language = it },
            )

            Section(t("Tokens", "Tokens")) { TokenSwatches() }

            Section(t("Typography", "Typografie")) {
                val type = Mk8dxTheme.type
                Mk8dxDisplayText("Mario Kart Stadium", type.display2)
                Mk8dxDisplayText(t("Track standing", "Circuitstand"), type.display4)
                Mk8dxDisplayText(t("Section heading", "Sectiekop"), type.display6)
                Text(t("Section title · IBM Plex Sans 600", "Sectietitel · IBM Plex Sans 600"), style = type.title, color = colors.textPrimary)
                Text(
                    t(
                        "Body text reads calmly. Wolfeschlegelsteinhausenbergerdorff van der Heijden-Vermeulen posted a new personal best.",
                        "Lopende tekst leest rustig. Wolfeschlegelsteinhausenbergerdorff van der Heijden-Vermeulen reed een nieuw persoonlijk record.",
                    ),
                    style = type.body, color = colors.textBody,
                )
                Text(t("Secondary line · 3 laps · Base game", "Tweede regel · 3 ronden · Basisspel"), style = type.bodyS, color = colors.textSecondary)
                Text(t("Label · Total time", "Label · Totaaltijd"), style = type.label, color = colors.textSecondary)
                Text(t("MICRO · TABLE HEAD", "MICRO · TABELKOP"), style = type.micro, color = colors.textTertiary)
                Text("1:45.912  15:59:59.999", style = type.dataXl, color = colors.textPrimary)
                Text(
                    "${Mk8dxNumeric.formatRank(99_999, language)}  ${Mk8dxNumeric.formatDelta(-412)}  ${Mk8dxNumeric.formatDelta(62_004)}  ${Mk8dxNumeric.formatDelta(0)}",
                    style = type.dataL, color = colors.textPrimary,
                )
                Text("0123456789 · 1111 · 8888", style = type.data, color = colors.textBody)
            }

            Section("EngineSelector · EngineMark") {
                var engine by rememberSaveable { mutableStateOf(150) }
                Mk8dxEngineSelector(t("Engine class", "Klasse"), engine, { engine = it }, Modifier.testTag("ds-engine-selector"))
                Mk8dxEngineSelector(t("Engine class", "Klasse"), 200, {}, large = true)
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxEngineMark(150)
                    Mk8dxEngineMark(200)
                    Mk8dxEngineMark(150, size = Mk8dxEngineMarkSize.Lg)
                    Mk8dxEngineMark(200, size = Mk8dxEngineMarkSize.Plain)
                }
            }

            Section(t("Actions", "Acties")) {
                Mk8dxButton(t("Post a time", "Tijd plaatsen"), {}, variant = Mk8dxButtonVariant.Primary, stopwatch = true, size = Mk8dxButtonSize.Lg)
                Mk8dxButton(t("Post a time", "Tijd plaatsen"), {}, variant = Mk8dxButtonVariant.Primary, stopwatch = true)
                Mk8dxButton(t("Post a time", "Tijd plaatsen"), {}, variant = Mk8dxButtonVariant.Primary, stopwatch = true, size = Mk8dxButtonSize.Sm)
                Mk8dxButton(t("Post a time", "Tijd plaatsen"), {}, variant = Mk8dxButtonVariant.Global, stopwatch = true)
                Mk8dxButton(t("Compare", "Vergelijken"), {}, variant = Mk8dxButtonVariant.Secondary)
                Mk8dxButton(t("Show all tracks", "Alle circuits tonen"), {}, variant = Mk8dxButtonVariant.Quiet)
                Mk8dxButton(t("Withdraw result", "Resultaat intrekken"), {}, variant = Mk8dxButtonVariant.Danger)
                Mk8dxButton(
                    t("Publish", "Publiceren"), {}, variant = Mk8dxButtonVariant.Primary,
                    disabledReason = t("Publish · enter a total time first", "Publiceren · vul eerst een totaaltijd in"),
                    modifier = Modifier.testTag("ds-disabled-button"),
                )
                Mk8dxButton(t("Publish", "Publiceren"), {}, variant = Mk8dxButtonVariant.Primary, loadingLabel = t("Publishing…", "Publiceren…"))
                Mk8dxArmedButton(
                    t("Publish", "Publiceren"), t("Press again to publish", "Druk nogmaals om te publiceren"),
                    t("Publishes 1:45.912 at 150cc", "Publiceert 1:45.912 op 150cc"), {},
                )
            }

            Section(t("Selection and status", "Selectie en status")) {
                var scope by rememberSaveable { mutableStateOf("all") }
                Mk8dxSegmentedControl(t("Tracks", "Circuits"), listOf("base" to "Base 48", "bcp" to "BCP 48", "all" to "All 96"), scope, { scope = it })
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
                    Mk8dxChip(t("Neutral", "Neutraal"))
                    Mk8dxChip(t("Verified", "Geverifieerd"), tone = Mk8dxChipTone.Success)
                    Mk8dxChip(t("Check", "Controleren"), tone = Mk8dxChipTone.Warning)
                    Mk8dxChip(t("Rejected", "Afgewezen"), tone = Mk8dxChipTone.Error)
                    Mk8dxChip(t("Advanced", "Gevorderd"), tone = Mk8dxChipTone.Advanced)
                    Mk8dxChip(t("Combined", "Gecombineerd"), tone = Mk8dxChipTone.Combined)
                    Mk8dxChip("Live", tone = Mk8dxChipTone.Live)
                    Mk8dxYouChip(t("You", "Jij"))
                }
            }

            Section(t("Ranking rows", "Klassementsrijen")) {
                val you = t("You", "Jij")
                Mk8dxRankingTable(
                    caption = t("Time Trial standing", "Time Trial-stand"),
                    language = language,
                    rows = listOf(
                        Mk8dxRankRow(1, "Byron", 93_635),
                        Mk8dxRankRow(99, "Matteo", 104_689, deltaMs = -412),
                        Mk8dxRankRow(999, "Wolfeschlegelsteinhausenbergerdorff van der Heijden-Vermeulen", 105_912, deltaMs = 0),
                        Mk8dxRankRow(1_000, "Ben", 106_784, deltaMs = 1_149, kind = Mk8dxRowKind.You, youLabel = you),
                        Mk8dxRankRow(10_000, "Nintendo Ghost", 113_191, deltaMs = 62_004, kind = Mk8dxRowKind.Reference),
                        Mk8dxRankRow(99_999, "Valerio", 57_599_999, deltaMs = -61_000),
                    ),
                    modifier = Modifier.testTag("ds-ranking"),
                )
            }

            Section("HeroRank") {
                @OptIn(ExperimentalLayoutApi::class)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.lg)) {
                    for (rank in listOf(12, 999, 1_000, 99_999)) Mk8dxHeroRank(rank, language, t("Standing", "Positie"))
                }
            }

            Section("TimeInput") {
                var digits by rememberSaveable { mutableStateOf("14591") }
                Mk8dxTimeInput(t("Total time", "Totaaltijd"), digits, { digits = it }, Modifier.testTag("ds-time-input"))
                Mk8dxTimeInput(t("Lap 1", "Ronde 1"), "", {}, invalid = true)
                Mk8dxTimeInput(t("Lap 2", "Ronde 2"), "035123", {}, doubt = true)
                Mk8dxTimeInput(t("Lap 3", "Ronde 3"), "035120", {}, compact = true)
            }
        }
    }
}

@Composable
private fun Section(title: String, content: @Composable () -> Unit) {
    val colors = Mk8dxTheme.colors
    Column(
        Modifier.fillMaxWidth().background(colors.surfaceRaised).border(1.dp, colors.borderSubtle).padding(Mk8dxSpacing.lg),
        verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.md),
    ) {
        Text(title, style = Mk8dxTheme.type.title, color = colors.textPrimary, modifier = Modifier.semantics { heading() })
        content()
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun TokenSwatches() {
    val c = Mk8dxTheme.colors
    val swatches = listOf(
        "surface.app" to c.surfaceApp, "surface.raised" to c.surfaceRaised, "surface.control" to c.surfaceControl,
        "text.primary" to c.textPrimary, "text.secondary" to c.textSecondary, "border.strong" to c.borderStrong,
        "action.primary" to c.actionPrimary, "personal.accent" to c.personalAccent, "engine.150" to c.engine150,
        "engine.200" to c.engine200, "live" to c.live, "focus.ring" to c.focusRing,
        "status.success" to c.statusSuccess, "status.warning" to c.statusWarning, "status.error" to c.statusError,
        "status.info" to c.statusInfo, "rank.gold" to c.rankGold, "rank.silver" to c.rankSilver, "rank.bronze" to c.rankBronze,
    )
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm), verticalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        for ((name, color) in swatches) {
            Column(Modifier.width(96.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Box(Modifier.size(width = 96.dp, height = 28.dp).background(color).border(1.dp, c.borderSubtle))
                Text(name, style = Mk8dxTheme.type.micro, color = c.textSecondary)
                Text(
                    "#%06X".format(color.toArgb() and 0xFFFFFF),
                    style = Mk8dxTheme.type.dataS, color = c.textTertiary,
                )
            }
        }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(Mk8dxSpacing.sm)) {
        Box(Modifier.size(24.dp).background(Color.Transparent).border(Mk8dxSpacing.focusWidth, c.focusRing))
        Text("focus.ring · ${Mk8dxSpacing.focusWidth}", style = Mk8dxTheme.type.label, color = c.textBody)
    }
}
