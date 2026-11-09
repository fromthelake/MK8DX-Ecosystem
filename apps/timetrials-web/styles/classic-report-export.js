
const state = {
  scope: '',
  playerFilter: '',
  groupFilter: '__all__',
  payload: null,
  catalog: null,
  audioEnabled: false,
  currentTrackMusic: '',
  participant: '',
  participantScope: '',
  overlayPlayers: [],
  compareA: '',
  compareB: '',
  histogramGroup: '',
  histogramPlayer: '',
  comparisonPlayers: [],
  comparisonMode: 'default',
  selectedTrack: '',
  scrollTargetId: '',
  exportFormat: 'full',
  exportInteractive: false,
  exportEmbedImages: false,
  pendingDownload: false,
  language: 'nl',
  classicCustomizationLoadedKey: '',
  classicCustomizationVersion: 0,
  classicCustomizationDirty: false,
  classicCustomizationLoading: false,
  classicCustomizationSaving: false,
  classicCustomization: null,
  classicEditingTarget: '',
  classicEditingDrafts: {},
  classicEditorSelectionTarget: '',
  classicEditorSelectionRange: null,
};

let bgAudio = null;
const PAGE_VIEW = document.body?.dataset?.analyticsView || 'dashboard';
const isRecapView = () => PAGE_VIEW === 'recap';
const isClassicView = () => PAGE_VIEW === 'classic';
const isStoryView = () => isRecapView() || isClassicView();

const qs = (id) => document.getElementById(id);
const hasNode = (id) => Boolean(qs(id));
const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');
const norm = (value) => String(value ?? '').trim().toLowerCase();
const unique = (items) => Array.from(new Set(items.filter((item) => item !== '' && item != null)));
const byText = (left, right) => String(left ?? '').localeCompare(String(right ?? ''), 'nl');
const phaseWeight = (phase) => (phase === 'qualifier' ? 0 : 1);
const isMiiName = (value) => norm(value).startsWith('mii');
const MAX_COMPARISON_PLAYERS = 12;
const DEFAULT_AUTO_COMPARISON_PLAYERS = 4;
const COMPARISON_SLOT_IDS = Array.from({ length: MAX_COMPARISON_PLAYERS }, (_, index) => `compareSlot${index + 1}Select`);
const GROUP_FILTER_ALL = '__all__';
const GROUP_FILTER_QUALIFIER_ONLY = '__qualifier_only__';
const GROUP_FILTER_POST_ONLY = '__post_only__';
const CLASSIC_EXPORT_FORMATS = new Set(['full', 'fragment']);
const CLASSIC_LANGUAGE_OPTIONS = new Set(['nl', 'uk']);
const CLASSIC_VISIBILITY_DEFAULTS = {
  showTopCups: false,
  showCupTrackOverview: false,
  showTrackDetail: false,
  showCharacterHub: false,
  showTotalAfterRaceChart: false,
  showPositionDistributionTable: false,
  showChartDownloadButtons: false,
};
const exportAssetDataUrlCache = new Map();
let storyContextCleanup = null;

function cloneClassicCustomizationDefaults() {
  return {
    visibility: { ...CLASSIC_VISIBILITY_DEFAULTS },
    introHtml: '',
    topTracksIntroHtml: '',
    playerNotesByPlayer: {},
    updatedAt: '',
    updatedBy: '',
  };
}
const I18N = {
  nl: {
    race: 'Race',
    chart: 'Grafiek',
    noDataPoint: 'Geen datapunt',
    noComparison: 'geen-vergelijking',
    musicOn: 'Muziek aan',
    musicOff: 'Muziek uit',
    stopMusic: 'Muziek stoppen',
    playMusic: 'Muziek afspelen',
    playMusicLabel: 'Speel muziek van {track} af',
    uniqueRaces: 'Unieke races',
    participants: 'Deelnemers',
    groups: 'Groepen',
    tracksPlayed: 'Banen gespeeld',
    cupsPlayed: 'Cups gespeeld',
    characterRosters: 'Personagerosters',
    noRaceData: 'Geen racegegevens beschikbaar.',
    characterHub: 'Personagehub',
    noCharacterDataSelection: 'Er zijn geen personagegegevens beschikbaar voor deze selectie.',
    roster: 'Roster',
    picks: 'Keuzes',
    share: 'Aandeel',
    colorVariants: 'Kleurvarianten',
    totalSuffix: 'totaal',
    within: 'binnen',
    trackDetailBlurb: 'Baandetail en sterkste spelers op deze selectie.',
    timesPlayed: 'keer gespeeld',
    participant: 'Deelnemer',
    standingsColRank: '#',
    standingsColName: 'Name',
    standingsColChar: 'Char',
    standingsColPts: 'Pts',
    avgRacePoints: 'Gem. racepunten',
    timesPlayedHeader: 'Keer gespeeld',
    bestFinish: 'Beste finish',
    charactersPlayed: 'Characters gespeeld',
    noCharacterDataPlayer: 'Er zijn geen charactergegevens beschikbaar voor {player}.',
    charactersOfPlayer: 'Characters van {player}',
    playerCharacterUsage: 'Aantal keer gespeeld en aandeel binnen alle races van deze speler.',
    character: 'Character',
    noSharedTotals: 'Deze twee spelers hebben binnen de huidige selectie geen gedeelde races met totaalstanden.',
    twoPlayerDelta: 'Twee-speler delta',
    deltaChart: 'Delta grafiek',
    points: 'punten',
    ahead: 'voor',
    behind: 'achter',
    comparisonFilters: 'Vergelijkingsfilters',
    autoComparisonHelp: 'Automatisch gevuld met {count} spelers uit Kampioen wanneer alle groepen zichtbaar zijn. Je kunt uitbreiden tot {max}.',
    manualComparisonHelp: 'Speler 1 volgt de globale speler; de overige velden blijven leeg tot je zelf kiest.',
    choosePlayer1: 'Kies speler 1',
    choosePlayerN: 'Kies speler {index}',
    playerN: 'Speler {index}',
    player1Scope: 'Scope speler 1',
    selectedCountOfMax: 'Geselecteerd: {count} van {max} spelers.',
    raceProgress: 'Raceverloop',
    noRaceDataForPlayer: 'Geen racegegevens beschikbaar voor deze speler binnen deze selectie.',
    positionAfterRace: 'Positie na race',
    placeSuffix: 'plek',
    sharedWith: 'gedeeld met',
    finishPositionPerRace: 'Finishpositie per race',
    totalAfterRace: 'Totaal na race',
    topThreeTotalBenchmark: 'Top 3 totaalbenchmark',
    topThreeTotalBenchmarkBlurb: 'Puntenverschil van deze speler tegenover de actuele nummers 1, 2 en 3 na iedere race. 0 betekent gelijk; positief betekent voorsprong.',
    firstPositionTotal: 'Δ to 1st',
    secondPositionTotal: 'Δ to 2nd',
    thirdPositionTotal: 'Δ to 3rd',
    participantAnalysis: 'Deelnemeranalyse',
    participantAnalysisDescription: 'Speler 1 is het hoofdperspectief; speler 2 en extra spelers lopen mee in dezelfde grafieken.',
    positionAfterRaceAxis: 'As loopt van 1 bovenaan naar {max} onderaan.',
    finishPosition: 'Finishpositie',
    finishPositionBlurb: 'Per race de daadwerkelijke eindpositie.',
    totalAfterRaceBlurb: 'Opbouw van het puntentotaal door de selectie heen.',
    positionDistribution: 'Positieverdeling',
    noPositionsForGroup: 'Voor deze groep zijn nog geen raceposities aanwezig.',
    positionDistributionDescription: 'Per speler zie je hoe vaak iedere finishpositie voorkwam, plus top 3-ritme en gemiddelde finish.',
    top3: 'Top 3',
    avgAbbrev: 'Gem.',
    selectedPlayerFront: '{player} staat vooraan in de grafiek voor deze groep.',
    noHistogramGroups: 'Er zijn geen groepen beschikbaar voor de histogramtabel.',
    selectedPlayerFrontCompare: '{player} staat vooraan; extra geselecteerde spelers worden ernaast gezet per positie.',
    comparison: 'Spelervergelijking',
    comparisonDescription: 'Gebaseerd op dezelfde gedeelde filterset van speler 1, speler 2 en extra spelers.',
    sharedRaces: 'gedeelde races',
    tied: 'Gelijk',
    avgGroupDelta: 'Gem. groepsdelta',
    track: 'Baan',
    cup: 'Cup',
    duels: 'Duels',
    noSharedTracks: 'Geen gezamenlijke banen in deze selectie.',
    addTwoPlayers: 'Voeg via de gedeelde vergelijkingsfilters minimaal twee spelers toe om paarvergelijkingen te tonen.',
    endStandings: 'Eindstanden',
    noEndGroups: 'Er zijn geen eindgroepen beschikbaar voor deze selectie.',
    endStandingsTable: 'Eindstandentabel voor eindrondes',
    endStandingsDescription: 'Per eindgroep zie je de complete eindstand. Gedeelde plekken blijven expliciet zichtbaar.',
    playersCount: '{count} spelers',
    qualifier: 'Kwalificatie',
    noQualifierStandings: 'Er zijn geen kwalificatiestanden beschikbaar voor deze selectie.',
    qualifierTable: 'Kwalificatiestandentabel',
    qualifierDescription: 'Tags tonen direct naar welke eindgroep een deelnemer doorstroomde.',
    endGroup: 'Eindgroep',
    top5Tracks: 'Top 5 meest gespeelde banen',
    top5Cups: 'Top 5 meest gespeelde cups',
    trackDetailEmptyExport: 'De baandetail hieronder gebruikt de standaard geselecteerde baan voor deze export.',
    trackDetailEmptyInteractive: 'Kies een baan in het overzicht om de sterkste spelers en muziekoptie te zien.',
    cupTrackOverview: 'Cup- en baangebruiksoverzicht',
    uniqueRacesBasis: '{count} unieke groepsraces vormen de basis voor alle aantallen en percentages.',
    fixedStoryTitle: 'Toernooiverhaal in vaste opbouw',
    fixedStoryDescription: 'Deze pagina gebruikt dezelfde tabellen, waarden en grafieken als de analyticsweergave, maar zet ze in een langere recap-flow met vaste spelersecties.',
    leadChampion: '{player} voert de recap aan als best geklasseerde speler in de eindgroep met {points} punten.',
    leadFallback: 'Deze recap gebruikt de bestaande Step 10-data als basis voor alle spelersblokken.',
    leadTrack: '{track} was een van de opvallendste banen in deze selectie.',
    leadCup: '{cup} kwam het vaakst terug in de gespeelde races.',
    directRankComparison: 'Directe rangvergelijking',
    noDirectComparison: 'Er is geen directe speler boven of onder deze speler beschikbaar in dezelfde groep.',
    leaderComparisonDescription: '{player} wordt vergeleken met de nummer 2 van {group} om het gat aan de top te tonen.',
    followerComparisonDescription: '{player} wordt vergeleken met {opponent}, de speler direct boven hen in {group}.',
    directComparisonFor: 'Directe rangvergelijking voor {player}',
    noSharedTotalsPlayers: 'Deze speler en de gekozen vergelijkingsspeler hebben geen gedeelde races met totaalstanden in deze selectie.',
    playerLabel: 'Deelnemer',
    playerSectionIntro: '{player} krijgt hier een vaste recap-sectie op basis van de bestaande Step 10-output.',
    qualifierStandingSentence: 'De speler stond in {group} op plek {position} met {points} punten in de kwalificatie.',
    noQualifierStandingPlayer: 'Er is geen kwalificatiestand beschikbaar voor deze speler.',
    finalStandingSentence: 'De speler eindigde in {group} op plek {position} met {points} punten.',
    noFinalStandingPlayer: 'Er is geen eindgroepstand beschikbaar voor deze speler.',
    playerRaceSummary: 'Over {races} races noteerde deze speler {wins} keer plek 1 en {top3} top-3-finishes.',
    noRaceFramesPlayer: 'Er zijn voor deze speler geen raceframes beschikbaar.',
    qualifierGroup: 'Kwalificatiegroep',
    pointsLabel: 'Punten',
    racesLabel: 'Races',
    wins: 'Overwinningen',
    avgPosLabel: 'Gem. pos',
    avgFinishLabel: 'Gem. finish',
    keyLabel: 'Kenmerk',
    valueLabel: 'Waarde',
    raceProgressOf: 'Raceverloop van {player}',
    allPlayerCharts: 'Alle racegrafieken van deze speler binnen het geselecteerde toernooi.',
    tournamentRankLabel: 'Tournament Rank',
    positionDistributionOf: 'Positieverdeling van {player}',
    basedOnGroupOfPlayer: 'Gebaseerd op de {groupType} van {player}.',
    playerCentralHistogram: '{player} staat centraal in deze positieverdeling.',
    noGroupForPlayerHistogram: 'Er is geen groep beschikbaar om de positieverdeling voor deze speler te tonen.',
    playerIndex: 'Spelerindex',
    jumpToPlayerRecap: 'Spring direct naar een vaste recap-sectie per deelnemer.',
    personagehubDescription: 'Compact overzicht van de meest gebruikte rosters en varianten.',
    tournamentRecapTitle: 'MK8DX Toernooirecap',
    classicExportKicker: 'Mario Kart 8 Deluxe toernooirecap',
    classicExportIntro: 'Deze export gebruikt dezelfde Step 10-tabellen, waarden en grafieken als de analyticsomgeving, maar is geoptimaliseerd voor de lichte WordPress-pagina van Classic.',
    classicPreviewTitle: 'WordPress exportpreview',
    classicPreviewDescription: 'Gebruik deze pagina om een statische HTML-export of een losse entry-content-fragmentexport te downloaden voor Classic.',
    formatLabel: 'Format',
    languageLabel: 'Taal',
    exportInteractiveLabel: 'Export interactiviteit',
    exportInteractiveText: 'Grafiek-hoverdata meenemen',
    compactExportLabel: 'Compact',
    interactiveExportLabel: 'Interactief',
    exportEmbedImagesLabel: 'Afbeeldingen exporteren',
    exportEmbedImagesText: 'Afbeeldingen insluiten',
    linkedImagesLabel: 'Gelinkt',
    embeddedImagesLabel: 'Ingesloten',
    groupFilterLabelShort: 'Groepsfilter',
    playerFilterLabelShort: 'Spelerfilter',
    embeddedPreviewTitle: 'Embedded Twenty Fifteen preview',
    classicFragmentHelper: 'De download levert alleen de entry-content op, maar de preview toont die inhoud al ingebed in de Twenty Fifteen-shell zodat de sidebar- en contentverhouding direct zichtbaar is.',
    classicFullHelper: 'De preview gebruikt de volledige Twenty Fifteen-shell, zodat je direct ziet hoe de export in de site-opbouw van de community landt.',
    classicSave: 'Opslaan',
    classicSaveIdle: 'Niet opgeslagen wijzigingen',
    classicSaveSuccess: 'Wijzigingen opgeslagen',
    classicSaveFailed: 'Opslaan mislukt',
    classicSaving: 'Opslaan…',
    classicEditorTitle: 'Export inhoud aanpassen',
    classicEditorDescription: 'Pas teksten en zichtbaarheid aan. Opslaan zet de huidige stand vast voor latere bewerking en export.',
    classicIntroLabel: 'Toernooi-introductie',
    classicTopTracksIntroLabel: 'Introductie top 5 gereden banen',
    classicPlayerNoteLabel: 'Persoonlijke analyse voor {player}',
    classicEdit: 'Klik om tekst aan te passen',
    summaryTitle: 'Samenvatting:',
    classicEditorBold: 'Vet',
    classicEditorItalic: 'Cursief',
    classicEditorUnderline: 'Onderstrepen',
    classicEditorStrike: 'Doorhalen',
    classicEditorLink: 'Link',
    classicEditorUnorderedList: 'Lijst',
    classicEditorOrderedList: 'Genummerde lijst',
    classicEditorAlignLeft: 'Links',
    classicEditorAlignCenter: 'Centreren',
    classicEditorAlignRight: 'Rechts',
    classicEditorIndent: 'Inspringen',
    classicEditorOutdent: 'Uitspringen',
    classicEditorClear: 'Opmaak wissen',
    classicEditorFont: 'Lettertype',
    classicEditorSize: 'Grootte',
    classicEditorColor: 'Tekstkleur',
    classicEditorBg: 'Achtergrondkleur',
    classicEditorLinkPrompt: 'Plak de link-URL',
    classicEditorMore: 'Meer',
    classicEditorColorHelp: 'Selecteer tekst en kies een kleur om die selectie aan te passen.',
    classicApply: 'Toepassen',
    classicCancel: 'Annuleren',
    classicHistogramHoverPercent: 'Percentage',
    classicHistogramHoverTracks: 'Banen',
    chartCountLabel: 'Aantal',
    chartInfoAria: 'Grafiekinfo',
    chartInfoLabel: 'Info',
    positionAfterRaceInfo: 'Toont na elke race de tussenstandpositie. Lager is beter: 1 staat bovenaan en de lijn volgt de ranking door het toernooi.',
    finishPositionInfo: 'Toont de daadwerkelijke finishpositie per race. Hiermee zie je ritme, pieken en dips los van puntentotaal.',
    totalAfterRaceInfo: 'Toont de opbouw van het totale aantal punten per race binnen de huidige selectie.',
    topThreeTotalBenchmarkInfo: 'Toont het puntenverschil met de actuele nummer 1, 2 en 3 per race. 0 is gelijk; positief betekent dat deze speler voorligt.',
    positionDistributionInfo: 'Toont hoe vaak elke finishpositie voorkwam. Hover op een balk voor aandeel en de banen waarop die positie is behaald.',
    deltaChartInfo: 'Toont per gedeelde race het puntverschil tussen twee spelers. Boven de nullijn ligt speler A voor, onder de nullijn speler B.',
    classicSectionVisibilityLabel: 'Secties in export tonen',
    classicShowTopCups: 'Top 5 meest gespeelde cups',
    classicShowCupTrackOverview: 'Cup- en baangebruiksoverzicht',
    classicShowTrackDetail: 'Baandetail en sterkste spelers',
    classicShowCharacterHub: 'Character hub',
    classicShowTotalAfterRaceChart: 'Total after race grafiek',
    classicShowPositionDistributionTable: 'Positieverdeling tabel',
    classicShowChartDownloadButtons: 'JPEG downloadknoppen tonen',
    classicTopTracksHeader: 'Top 5 gereden banen',
    classicReturnToStandings: 'Terug naar eindstand',
    classicWordpressStart: 'vvv WORDPRESS PAGINA START HIER vvv',
    scopeLabel: 'Toernooi',
    groupLabel: 'Groep',
    playerLabelShort: 'Speler',
    resetDefault: 'Terug naar standaard',
    downloadIndex: 'Download index.html',
    downloadEntry: 'Download .entry-content',
    backToBoard: 'Terug naar toernooibord',
    openRecap: 'Open recap',
    openDashboard: 'Open dashboard',
    classicHeroKicker: 'Stap 10 Classic-export',
    classicHeroFallbackTitle: 'MK8DX Classic-export',
    classicHeroSubtitle: 'Statische exportpreview voor een WordPress-pagina op basis van de lokale tn11-layout.',
    classicHeroLoadedSubtitle: 'Statische exportpreview voor de verslaggever, met dezelfde Step 10-tabellen en grafieken in een WordPress-vriendelijke light theme.',
    allPlayers: 'alle spelers',
    allPlayersCapitalized: 'Alle spelers',
    allGroups: 'alle groepen',
    allGroupsCapitalized: 'Alle groepen',
    allQualifiers: 'alle kwalificaties',
    allQualifiersCapitalized: 'Alleen Alle Kwalificaties',
    allEndGroups: 'alle eindgroepen',
    allEndGroupsCapitalized: 'Alleen Alle Eindgroepen',
    resetFilters: 'Filters resetten',
    downloadAllCharts: 'Alle grafieken downloaden',
    exportReady: 'Export klaar voor {tournament} · {participants} deelnemers · format {format} · taal {language} · export {mode} · afbeeldingen {imageMode} · {races} unieke groepsraces.',
    noAnalyzableTournaments: 'Geen analyseerbare toernooien',
    noStep10: 'Er is nog geen toernooi dat volgens de bestaande workflow Stap 10 heeft bereikt.',
    characterHubTitle: 'Personagehub',
  },
  uk: {},
};
Object.assign(I18N.uk, {
  race: 'Race',
  chart: 'Chart',
  noDataPoint: 'No data point',
  noComparison: 'no-comparison',
  musicOn: 'Music on',
  musicOff: 'Music off',
  stopMusic: 'Stop music',
  playMusic: 'Play music',
  playMusicLabel: 'Play music from {track}',
  uniqueRaces: 'Unique races',
  participants: 'Participants',
  groups: 'Groups',
  tracksPlayed: 'Tracks played',
  cupsPlayed: 'Cups played',
  characterRosters: 'Character rosters',
  noRaceData: 'No race data available.',
  characterHub: 'Character hub',
  noCharacterDataSelection: 'No character data is available for this selection.',
  roster: 'Roster',
  picks: 'Picks',
  share: 'Share',
  colorVariants: 'Colour variants',
  totalSuffix: 'total',
  within: 'within',
  trackDetailBlurb: 'Track detail and strongest players in this selection.',
  timesPlayed: 'times played',
  participant: 'Participant',
  standingsColRank: '#',
  standingsColName: 'Name',
  standingsColChar: 'Char',
  standingsColPts: 'Pts',
  avgRacePoints: 'Avg race points',
  timesPlayedHeader: 'Times played',
  bestFinish: 'Best finish',
  charactersPlayed: 'Characters played',
  noCharacterDataPlayer: 'No character data is available for {player}.',
  charactersOfPlayer: 'Characters for {player}',
  playerCharacterUsage: 'Times played and share across all races for this player.',
  character: 'Character',
  noSharedTotals: 'These two players have no shared races with running totals in the current selection.',
  twoPlayerDelta: 'Two-player delta',
  deltaChart: 'Delta chart',
  points: 'points',
  ahead: 'ahead',
  behind: 'behind',
  comparisonFilters: 'Comparison filters',
  autoComparisonHelp: 'Automatically filled with {count} players from Champion when all groups are visible. You can expand up to {max}.',
  manualComparisonHelp: 'Player 1 follows the global player; the remaining fields stay empty until you choose them.',
  choosePlayer1: 'Choose player 1',
  choosePlayerN: 'Choose player {index}',
  playerN: 'Player {index}',
  player1Scope: 'Player 1 scope',
  selectedCountOfMax: 'Selected: {count} of {max} players.',
  raceProgress: 'Race progress',
  noRaceDataForPlayer: 'No race data is available for this player in this selection.',
  positionAfterRace: 'Position after race',
  placeSuffix: 'place',
  sharedWith: 'shared with',
  finishPositionPerRace: 'Finish position per race',
  totalAfterRace: 'Total after race',
  topThreeTotalBenchmark: 'Top 3 total benchmark',
  topThreeTotalBenchmarkBlurb: 'Point difference for this player against the current 1st, 2nd and 3rd after each race. 0 means tied; positive means ahead.',
  firstPositionTotal: 'Δ to 1st',
  secondPositionTotal: 'Δ to 2nd',
  thirdPositionTotal: 'Δ to 3rd',
  participantAnalysis: 'Participant analysis',
  participantAnalysisDescription: 'Player 1 is the main perspective; player 2 and extra players are shown in the same charts.',
  positionAfterRaceAxis: 'Axis runs from 1 at the top to {max} at the bottom.',
  finishPosition: 'Finish position',
  finishPositionBlurb: 'Actual finishing position for each race.',
  totalAfterRaceBlurb: 'Build-up of the running points total across the selection.',
  positionDistribution: 'Position distribution',
  noPositionsForGroup: 'No race positions are available for this group yet.',
  positionDistributionDescription: 'For each player you can see how often each finishing position occurred, plus top 3 rhythm and average finish.',
  top3: 'Top 3',
  avgAbbrev: 'Avg.',
  selectedPlayerFront: '{player} is highlighted at the front of the chart for this group.',
  noHistogramGroups: 'No groups are available for the histogram table.',
  selectedPlayerFrontCompare: '{player} is shown first; extra selected players are placed alongside by position.',
  comparison: 'Player comparison',
  comparisonDescription: 'Based on the same shared filter set for player 1, player 2 and extra players.',
  sharedRaces: 'shared races',
  tied: 'Tied',
  avgGroupDelta: 'Avg group delta',
  track: 'Track',
  cup: 'Cup',
  duels: 'Duels',
  noSharedTracks: 'No shared tracks in this selection.',
  addTwoPlayers: 'Add at least two players via the shared comparison filters to show pair comparisons.',
  endStandings: 'Final standings',
  noEndGroups: 'No final groups are available for this selection.',
  endStandingsTable: 'Final standings table for final rounds',
  endStandingsDescription: 'Each final group shows the complete final ranking. Tied places remain explicitly visible.',
  playersCount: '{count} players',
  qualifier: 'Qualifier',
  noQualifierStandings: 'No qualifier standings are available for this selection.',
  qualifierTable: 'Qualifier standings table',
  qualifierDescription: 'Tags show directly which final group each participant advanced to.',
  endGroup: 'Final group',
  top5Tracks: 'Top 5 most played tracks',
  top5Cups: 'Top 5 most played cups',
  trackDetailEmptyExport: 'The track detail below uses the default selected track for this export.',
  trackDetailEmptyInteractive: 'Choose a track in the overview to see the strongest players and music option.',
  cupTrackOverview: 'Cup and track usage overview',
  uniqueRacesBasis: '{count} unique group races form the basis for all counts and percentages.',
  fixedStoryTitle: 'Tournament story in a fixed structure',
  fixedStoryDescription: 'This page uses the same tables, values and charts as the analytics view, but arranges them in a longer recap flow with fixed player sections.',
  leadChampion: '{player} leads the recap as the highest-ranked player in the final group with {points} points.',
  leadFallback: 'This recap uses the existing Step 10 data as the basis for all player sections.',
  leadTrack: '{track} was one of the standout tracks in this selection.',
  leadCup: '{cup} appeared most often in the races played.',
  directRankComparison: 'Direct rank comparison',
  noDirectComparison: 'No direct player above or below this player is available in the same group.',
  leaderComparisonDescription: '{player} is compared with the number 2 in {group} to show the gap at the top.',
  followerComparisonDescription: '{player} is compared with {opponent}, the player directly above them in {group}.',
  directComparisonFor: 'Direct rank comparison for {player}',
  noSharedTotalsPlayers: 'This player and the chosen comparison player have no shared races with running totals in this selection.',
  playerLabel: 'Participant',
  playerSectionIntro: '{player} gets a fixed recap section here based on the existing Step 10 output.',
  qualifierStandingSentence: 'The player finished in {group} in position {position} with {points} points in the qualifier.',
  noQualifierStandingPlayer: 'No qualifier standing is available for this player.',
  finalStandingSentence: 'The player finished in {group} in position {position} with {points} points.',
  noFinalStandingPlayer: 'No final group standing is available for this player.',
  playerRaceSummary: 'Across {races} races this player recorded {wins} wins and {top3} top-3 finishes.',
  noRaceFramesPlayer: 'No race frames are available for this player.',
  qualifierGroup: 'Qualifier group',
  pointsLabel: 'Points',
  racesLabel: 'Races',
  wins: 'Wins',
  avgPosLabel: 'Avg pos',
  avgFinishLabel: 'Avg finish',
  keyLabel: 'Metric',
  valueLabel: 'Value',
  raceProgressOf: 'Race progress for {player}',
  allPlayerCharts: 'All race charts for this player within the selected tournament.',
  tournamentRankLabel: 'Tournament Rank',
  positionDistributionOf: 'Position distribution for {player}',
  basedOnGroupOfPlayer: 'Based on the {groupType} of {player}.',
  playerCentralHistogram: '{player} is central in this position distribution.',
  noGroupForPlayerHistogram: 'No group is available to show the position distribution for this player.',
  playerIndex: 'Player index',
  jumpToPlayerRecap: 'Jump directly to a fixed recap section for each participant.',
  personagehubDescription: 'Compact overview of the most used rosters and variants.',
  tournamentRecapTitle: 'MK8DX Tournament recap',
  classicExportKicker: 'Mario Kart 8 Deluxe tournament recap',
  classicExportIntro: 'This export uses the same Step 10 tables, values and charts as the analytics environment, but is optimised for Classic’s light WordPress page.',
  classicPreviewTitle: 'WordPress export preview',
  classicPreviewDescription: 'Use this page to download a static HTML export or a separate entry-content fragment export for Classic.',
  formatLabel: 'Format',
  languageLabel: 'Language',
  exportInteractiveLabel: 'Export interactivity',
  exportInteractiveText: 'Include chart hover data',
  compactExportLabel: 'Compact',
  interactiveExportLabel: 'Interactive',
  exportEmbedImagesLabel: 'Export images',
  exportEmbedImagesText: 'Embed images',
  linkedImagesLabel: 'Linked',
  embeddedImagesLabel: 'Embedded',
  groupFilterLabelShort: 'Group filter',
  playerFilterLabelShort: 'Player filter',
  embeddedPreviewTitle: 'Embedded Twenty Fifteen preview',
  classicFragmentHelper: 'The download only contains the entry content, but the preview already shows that content embedded in the Twenty Fifteen shell so the sidebar/content ratio is immediately visible.',
  classicFullHelper: 'The preview uses the full Twenty Fifteen shell so you can immediately see how the export lands in the community site’s structure.',
  classicSave: 'Save',
  classicSaveIdle: 'Unsaved changes',
  classicSaveSuccess: 'Changes saved',
  classicSaveFailed: 'Save failed',
  classicSaving: 'Saving…',
  classicEditorTitle: 'Edit export content',
  classicEditorDescription: 'Adjust text and visibility. Save stores the current state for later editing and export.',
  classicIntroLabel: 'Tournament introduction',
  classicTopTracksIntroLabel: 'Introduction for top 5 tracks',
  classicPlayerNoteLabel: 'Personal analysis for {player}',
  classicEdit: 'Click to edit text',
  summaryTitle: 'Summary:',
  classicEditorBold: 'Bold',
  classicEditorItalic: 'Italic',
  classicEditorUnderline: 'Underline',
  classicEditorStrike: 'Strikethrough',
  classicEditorLink: 'Link',
  classicEditorUnorderedList: 'List',
  classicEditorOrderedList: 'Numbered list',
  classicEditorAlignLeft: 'Align left',
  classicEditorAlignCenter: 'Center',
  classicEditorAlignRight: 'Align right',
  classicEditorIndent: 'Indent',
  classicEditorOutdent: 'Outdent',
  classicEditorClear: 'Clear formatting',
  classicEditorFont: 'Font',
  classicEditorSize: 'Size',
  classicEditorColor: 'Text color',
  classicEditorBg: 'Background color',
  classicEditorLinkPrompt: 'Paste link URL',
  classicEditorMore: 'More',
  classicEditorColorHelp: 'Select text and pick a color to apply it to that selection.',
  classicApply: 'Apply',
  classicCancel: 'Cancel',
  classicHistogramHoverPercent: 'Percent',
  classicHistogramHoverTracks: 'Tracks',
  chartCountLabel: 'Count',
  chartInfoAria: 'Chart info',
  chartInfoLabel: 'Info',
  positionAfterRaceInfo: 'Shows the interim standing position after each race. Lower is better: 1 is at the top and the line tracks ranking through the tournament.',
  finishPositionInfo: 'Shows the actual finishing position per race, so you can read rhythm, peaks and dips separately from total points.',
  totalAfterRaceInfo: 'Shows the build-up of total points after each race within the current selection.',
  topThreeTotalBenchmarkInfo: 'Shows the points difference versus the current 1st, 2nd and 3rd after each race. 0 is tied; positive means this player is ahead.',
  positionDistributionInfo: 'Shows how often each finishing position occurred. Hover a bar for share and the tracks where that result happened.',
  deltaChartInfo: 'Shows the points delta between two players for each shared race. Above zero player A leads, below zero player B leads.',
  classicSectionVisibilityLabel: 'Show sections in export',
  classicShowTopCups: 'Top 5 most played cups',
  classicShowCupTrackOverview: 'Cup and track usage overview',
  classicShowTrackDetail: 'Track detail and strongest players',
  classicShowCharacterHub: 'Character hub',
  classicShowTotalAfterRaceChart: 'Total after race chart',
  classicShowPositionDistributionTable: 'Position distribution table',
  classicShowChartDownloadButtons: 'Show JPEG download buttons',
  classicTopTracksHeader: 'Top 5 tracks driven',
  classicReturnToStandings: 'Back to standings',
  classicWordpressStart: 'vvv WORDPRESS PAGE STARTS HERE vvv',
  scopeLabel: 'Tournament',
  groupLabel: 'Group',
  playerLabelShort: 'Player',
  resetDefault: 'Reset to default',
  downloadIndex: 'Download index.html',
  downloadEntry: 'Download .entry-content',
  backToBoard: 'Back to tournament board',
  openRecap: 'Open recap',
  openDashboard: 'Open dashboard',
  classicHeroKicker: 'Step 10 Classic export',
  classicHeroFallbackTitle: 'MK8DX Classic export',
  classicHeroSubtitle: 'Static export preview for a WordPress page based on the local tn11 layout.',
  classicHeroLoadedSubtitle: 'Static export preview for the report writer, using the same Step 10 tables and charts in a WordPress-friendly light theme.',
  allPlayers: 'all players',
  allPlayersCapitalized: 'All players',
  allGroups: 'all groups',
  allGroupsCapitalized: 'All groups',
  allQualifiers: 'all qualifiers',
  allQualifiersCapitalized: 'Only all qualifiers',
  allEndGroups: 'all final groups',
  allEndGroupsCapitalized: 'Only all final groups',
  resetFilters: 'Reset filters',
  downloadAllCharts: 'Download all charts',
  exportReady: 'Export ready for {tournament} · {participants} participants · format {format} · language {language} · export {mode} · images {imageMode} · {races} unique group races.',
  noAnalyzableTournaments: 'No analysable tournaments',
  noStep10: 'No tournament has reached Step 10 yet according to the existing workflow.',
  momentumBetweenPlayers: 'Momentum between two players',
  momentumDescription: 'Compare the delta in total points after each shared race for player 1 and player 2 from the shared filter set.',
  characterHubTitle: 'Character hub',
});

function tr(key, vars = {}) {
  const lang = state.language || 'nl';
  const source = I18N[lang] || I18N.nl;
  const fallback = I18N.nl[key] || key;
  return String(source[key] || fallback).replace(/\{(\w+)\}/g, (_m, name) => String(vars[name] ?? ''));
}

function fetchJson(url) {
  return fetch(url, { headers: { Accept: 'application/json' } }).then((response) => response.json());
}

async function fetchAnalytics() {
  const params = new URLSearchParams();
  if (state.scope) params.set('scope', state.scope);
  return fetchJson(`../api/tournament_analytics.php?${params.toString()}`);
}

async function fetchCatalog() {
  return fetchJson('../assets/game_catalog.json');
}

function classicCustomizationScopeKey() {
  return [state.scope || '', state.groupFilter || GROUP_FILTER_ALL, state.language || 'nl'].join('|');
}

function classicCustomizationState() {
  if (!state.classicCustomization) state.classicCustomization = cloneClassicCustomizationDefaults();
  if (!state.classicCustomization.visibility) state.classicCustomization.visibility = { ...CLASSIC_VISIBILITY_DEFAULTS };
  return state.classicCustomization;
}

function classicVisibilityValue(key) {
  const customization = classicCustomizationState();
  return Boolean(customization.visibility?.[key]);
}

function classicVisibilityCheckboxId(key) {
  const map = {
    showTopCups: 'classicShowTopCupsCheckbox',
    showCupTrackOverview: 'classicShowCupTrackOverviewCheckbox',
    showTrackDetail: 'classicShowTrackDetailCheckbox',
    showCharacterHub: 'classicShowCharacterHubCheckbox',
    showTotalAfterRaceChart: 'classicShowTotalAfterRaceChartCheckbox',
    showPositionDistributionTable: 'classicShowPositionDistributionTableCheckbox',
    showChartDownloadButtons: 'classicShowChartDownloadButtonsCheckbox',
  };
  return map[key] || '';
}

function classicEditTargetForPlayer(playerName) {
  return `player:${String(playerName || '')}`;
}

function classicCurrentTextForTarget(target) {
  const customization = classicCustomizationState();
  if (target === 'intro') return String(customization.introHtml || '');
  if (target === 'topTracksIntro') return String(customization.topTracksIntroHtml || '');
  if (target.startsWith('player:')) {
    const playerName = target.replace(/^player:/, '');
    return String(customization.playerNotesByPlayer?.[playerName] || '');
  }
  return '';
}

function classicSetTextForTarget(target, value) {
  const customization = classicCustomizationState();
  const nextValue = String(value || '');
  if (target === 'intro') {
    customization.introHtml = nextValue;
    return;
  }
  if (target === 'topTracksIntro') {
    customization.topTracksIntroHtml = nextValue;
    return;
  }
  if (target.startsWith('player:')) {
    const playerName = target.replace(/^player:/, '');
    customization.playerNotesByPlayer[playerName] = nextValue;
  }
}

function classicBeginInlineEdit(target) {
  state.classicEditingTarget = target;
  state.classicEditingDrafts[target] = classicCurrentTextForTarget(target);
}

function classicCancelInlineEdit(target) {
  if (target && state.classicEditingTarget === target) state.classicEditingTarget = '';
  if (target && Object.prototype.hasOwnProperty.call(state.classicEditingDrafts, target)) delete state.classicEditingDrafts[target];
}

function classicSaveInlineEdit(target) {
  const liveHtml = classicReadEditorHtml(target);
  if (liveHtml != null) state.classicEditingDrafts[target] = liveHtml;
  const draft = String(state.classicEditingDrafts?.[target] ?? classicCurrentTextForTarget(target));
  classicSetTextForTarget(target, draft);
  state.classicCustomizationDirty = true;
  if (hasNode('classicSaveStatus')) qs('classicSaveStatus').textContent = tr('classicSaveIdle');
  classicCancelInlineEdit(target);
}

function classicReadEditorHtml(target) {
  if (!target || !document?.querySelectorAll) return null;
  const nodes = Array.from(document.querySelectorAll('[data-classic-edit-input]'));
  const node = nodes.find((candidate) => String(candidate?.dataset?.classicEditInput || '') === String(target));
  if (!node) return null;
  if (node.isContentEditable) return String(node.innerHTML || '');
  if ('value' in node) return String(node.value || '');
  return null;
}

function classicTablerIcon(iconName) {
  const icons = {
    bold: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h6a4 4 0 0 1 0 8H7z"></path><path d="M7 13h7a4 4 0 0 1 0 8H7z"></path></svg>',
    italic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4h8"></path><path d="M8 20h8"></path><path d="M14 4l-4 16"></path></svg>',
    underline: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4v6a5 5 0 0 0 10 0V4"></path><path d="M5 20h14"></path></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12a3 3 0 0 0 3 3h3a3 3 0 0 0 0-6h-3a3 3 0 0 0-3 3z"></path><path d="M9 12H7a3 3 0 1 0 0 6h3"></path></svg>',
    list: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11"></path><path d="M9 12h11"></path><path d="M9 18h11"></path><path d="M4 6h.01"></path><path d="M4 12h.01"></path><path d="M4 18h.01"></path></svg>',
    listNumbers: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 6h11"></path><path d="M10 12h11"></path><path d="M10 18h11"></path><path d="M4 6h1v4"></path><path d="M4 12h2l-2 2h2"></path><path d="M4 18a1.5 1.5 0 1 0 0 3a1.5 1.5 0 1 0 0-3"></path></svg>',
    alignLeft: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h10"></path><path d="M4 18h14"></path></svg>',
    alignCenter: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M7 12h10"></path><path d="M5 18h14"></path></svg>',
    alignRight: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M10 12h10"></path><path d="M6 18h14"></path></svg>',
    clear: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6l-12 12"></path></svg>',
    indent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M4 12h10"></path><path d="M4 18h16"></path><path d="M14 10l3 2l-3 2z"></path></svg>',
    outdent: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16"></path><path d="M10 12h10"></path><path d="M4 18h16"></path><path d="M10 10l-3 2l3 2z"></path></svg>',
  };
  return icons[iconName] || '';
}

function classicEditorToolButton(label, iconName, command, value = '') {
  const dataValue = value ? ` data-classic-value="${esc(value)}"` : '';
  return `<button type="button" class="analytics-ghost-btn classic-editor-btn" title="${esc(label)}" aria-label="${esc(label)}" data-classic-cmd="${esc(command)}"${dataValue}><span class="classic-editor-icon">${classicTablerIcon(iconName)}</span></button>`;
}

function classicRememberSelection(surface) {
  const selection = window?.getSelection ? window.getSelection() : null;
  if (!selection || selection.rangeCount < 1) return;
  const range = selection.getRangeAt(0);
  if (!surface?.contains(range.commonAncestorContainer)) return;
  state.classicEditorSelectionTarget = String(surface.dataset?.classicEditInput || '');
  state.classicEditorSelectionRange = range.cloneRange();
}

function classicRestoreSelection(surface) {
  if (!surface || !state.classicEditorSelectionRange) return;
  const target = String(surface.dataset?.classicEditInput || '');
  if (!target || state.classicEditorSelectionTarget !== target) return;
  const selection = window?.getSelection ? window.getSelection() : null;
  if (!selection) return;
  try {
    selection.removeAllRanges();
    selection.addRange(state.classicEditorSelectionRange);
  } catch (_error) {
    // Ignore stale ranges after rerender.
  }
}

function classicRichToolbar() {
  return `<div class="classic-rich-toolbar"><div class="classic-rich-toolbar-row classic-rich-toolbar-row-main">${classicEditorToolButton(tr('classicEditorBold'), 'bold', 'bold')}${classicEditorToolButton(tr('classicEditorItalic'), 'italic', 'italic')}${classicEditorToolButton(tr('classicEditorUnderline'), 'underline', 'underline')}${classicEditorToolButton(tr('classicEditorLink'), 'link', 'createLink')}${classicEditorToolButton(tr('classicEditorUnorderedList'), 'list', 'insertUnorderedList')}${classicEditorToolButton(tr('classicEditorOrderedList'), 'listNumbers', 'insertOrderedList')}</div><div class="classic-rich-toolbar-row classic-rich-toolbar-row-secondary">${classicEditorToolButton(tr('classicEditorAlignLeft'), 'alignLeft', 'justifyLeft')}${classicEditorToolButton(tr('classicEditorAlignCenter'), 'alignCenter', 'justifyCenter')}${classicEditorToolButton(tr('classicEditorAlignRight'), 'alignRight', 'justifyRight')}<label class="classic-editor-color-chip" title="${esc(tr('classicEditorColor'))}"><span>${esc(tr('classicEditorColor'))}</span><input type="color" value="#1f2a3a" data-classic-cmd-select="foreColor" /></label>${classicEditorToolButton(tr('classicEditorClear'), 'clear', 'removeFormat')}</div><details class="classic-editor-more"><summary>${esc(tr('classicEditorMore'))}</summary><div class="classic-rich-toolbar-row"><label><span>${esc(tr('classicEditorFont'))}</span><select data-classic-cmd-select="fontName"><option value="Noto Sans">Noto Sans</option><option value="Segoe UI">Segoe UI</option><option value="Georgia">Georgia</option><option value="Verdana">Verdana</option><option value="Courier New">Courier New</option></select></label><label><span>${esc(tr('classicEditorSize'))}</span><select data-classic-cmd-select="fontSize"><option value="2">S</option><option value="3" selected>M</option><option value="4">L</option><option value="5">XL</option></select></label><label><span>${esc(tr('classicEditorBg'))}</span><input type="color" value="#fff8b3" data-classic-cmd-select="hiliteColor" /></label>${classicEditorToolButton(tr('classicEditorOutdent'), 'outdent', 'outdent')}${classicEditorToolButton(tr('classicEditorIndent'), 'indent', 'indent')}</div></details><p class="classic-editor-hint">${esc(tr('classicEditorColorHelp'))}</p></div>`;
}

function classicApplyEditorCommand(command, value = '', sourceNode = null) {
  const root = sourceNode?.closest ? sourceNode.closest('.classic-rich-editor') : null;
  const surface = root?.querySelector?.('[data-classic-edit-input][contenteditable="true"]') || null;
  if (!surface) return;
  surface.focus();
  classicRestoreSelection(surface);
  let cmdValue = value;
  if (command === 'createLink') {
    const asked = window?.prompt ? window.prompt(tr('classicEditorLinkPrompt'), 'https://') : '';
    cmdValue = String(asked || '').trim();
    if (!cmdValue) return;
  }
  try {
    document.execCommand(command, false, cmdValue || null);
  } catch (_error) {
    return;
  }
  const target = String(surface.dataset?.classicEditInput || '');
  if (target) state.classicEditingDrafts[target] = String(surface.innerHTML || '');
  classicRememberSelection(surface);
}

function sanitizeClientEditableHtml(source) {
  const html = String(source || '');
  if (!html) return '';
  const allowed = new Set(['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'blockquote', 'span', 'mark']);
  const aliases = { b: 'strong', i: 'em', strike: 's', del: 's', div: 'p', font: 'span',
    h1: 'p', h2: 'p', h3: 'p', h4: 'p', h5: 'p', h6: 'p' };
  const dropped = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'form', 'input', 'button']);
  const styleRules = {
    color: /^(?:#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i,
    'background-color': /^(?:#[0-9a-f]{3,8}|rgba?\([\d.,\s%]+\))$/i,
    'text-align': /^(?:left|center|right|justify)$/i,
    'font-size': /^(?:[1-7]|\d{1,2}(?:px|pt|em|rem))$/i,
    'font-family': /^(?:Noto Sans|Segoe UI|Georgia|Verdana|Courier New)$/i,
    'margin-left': /^(?:0|\d{1,3}(?:px|em))$/i,
  };
  const template = document.createElement('template');
  template.innerHTML = html;
  const clean = document.createElement('div');
  const appendSafe = (sourceNode, destination) => {
    if (sourceNode.nodeType === Node.TEXT_NODE) {
      const parts = sourceNode.textContent.replace(/\r\n?|\n/g, '\n').split('\n');
      parts.forEach((part, index) => {
        if (index > 0) destination.appendChild(document.createElement('br'));
        destination.appendChild(document.createTextNode(part));
      });
      return;
    }
    if (sourceNode.nodeType !== Node.ELEMENT_NODE) return;
    const originalTag = sourceNode.localName.toLowerCase();
    if (dropped.has(originalTag)) return;
    const tag = aliases[originalTag] || originalTag;
    if (!allowed.has(tag)) {
      Array.from(sourceNode.childNodes).forEach((child) => appendSafe(child, destination));
      return;
    }
    const href = tag === 'a' ? String(sourceNode.getAttribute('href') || '').trim() : '';
    if (tag === 'a' && (!/^(?:https?:\/\/|mailto:)/i.test(href) || /[\s<>"']/u.test(href) || href.length > 2000)) {
      Array.from(sourceNode.childNodes).forEach((child) => appendSafe(child, destination));
      return;
    }
    const element = document.createElement(tag);
    if (tag === 'a') {
      element.setAttribute('href', href);
      element.setAttribute('rel', 'noopener');
      element.setAttribute('target', '_blank');
    }
    const safeClasses = String(sourceNode.getAttribute('class') || '').split(/\s+/)
      .filter((name) => /^(?:rt-color-(?:red|orange|yellow|green|blue|purple|gray)|rt-bg-(?:yellow|green|blue|pink)|rt-size-(?:s|l|xl)|rt-font-(?:serif|mono)|rt-align-(?:center|right)|rt-indent-[1-3])$/.test(name));
    if (safeClasses.length) element.className = [...new Set(safeClasses)].join(' ');
    for (const property of Object.keys(styleRules)) {
      const value = sourceNode.style?.getPropertyValue(property)?.trim() || '';
      if (value && styleRules[property].test(value)) element.style.setProperty(property, value);
    }
    if (originalTag === 'font') {
      const color = String(sourceNode.getAttribute('color') || '').trim();
      const face = String(sourceNode.getAttribute('face') || '').trim();
      const size = String(sourceNode.getAttribute('size') || '').trim();
      if (styleRules.color.test(color)) element.style.setProperty('color', color);
      if (styleRules['font-family'].test(face)) element.style.setProperty('font-family', face);
      if (/^[1-7]$/.test(size)) {
        element.style.setProperty('font-size', ['10px', '13px', '16px', '18px', '24px', '32px', '48px'][Number(size) - 1]);
      }
    }
    const align = String(sourceNode.getAttribute('align') || '').trim();
    if (styleRules['text-align'].test(align)) element.style.setProperty('text-align', align);
    Array.from(sourceNode.childNodes).forEach((child) => appendSafe(child, element));
    destination.appendChild(element);
  };
  Array.from(template.content.childNodes).forEach((child) => appendSafe(child, clean));
  return clean.innerHTML;
}

function safeCssImageUrl(source) {
  const url = String(source || '');
  return /^(?:https?:\/\/|\/|\.\.?\/|assets\/)[a-z0-9/_:.?=&%#-]+$/i.test(url) ? url : '';
}

async function fetchClassicCustomization() {
  const params = new URLSearchParams();
  if (state.scope) params.set('scope', state.scope);
  params.set('group', state.groupFilter || GROUP_FILTER_ALL);
  params.set('lang', state.language || 'nl');
  return fetchJson(`../api/tournament_analytics_classic_content.php?${params.toString()}`);
}

async function saveClassicCustomization() {
  if (!isClassicView() || !state.scope) return { ok: false, error: 'Geen toernooi geselecteerd.' };
  const customization = classicCustomizationState();
  const payload = {
    scope: state.scope,
    group: state.groupFilter || GROUP_FILTER_ALL,
    lang: state.language || 'nl',
    version: Number(state.classicCustomizationVersion || 0),
    updatedBy: 'classic-editor',
    content: {
      visibility: { ...CLASSIC_VISIBILITY_DEFAULTS, ...(customization.visibility || {}) },
      introHtml: String(customization.introHtml || ''),
      topTracksIntroHtml: String(customization.topTracksIntroHtml || ''),
      playerNotesByPlayer: { ...(customization.playerNotesByPlayer || {}) },
    },
  };
  try {
    const response = await fetch('../api/tournament_analytics_classic_content_save.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    return data;
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function ensureClassicCustomizationLoaded() {
  if (!isClassicView() || !state.scope) return;
  const key = classicCustomizationScopeKey();
  if (state.classicCustomizationLoadedKey === key && state.classicCustomization) return;
  state.classicCustomizationLoading = true;
  try {
    const response = await fetchClassicCustomization();
    if (response?.ok) {
      const content = response.content || {};
      state.classicCustomization = {
        visibility: { ...CLASSIC_VISIBILITY_DEFAULTS, ...(content.visibility || {}) },
        introHtml: String(content.introHtml || ''),
        topTracksIntroHtml: String(content.topTracksIntroHtml || ''),
        playerNotesByPlayer: { ...(content.playerNotesByPlayer || {}) },
        updatedAt: String(content.updatedAt || ''),
        updatedBy: String(content.updatedBy || ''),
      };
      state.classicCustomizationVersion = Number(response.version || 0);
      state.classicCustomizationLoadedKey = key;
      state.classicCustomizationDirty = false;
      state.classicEditingTarget = '';
      state.classicEditingDrafts = {};
    } else {
      state.classicCustomization = cloneClassicCustomizationDefaults();
      state.classicCustomizationVersion = 0;
      state.classicCustomizationLoadedKey = key;
      state.classicCustomizationDirty = false;
      state.classicEditingTarget = '';
      state.classicEditingDrafts = {};
    }
  } finally {
    state.classicCustomizationLoading = false;
  }
}

function fillSelect(node, items, value, getValue, getLabel) {
  if (!node) return;
  node.innerHTML = items.map((item) => {
    const optionValue = String(getValue(item));
    return `<option value="${esc(optionValue)}"${optionValue === value ? ' selected' : ''}>${esc(getLabel(item))}</option>`;
  }).join('');
}

function isPhaseOnlyGroupFilter(value) {
  return value === GROUP_FILTER_QUALIFIER_ONLY || value === GROUP_FILTER_POST_ONLY;
}

function groupFilterPredicate(value) {
  if (value === GROUP_FILTER_ALL) return () => true;
  if (value === GROUP_FILTER_QUALIFIER_ONLY) return (row) => row.phase === 'qualifier';
  if (value === GROUP_FILTER_POST_ONLY) return (row) => row.phase === 'post';
  return (row) => row.groupKey === value;
}

function groupFilterLabel(value, groups = []) {
  if (value === GROUP_FILTER_ALL) return tr('allGroups');
  if (value === GROUP_FILTER_QUALIFIER_ONLY) return tr('allQualifiers');
  if (value === GROUP_FILTER_POST_ONLY) return tr('allEndGroups');
  return groups.find((group) => group.groupKey === value)?.groupName || tr('allGroups');
}

function groupFilterToUrlValue(value) {
  if (value === GROUP_FILTER_QUALIFIER_ONLY) return 'q_rounds';
  if (value === GROUP_FILTER_POST_ONLY) return 'end_rounds';
  if (value === GROUP_FILTER_ALL) return '';
  return value;
}

function urlValueToGroupFilter(value) {
  if (!value) return GROUP_FILTER_ALL;
  if (value === 'q_rounds' || value === GROUP_FILTER_QUALIFIER_ONLY) return GROUP_FILTER_QUALIFIER_ONLY;
  if (value === 'end_rounds' || value === GROUP_FILTER_POST_ONLY) return GROUP_FILTER_POST_ONLY;
  return value;
}

function currentUrlObject() {
  try {
    const href = window?.location?.href || `https://example.test/${PAGE_VIEW}`;
    return new URL(href);
  } catch (_) {
    return new URL(`https://example.test/${PAGE_VIEW}`);
  }
}

function playerAnchorId(player) {
  return player ? `speler-${slugify(player)}` : '';
}

function standingAnchorId(groupKey, playerName) {
  return `standing-${slugify(groupKey || '')}-${slugify(playerName || '')}`;
}

function setScrollTargetFromInteractionNode(node) {
  const section = node?.closest ? node.closest('.recap-player-section') : null;
  const id = String(section?.id || '').trim();
  if (!id) return;
  state.scrollTargetId = id;
  if (!window?.history?.replaceState) return;
  const url = currentUrlObject();
  const nextUrl = `${url.pathname}${url.search}#${encodeURIComponent(id)}`;
  window.history.replaceState({}, '', nextUrl);
}

function hydrateStateFromUrl() {
  const url = currentUrlObject();
  const params = url.searchParams;
  state.scope = params.get('scope') || state.scope;
  state.groupFilter = urlValueToGroupFilter(params.get('group') || '');
  state.playerFilter = params.get('player') || state.playerFilter;
  state.participant = params.get('participant') || state.participant;
  state.participantScope = params.get('participantScope') || state.participantScope;
  state.histogramGroup = params.get('histogramGroup') || state.histogramGroup;
  state.histogramPlayer = params.get('histogramPlayer') || state.histogramPlayer;
  state.selectedTrack = params.get('track') || state.selectedTrack;
  const urlPlayers = COMPARISON_SLOT_IDS.map((_, index) => params.get(`compare${index + 1}`) || '').filter(Boolean);
  if (urlPlayers.length) {
    state.comparisonPlayers = urlPlayers;
    state.comparisonMode = 'manual';
  }
  const scrollToPlayer = params.get('scrollToPlayer') || '';
  const anchorHash = String(url.hash || '').replace(/^#/, '');
  state.scrollTargetId = scrollToPlayer ? playerAnchorId(scrollToPlayer) : anchorHash;
  const exportFormat = params.get('format') || '';
  if (CLASSIC_EXPORT_FORMATS.has(exportFormat)) state.exportFormat = exportFormat;
  const language = norm(params.get('lang') || '');
  if (CLASSIC_LANGUAGE_OPTIONS.has(language)) state.language = language;
  state.exportInteractive = params.get('interactive') === '1';
  state.exportEmbedImages = params.get('embedImages') === '1';
  state.pendingDownload = params.get('download') === '1';
}

function syncUrlState() {
  if (!window?.history?.replaceState) return;
  const url = currentUrlObject();
  const params = new URLSearchParams();
  if (state.scope) params.set('scope', state.scope);
  const groupUrlValue = groupFilterToUrlValue(state.groupFilter);
  if (groupUrlValue) params.set('group', groupUrlValue);
  if (state.playerFilter) params.set('player', state.playerFilter);
  if (isClassicView()) {
    if (state.exportFormat && state.exportFormat !== 'full') params.set('format', state.exportFormat);
    if (state.language && state.language !== 'nl') params.set('lang', state.language);
    if (state.exportInteractive) params.set('interactive', '1');
    if (state.exportEmbedImages) params.set('embedImages', '1');
  } else if (!isRecapView()) {
    if (state.participant && state.participant !== state.playerFilter) params.set('participant', state.participant);
    if (state.participantScope) params.set('participantScope', state.participantScope);
    if (state.histogramGroup) params.set('histogramGroup', state.histogramGroup);
    if (state.histogramPlayer) params.set('histogramPlayer', state.histogramPlayer);
    if (state.selectedTrack) params.set('track', state.selectedTrack);
    state.comparisonPlayers.forEach((player, index) => {
      if (player) params.set(`compare${index + 1}`, player);
    });
  }
  url.search = params.toString() ? `?${params.toString()}` : '';
  const hash = window.location?.hash || '';
  const nextUrl = `${url.pathname}${url.search}${hash}`;
  window.history.replaceState({}, '', nextUrl);
}

function currentChartTheme() {
  return isClassicView() ? 'light' : 'dark';
}

function currentLabelLanguage() {
  return state.language || 'nl';
}

function scrollToRequestedPlayer() {
  if (!state.scrollTargetId) return;
  const node = document.getElementById(state.scrollTargetId);
  if (node && typeof node.scrollIntoView === 'function') {
    node.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
}

function currentRequestedPlayerAnchor() {
  return state.scrollTargetId || playerAnchorId(state.playerFilter) || '';
}

function syncClassicPreviewFrameScroll() {
  if (!isClassicView()) return;
  const frame = qs('classicPreviewFrame');
  const targetId = currentRequestedPlayerAnchor();
  if (!frame || !targetId) return;
  const applyScroll = () => {
    const frameDocument = frame.contentDocument || frame.contentWindow?.document || null;
    const targetNode = frameDocument?.getElementById?.(targetId) || null;
    if (targetNode && typeof targetNode.scrollIntoView === 'function') {
      targetNode.scrollIntoView({ behavior: 'auto', block: 'start' });
    }
  };
  if (!frame.__classicPreviewScrollBound && typeof frame.addEventListener === 'function') {
    frame.addEventListener('load', applyScroll);
    frame.__classicPreviewScrollBound = true;
  }
  if (typeof setTimeout === 'function') setTimeout(applyScroll, 60);
}

function ensureAudio() {
  if (!bgAudio) {
    bgAudio = new Audio();
    bgAudio.loop = true;
  }
  return bgAudio;
}

async function toggleTrackMusic(src) {
  if (!src) return;
  const audio = ensureAudio();
  if (!state.audioEnabled) state.audioEnabled = true;
  if (state.currentTrackMusic === src && !audio.paused) {
    audio.pause();
    state.currentTrackMusic = '';
    updateAudioUi();
    return;
  }
  audio.src = src;
  audio.loop = true;
  audio.muted = !state.audioEnabled;
  state.currentTrackMusic = src;
  try {
    await audio.play();
  } catch (_) {
    audio.muted = false;
    try { await audio.play(); } catch (_) {}
  }
  updateAudioUi();
}

function updateAudioUi() {
  const toggle = qs('audioToggleBtn');
  if (toggle) toggle.textContent = state.audioEnabled ? tr('musicOn') : tr('musicOff');
  document.querySelectorAll('[data-audio-src]').forEach((button) => {
    const isCurrent = state.audioEnabled && button.dataset.audioSrc === state.currentTrackMusic;
    button.classList.toggle('is-playing', isCurrent);
    button.textContent = isCurrent ? tr('stopMusic') : tr('playMusic');
  });
}

function audioButton(trackMusic, label) {
  if (!trackMusic) return '';
  const isCurrent = state.audioEnabled && state.currentTrackMusic === trackMusic;
  return `<button type="button" class="audio-chip${isCurrent ? ' is-playing' : ''}" data-audio-src="${esc(trackMusic)}" aria-label="${esc(label)}">${isCurrent ? tr('stopMusic') : tr('playMusic')}</button>`;
}

function defaultMiiIcon() {
  return '../assets/img/character/80.png';
}

function buildCatalog(rawCatalog) {
  const labelLanguage = currentLabelLanguage();
  const resolveLocalizedName = (entry) => {
    if (!entry) return '';
    if (labelLanguage === 'uk') return entry.nameUK || entry.nameUS || entry.nameNL || '';
    return entry.nameNL || entry.nameUK || entry.nameUS || '';
  };
  const cupsByIndex = new Map();
  const cups = [];
  (rawCatalog.cups || []).forEach((cup) => {
    const entry = { ...cup, label: resolveLocalizedName(cup), image: `/assets/img/cup/${cup.cupIndex}.webp` };
    cupsByIndex.set(String(cup.cupIndex), entry);
    cups.push(entry);
  });

  const tracksByName = new Map();
  const tracks = [];
  (rawCatalog.tracks || []).forEach((track) => {
    const cup = cupsByIndex.get(String(track.cupIndex)) || null;
    const entry = {
      ...track,
      label: resolveLocalizedName(track),
      cup,
      cupLabel: cup?.label || '',
      image: `/assets/img/track/${track.trackIndex}.webp`,
      backgroundImage: `/assets/img/track/${track.trackIndex}.webp`,
      thumb: `/assets/img/track/${track.trackIndex}.webp`,
    };
    tracks.push(entry);
    [track.nameUK, track.nameUS, track.nameNL, track.nameMkwrscom].forEach((name) => {
      if (name) tracksByName.set(norm(name), entry);
    });
  });

  const rostersByName = new Map();
  const variantsByName = new Map();
  (rawCatalog.characters || []).forEach((character) => {
    const variant = { ...character, label: character.nameNL || character.nameUK || character.nameUS || '', icon: `/assets/img/character/${character.characterIndex}.png` };
    [character.nameUK, character.nameUS, character.nameNL].forEach((name) => {
      if (name) variantsByName.set(norm(name), variant);
    });
    const rosterKey = String(character.rosterIndex);
    if (!rostersByName.has(rosterKey)) {
      rostersByName.set(rosterKey, { rosterIndex: character.rosterIndex, label: character.nameNL || character.nameUK || character.nameUS || '', icon: variant.icon, variantCount: 0 });
    }
    rostersByName.get(rosterKey).variantCount += 1;
  });
  variantsByName.set('mii', { label: 'Mii', icon: defaultMiiIcon(), rosterIndex: 47, characterIndex: 80 });
  rostersByName.set('47', { rosterIndex: 47, label: 'Mii', icon: defaultMiiIcon(), variantCount: 1 });

  return { cups, cupsByIndex, tracks, tracksByName, rostersByName, variantsByName };
}

function resolveCharacter(rawRoster, rawVariant, catalog) {
  const variant = catalog.variantsByName.get(norm(rawVariant)) || (isMiiName(rawVariant) ? catalog.variantsByName.get('mii') : null);
  let roster = variant ? catalog.rostersByName.get(String(variant.rosterIndex)) : null;
  if (!roster && rawRoster) roster = Array.from(catalog.rostersByName.values()).find((item) => norm(item.label) === norm(rawRoster)) || null;
  if (!roster && isMiiName(rawRoster)) roster = catalog.rostersByName.get('47') || null;
  return {
    rosterLabel: roster?.label || rawRoster || rawVariant || 'Onbekend',
    rosterIcon: roster?.icon || (isMiiName(rawRoster) || isMiiName(rawVariant) ? defaultMiiIcon() : ''),
    rosterVariantCount: roster?.variantCount || 1,
    variantLabel: variant?.label || rawVariant || rawRoster || 'Onbekend',
    variantIcon: variant?.icon || roster?.icon || (isMiiName(rawRoster) || isMiiName(rawVariant) ? defaultMiiIcon() : ''),
  };
}

function enrichRaceRow(row, catalog) {
  const track = catalog.tracksByName.get(norm(row.track || row.trackRaw)) || null;
  const character = resolveCharacter(row.characterRoster || row.character, row.characterVariant || row.character, catalog);
  return {
    ...row,
    raceSlotKey: row.raceKey,
    trackLabel: track?.label || row.track || row.trackRaw || 'Onbekend',
    cupLabel: track?.cupLabel || row.cup || row.cupRaw || 'Onbekend',
    trackImage: track?.image || track?.thumb || '',
    trackBackgroundImage: track?.backgroundImage || '',
    trackThumb: track?.thumb || track?.image || '',
    cupImage: track?.cup?.image || '',
    lapCount: track?.lapCount || null,
    trackSlug: track?.slug || row.trackSlug || '',
    rosterLabel: character.rosterLabel,
    rosterIcon: character.rosterIcon,
    variantLabel: character.variantLabel,
    variantIcon: character.variantIcon,
    rosterVariantCount: character.rosterVariantCount,
  };
}

function enrichFinalRow(row, catalog) {
  const character = resolveCharacter(row.characterRoster || row.character, row.characterVariant || row.character, catalog);
  return { ...row, rosterLabel: character.rosterLabel, rosterIcon: character.rosterIcon, variantLabel: character.variantLabel, variantIcon: character.variantIcon };
}

function sortRaceRows(rows) {
  return rows.slice().sort((left, right) => [phaseWeight(left.phase), left.groupName, Number(left.race || 0), left.playerName].join('|').localeCompare([phaseWeight(right.phase), right.groupName, Number(right.race || 0), right.playerName].join('|'), 'nl', { numeric: true }));
}

  function resolveAfterRaceStandings(rows) {
    const byRaceSlot = new Map();
    rows.forEach((row) => {
      if (!byRaceSlot.has(row.raceSlotKey)) byRaceSlot.set(row.raceSlotKey, []);
      byRaceSlot.get(row.raceSlotKey).push(row);
  });
  return sortRaceRows(rows).map((row) => {
    const raceRows = byRaceSlot.get(row.raceSlotKey) || [];
    const sorted = raceRows
      .map((entry) => ({ playerName: entry.playerName, totalAfter: Number(entry.totalAfter || 0) }))
      .sort((left, right) => right.totalAfter - left.totalAfter || byText(left.playerName, right.playerName));
    let currentRank = 0;
    let previousTotal = null;
      const resolved = sorted.map((entry, index) => {
        if (previousTotal == null || entry.totalAfter !== previousTotal) currentRank = index + 1;
        previousTotal = entry.totalAfter;
        return { ...entry, position: currentRank };
      });
      const own = resolved.find((entry) => entry.playerName === row.playerName) || null;
      const tiedCount = own ? resolved.filter((entry) => entry.totalAfter === own.totalAfter).length : 1;
      const tiedPlayers = own
        ? resolved
          .filter((entry) => entry.totalAfter === own.totalAfter && entry.playerName !== row.playerName)
          .map((entry) => entry.playerName)
          .sort(byText)
        : [];
      const tieSummary = tiedPlayers.length
        ? ` ${tr('sharedWith')} ${tiedPlayers.join(', ')}`
        : '';
      return {
        ...row,
        positionAfterRaceResolved: own?.position || Number(row.positionAfterRace || 0),
        positionAfterRaceLabel: own ? `${tiedCount > 1 ? 'T' : ''}${own.position}` : String(row.positionAfterRace || '-'),
        positionAfterRaceTied: tiedCount > 1,
        positionAfterRaceTiePlayers: tiedPlayers,
        positionAfterRaceDisplay: own ? `${tiedCount > 1 ? 'T' : ''}${own.position} ${tr('placeSuffix')}${tieSummary}` : `${row.positionAfterRace || '-'} ${tr('placeSuffix')}`,
      };
    });
  }

function sortStandingRows(rows) {
  return rows.slice().sort((left, right) => {
    if (Number(left.position || 999) !== Number(right.position || 999)) return Number(left.position || 999) - Number(right.position || 999);
    if (Number(left.totalPoints || 0) !== Number(right.totalPoints || 0)) return Number(right.totalPoints || 0) - Number(left.totalPoints || 0);
    return byText(left.playerName, right.playerName);
  });
}

function standingLabel(row) {
  if (!row) return '-';
  return row.tied ? `T${row.position}` : String(row.position ?? '-');
}

function trackKeyFromRow(row) { return row.trackSlug || row.trackLabel; }
function cupKeyFromRow(row) { return row.cupLabel; }
function buildGroupList(finalRows) {
  const map = new Map();
  finalRows.forEach((row) => {
    if (!row.groupKey) return;
    if (!map.has(row.groupKey)) map.set(row.groupKey, { groupKey: row.groupKey, lobbyId: row.lobbyId, groupName: row.groupName, phase: row.phase, phaseLabel: row.phaseLabel });
  });
  return Array.from(map.values()).sort((left, right) => phaseWeight(left.phase) !== phaseWeight(right.phase) ? phaseWeight(left.phase) - phaseWeight(right.phase) : byText(left.groupName, right.groupName));
}

function buildStandingsByGroup(rows) {
  const map = new Map();
  sortStandingRows(rows).forEach((row) => {
    if (!map.has(row.groupKey)) map.set(row.groupKey, { groupKey: row.groupKey, lobbyId: row.lobbyId, groupName: row.groupName, phase: row.phase, phaseLabel: row.phaseLabel, rows: [] });
    map.get(row.groupKey).rows.push(row);
  });
  return Array.from(map.values()).sort((left, right) => phaseWeight(left.phase) !== phaseWeight(right.phase) ? phaseWeight(left.phase) - phaseWeight(right.phase) : byText(left.groupName, right.groupName));
}

function autoComparisonPlayers(derived) {
  const championRows = !state.playerFilter && state.groupFilter === GROUP_FILTER_ALL
    ? sortStandingRows(derived.baseFinalRows.filter((row) => row.phase === 'post' && norm(row.groupName) === 'kampioen'))
    : [];
  const rankedPlayers = unique((championRows.length ? championRows : sortStandingRows(derived.filteredFinalRows)).map((row) => row.playerName)).slice(0, DEFAULT_AUTO_COMPARISON_PLAYERS);
  if (rankedPlayers.length) return rankedPlayers;
  return unique(sortRaceRows(derived.filteredRaceRows).map((row) => row.playerName)).slice(0, DEFAULT_AUTO_COMPARISON_PLAYERS);
}

function normalizeComparisonPlayers(players, allPlayerOptions, preferredFirst = '') {
  const valid = unique(players.filter((player) => allPlayerOptions.includes(player))).slice(0, MAX_COMPARISON_PLAYERS);
  const normalized = [];
  for (let index = 0; index < MAX_COMPARISON_PLAYERS; index += 1) normalized.push(valid[index] || '');
  if (preferredFirst && allPlayerOptions.includes(preferredFirst)) normalized[0] = preferredFirst;
  const seen = new Set();
  return normalized.map((player, index) => {
    if (!player || (seen.has(player) && index !== 0)) return '';
    seen.add(player);
    return player;
  });
}

function syncComparisonSlots(derived, preferredFirst = '') {
  state.comparisonPlayers = normalizeComparisonPlayers(state.comparisonPlayers, derived.allPlayerOptions, preferredFirst);
  state.compareA = state.comparisonPlayers[0] || '';
  state.compareB = state.comparisonPlayers[1] || '';
  state.overlayPlayers = state.comparisonPlayers.slice(1).filter(Boolean);
}

function defaultComparisonPlayers(derived) {
  if (state.playerFilter) return normalizeComparisonPlayers([state.playerFilter], derived.allPlayerOptions, state.playerFilter);
  return normalizeComparisonPlayers(autoComparisonPlayers(derived), derived.allPlayerOptions);
}

function selectAllComparisonPlayers(derived) {
  if (state.playerFilter) {
    const everyone = [state.playerFilter, ...derived.allPlayerOptions.filter((player) => player !== state.playerFilter)];
    return normalizeComparisonPlayers(everyone, derived.allPlayerOptions, state.playerFilter);
  }
  const visibleStandings = sortStandingRows(derived.filteredFinalRows);
  const championStandings = state.groupFilter === GROUP_FILTER_ALL
    ? sortStandingRows(derived.baseFinalRows.filter((row) => row.phase === 'post' && norm(row.groupName) === 'kampioen'))
    : [];
  const preferredPlayers = unique((championStandings.length ? championStandings : visibleStandings).map((row) => row.playerName));
  if (preferredPlayers.length) return normalizeComparisonPlayers(preferredPlayers, derived.allPlayerOptions);
  return normalizeComparisonPlayers(derived.allPlayerOptions, derived.allPlayerOptions);
}

function aggregateTrackUsage(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = trackKeyFromRow(row);
    if (!key) return;
    if (!map.has(key)) map.set(key, {
      trackKey: key,
      trackLabel: row.trackLabel,
      trackSlug: row.trackSlug,
      trackImage: row.trackImage,
      trackBackgroundImage: row.trackBackgroundImage || row.trackImage || '',
      trackThumb: row.trackThumb,
      cupLabel: row.cupLabel,
      trackMusic: row.trackMusic || '',
      raceSlotKeys: new Set(),
      rows: [],
    });
    const entry = map.get(key);
    entry.raceSlotKeys.add(row.raceSlotKey);
    entry.rows.push(row);
  });
  return Array.from(map.values()).map((entry) => ({ ...entry, count: entry.raceSlotKeys.size, players: unique(entry.rows.map((row) => row.playerName)) })).sort((left, right) => right.count - left.count || byText(left.trackLabel, right.trackLabel));
}

function aggregateCupUsage(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = cupKeyFromRow(row);
    if (!key) return;
    if (!map.has(key)) map.set(key, { cupKey: key, cupLabel: row.cupLabel, cupImage: row.cupImage, raceSlotKeys: new Set() });
    map.get(key).raceSlotKeys.add(row.raceSlotKey);
  });
  return Array.from(map.values()).map((entry) => ({ ...entry, count: entry.raceSlotKeys.size })).sort((left, right) => right.count - left.count || byText(left.cupLabel, right.cupLabel));
}

function aggregateRosterUsage(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const key = row.rosterLabel;
    if (!key) return;
    if (!map.has(key)) map.set(key, { rosterLabel: row.rosterLabel, rosterIcon: row.rosterIcon || row.variantIcon || '', count: 0, players: new Set(), variants: new Map() });
    const entry = map.get(key);
    entry.count += 1;
    entry.players.add(row.playerName);
    const variantKey = row.variantLabel || row.rosterLabel;
    if (!entry.variants.has(variantKey)) entry.variants.set(variantKey, { variantLabel: row.variantLabel || row.rosterLabel, variantIcon: row.variantIcon || row.rosterIcon || '', count: 0 });
    entry.variants.get(variantKey).count += 1;
  });
  return Array.from(map.values()).map((entry) => ({ ...entry, playerCount: entry.players.size, variants: Array.from(entry.variants.values()).sort((left, right) => right.count - left.count || byText(left.variantLabel, right.variantLabel)) })).sort((left, right) => right.count - left.count || byText(left.rosterLabel, right.rosterLabel));
}

function buildCupOverview(rows, catalog) {
  const totalUniqueRaces = unique(rows.map((row) => row.raceSlotKey)).length;
  const trackUsage = new Map(aggregateTrackUsage(rows).map((entry) => [entry.trackSlug || entry.trackLabel, entry]));
  const cupUsage = new Map(aggregateCupUsage(rows).map((entry) => [entry.cupLabel, entry]));
  return catalog.cups.map((cup) => {
    const tracks = catalog.tracks.filter((track) => String(track.cupIndex) === String(cup.cupIndex)).sort((left, right) => Number(left.trackIndex) - Number(right.trackIndex)).map((track) => {
      const usage = trackUsage.get(track.slug || track.label);
      const count = usage?.count || 0;
      return { trackKey: track.slug || track.label, trackLabel: track.label, count, percentage: totalUniqueRaces > 0 ? (count / totalUniqueRaces) * 100 : 0, trackMusic: usage?.trackMusic || '', image: track.image, backgroundImage: track.backgroundImage || '', thumb: track.thumb, cupLabel: cup.label };
    });
    const cupCount = cupUsage.get(cup.label)?.count || tracks.reduce((sum, track) => sum + track.count, 0);
    return { cupLabel: cup.label, cupImage: cup.image, count: cupCount, percentage: totalUniqueRaces > 0 ? (cupCount / totalUniqueRaces) * 100 : 0, tracks };
  });
}

function buildTrackDetail(trackUsageRows, selectedTrackKey) {
  const track = trackUsageRows.find((entry) => entry.trackKey === selectedTrackKey || entry.trackSlug === selectedTrackKey || entry.trackLabel === selectedTrackKey) || null;
  if (!track) return null;
  const byPlayer = new Map();
  track.rows.forEach((row) => {
    if (!byPlayer.has(row.playerName)) byPlayer.set(row.playerName, { playerName: row.playerName, totalRacePoints: 0, plays: 0, bestFinish: null });
    const entry = byPlayer.get(row.playerName);
    entry.totalRacePoints += Number(row.racePoints || 0);
    entry.plays += 1;
    if (Number(row.position || 0) > 0) entry.bestFinish = entry.bestFinish == null ? Number(row.position) : Math.min(entry.bestFinish, Number(row.position));
  });
  const strongestPlayers = Array.from(byPlayer.values()).map((entry) => ({ ...entry, averageRacePoints: entry.plays > 0 ? entry.totalRacePoints / entry.plays : 0 })).sort((left, right) => right.averageRacePoints - left.averageRacePoints || byText(left.playerName, right.playerName));
  return { ...track, strongestPlayers };
}

function buildParticipantScopeOptions(baseFinalRows, player) {
  const postRows = sortStandingRows(baseFinalRows.filter((row) => row.phase === 'post' && row.playerName === player));
  const seen = new Set();
  const options = [{ value: '__all__', label: 'Alles' }, { value: 'qualifier', label: 'Kwalificatie' }];
  postRows.forEach((row) => {
    if (!seen.has(row.lobbyId)) {
      seen.add(row.lobbyId);
      options.push({ value: `group:${row.lobbyId}`, label: row.groupName });
    }
  });
  return options;
}

function participantScopeForGroup(group) {
  if (!group) return '';
  return group.phase === 'qualifier' ? 'qualifier' : `group:${group.lobbyId}`;
}

function defaultParticipantScope(baseFinalRows, player) {
  const postRow = sortStandingRows(baseFinalRows.filter((row) => row.phase === 'post' && row.playerName === player))[0];
  return postRow ? `group:${postRow.lobbyId}` : '__all__';
}

function filterParticipantRows(baseRaceRows, player, participantScope) {
  let rows = baseRaceRows.filter((row) => row.playerName === player);
  if (participantScope === 'qualifier') rows = rows.filter((row) => row.phase === 'qualifier');
  else if (participantScope.startsWith('group:')) rows = rows.filter((row) => row.phase === 'post' && row.lobbyId === participantScope.slice(6));
  return sortRaceRows(rows);
}

function hueToRgb(p, q, t) {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + ((q - p) * 6 * value);
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + ((q - p) * (2 / 3 - value) * 6);
  return p;
}

function hslToHex(h, s, l) {
  let r;
  let g;
  let b;
  if (s === 0) {
    r = l;
    g = l;
    b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - (l * s);
    const p = (2 * l) - q;
    r = hueToRgb(p, q, h + 1 / 3);
    g = hueToRgb(p, q, h);
    b = hueToRgb(p, q, h - 1 / 3);
  }
  return `#${[r, g, b].map((value) => Math.round(value * 255).toString(16).padStart(2, '0')).join('')}`;
}

function hexToRgba(hex, alpha = 1) {
  const normalized = String(hex || '').replace('#', '').trim();
  if (!/^[0-9a-f]{6}$/i.test(normalized)) return `rgba(255,255,255,${alpha})`;
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function chartColor(index, theme = currentChartTheme()) {
  const goldenRatio = 0.618033988749895;
  let hue = (0.56 + (index * goldenRatio)) % 1;
  if (hue >= 0.08 && hue <= 0.17) hue = (hue + 0.18) % 1;
  if (theme === 'light') return hslToHex(hue, 0.63, 0.36);
  return hslToHex(hue, 0.68, 0.62);
}

function buildOverlaySeries(baseRaceRows, players, participantScope, colorMap = {}) {
  const playerRows = players.map((player) => ({ player, rows: filterParticipantRows(baseRaceRows, player, participantScope) })).filter((entry) => entry.player && entry.rows.length > 0);
  const raceSlotOrder = unique(playerRows.flatMap((entry) => entry.rows.map((row) => row.raceSlotKey)));
  const slotMeta = new Map();
  playerRows.forEach((entry) => entry.rows.forEach((row) => { if (!slotMeta.has(row.raceSlotKey)) slotMeta.set(row.raceSlotKey, row); }));
  const orderedSlots = raceSlotOrder.map((slot) => slotMeta.get(slot)).filter(Boolean).sort((left, right) => phaseWeight(left.phase) !== phaseWeight(right.phase) ? phaseWeight(left.phase) - phaseWeight(right.phase) : (left.groupName !== right.groupName ? byText(left.groupName, right.groupName) : Number(left.race || 0) - Number(right.race || 0)));
  const slotKeys = orderedSlots.map((row) => row.raceSlotKey);
  return {
    labels: orderedSlots.map((row, index) => ({ key: row.raceSlotKey, shortLabel: String(index + 1), detail: `${row.phase === 'qualifier' ? 'Kwalificatie' : row.groupName} · race ${row.race}` })),
    series: playerRows.map((entry, index) => {
      const rowBySlot = new Map(entry.rows.map((row) => [row.raceSlotKey, row]));
      return { key: entry.player, label: entry.player, color: colorMap[entry.player] || chartColor(index), points: slotKeys.map((slotKey, slotIndex) => ({ x: slotIndex + 1, row: rowBySlot.get(slotKey) })) };
    }),
  };
}

function buildTopThreeTotalBenchmarkSeries(baseRaceRows, participant, participantScope, colorMap = {}) {
  const participantRows = filterParticipantRows(baseRaceRows, participant, participantScope);
  const orderedRows = sortRaceRows(participantRows);
  const slotRowsByKey = new Map();
  baseRaceRows.forEach((row) => {
    if (!slotRowsByKey.has(row.raceSlotKey)) slotRowsByKey.set(row.raceSlotKey, []);
    slotRowsByKey.get(row.raceSlotKey).push(row);
  });
  const labels = orderedRows.map((row, index) => ({
    key: row.raceSlotKey,
    shortLabel: String(index + 1),
    detail: `${row.phase === 'qualifier' ? 'Kwalificatie' : row.groupName} · race ${row.race}`,
  }));
  const podiumSeries = [
    { key: 'rank-1', label: tr('firstPositionTotal'), color: '#f6c453', rankIndex: 0 },
    { key: 'rank-2', label: tr('secondPositionTotal'), color: '#8e98a6', rankIndex: 1 },
    { key: 'rank-3', label: tr('thirdPositionTotal'), color: '#be7a3c', rankIndex: 2 },
  ];
  const pointsByRank = podiumSeries.map((entry) => ({ ...entry, points: [] }));
  orderedRows.forEach((row, index) => {
    const slotRows = (slotRowsByKey.get(row.raceSlotKey) || [])
      .map((entry) => ({ ...entry, totalAfterNumber: Number(entry.totalAfter || 0) }))
      .sort((left, right) => right.totalAfterNumber - left.totalAfterNumber || byText(left.playerName, right.playerName));
    let currentRank = 0;
    let previousTotal = null;
    const rankedRows = slotRows.map((entry, slotIndex) => {
      if (previousTotal == null || entry.totalAfterNumber !== previousTotal) currentRank = slotIndex + 1;
      previousTotal = entry.totalAfterNumber;
      const tiedPlayers = slotRows
        .filter((candidate) => candidate.totalAfterNumber === entry.totalAfterNumber)
        .map((candidate) => candidate.playerName)
        .sort(byText);
      return { ...entry, leaderboardPosition: currentRank, tiedPlayers };
    });
    pointsByRank.forEach((seriesEntry) => {
      const benchmarkRow = rankedRows[seriesEntry.rankIndex] || null;
      const playerRow = rankedRows.find((entry) => entry.playerName === participant) || null;
      seriesEntry.points.push({
        x: index + 1,
        value: benchmarkRow && playerRow ? playerRow.totalAfterNumber - benchmarkRow.totalAfterNumber : null,
        row: benchmarkRow,
        playerRow,
        rankIndex: seriesEntry.rankIndex,
      });
    });
  });
  return { labels, series: pointsByRank };
}

function formatPositionTickLabel(value) {
  if (Number(value) === 1) return '🏆';
  if (Number(value) === 2) return '🥈';
  if (Number(value) === 3) return '🥉';
  return String(value);
}

function buildHistogramData(baseRaceRows, baseFinalRows, groupKey) {
  const finalGroup = sortStandingRows(baseFinalRows.filter((row) => row.groupKey === groupKey));
  const raceGroup = sortRaceRows(baseRaceRows.filter((row) => row.groupKey === groupKey));
  const observedMaxPosition = Math.max(0, ...raceGroup.map((row) => Number(row.position || 0)));
  const playerCount = finalGroup.length;
  const maxPosition = Math.max(12, playerCount, observedMaxPosition);
  const rows = finalGroup.map((standing) => {
    const playerRows = raceGroup.filter((row) => row.playerName === standing.playerName);
    const positions = Array.from({ length: maxPosition }, (_, index) => index + 1).map((position) => {
      const rowsAtPosition = playerRows.filter((row) => Number(row.position || 0) === position);
      const tracks = Array.from(rowsAtPosition.reduce((map, row) => {
        const key = row.trackLabel || row.track || row.trackRaw || '-';
        if (!map.has(key)) map.set(key, { track: key, count: 0 });
        map.get(key).count += 1;
        return map;
      }, new Map()).values()).sort((left, right) => right.count - left.count || byText(left.track, right.track));
      return { position, count: rowsAtPosition.length, tracks };
    });
    const totalRaces = playerRows.length;
    const avgFinish = totalRaces > 0 ? playerRows.reduce((sum, row) => sum + Number(row.position || 0), 0) / totalRaces : 0;
    const top3Count = playerRows.filter((row) => Number(row.position || 99) <= 3).length;
    return { standing, positions, totalRaces, avgFinish, top3Count, top3Rate: totalRaces > 0 ? (top3Count / totalRaces) * 100 : 0 };
  });
  return { rows, maxPosition };
}

function createHistogramPlayerChartForPlayers(histogram, selectedPlayers, options = {}) {
  const playerOrder = unique(selectedPlayers);
  const playerColors = options.playerColors || {};
  const chartRows = playerOrder
    .map((playerName) => histogram.rows.find((row) => row.standing.playerName === playerName) || null)
    .filter(Boolean);
  const fallbackRow = histogram.rows[0] || null;
  const rows = chartRows.length ? chartRows : (fallbackRow ? [fallbackRow] : []);
  if (!rows.length || !histogram.maxPosition) return '';
  const primaryRow = rows[0];
  const width = 720;
  const height = 280;
  const padding = { top: 24, right: 22, bottom: 56, left: 58 };
  const groups = Array.from({ length: histogram.maxPosition }, (_, index) => ({
    position: index + 1,
    bars: rows.map((row, rowIndex) => ({
      playerName: row.standing.playerName,
      color: playerColors[row.standing.playerName] || chartColor(rowIndex),
      count: row.positions[index]?.count || 0,
    })),
  }));
  const maxCount = Math.max(12, ...groups.flatMap((group) => group.bars.map((bar) => bar.count)));
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const barWidth = chartWidth / Math.max(histogram.maxPosition, 1);
  const toY = (value) => padding.top + chartHeight - ((value / maxCount) * chartHeight);
  const yMinorTicks = Array.from({ length: maxCount + 1 }, (_, index) => index);
  const yMajorTicks = new Set(Array.from({ length: Math.floor(maxCount / 3) + 1 }, (_, index) => index * 3).concat(maxCount));
  const staticChart = Boolean(options.staticExport) && !Boolean(options.interactiveCharts);
  const hoverEntries = [];
  const hoverZones = [];
  const bars = groups.map((group, index) => {
    const groupX = padding.left + (index * barWidth) + 6;
    const innerGap = 4;
    const widthValue = Math.max(8, ((Math.max(12, barWidth - 12)) - (innerGap * Math.max(0, group.bars.length - 1))) / Math.max(group.bars.length, 1));
    return group.bars.map((bar, barIndex) => {
      const histogramRow = rows.find((row) => row.standing.playerName === bar.playerName) || null;
      const positionData = histogramRow?.positions?.[index] || null;
      const totalRaces = Number(histogramRow?.totalRaces || 0);
      const percentage = totalRaces > 0 ? (Number(bar.count || 0) / totalRaces) * 100 : 0;
      const tracks = Array.isArray(positionData?.tracks) ? positionData.tracks : [];
      const trackSummaryLines = tracks.length
        ? (() => {
          const ordered = tracks
            .map((entry) => ({ track: String(entry.track || '-'), count: Number(entry.count || 0) }))
            .sort((left, right) => byText(left.track, right.track));
          return ordered.map((entry) => `${entry.count}x ${entry.track}`);
        })()
        : ['-'];
      const x = groupX + (barIndex * (widthValue + innerGap));
      const y = toY(bar.count);
      const h = (height - padding.bottom) - y;
      const hoverIndex = hoverEntries.length;
      hoverEntries.push({
        raceNumber: group.position,
        title: tr('positionDistribution'),
        label: bar.playerName,
        x: x + (widthValue / 2),
        values: [
          { label: tr('classicHistogramHoverPercent'), color: bar.color, display: `${formatPercent(percentage)} (${bar.count}x)` },
          { label: tr('classicHistogramHoverTracks'), color: bar.color, lines: trackSummaryLines },
        ],
      });
      if (!staticChart) {
        hoverZones.push(`<rect class="chart-hover-zone" x="${x}" y="${padding.top}" width="${Math.max(10, widthValue)}" height="${chartHeight}" data-hover-index="${hoverIndex}" />`);
      }
      return `<g><rect class="histogram-chart-bar" x="${x}" y="${y}" width="${widthValue}" height="${Math.max(0, h)}" style="fill:${esc(bar.color)};stroke:${esc(bar.color)};" /><text class="histogram-chart-value" x="${x + (widthValue / 2)}" y="${Math.max(padding.top + 11, y - 4)}" text-anchor="middle">${esc(`${bar.count}x`)}</text></g>`;
    }).join('');
  }).join('');
  const xLabels = Array.from({ length: histogram.maxPosition }, (_, index) => index + 1).map((position, index) => {
    const x = padding.left + (index * barWidth) + (barWidth / 2);
    return `<text x="${x}" y="${height - 22}" text-anchor="middle">${esc(String(position))}</text>`;
  }).join('');
  const yGrid = yMinorTicks.map((tick) => {
    const y = toY(tick);
    const isMajor = yMajorTicks.has(tick) || tick === 0;
    return `<g><line class="${isMajor ? 'chart-grid' : 'chart-grid chart-grid-minor'}" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" />${isMajor ? `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${esc(String(tick))}</text>` : ''}</g>`;
  }).join('');
  const exportId = options.exportId || 'histogramPlayerChartShell';
  const exportLabel = options.exportLabel || `${primaryRow.standing.playerName}-positieverdeling`;
  const title = options.title || 'Positieverdeling per speler';
  const infoText = options.infoText || tr('positionDistributionInfo');
  const hoverPayload = staticChart ? '' : encodeChartPayload(hoverEntries);
  const hoverMarkup = staticChart ? '' : '<div class="chart-tooltip" hidden></div>';
  const hoverLine = staticChart ? '' : `<line class="chart-hover-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" hidden />`;
  const hoverLayer = staticChart ? '' : `<g class="chart-hover-layer">${hoverZones.join('')}</g>`;
  const avgFinishLine = Number(primaryRow?.avgFinish || 0) > 0
    ? (() => {
      const clampedAvg = Math.min(Math.max(1, Number(primaryRow.avgFinish)), Math.max(1, histogram.maxPosition));
      const avgX = padding.left + ((clampedAvg - 0.5) * (chartWidth / Math.max(histogram.maxPosition, 1)));
      return `<line class="chart-avg-finish-line" x1="${avgX}" y1="${padding.top}" x2="${avgX}" y2="${height - padding.bottom}" />`;
    })()
    : '';
  const showLegend = rows.length > 1;
  const legendMarkup = showLegend ? `<div class="chart-legend">${rows.map((row, index) => `<span class="legend-item"><i style="background:${playerColors[row.standing.playerName] || chartColor(index)}"></i>${esc(row.standing.playerName)}</span>`).join('')}</div>` : '';
  const chartShell = staticChart
    ? `<div class="chart-shell" id="${esc(exportId)}" data-chart-export-id="histogram-player" data-chart-step="1">${hoverMarkup}<svg class="position-histogram-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Staafgrafiek positieverdeling"><g class="chart-grid">${yGrid}</g><line class="chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" /><line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />${avgFinishLine}${hoverLine}${bars}<g class="chart-x-labels">${xLabels}</g><text class="chart-axis-title" x="${padding.left - 24}" y="${padding.top - 8}" text-anchor="start">${esc(tr('chartCountLabel'))}</text><text class="chart-axis-title" x="${width / 2}" y="${height - 6}" text-anchor="middle">Positie</text></svg>${legendMarkup}</div>`
    : `<div class="chart-shell interactive-chart" id="${esc(exportId)}" data-chart-shell="1" data-chart-points="${esc(hoverPayload)}" data-chart-export-id="histogram-player" data-chart-step="1">${hoverMarkup}<svg class="position-histogram-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Staafgrafiek positieverdeling"><g class="chart-grid">${yGrid}</g><line class="chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" /><line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />${avgFinishLine}${hoverLine}${bars}${hoverLayer}<g class="chart-x-labels">${xLabels}</g><text class="chart-axis-title" x="${padding.left - 24}" y="${padding.top - 8}" text-anchor="start">${esc(tr('chartCountLabel'))}</text><text class="chart-axis-title" x="${width / 2}" y="${height - 6}" text-anchor="middle">Positie</text></svg>${legendMarkup}</div>`;
  if (options.hideCardHeading) return `<article class="panel-card chart-wide-card histogram-player-card">${chartShell}</article>`;
  return `<article class="panel-card chart-wide-card histogram-player-card">${renderChartSectionHead(title, infoText, exportButton(exportId, exportLabel))}${chartShell}</article>`;
}

function createHistogramPlayerChart(histogram, selectedPlayer) {
  return createHistogramPlayerChartForPlayers(histogram, [selectedPlayer, ...state.comparisonPlayers.filter(Boolean)]);
}

function buildComparisonData(raceRows, finalRows, selectedPlayers) {
  const players = unique(selectedPlayers);
  const pairCards = [];
  for (let leftIndex = 0; leftIndex < players.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < players.length; rightIndex += 1) {
      const playerA = players[leftIndex];
      const playerB = players[rightIndex];
      const raceMap = new Map();
      raceRows.forEach((row) => {
        if (row.playerName !== playerA && row.playerName !== playerB) return;
        if (!raceMap.has(row.raceSlotKey)) raceMap.set(row.raceSlotKey, {});
        raceMap.get(row.raceSlotKey)[row.playerName] = row;
      });
      let aboveA = 0; let aboveB = 0; let ties = 0; let sharedRaces = 0;
      const trackDuels = new Map();
      raceMap.forEach((pair) => {
        if (!pair[playerA] || !pair[playerB]) return;
        sharedRaces += 1;
        const rowA = pair[playerA];
        const rowB = pair[playerB];
        if (Number(rowA.position || 0) < Number(rowB.position || 0)) aboveA += 1;
        else if (Number(rowB.position || 0) < Number(rowA.position || 0)) aboveB += 1;
        else ties += 1;
        const key = trackKeyFromRow(rowA);
        if (!trackDuels.has(key)) trackDuels.set(key, { trackLabel: rowA.trackLabel, cupLabel: rowA.cupLabel, duels: 0, aWins: 0, bWins: 0 });
        const duel = trackDuels.get(key);
        duel.duels += 1;
        if (Number(rowA.position || 0) < Number(rowB.position || 0)) duel.aWins += 1;
        else if (Number(rowB.position || 0) < Number(rowA.position || 0)) duel.bWins += 1;
      });
      const groupMap = new Map();
      finalRows.forEach((row) => {
        if (row.playerName !== playerA && row.playerName !== playerB) return;
        if (!groupMap.has(row.groupKey)) groupMap.set(row.groupKey, {});
        groupMap.get(row.groupKey)[row.playerName] = row;
      });
      const groupDiffs = [];
      groupMap.forEach((pair) => { if (pair[playerA] && pair[playerB]) groupDiffs.push(Number(pair[playerA].totalPoints || 0) - Number(pair[playerB].totalPoints || 0)); });
      const avgGroupDelta = groupDiffs.length ? groupDiffs.reduce((sum, value) => sum + value, 0) / groupDiffs.length : null;
      pairCards.push({ playerA, playerB, sharedRaces, aboveA, aboveB, ties, avgGroupDelta, sharedTracks: Array.from(trackDuels.values()).sort((left, right) => right.duels - left.duels || byText(left.trackLabel, right.trackLabel)) });
    }
  }
  return pairCards;
}

function buildDeltaSeries(raceRows, playerA, playerB) {
  const raceMap = new Map();
  raceRows.forEach((row) => {
    if (row.playerName !== playerA && row.playerName !== playerB) return;
    if (!raceMap.has(row.raceSlotKey)) raceMap.set(row.raceSlotKey, {});
    raceMap.get(row.raceSlotKey)[row.playerName] = row;
  });
  const rows = Array.from(raceMap.values()).filter((pair) => pair[playerA] && pair[playerB]).map((pair) => {
    const rowA = pair[playerA];
    const rowB = pair[playerB];
    return { label: `${rowA.groupName} · race ${rowA.race}`, delta: Number(rowA.totalAfter || 0) - Number(rowB.totalAfter || 0) };
  });
  const maxAbs = Math.max(1, ...rows.map((row) => Math.abs(row.delta)));
  return { rows: rows.map((row, index) => ({ ...row, x: index + 1 })), maxAbs };
}

function formatNumber(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('nl-NL', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPercent(value) { return `${formatNumber(value, 1)}%`; }
function podiumIconForPlace(value) {
  const rank = Number(value || 0);
  if (rank === 1) return '\uD83C\uDFC6';
  if (rank === 2) return '\uD83E\uDD48';
  if (rank === 3) return '\uD83E\uDD49';
  return '';
}

function ordinalEn(value) {
  const n = Math.max(0, Math.floor(Number(value || 0)));
  const abs = Math.abs(n);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  const mod10 = abs % 10;
  if (mod10 === 1) return `${n}st`;
  if (mod10 === 2) return `${n}nd`;
  if (mod10 === 3) return `${n}rd`;
  return `${n}th`;
}

function formatPlaceDisplay(value, options = {}) {
  const rank = Number(value || 0);
  if (!Number.isFinite(rank) || rank <= 0) return `${value} ${tr('placeSuffix')}`;
  const withIcon = options.withIcon !== false;
  const tiePrefix = options.tied ? 'T' : '';
  const placeText = state.language === 'uk'
    ? `${tiePrefix}${ordinalEn(rank)} ${tr('placeSuffix')}`
    : `${tiePrefix}${Math.floor(rank)}e ${tr('placeSuffix')}`;
  const icon = withIcon ? podiumIconForPlace(rank) : '';
  return icon ? `${placeText} ${icon}` : placeText;
}

function slugify(value) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'grafiek';
}

function exportButton(targetId, fileName) {
  if (isClassicView() && !classicVisibilityValue('showChartDownloadButtons')) return '';
  return `<button type="button" class="analytics-ghost-btn chart-download-btn" data-download-chart="${esc(targetId)}" data-download-name="${esc(fileName)}">Download als JPEG</button>`;
}

function renderChartInfoBubble(infoText) {
  const text = String(infoText || '').trim();
  if (!text) return '';
  return `<span class="chart-info" tabindex="0" role="button" aria-label="${esc(tr('chartInfoAria'))}"><span class="chart-info-icon" aria-hidden="true">i</span><span class="chart-info-tooltip">${esc(text)}</span></span>`;
}

function renderChartHeading(title, infoText) {
  return `<span class="chart-heading-row"><span>${esc(title)}</span>${renderChartInfoBubble(infoText)}</span>`;
}

function renderChartSectionHead(title, infoText, buttonHtml = '') {
  return `<div class="section-head"><div><h3>${renderChartHeading(title, infoText)}</h3></div>${buttonHtml}</div>`;
}

function renderTooltipValueItem(item) {
  const color = item?.color || '';
  const label = item?.label || '';
  const display = item?.display || '';
  const lines = Array.isArray(item?.lines) ? item.lines.filter((line) => String(line || '').trim()) : [];
  if (lines.length) {
    const joined = lines.map((line) => esc(line)).join('<br>');
    return `<li><span class="chart-tooltip-key"><i style="background:${esc(color)}"></i>${esc(label)}</span><strong class="chart-tooltip-lines">${joined}</strong></li>`;
  }
  return `<li><span class="chart-tooltip-key"><i style="background:${esc(color)}"></i>${esc(label)}</span><strong>${esc(display)}</strong></li>`;
}

function selectedOptionText(id, fallback = '') {
  const node = qs(id);
  if (!node) return fallback;
  const option = node.options?.[node.selectedIndex] || null;
  return (option?.textContent || fallback || '').trim();
}

function buildExportContextSuffix() {
  const tournament = selectedOptionText('scopeSelect', state.scope || 'toernooi');
  const group = selectedOptionText('groupFilterSelect', state.groupFilter === GROUP_FILTER_ALL ? 'Alle groepen' : state.groupFilter);
  const globalPlayer = selectedOptionText('playerFilterSelect', state.playerFilter || 'Alle spelers');
  const comparisonPlayers = Array.from(document.querySelectorAll('[id^="compareSlot"]'))
    .map((node) => node.value || '')
    .filter(Boolean);
  const comparisonLabel = comparisonPlayers.length ? comparisonPlayers.join('-') : 'geen-vergelijking';
  return [tournament, group, globalPlayer, comparisonLabel].map((part) => slugify(part)).filter(Boolean).join('__');
}

function inlineSvgComputedStyles(sourceSvg, cloneSvg) {
  const sourceNodes = [sourceSvg, ...sourceSvg.querySelectorAll('*')];
  const cloneNodes = [cloneSvg, ...cloneSvg.querySelectorAll('*')];
  const properties = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'font-family', 'font-size', 'font-weight', 'letter-spacing', 'paint-order', 'filter', 'display', 'visibility'];
  sourceNodes.forEach((node, index) => {
    const cloneNode = cloneNodes[index];
    if (!cloneNode) return;
    const computed = window.getComputedStyle(node);
    const inlineStyle = properties.map((property) => `${property}:${computed.getPropertyValue(property)};`).join('');
    if (inlineStyle) cloneNode.setAttribute('style', inlineStyle);
  });
}

function renderSvgToJpeg(svgNode, fileName) {
  if (!svgNode) return Promise.resolve();
  const clone = svgNode.cloneNode(true);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  inlineSvgComputedStyles(svgNode, clone);
  const markup = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const viewBox = svgNode.viewBox?.baseVal || { width: svgNode.clientWidth || 860, height: svgNode.clientHeight || 320 };
      const width = Math.max(1, Math.round(viewBox.width || svgNode.clientWidth || 860));
      const height = Math.max(1, Math.round(viewBox.height || svgNode.clientHeight || 320));
      const canvas = document.createElement('canvas');
      canvas.width = width * 2;
      canvas.height = height * 2;
      const context = canvas.getContext('2d');
      if (context) {
        context.scale(2, 2);
        context.fillStyle = isClassicView() ? '#ffffff' : '#0d1724';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/jpeg', 0.92);
        link.download = `${slugify(fileName)}.jpg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
      URL.revokeObjectURL(url);
      resolve();
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      resolve();
    };
    image.src = url;
  });
}

function downloadChartFromTrigger(trigger) {
  const chartId = trigger?.dataset?.downloadChart || '';
  const fileName = [trigger?.dataset?.downloadName || chartId || 'grafiek', buildExportContextSuffix()].filter(Boolean).join('__');
  const shell = chartId ? document.getElementById(chartId) : null;
  const svg = shell?.querySelector('svg') || null;
  return renderSvgToJpeg(svg, fileName);
}

async function downloadAllCharts() {
  const buttons = Array.from(document.querySelectorAll('[data-download-chart]'));
  for (let index = 0; index < buttons.length; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await downloadChartFromTrigger(buttons[index]);
  }
}

  function downloadTextFile(fileName, content, mimeType = 'text/html;charset=utf-8') {
    if (!document?.createElement || !window?.URL?.createObjectURL) return;
    const blob = new Blob([content], { type: mimeType });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

  function classicFileBaseName() {
    return slugify(classicExportTitle() || 'mk8dx-recap-export');
  }

  function buildClassicFragmentDownloadHtml(fragmentHtml) {
    const wordpressCss = getClassicWordpressPostCss();
    const inlineCss = [wordpressCss].filter(Boolean).join('\n\n');
    const runtimeScript = `\n<script id="mk8-classic-export-runtime">\n${getClassicExportRuntimeJs()}\n</script>`;
    if (!inlineCss) return `${fragmentHtml}${runtimeScript}`;
    return `<style id="mk8-classic-export-inline-css">\n${inlineCss}\n</style>\n${fragmentHtml}${runtimeScript}`;
  }

  async function triggerClassicDownload(kind, derived) {
    const exports = await buildClassicDownloadPayloads(derived);
    if (kind === 'fragment') {
      state.exportFormat = 'fragment';
      downloadTextFile(`${classicFileBaseName()}-entry-content.html`, buildClassicFragmentDownloadHtml(exports.fragmentHtml));
    return;
  }
  state.exportFormat = 'full';
  downloadTextFile(`${classicFileBaseName()}-index.html`, exports.fullHtml);
}

function renderMetricCards(derived) {
  if (!hasNode('overviewCards')) return;
  const metrics = [
    [tr('uniqueRaces'), derived.filteredRaceCount],
    [tr('participants'), derived.playerOptions.length],
    [tr('groups'), derived.filteredGroups.length],
    [tr('tracksPlayed'), derived.trackUsage.length],
    [tr('cupsPlayed'), derived.cupUsage.length],
    [tr('characterRosters'), derived.rosterUsage.length],
  ];
  qs('overviewCards').innerHTML = metrics.map(([label, value]) => `<article class="metric-card"><span class="metric-label">${esc(label)}</span><strong class="metric-value">${esc(value)}</strong></article>`).join('');
}

function table(headers, rows, className = '') {
  return `<div class="table-wrap ${className}"><table class="analytics-table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function medalBadge(index) {
  const items = [
    { label: '1e', emoji: '\uD83C\uDFC6' }, // U+1F3C6
    { label: '2e', emoji: '\uD83E\uDD48' }, // U+1F948
    { label: '3e', emoji: '\uD83E\uDD49' }, // U+1F949
  ];
  const item = items[index];
  if (!item) return '';
  return `<span class="standing-podium-emoji" title="${esc(item.label)}">${item.emoji}</span>`;
}

function renderStandingRow(row, index, qualifier = false, options = {}) {
  const rankNumber = Number(row?.position || 0);
  const isSharedRank = Boolean(row?.tied) || (Array.isArray(row?.tiedPlayers) && row.tiedPlayers.length > 1);
  const podiumIndex = !isSharedRank && [1, 2, 3].includes(rankNumber) ? rankNumber - 1 : -1;
  const medal = podiumIndex >= 0 ? medalBadge(podiumIndex) : '';
  const characterLabel = row.variantLabel || row.rosterLabel || '-';
  const characterIcon = row.variantIcon || row.rosterIcon || '';
  const rowId = options.includeAnchors ? ` id="${esc(standingAnchorId(row.groupKey, row.playerName))}"` : '';
  const playerNameCell = options.linkPlayerToRecap
    ? `<a class="link-chip is-static" href="#${esc(playerAnchorId(row.playerName))}">${esc(row.playerName)}</a>`
    : `<strong>${esc(row.playerName)}</strong>`;
  const targetGroupCell = qualifier
    ? `<td class="cell-center">${row.qualifiedTargetGroupName ? `<span class="group-tag group-tag-${esc(norm(row.qualifiedTargetGroupName))}">${esc(row.qualifiedTargetGroupName)}</span>` : '-'}</td>`
    : '';
  return `<tr${rowId} class="${podiumIndex >= 0 ? `standing-top standing-top-${podiumIndex + 1}` : ''}"><td>${medal}${medal ? '' : `<span class="standing-rank">${esc(standingLabel(row))}</span>`}</td><td><div class="player-cell"><div>${playerNameCell}</div></div></td><td><div class="player-cell player-cell-compact character-cell" title="${esc(characterLabel)}">${characterIcon ? `<img src="${esc(characterIcon)}" alt="${esc(characterLabel)}" loading="lazy" decoding="async" />` : ''}</div></td>${qualifier ? `<td class="cell-number">${esc(row.totalPoints ?? '-')}</td>${targetGroupCell}` : ''}${qualifier ? '' : `<td class="cell-number">${esc(row.totalPoints ?? '-')}</td>`}</tr>`;
}

function renderTopFiveList(entries, itemType, options = {}) {
  if (!entries.length) return `<p class="empty-note">${esc(tr('noRaceData'))}</p>`;
  const headerRow = itemType === 'track'
    ? `<li class="top-list-head"><span class="top-index">#</span><span class="top-name">${esc(tr('track'))}</span><strong class="top-count">${esc(tr('timesPlayedHeader'))}</strong></li>`
    : '';
  return `<ol class="top-list top-list-${esc(itemType)}">${headerRow}${entries.slice(0, 5).map((entry, index) => {
    if (itemType === 'track') {
      const trackIcon = entry.trackImage || entry.trackThumb || '';
      const trackBackground = entry.trackBackgroundImage || entry.trackImage || '';
      if (options.trackBackgroundRows) {
        const safeBackground = safeCssImageUrl(trackBackground);
        const rowStyle = safeBackground ? ` style="--top-track-bg:url('${esc(safeBackground)}')"` : '';
        return `<li class="top-track-row-bg"${rowStyle}><span class="top-index">${index + 1}</span><span class="top-name">${esc(entry.trackLabel)}</span><strong class="top-count">${esc(entry.count)}</strong></li>`;
      }
      const nameCell = options.staticExport
        ? `<span class="top-track-button top-track-button-static"><span class="top-icon top-icon-track">${trackIcon ? `<img src="${esc(trackIcon)}" alt="" loading="lazy" decoding="async" />` : ''}</span><span class="top-name">${esc(entry.trackLabel)}</span></span>`
        : `<button type="button" class="top-track-button" data-select-track="${esc(entry.trackKey)}"><span class="top-icon top-icon-track">${trackIcon ? `<img src="${esc(trackIcon)}" alt="" loading="lazy" decoding="async" />` : ''}</span><span class="top-name">${esc(entry.trackLabel)}</span></button>`;
      return `<li><span class="top-index">${index + 1}</span><span class="top-icon top-icon-cup">${entry.cupImage ? `<img src="${esc(entry.cupImage)}" alt="" loading="lazy" decoding="async" />` : ''}</span>${nameCell}<strong class="top-count">${esc(entry.count)}</strong></li>`;
    }
    return `<li><span class="top-index">${index + 1}</span><span class="top-icon top-icon-cup top-icon-cup-large">${entry.cupImage ? `<img src="${esc(entry.cupImage)}" alt="" loading="lazy" decoding="async" />` : ''}</span><span class="top-name">${esc(entry.cupLabel)}</span><strong class="top-count">${esc(entry.count)}</strong></li>`;
  }).join('')}</ol>`;
}

function emptyCard(title, text) {
  return `<article class="panel-card empty-card"><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`;
}

function renderCharacterHub(usageRows) {
  if (!usageRows.length) return emptyCard(tr('characterHub'), tr('noCharacterDataSelection'));
  const total = usageRows.reduce((sum, row) => sum + row.count, 0);
  return table([tr('roster'), tr('picks'), tr('share'), tr('participants'), tr('colorVariants')], usageRows.map((row) => `<tr><td><div class="player-cell player-cell-compact">${row.rosterIcon ? `<img src="${esc(row.rosterIcon)}" alt="" loading="lazy" decoding="async" />` : ''}<div><strong>${esc(row.rosterLabel)}</strong></div></div></td><td class="cell-number">${esc(row.count)}</td><td class="cell-number">${esc(formatPercent((row.count / Math.max(total, 1)) * 100))}</td><td class="cell-number">${esc(row.playerCount)}</td><td>${row.variants.map((variant) => `<div class="variant-row">${variant.variantIcon ? `<img src="${esc(variant.variantIcon)}" alt="" loading="lazy" decoding="async" />` : ''}<span>${esc(variant.variantLabel)}</span><small>${esc(formatPercent((variant.count / Math.max(total, 1)) * 100))} ${esc(tr('totalSuffix'))} · ${esc(formatPercent((variant.count / Math.max(row.count, 1)) * 100))} ${esc(tr('within'))} ${esc(row.rosterLabel)}</small><strong>${esc(variant.count)}</strong></div>`).join('')}</td></tr>`), 'character-table');
}

function renderTrackDetail(trackDetail, options = {}) {
  const audio = options.staticExport ? '' : audioButton(trackDetail.trackMusic, tr('playMusicLabel', { track: trackDetail.trackLabel }));
  return `<article class="panel-card track-detail-card" id="trackDetailCard"><div class="section-head"><div><h3>${esc(trackDetail.trackLabel)}</h3><p>${esc(tr('trackDetailBlurb'))}</p></div></div><div class="track-detail-meta">${trackDetail.cupImage ? `<span class="usage-chip usage-chip-cup" title="${esc(trackDetail.cupLabel)}"><img src="${esc(trackDetail.cupImage)}" alt="" loading="lazy" decoding="async" /></span>` : ''}${trackDetail.trackImage ? `<span class="usage-chip usage-chip-track"><img src="${esc(trackDetail.trackImage)}" alt="" loading="lazy" decoding="async" /><span>${esc(trackDetail.trackLabel)}</span></span>` : ''}<span class="usage-chip"><strong>${esc(trackDetail.count)}</strong><span>${esc(tr('timesPlayed'))}</span></span>${audio}</div>${trackDetail.trackImage ? `<div class="track-detail-image-wrap"><img class="track-detail-image" src="${esc(trackDetail.trackImage)}" alt="${esc(trackDetail.trackLabel)}" loading="lazy" decoding="async" /></div>` : ''}${table(['#', tr('participant'), tr('avgRacePoints'), tr('timesPlayedHeader'), tr('bestFinish')], trackDetail.strongestPlayers.slice(0, 12).map((entry, index) => `<tr><td>${index + 1}</td><td>${esc(entry.playerName)}</td><td class="cell-number">${esc(formatNumber(entry.averageRacePoints, 2))}</td><td class="cell-number">${esc(entry.plays)}</td><td class="cell-number">${esc(entry.bestFinish ?? '-')}</td></tr>`))}</article>`;
}

function buildPlayerCharacterUsage(playerRaceRows) {
  const total = playerRaceRows.length;
  const map = new Map();
  playerRaceRows.forEach((row) => {
    const key = row.variantLabel || row.rosterLabel || 'Onbekend';
    if (!map.has(key)) map.set(key, { label: key, icon: row.variantIcon || row.rosterIcon || '', count: 0 });
    map.get(key).count += 1;
  });
  return Array.from(map.values())
    .map((entry) => ({ ...entry, percentage: total > 0 ? (entry.count / total) * 100 : 0 }))
    .sort((left, right) => right.count - left.count || byText(left.label, right.label));
}

function renderPlayerCharacterTable(playerName, playerRaceRows) {
  const usage = buildPlayerCharacterUsage(playerRaceRows);
  if (!usage.length) return emptyCard(tr('charactersPlayed'), tr('noCharacterDataPlayer', { player: playerName }));
  return `<article class="panel-card recap-character-card"><div class="section-head"><div><h3>${esc(tr('charactersOfPlayer', { player: playerName }))}</h3><p>${esc(tr('playerCharacterUsage'))}</p></div></div>${table([tr('character'), tr('timesPlayedHeader'), tr('share')], usage.map((entry) => `<tr><td><div class="player-cell player-cell-compact">${entry.icon ? `<img src="${esc(entry.icon)}" alt="" loading="lazy" decoding="async" />` : ''}<div><strong>${esc(entry.label)}</strong></div></div></td><td class="cell-number">${esc(entry.count)}</td><td class="cell-number">${esc(formatPercent(entry.percentage))}</td></tr>`), 'recap-character-table')}</article>`;
}

function renderRecapPlayerHeading(rec) {
  const usage = buildPlayerCharacterUsage(rec.playerRaceRows || []);
  const topCharacter = usage[0] || null;
  const icon = topCharacter?.icon || '';
  const label = topCharacter?.label || '';
  return `<h2><span class="recap-player-name">${esc(rec.playerName)}</span>${icon ? `<img class="recap-player-name-icon" src="${esc(icon)}" alt="${esc(label)}" loading="lazy" decoding="async" />` : ''}</h2>`;
}

function createLineChart(series, options = {}) {
  const width = 860;
  const height = 308;
  const padding = { top: 20, right: 20, bottom: 62, left: 56 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const pointCount = Math.max(1, ...series.map((entry) => entry.points.length));
  const yMin = Number(options.yMin);
  const yMax = Number(options.yMax);
  const yRange = Math.max(1, yMax - yMin);
  const invertY = Boolean(options.invertY);
  const toX = (value) => padding.left + ((Math.max(1, value) - 1) * (plotWidth / Math.max(1, pointCount - 1)));
  const toY = (value) => invertY ? padding.top + ((value - yMin) / yRange) * plotHeight : padding.top + ((yMax - value) / yRange) * plotHeight;
  const yMajorTicks = options.yMajorTicks || options.yTicks || [];
  const yMinorTicks = options.yMinorTicks || [];
  const xMinorStep = Number(options.xMinorStep || 1);
  const xMajorStep = Number(options.xMajorStep || 4);
  const minorYMarkup = yMinorTicks.map((tick) => `<line class="chart-grid-minor" x1="${padding.left}" y1="${toY(tick.value)}" x2="${width - padding.right}" y2="${toY(tick.value)}" />`).join('');
  const majorYMarkup = yMajorTicks.map((tick) => `<g><line x1="${padding.left}" y1="${toY(tick.value)}" x2="${width - padding.right}" y2="${toY(tick.value)}" /><text x="${padding.left - 8}" y="${toY(tick.value) + 4}" text-anchor="end">${esc(tick.label)}</text></g>`).join('');
  const xMinorMarkup = Array.from({ length: pointCount }, (_, index) => index + 1)
    .filter((value) => xMinorStep > 0 && value % xMinorStep === 0)
    .map((value) => `<line class="chart-grid-minor" x1="${toX(value)}" y1="${padding.top}" x2="${toX(value)}" y2="${height - padding.bottom + 0.5}" />`)
    .join('');
  const xLabels = options.xLabels || [];
  const hoverLabels = options.hoverLabels || xLabels;
  const staticChart = Boolean(options.staticExport) && !Boolean(options.interactiveCharts);
  const labelIndexes = Array.from({ length: xLabels.length }, (_, index) => index)
    .filter((index) => index === 0 || index === xLabels.length - 1 || ((index + 1) % xMajorStep === 0));
  const xAxisLabels = labelIndexes.map((index) => `<text x="${toX(index + 1)}" y="${height - 14}" text-anchor="middle">${esc(xLabels[index])}</text>`).join('');
  const formatHoverValue = typeof options.formatHoverValue === 'function' ? options.formatHoverValue : (value) => String(value);
  const formatHoverLines = typeof options.formatHoverLines === 'function' ? options.formatHoverLines : () => [];
  const formatHoverMeta = typeof options.formatHoverMeta === 'function' ? options.formatHoverMeta : () => null;
  const zeroIsValue = Boolean(options.zeroIsValue);
  const areaEnabled = Boolean(options.area);
  const showLegend = options.showLegend ?? (series.length > 1);
  const baselineY = toY(Number(options.areaBaseline ?? yMin));
  const lineMarkup = series.map((entry) => {
    let path = '';
    let current = [];
    const segments = [];
    entry.points.forEach((point) => {
      if (point.value == null || (!zeroIsValue && point.value === 0)) {
        if (current.length) { path += `${current.join(' ')} `; segments.push(current); current = []; }
        return;
      }
      current.push(`${current.length === 0 ? 'M' : 'L'}${toX(point.x)} ${toY(point.value)}`);
    });
    if (current.length) { path += current.join(' '); segments.push(current); }
    const areaMarkup = areaEnabled
      ? segments.map((segment) => {
        const first = segment[0]?.match(/^M([^ ]+) /);
        const last = segment[segment.length - 1]?.match(/^[ML]([^ ]+) /);
        if (!first || !last || segment.length < 2) return '';
        return `<path class="line-area-fill" d="${segment.join(' ')} L${last[1]} ${baselineY} L${first[1]} ${baselineY} Z" style="fill:${esc(hexToRgba(entry.color, Number(options.areaOpacity || 0.14)))};stroke:none;" />`;
      }).join('')
      : '';
    return `<g class="line-series">${areaMarkup}<path d="${path}" stroke="${entry.color}" />${entry.points.map((point) => {
      if (point.value == null || (!zeroIsValue && point.value === 0)) return '';
      if (options.podiumDots && [1, 2, 3].includes(Number(point.value))) {
        const podiumValue = Number(point.value);
        const icon = podiumValue === 1 ? '🏆' : podiumValue === 2 ? '🥈' : '🥉';
        return `<g class="chart-podium-icon chart-podium-icon-${podiumValue}" data-series="${esc(entry.label)}" data-x="${esc(point.x)}"><text x="${toX(point.x)}" y="${toY(point.value) + 5}" text-anchor="middle">${icon}</text></g>`;
      }
      return `<circle class="chart-dot" cx="${toX(point.x)}" cy="${toY(point.value)}" r="3.5" fill="${entry.color}" data-series="${esc(entry.label)}" data-x="${esc(point.x)}" />`;
    }).join('')}</g>`;
  }).join('');
  const hoverZones = staticChart ? '' : Array.from({ length: pointCount }, (_, index) => {
    const center = toX(index + 1);
    const prevCenter = index > 0 ? toX(index) : padding.left;
    const nextCenter = index < pointCount - 1 ? toX(index + 2) : width - padding.right;
    const zoneLeft = index === 0 ? padding.left : center - ((center - prevCenter) / 2);
    const zoneRight = index === pointCount - 1 ? width - padding.right : center + ((nextCenter - center) / 2);
    return `<rect class="chart-hover-zone" x="${zoneLeft}" y="${padding.top}" width="${Math.max(10, zoneRight - zoneLeft)}" height="${plotHeight}" data-hover-index="${index}" />`;
  }).join('');
  const hoverEntries = Array.from({ length: pointCount }, (_, index) => ({
    index,
    raceNumber: index + 1,
    x: toX(index + 1),
    label: hoverLabels[index] || xLabels[index] || `Race ${index + 1}`,
    title: options.label || '',
    mode: options.readoutMode || '',
    values: series.map((entry) => {
      const point = entry.points.find((item) => Number(item.x) === index + 1) || null;
      if (!point || point.value == null || (!zeroIsValue && point.value === 0)) return null;
      return {
        label: entry.label,
        color: entry.color,
        value: point.value,
        display: formatHoverValue(point.value, point, entry),
        meta: formatHoverMeta(point.value, point, entry),
        lines: (() => {
          const value = formatHoverLines(point.value, point, entry);
          if (Array.isArray(value)) return value.filter((line) => String(line || '').trim());
          if (value == null) return [];
          const text = String(value).trim();
          return text ? [text] : [];
        })(),
      };
    }).filter(Boolean),
  }));
  const hoverPayload = staticChart ? '' : encodeChartPayload(hoverEntries);
  const hoverMarkup = staticChart ? '' : `<div class="chart-tooltip" hidden></div>`;
  const hoverLine = staticChart ? '' : `<line class="chart-hover-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" hidden />`;
  const hoverLayer = staticChart ? '' : `<g class="chart-hover-layer">${hoverZones}</g>`;
  const legendMarkup = showLegend ? `<div class="chart-legend">${series.map((entry) => `<span class="legend-item"><i style="background:${entry.color}"></i>${esc(entry.label)}</span>`).join('')}</div>` : '';
  const chartContent = `${hoverMarkup}<svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(options.label || 'Grafiek')}"><g class="chart-grid">${minorYMarkup}${xMinorMarkup}${majorYMarkup}</g><line class="chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" /><line class="chart-axis" x1="${padding.left}" y1="${height - padding.bottom}" x2="${width - padding.right}" y2="${height - padding.bottom}" />${hoverLine}${lineMarkup}${hoverLayer}<g class="chart-x-labels">${xAxisLabels}</g></svg>${legendMarkup}`;
  const chartStep = Math.max(1, Number(options.xMinorStep || 1));
  if (staticChart) return `<div class="chart-shell" id="${esc(options.exportId || '')}" data-chart-export-id="${esc(options.exportId || '')}" data-chart-step="${esc(String(chartStep))}">${chartContent}</div>`;
  return `<div class="chart-shell interactive-chart" id="${esc(options.exportId || '')}" data-chart-shell="1" data-chart-points="${esc(hoverPayload)}" data-chart-export-id="${esc(options.exportId || '')}" data-chart-step="${esc(String(chartStep))}">${chartContent}</div>`;
}

function parseChartPayload(node) {
  if (!node || !node.dataset.chartPoints) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(node.dataset.chartPoints));
    if (Array.isArray(parsed)) return parsed;
    if (parsed && parsed.c === 1 && Array.isArray(parsed.s) && Array.isArray(parsed.e)) {
      const strings = parsed.s;
      const decodeRef = (value) => (Number.isInteger(value) && value >= 0 && value < strings.length ? String(strings[value] || '') : '');
      const decodeMeta = (value) => {
        if (Array.isArray(value)) {
          return {
            rankIndex: Number(value[0] || 0),
            benchmarkPlayer: decodeRef(value[1]),
            benchmarkTotal: value[2],
            playerTotal: value[3],
          };
        }
        return value && typeof value === 'object' ? value : {};
      };
      return parsed.e.map((entryRaw) => {
        if (!Array.isArray(entryRaw)) return null;
        const valuesRaw = Array.isArray(entryRaw[6]) ? entryRaw[6] : [];
        const values = valuesRaw.map((valueRaw) => {
          if (!Array.isArray(valueRaw)) return null;
          const linesRaw = Array.isArray(valueRaw[4]) ? valueRaw[4] : [];
          return {
            label: decodeRef(valueRaw[0]),
            color: decodeRef(valueRaw[1]),
            value: valueRaw[2],
            display: decodeRef(valueRaw[3]),
            lines: linesRaw.map((lineRef) => decodeRef(lineRef)).filter((line) => line !== ''),
            meta: decodeMeta(valueRaw[5]),
          };
        }).filter(Boolean);
        return {
          index: Number.isFinite(Number(entryRaw[0])) ? Number(entryRaw[0]) : 0,
          raceNumber: Number.isFinite(Number(entryRaw[1])) ? Number(entryRaw[1]) : 0,
          x: Number.isFinite(Number(entryRaw[2])) ? Number(entryRaw[2]) : 0,
          label: decodeRef(entryRaw[3]),
          title: decodeRef(entryRaw[4]),
          mode: decodeRef(entryRaw[5]),
          values,
        };
      }).filter(Boolean);
    }
    return [];
  } catch (_) {
    return [];
  }
}

function encodeChartPayload(entries) {
  const list = Array.isArray(entries) ? entries : [];
  try {
    const strings = [];
    const stringIndex = new Map();
    const sid = (value) => {
      const text = String(value || '');
      if (!text) return -1;
      if (stringIndex.has(text)) return stringIndex.get(text);
      const index = strings.length;
      strings.push(text);
      stringIndex.set(text, index);
      return index;
    };
    const encodeMeta = (meta) => {
      if (!meta || typeof meta !== 'object') return null;
      return [
        Number(meta.rankIndex || 0),
        sid(meta.benchmarkPlayer || ''),
        meta.benchmarkTotal ?? null,
        meta.playerTotal ?? null,
      ];
    };
    const encodedEntries = list.map((entry) => {
      const valuesRaw = Array.isArray(entry?.values) ? entry.values : [];
      const values = valuesRaw.map((item) => [
        sid(item?.label || ''),
        sid(item?.color || ''),
        item?.value ?? null,
        sid(item?.display || ''),
        (Array.isArray(item?.lines) ? item.lines : []).map((line) => sid(line)).filter((index) => index >= 0),
        encodeMeta(item?.meta || null),
      ]);
      return [
        Number(entry?.index || 0),
        Number(entry?.raceNumber || 0),
        Number(entry?.x || 0),
        sid(entry?.label || ''),
        sid(entry?.title || ''),
        sid(entry?.mode || ''),
        values,
      ];
    });
    return encodeURIComponent(JSON.stringify({ c: 1, s: strings, e: encodedEntries }));
  } catch (_error) {
    return encodeURIComponent(JSON.stringify(list));
  }
}

function renderReadoutValueRows(values, includeDetails = true, forceCompact = false, mode = 'default') {
  const list = Array.isArray(values) ? values : [];
  const compactMode = forceCompact || !includeDetails;
  const colspan = mode === 'place-track' ? 2 : (mode === 'benchmark-delta' ? 2 : (compactMode ? 2 : 3));
  if (!list.length) return `<tr><td colspan="${colspan}" class="mk-chart-readout-empty">${esc(tr('noDataPoint'))}</td></tr>`;
  return list.map((item) => {
    const color = item?.color || '';
    const label = item?.label || '';
    const display = item?.display || '-';
    const lines = Array.isArray(item?.lines) ? item.lines.filter((line) => String(line || '').trim()) : [];
    const details = lines.length ? lines.map((line) => esc(line)).join('<br>') : '';
    const valueCell = lines.length ? '-' : esc(display);
    if (mode === 'place-track') {
      const displayTextRaw = String(display || '').trim();
      const fallbackPlace = Number.isFinite(Number(item?.value)) && Number(item.value) > 0
        ? formatPlaceDisplay(Number(item.value), { withIcon: true })
        : '-';
      const placeText = displayTextRaw && displayTextRaw !== '-' ? displayTextRaw : fallbackPlace;
      const trackName = lines[0] ? esc(lines[0]) : '-';
      const tieRows = lines.slice(1).map((line) => `<tr><td class="mk-chart-readout-track mk-chart-readout-tie" colspan="2">${esc(line)}</td></tr>`).join('');
      return `<tr><td class="mk-chart-readout-place">${esc(placeText)}</td><td class="mk-chart-readout-track">${trackName}</td></tr>${tieRows}`;
    }
    if (mode === 'benchmark-delta') {
      const meta = item?.meta || {};
      const numeric = Number(item?.value || 0);
      const sign = numeric > 0 ? '+' : '';
      const rankIndex = Number(meta?.rankIndex || 0);
      const targetName = String(meta?.benchmarkPlayer || '-');
      const benchmarkTotal = Number.isFinite(Number(meta?.benchmarkTotal)) ? formatNumber(Number(meta.benchmarkTotal), 0) : '-';
      const playerTotal = Number.isFinite(Number(meta?.playerTotal)) ? formatNumber(Number(meta.playerTotal), 0) : '-';
      const summaryClass = numeric === 0 ? ` mk-benchmark-tie mk-benchmark-tie-${Math.max(1, rankIndex + 1)}` : '';
      return `<tr class="mk-benchmark-row${summaryClass}"><td class="mk-benchmark-col mk-benchmark-col-label">${esc(label)}</td><td class="mk-benchmark-pack-cell"><div class="mk-benchmark-pack"><span class="mk-benchmark-col mk-benchmark-col-name">${esc(targetName)}</span><span class="mk-benchmark-col mk-benchmark-col-score">${esc(benchmarkTotal)}</span><span class="mk-benchmark-col mk-benchmark-col-vs">vs</span><span class="mk-benchmark-col mk-benchmark-col-score">${esc(playerTotal)}</span><span class="mk-benchmark-col mk-benchmark-col-delta">${esc(`${sign}${formatNumber(numeric, 0)}`)}</span><span class="mk-benchmark-col mk-benchmark-col-points">pts</span></div></td></tr>`;
    }
    if (compactMode) {
      const compactValue = lines.length ? details : valueCell;
      const wrappedValue = lines.length ? `<span class="mk-chart-readout-track-lines">${compactValue}</span>` : compactValue;
      return `<tr><td><span class="mk-chart-readout-key"><i style="background:${esc(color)}"></i>${esc(label)}</span></td><td>${wrappedValue}</td></tr>`;
    }
    return `<tr><td><span class="mk-chart-readout-key"><i style="background:${esc(color)}"></i>${esc(label)}</span></td><td>${valueCell}</td><td class="mk-chart-readout-details">${details || '-'}</td></tr>`;
  }).join('');
}

function ensureChartReadoutNode(shell) {
  if (!shell || !shell.parentElement) return null;
  let host = null;
  Array.from(shell.parentElement.children || []).forEach((child) => {
    if (!host && child?.classList?.contains('mk-chart-scrubber-wrap')) host = child;
  });
  if (!host) {
    host = document.createElement('div');
    host.className = 'mk-chart-scrubber-wrap';
    shell.parentElement.appendChild(host);
  }
  let readout = host.querySelector('.mk-chart-readout');
  if (!readout) {
    readout = document.createElement('div');
    readout.className = 'mk-chart-readout';
    host.appendChild(readout);
  }
  return readout;
}

function ensureChartScrubberNode(shell) {
  if (!shell || !shell.parentElement) return null;
  const points = parseChartPayload(shell);
  if (!points.length) return null;
  let host = null;
  Array.from(shell.parentElement.children || []).forEach((child) => {
    if (!host && child?.classList?.contains('mk-chart-scrubber-wrap')) host = child;
  });
  if (!host) {
    host = document.createElement('div');
    host.className = 'mk-chart-scrubber-wrap';
    shell.parentElement.appendChild(host);
  }
  let scrubber = host.querySelector('.mk-chart-scrubber');
  if (!scrubber) {
    scrubber = document.createElement('input');
    scrubber.type = 'range';
    scrubber.className = 'mk-chart-scrubber';
    scrubber.step = '1';
    host.insertBefore(scrubber, host.firstChild || null);
    const onScrub = () => {
      updateLineChartHover(shell, Number(scrubber.value || 0));
    };
    scrubber.addEventListener('input', onScrub);
    scrubber.addEventListener('change', onScrub);
  }
  scrubber.min = '0';
  scrubber.max = String(Math.max(0, points.length - 1));
  const rawStep = Number(shell?.dataset?.chartStep || 1);
  const scrubberStep = Number.isFinite(rawStep) && rawStep > 0 ? rawStep : 1;
  scrubber.step = String(scrubberStep);
  const currentValue = Number(scrubber.value || 0);
  scrubber.value = String(Number.isFinite(currentValue) ? Math.min(Math.max(currentValue, 0), points.length - 1) : 0);
  shell._mkScrubberInput = scrubber;
  return scrubber;
}

function syncChartScrubberLayout(shell) {
  if (!shell?.parentElement) return;
  const host = shell.parentElement.querySelector('.mk-chart-scrubber-wrap');
  if (!host) return;
  const svg = shell.querySelector('svg');
  if (!svg?.getBoundingClientRect) {
    host.style.width = '100%';
    host.style.maxWidth = '100%';
    host.style.marginLeft = 'auto';
    host.style.marginRight = 'auto';
    return;
  }
  const shellRect = shell.getBoundingClientRect?.();
  const svgRect = svg.getBoundingClientRect?.();
  const viewBox = svg.viewBox?.baseVal || null;
  const edgeExpandPx = 8;
  const pointXs = parseChartPayload(shell)
    .map((entry) => Number(entry?.x))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => left - right);
  const payloadMinX = pointXs.length ? pointXs[0] : null;
  const payloadMaxX = pointXs.length ? pointXs[pointXs.length - 1] : null;
  if (Number.isFinite(payloadMinX) && Number.isFinite(payloadMaxX) && payloadMaxX > payloadMinX && viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0) {
    const scaleX = (svgRect?.width || 0) / viewBox.width;
    const offsetPx = Math.max(0, Math.round((payloadMinX - viewBox.x) * scaleX));
    const widthPx = Math.max(0, Math.round((payloadMaxX - payloadMinX) * scaleX));
    const shellWidth = Math.round(shellRect?.width || widthPx || 0);
    const expandedOffset = Math.max(0, offsetPx - edgeExpandPx);
    const expandedWidth = Math.min(shellWidth, Math.max(0, widthPx + (edgeExpandPx * 2)));
    host.style.width = expandedWidth > 0 ? `${expandedWidth}px` : '100%';
    host.style.marginLeft = `${Math.min(expandedOffset, Math.max(0, shellWidth - (expandedWidth || 0)))}px`;
    host.style.marginRight = '0';
    host.style.maxWidth = '100%';
    return;
  }
  const labelNodes = Array.from(svg.querySelectorAll?.('.chart-x-labels text') || []);
  let minX = null;
  let maxX = null;
  labelNodes.forEach((node) => {
    const xAttr = Number(node.getAttribute?.('x'));
    if (Number.isFinite(xAttr)) {
      minX = minX == null ? xAttr : Math.min(minX, xAttr);
      maxX = maxX == null ? xAttr : Math.max(maxX, xAttr);
      return;
    }
    try {
      const box = node.getBBox?.();
      if (box && Number.isFinite(box.x) && Number.isFinite(box.width)) {
        const left = box.x;
        const right = box.x + box.width;
        minX = minX == null ? left : Math.min(minX, left);
        maxX = maxX == null ? right : Math.max(maxX, right);
      }
    } catch (_) {
      // Ignore bbox failures; fallback to full SVG width below.
    }
  });
  const canUseLabelRange = Number.isFinite(minX) && Number.isFinite(maxX) && maxX > minX && viewBox && Number.isFinite(viewBox.width) && viewBox.width > 0;
  if (canUseLabelRange) {
    const scaleX = (svgRect?.width || 0) / viewBox.width;
    const offsetPx = Math.max(0, Math.round((minX - viewBox.x) * scaleX));
    const widthPx = Math.max(0, Math.round((maxX - minX) * scaleX));
    const shellWidth = Math.round(shellRect?.width || widthPx || 0);
    const expandedOffset = Math.max(0, offsetPx - edgeExpandPx);
    const expandedWidth = Math.min(shellWidth, Math.max(0, widthPx + (edgeExpandPx * 2)));
    host.style.width = expandedWidth > 0 ? `${expandedWidth}px` : '100%';
    host.style.marginLeft = `${Math.min(expandedOffset, Math.max(0, shellWidth - (expandedWidth || 0)))}px`;
    host.style.marginRight = '0';
    host.style.maxWidth = '100%';
    return;
  }
  const targetWidth = Math.round(Math.max(0, Math.min(svgRect?.width || 0, shellRect?.width || svgRect?.width || 0)));
  host.style.maxWidth = '100%';
  host.style.width = targetWidth > 0 ? `${targetWidth}px` : '100%';
  host.style.marginLeft = '0';
  host.style.marginRight = '0';
}

function initializeInteractiveCharts(rootNode = null) {
  const root = rootNode || qs('analyticsMount') || document;
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.interactive-chart[data-chart-shell]').forEach((shell) => {
    const points = parseChartPayload(shell);
    if (!points.length) return;
    ensureChartScrubberNode(shell);
    ensureChartReadoutNode(shell);
    syncChartScrubberLayout(shell);
    const initialIndex = Number(shell._mkScrubberInput?.value || 0);
    updateLineChartHover(shell, Number.isFinite(initialIndex) ? initialIndex : 0);
  });
}

function updateLineChartHover(shell, hoverIndex) {
  if (!shell) return;
  const nextIndex = Number(hoverIndex);
  if (!Number.isFinite(nextIndex)) return;
  if (!shell._mkHoverState) shell._mkHoverState = { index: -1, frame: 0 };
  shell._mkHoverState.index = nextIndex;
  if (shell._mkHoverState.frame) return;
  shell._mkHoverState.frame = (window?.requestAnimationFrame ? window.requestAnimationFrame : (cb) => setTimeout(cb, 16))(() => {
    shell._mkHoverState.frame = 0;
    const points = parseChartPayload(shell);
    const activeIndex = Number(shell._mkHoverState?.index ?? 0);
    const entry = points[activeIndex] || null;
    const hoverLine = shell.querySelector('.chart-hover-line');
    if (!entry) return;
    if (hoverLine) {
      hoverLine.removeAttribute('hidden');
      hoverLine.setAttribute('x1', entry.x);
      hoverLine.setAttribute('x2', entry.x);
    }
    const readout = ensureChartReadoutNode(shell);
    if (readout) {
      const valuesList = Array.isArray(entry.values) ? entry.values : [];
      const includeDetails = valuesList.some((item) => Array.isArray(item?.lines) && item.lines.some((line) => String(line || '').trim()));
      const forceCompact = String(entry?.title || '') === String(tr('positionDistribution'));
      const placeTrackMode = String(entry?.mode || '') === 'place-track'
        || String(entry?.title || '') === String(tr('positionAfterRace'))
        || String(entry?.title || '') === String(tr('finishPositionPerRace'));
      const benchmarkMode = String(entry?.mode || '') === 'benchmark-delta';
      const deltaPointsMode = String(entry?.mode || '') === 'delta-points';
      const tableClass = `mk-chart-readout-table${forceCompact ? ' is-compact' : ''}${forceCompact ? ' is-position-distribution' : ''}${placeTrackMode ? ' is-place-track' : ''}${benchmarkMode ? ' is-benchmark-delta' : ''}${deltaPointsMode ? ' is-delta-points' : ''}`;
      readout.innerHTML = `<div class="mk-chart-readout-head"><strong>${esc(tr('race'))} ${esc(entry.raceNumber)}</strong>${entry.label ? `<span>${esc(entry.label)}</span>` : ''}</div><div class="mk-table-scroll"><table class="${tableClass}"><tbody>${renderReadoutValueRows(valuesList, includeDetails, forceCompact, benchmarkMode ? 'benchmark-delta' : (placeTrackMode ? 'place-track' : 'default'))}</tbody></table></div>`;
    }
    const scrubber = shell._mkScrubberInput || null;
    if (scrubber && Number.isFinite(activeIndex)) scrubber.value = String(activeIndex);
  });
}

function hideLineChartHover(shell) {
  if (!shell) return;
  if (shell._mkScrubberInput) return;
  const hoverLine = shell.querySelector('.chart-hover-line');
  if (hoverLine) hoverLine.setAttribute('hidden', 'hidden');
}

function createDeltaChart(deltaSeries, playerA, playerB, options = {}) {
  if (!deltaSeries.rows.length) return emptyCard(options.emptyTitle || tr('twoPlayerDelta'), options.emptyText || tr('noSharedTotals'));
  const width = 860;
  const height = 292;
  const padding = { top: 28, right: 22, bottom: 42, left: 74 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxAbs = Math.max(1, deltaSeries.maxAbs);
  const yMinorStep = Math.max(1, Number(options.yMinorStep || 1));
  const yMajorStep = Math.max(yMinorStep, Number(options.yMajorStep || 3));
  const maxTickAbs = Math.max(yMinorStep, Math.ceil(maxAbs / yMinorStep) * yMinorStep);
  const zeroY = padding.top + (plotHeight / 2);
  const toX = (value) => padding.left + ((value - 1) * (plotWidth / Math.max(1, deltaSeries.rows.length - 1)));
  const toY = (value) => zeroY - (value / maxTickAbs) * (plotHeight / 2);
  const yMinorValues = [];
  for (let value = -maxTickAbs; value <= maxTickAbs; value += yMinorStep) yMinorValues.push(value);
  const yMajorValues = yMinorValues.filter((value) => value === 0 || value === maxTickAbs || value === -maxTickAbs || (value % yMajorStep) === 0);
  const xMinorMarkup = Array.from({ length: deltaSeries.rows.length }, (_, index) => index + 1)
    .map((value) => `<line class="chart-grid-minor" x1="${toX(value)}" y1="${padding.top}" x2="${toX(value)}" y2="${height - padding.bottom}" />`)
    .join('');
  const yMinorMarkup = yMinorValues
    .filter((value) => !yMajorValues.includes(value))
    .map((value) => `<line class="chart-grid-minor" x1="${padding.left}" y1="${toY(value)}" x2="${width - padding.right}" y2="${toY(value)}" />`)
    .join('');
  const yMajorMarkup = yMajorValues
    .map((value) => `<g><line x1="${padding.left}" y1="${toY(value)}" x2="${width - padding.right}" y2="${toY(value)}" /><text x="${padding.left - 8}" y="${toY(value) + 4}" text-anchor="end">${esc(String(value))}</text></g>`)
    .join('');
  const xAxisLabels = deltaSeries.rows
    .filter((row, index) => index === 0 || index === deltaSeries.rows.length - 1 || ((index + 1) % 4 === 0))
    .map((row, index) => {
      const absoluteIndex = deltaSeries.rows.findIndex((entry) => entry.x === row.x);
      return `<text x="${toX(row.x)}" y="${height - 14}" text-anchor="middle">${esc(String(absoluteIndex + 1))}</text>`;
    })
    .join('');
  const path = deltaSeries.rows.map((row, index) => `${index === 0 ? 'M' : 'L'}${toX(row.x)} ${toY(row.delta)}`).join(' ');
  const positiveColor = options.positiveColor || '#9be15d';
  const negativeColor = options.negativeColor || '#ff7b7b';
  const areas = deltaSeries.rows.slice(0, -1).map((row, index) => {
    const next = deltaSeries.rows[index + 1];
    const positive = (row.delta + next.delta) / 2 >= 0;
    const fill = positive ? hexToRgba(positiveColor, 0.26) : hexToRgba(negativeColor, 0.24);
    return `<polygon class="${positive ? 'delta-positive' : 'delta-negative'}" points="${toX(row.x)},${zeroY} ${toX(row.x)},${toY(row.delta)} ${toX(next.x)},${toY(next.delta)} ${toX(next.x)},${zeroY}" style="fill:${esc(fill)}" />`;
  }).join('');
  const staticChart = Boolean(options.staticExport) && !Boolean(options.interactiveCharts);
  const hoverZones = staticChart ? '' : Array.from({ length: deltaSeries.rows.length }, (_, index) => {
    const center = toX(index + 1);
    const prevCenter = index > 0 ? toX(index) : padding.left;
    const nextCenter = index < deltaSeries.rows.length - 1 ? toX(index + 2) : width - padding.right;
    const zoneLeft = index === 0 ? padding.left : center - ((center - prevCenter) / 2);
    const zoneRight = index === deltaSeries.rows.length - 1 ? width - padding.right : center + ((nextCenter - center) / 2);
    return `<rect class="chart-hover-zone" x="${zoneLeft}" y="${padding.top}" width="${Math.max(10, zoneRight - zoneLeft)}" height="${plotHeight}" data-hover-index="${index}" />`;
  }).join('');
  const hoverEntries = deltaSeries.rows.map((row, index) => ({
    index,
    raceNumber: index + 1,
    x: toX(row.x),
    label: row.label,
    mode: 'delta-points',
    values: [
      {
        label: `${playerA} ${row.delta > 0 ? tr('ahead') : (row.delta < 0 ? tr('behind') : tr('tied').toLowerCase())}`,
        color: positiveColor,
        value: row.delta,
        display: `${formatNumber(row.delta, 0)} ${tr('points')}`,
      },
      {
        label: `${playerB} ${row.delta > 0 ? tr('behind') : (row.delta < 0 ? tr('ahead') : tr('tied').toLowerCase())}`,
        color: negativeColor,
        value: -row.delta,
        display: `${formatNumber(-row.delta, 0)} ${tr('points')}`,
      },
    ],
  }));
  const hoverPayload = staticChart ? '' : encodeChartPayload(hoverEntries);
  const title = options.title || tr('twoPlayerDelta');
  const infoText = options.infoText || tr('deltaChartInfo');
  const exportId = options.exportId || 'deltaChartShell';
  const exportLabel = options.exportLabel || `${playerA}-vs-${playerB}-delta`;
  const hoverMarkup = staticChart ? '' : `<div class="chart-tooltip" hidden></div>`;
  const hoverLine = staticChart ? '' : `<line class="chart-hover-line" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" hidden />`;
  const hoverLayer = staticChart ? '' : `<g class="chart-hover-layer">${hoverZones}</g>`;
  const showLegend = options.showLegend ?? false;
  const legendMarkup = showLegend ? `<div class="delta-meta"><span class="legend-item"><i style="background:${esc(positiveColor)}"></i>${esc(playerA)} ${esc(tr('ahead'))}</span><span class="legend-item"><i style="background:${esc(negativeColor)}"></i>${esc(playerB)} ${esc(tr('ahead'))}</span></div>` : '';
  const chartContent = `${hoverMarkup}<svg class="delta-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(tr('deltaChart'))}"><g class="chart-grid">${yMinorMarkup}${xMinorMarkup}${yMajorMarkup}</g><line class="chart-axis" x1="${padding.left}" y1="${zeroY}" x2="${width - padding.right}" y2="${zeroY}" /><line class="chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${height - padding.bottom}" /><text class="delta-player-label" x="${padding.left + 8}" y="${padding.top - 8}" text-anchor="start">${esc(playerA)}</text><text class="delta-player-label" x="${padding.left + 8}" y="${height - padding.bottom + 18}" text-anchor="start">${esc(playerB)}</text>${areas}<path class="delta-line" d="${path}" style="stroke:${esc(positiveColor)}" />${deltaSeries.rows.map((row) => `<circle cx="${toX(row.x)}" cy="${toY(row.delta)}" r="3.2" style="fill:${esc(row.delta >= 0 ? positiveColor : negativeColor)}" class="${row.delta >= 0 ? 'delta-dot-positive' : 'delta-dot-negative'}" />`).join('')}${hoverLine}${hoverLayer}<g class="chart-x-labels">${xAxisLabels}</g></svg>${legendMarkup}`;
  const chartShell = staticChart
    ? `<div class="chart-shell" id="${esc(exportId)}" data-chart-export-id="delta-chart" data-chart-step="1">${chartContent}</div>`
    : `<div class="chart-shell interactive-chart" id="${esc(exportId)}" data-chart-shell="1" data-chart-points="${esc(hoverPayload)}" data-chart-export-id="delta-chart" data-chart-step="1">${chartContent}</div>`;
  return `<article class="panel-card chart-wide-card"><div class="section-head"><div><h2>${renderChartHeading(title, infoText)}</h2></div>${exportButton(exportId, exportLabel)}</div>${chartShell}</article>`;
}

function renderGlobalComparisonControls(derived) {
  const scopeOptions = buildParticipantScopeOptions(derived.playerScopedFinalRows, state.participant);
  const isAutoMode = !state.playerFilter;
  return `<section class="section-block"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('comparisonFilters'))}</h2><p>${esc(isAutoMode ? tr('autoComparisonHelp', { count: DEFAULT_AUTO_COMPARISON_PLAYERS, max: MAX_COMPARISON_PLAYERS }) : tr('manualComparisonHelp'))}</p></div></div><div class="section-controls compact-controls"><button type="button" class="analytics-ghost-btn" id="comparisonSelectAllBtn">Select all</button><button type="button" class="analytics-ghost-btn" id="comparisonDefaultBtn">Default</button>${COMPARISON_SLOT_IDS.map((id, index) => {
    const currentValue = state.comparisonPlayers[index] || '';
    const taken = new Set(state.comparisonPlayers.filter((player, playerIndex) => player && playerIndex !== index));
    const options = [`<option value="">${index === 0 ? tr('choosePlayer1') : tr('choosePlayerN', { index: index + 1 })}</option>`, ...derived.allPlayerOptions.filter((player) => !taken.has(player) || player === currentValue).map((player) => `<option value="${esc(player)}"${player === currentValue ? ' selected' : ''}>${esc(player)}</option>`)];
    return `<label><span>${esc(tr('playerN', { index: index + 1 }))}</span><select id="${id}">${options.join('')}</select></label>`;
  }).join('')}<label><span>${esc(tr('player1Scope'))}</span><select id="participantScopeSelect">${scopeOptions.map((option) => `<option value="${esc(option.value)}"${option.value === state.participantScope ? ' selected' : ''}>${esc(option.label)}</option>`).join('')}</select></label></div><p class="empty-note">${esc(tr('selectedCountOfMax', { count: state.comparisonPlayers.filter(Boolean).length, max: MAX_COMPARISON_PLAYERS }))}</p></article></section>`;
}

function renderParticipantAnalysisPanel(baseRaceRows, participant, overlayPlayers, participantScope, options = {}) {
  const participantRows = filterParticipantRows(baseRaceRows, participant, participantScope);
  if (!participant || !participantRows.length) {
    return emptyCard(options.emptyTitle || tr('raceProgress'), options.emptyText || tr('noRaceDataForPlayer'));
  }
  const overlayData = buildOverlaySeries(baseRaceRows, overlayPlayers, participantScope, options.playerColors || {});
  const maxPosition = Math.max(12, ...participantRows.map((row) => Number(row.positionAfterRaceResolved || row.positionAfterRace || row.position || 0)));
  const positionMajorValues = unique([1, 3, 6, 9, 12].filter((value) => value <= maxPosition).concat(maxPosition));
  const positionMajorTicks = positionMajorValues
    .sort((left, right) => left - right)
    .map((value) => ({ value, label: String(value) }));
  const positionMinorTicks = Array.from({ length: maxPosition }, (_, index) => ({ value: index + 1 }));
  const exportPrefix = options.exportPrefix || `participant-${slugify(participant)}`;
  const exportIds = {
    afterRace: `${exportPrefix}-after-race`,
    finish: `${exportPrefix}-finish`,
    total: `${exportPrefix}-total`,
    topTotal: `${exportPrefix}-top-total`,
    ...(options.exportIds || {}),
  };
  const chartA = createLineChart(overlayData.series.map((entry) => ({ ...entry, points: entry.points.map((point) => ({ x: point.x, value: point.row ? Number(point.row.positionAfterRaceResolved || point.row.positionAfterRace || 0) : null, row: point.row || null })) })), { label: tr('positionAfterRace'), readoutMode: 'place-track', exportId: exportIds.afterRace, yMin: 1, yMax: maxPosition, invertY: true, podiumDots: true, yMajorTicks: positionMajorTicks, yMinorTicks: positionMinorTicks, xMinorStep: 1, xMajorStep: 4, xLabels: overlayData.labels.map((label) => label.shortLabel), hoverLabels: overlayData.labels.map((label) => label.detail), staticExport: options.staticExport, interactiveCharts: options.interactiveCharts, showLegend: false, formatHoverValue: (_value, point) => {
    const row = point?.row || null;
    const rank = Number(row?.positionAfterRaceResolved || row?.positionAfterRace || _value || 0);
    const tied = String(row?.positionAfterRaceLabel || '').toUpperCase().startsWith('T');
    return formatPlaceDisplay(rank, { withIcon: true, tied });
  }, formatHoverLines: (_value, point) => {
    const row = point?.row || null;
    const trackLine = row?.trackLabel ? [String(row.trackLabel)] : [];
    const tieLines = Array.isArray(row?.positionAfterRaceTiePlayers)
      ? row.positionAfterRaceTiePlayers
        .filter((name) => String(name || '').trim())
        .map((name) => `${tr('sharedWith')}: ${String(name).trim()}`)
      : [];
    return trackLine.concat(tieLines);
  } });
  const chartB = createLineChart(overlayData.series.map((entry) => ({ ...entry, points: entry.points.map((point) => ({ x: point.x, value: point.row ? Number(point.row.position || 0) : null, row: point.row || null })) })), { label: tr('finishPositionPerRace'), readoutMode: 'place-track', exportId: exportIds.finish, yMin: 1, yMax: maxPosition, invertY: true, podiumDots: true, yMajorTicks: positionMajorTicks, yMinorTicks: positionMinorTicks, xMinorStep: 1, xMajorStep: 4, xLabels: overlayData.labels.map((label) => label.shortLabel), hoverLabels: overlayData.labels.map((label) => label.detail), staticExport: options.staticExport, interactiveCharts: options.interactiveCharts, showLegend: false, formatHoverValue: (value) => formatPlaceDisplay(value, { withIcon: true }), formatHoverLines: (_value, point) => point?.row?.trackLabel || '' });
  const totalMax = Math.max(1, ...overlayData.series.flatMap((entry) => entry.points.map((point) => Number(point.row?.totalAfter || 0))));
  const pointMajorTicks = Array.from({ length: Math.floor(totalMax / 30) + 2 }, (_, index) => index * 30).filter((value) => value <= totalMax).concat(totalMax % 30 === 0 ? [] : [totalMax]).map((value) => ({ value, label: String(value) }));
  const pointMinorTicks = Array.from({ length: Math.floor(totalMax / 5) + 1 }, (_, index) => ({ value: index * 5 })).filter((tick) => tick.value <= totalMax);
  const chartC = createLineChart(overlayData.series.map((entry) => ({ ...entry, points: entry.points.map((point) => ({ x: point.x, value: point.row ? Number(point.row.totalAfter || 0) : null, row: point.row || null })) })), { label: tr('totalAfterRace'), exportId: exportIds.total, yMin: 0, yMax: totalMax, yMajorTicks: pointMajorTicks, yMinorTicks: pointMinorTicks, xMinorStep: 1, xMajorStep: 4, xLabels: overlayData.labels.map((label) => label.shortLabel), hoverLabels: overlayData.labels.map((label) => label.detail), staticExport: options.staticExport, interactiveCharts: options.interactiveCharts, showLegend: false, formatHoverValue: (value) => `${formatNumber(value, 0)} ${tr('points')}` });
  const benchmarkData = buildTopThreeTotalBenchmarkSeries(options.benchmarkRaceRows || baseRaceRows, participant, participantScope, options.playerColors || {});
  const benchmarkValues = benchmarkData.series.flatMap((entry) => entry.points.map((point) => Number(point.value || 0)));
  const benchmarkMin = Math.min(0, ...benchmarkValues);
  const benchmarkMax = Math.max(1, ...benchmarkValues);
  const benchmarkMaxAbs = Math.max(Math.abs(benchmarkMin), Math.abs(benchmarkMax));
  const benchmarkTickStep = benchmarkMaxAbs <= 20 ? 5 : 10;
  const benchmarkMajorTicks = [];
  for (let value = Math.floor(benchmarkMin / benchmarkTickStep) * benchmarkTickStep; value <= benchmarkMax; value += benchmarkTickStep) benchmarkMajorTicks.push({ value, label: String(value) });
  if (!benchmarkMajorTicks.some((tick) => tick.value === 0)) benchmarkMajorTicks.push({ value: 0, label: '0' });
  const benchmarkMinorTicks = [];
  for (let value = Math.floor(benchmarkMin / benchmarkTickStep) * benchmarkTickStep; value <= benchmarkMax; value += Math.max(1, benchmarkTickStep / 2)) benchmarkMinorTicks.push({ value });
  const chartD = createLineChart(benchmarkData.series, { label: tr('topThreeTotalBenchmark'), readoutMode: 'benchmark-delta', exportId: exportIds.topTotal, yMin: benchmarkMin, yMax: benchmarkMax, yMajorTicks: benchmarkMajorTicks.sort((left, right) => left.value - right.value), yMinorTicks: benchmarkMinorTicks, xMinorStep: 1, xMajorStep: 4, xLabels: benchmarkData.labels.map((label) => label.shortLabel), hoverLabels: benchmarkData.labels.map((label) => label.detail), area: true, areaBaseline: 0, areaOpacity: 0.12, zeroIsValue: true, staticExport: options.staticExport, interactiveCharts: options.interactiveCharts, showLegend: false, formatHoverValue: (value) => {
    const sign = value > 0 ? '+' : '';
    return `${sign}${formatNumber(value, 0)} ${tr('points')}`;
  }, formatHoverMeta: (value, point, entry) => {
    const row = point?.row || null;
    const playerTotal = point?.playerRow?.totalAfterNumber ?? null;
    const benchmarkTotal = row?.totalAfterNumber ?? null;
    return {
      rankIndex: Number(point?.rankIndex ?? entry?.rankIndex ?? 0),
      benchmarkPlayer: row?.playerName || '-',
      benchmarkTotal,
      playerTotal,
      signText: value >= 0 ? tr('ahead') : 'behind',
    };
  } });
  const title = options.title || tr('participantAnalysis');
  const description = options.description || tr('participantAnalysisDescription');
  const shellClass = options.shellClass || 'section-block';
  const sectionHeadMarkup = options.hideSectionHead
    ? ''
    : `<div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div>`;
  const showTotalAfterRaceChart = options.showTotalAfterRaceChart !== false;
  const totalChartCard = showTotalAfterRaceChart
    ? `<article class="panel-card chart-wide-card">${renderChartSectionHead(tr('totalAfterRace'), tr('totalAfterRaceInfo'), exportButton(exportIds.total, 'totaal-na-race'))}${chartC}</article>`
    : '';
  return `<section class="${esc(shellClass)}">${sectionHeadMarkup}<div class="chart-grid participant-chart-grid"><article class="panel-card chart-wide-card">${renderChartSectionHead(tr('positionAfterRace'), tr('positionAfterRaceInfo'), exportButton(exportIds.afterRace, 'positie-na-race'))}${chartA}</article><article class="panel-card chart-wide-card">${renderChartSectionHead(tr('finishPosition'), tr('finishPositionInfo'), exportButton(exportIds.finish, 'finishpositie'))}${chartB}</article>${totalChartCard}<article class="panel-card chart-wide-card">${renderChartSectionHead(tr('topThreeTotalBenchmark'), tr('topThreeTotalBenchmarkInfo'), exportButton(exportIds.topTotal, 'top-3-totaalbenchmark'))}${chartD}</article></div></section>`;
}

function renderHistogramPanel(baseRaceRows, baseFinalRows, groupKey, selectedPlayers, options = {}) {
  const histogram = buildHistogramData(baseRaceRows, baseFinalRows, groupKey);
  if (!histogram.rows.length) {
    return emptyCard(options.emptyTitle || tr('positionDistribution'), options.emptyText || tr('noPositionsForGroup'));
  }
  const title = options.title || tr('positionDistribution');
  const description = options.description || tr('positionDistributionDescription');
  const exportPrefix = options.exportPrefix || `histogram-${slugify(groupKey)}`;
  const selectedLabel = selectedPlayers[0] || histogram.rows[0]?.standing?.playerName || '';
  const infoText = options.infoText || tr('positionDistributionInfo');
  const tableHtml = options.showTable === false
    ? ''
    : table(['#', tr('participant'), ...Array.from({ length: histogram.maxPosition }, (_, index) => String(index + 1)), tr('avgAbbrev'), tr('top3'), `${tr('top3')} %`], histogram.rows.map((row) => `<tr><td>${esc(standingLabel(row.standing))}</td><td>${esc(row.standing.playerName)}</td>${row.positions.map((position) => `<td><div class="position-bar-cell" style="--bar-fill:${row.totalRaces > 0 ? position.count / row.totalRaces : 0}"><span>${esc(position.count)}</span></div></td>`).join('')}<td><div class="avg-finish-meter"><span style="--avg-marker:${histogram.maxPosition > 1 ? (row.avgFinish - 1) / (histogram.maxPosition - 1) : 0}"></span><small>${esc(formatNumber(row.avgFinish, 2))}</small></div></td><td class="cell-number">${esc(row.top3Count)}</td><td class="cell-number">${esc(formatPercent(row.top3Rate))}</td></tr>`), 'histogram-table');
  const summaryHtml = options.summaryHtml || '';
  const sectionHead = options.hideHeading
    ? ''
    : `<div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div></div>`;
  const chartHtml = createHistogramPlayerChartForPlayers(histogram, selectedPlayers, {
    exportId: `${exportPrefix}-chart`,
    exportLabel: `${selectedLabel}-positieverdeling`,
    title: options.chartTitle || tr('positionDistribution'),
    infoText,
    playerColors: options.playerColors || {},
    staticExport: options.staticExport,
    interactiveCharts: options.interactiveCharts,
  });
  return `<section class="${esc(options.shellClass || 'section-block')}">${sectionHead}${tableHtml}${chartHtml}${summaryHtml}</section>`;
}

function renderParticipantAnalysis(derived) {
  return renderParticipantAnalysisPanel(derived.filteredRaceRows, state.participant, unique([state.participant, ...state.comparisonPlayers.slice(1)].filter(Boolean)), state.participantScope, { exportIds: { afterRace: 'participantChartAfterRace', finish: 'participantChartFinish', total: 'participantChartTotal' }, title: tr('participantAnalysis'), description: tr('participantAnalysisDescription') });
}

function renderHistogram(derived) {
  const histogramGroups = derived.filteredGroups.filter((group) => group.phase === 'post' || group.phase === 'qualifier');
  if (!histogramGroups.length) return emptyCard(tr('positionDistribution'), tr('noHistogramGroups'));
  return `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('positionDistribution'))}</h2><p>${esc(tr('positionDistributionDescription'))}</p></div></div><div class="section-controls compact-controls"><label><span>${esc(tr('groupLabel'))}</span><select id="histogramGroupSelect">${histogramGroups.map((group) => `<option value="${esc(group.groupKey)}"${group.groupKey === state.histogramGroup ? ' selected' : ''}>${esc(group.phase === 'qualifier' ? `${tr('qualifier')} · ${group.groupName}` : group.groupName)}</option>`).join('')}</select></label></div>${renderHistogramPanel(derived.filteredRaceRows, derived.filteredFinalRows, state.histogramGroup, [state.histogramPlayer, ...state.comparisonPlayers.filter(Boolean)], { shellClass: 'histogram-body', chartDescription: tr('selectedPlayerFrontCompare', { player: state.histogramPlayer || tr('allPlayers') }) }).replace(/^<section class="histogram-body">|<\/section>$/g, '')}</section>`;
}

function renderComparison(derived) {
  const pairCards = buildComparisonData(derived.comparisonRaceRows, derived.comparisonFinalRows, state.comparisonPlayers);
  return `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('comparison'))}</h2><p>${esc(tr('comparisonDescription'))}</p></div></div>${pairCards.length ? `<div class="comparison-grid">${pairCards.map((card) => `<article class="panel-card comparison-card"><div class="section-head"><div><h3>${esc(card.playerA)} vs ${esc(card.playerB)}</h3><p>${esc(card.sharedRaces)} ${esc(tr('sharedRaces'))}</p></div></div><div class="summary-strip"><span>${esc(card.playerA)} ${esc(tr('ahead'))} ${esc(card.playerB)}: <strong>${esc(card.aboveA)}</strong></span><span>${esc(card.playerB)} ${esc(tr('ahead'))} ${esc(card.playerA)}: <strong>${esc(card.aboveB)}</strong></span><span>${esc(tr('tied'))}: <strong>${esc(card.ties)}</strong></span><span>${esc(tr('avgGroupDelta'))}: <strong>${esc(card.avgGroupDelta == null ? '-' : formatNumber(card.avgGroupDelta, 2))}</strong></span></div>${card.sharedTracks.length ? table([tr('track'), tr('cup'), tr('duels'), `${card.playerA} ${tr('ahead')}`, `${card.playerB} ${tr('ahead')}`], card.sharedTracks.slice(0, 10).map((track) => `<tr><td>${esc(track.trackLabel)}</td><td>${esc(track.cupLabel)}</td><td class="cell-number">${esc(track.duels)}</td><td class="cell-number">${esc(track.aWins)}</td><td class="cell-number">${esc(track.bWins)}</td></tr>`)) : `<p class="empty-note">${esc(tr('noSharedTracks'))}</p>`}</article>`).join('')}</div>` : emptyCard(tr('comparison'), tr('addTwoPlayers'))}</section>`;
}

function renderEndStandings(groups, options = {}) {
  if (!groups.length) return emptyCard(tr('endStandings'), tr('noEndGroups'));
  const sectionHeader = options.hideSectionHeader
    ? ''
    : `<div class="section-head"><div><h2>${esc(tr('endStandingsTable'))}</h2><p>${esc(tr('endStandingsDescription'))}</p></div></div>`;
  return `<section class="section-block">${sectionHeader}<div class="standings-grid">${groups.map((group) => `<article class="panel-card"><div class="section-head"><div><h3 class="standings-group-title standings-group-title-${esc(norm(group.groupName))}">${esc(group.groupName)}</h3><p>${esc(tr('playersCount', { count: group.rows.length }))}</p></div></div>${table([tr('standingsColRank'), tr('standingsColName'), tr('standingsColChar'), tr('standingsColPts')], group.rows.map((row, index) => renderStandingRow(row, index, false, options)), 'standings-table')}</article>`).join('')}</div></section>`;
}

function renderQualifierStandings(groups, options = {}) {
  if (!groups.length) return emptyCard(tr('qualifier'), tr('noQualifierStandings'));
  const sectionHeader = options.hideSectionHeader
    ? ''
    : `<div class="section-head"><div><h2>${esc(tr('qualifierTable'))}</h2><p>${esc(tr('qualifierDescription'))}</p></div></div>`;
  return `<section class="section-block">${sectionHeader}<div class="standings-grid">${groups.map((group) => `<article class="panel-card"><div class="section-head"><div><h3 class="standings-group-title standings-group-title-${esc(norm(group.groupName))}">${esc(group.groupName)}</h3><p>${esc(tr('playersCount', { count: group.rows.length }))}</p></div></div>${table([tr('standingsColRank'), tr('standingsColName'), tr('standingsColChar'), tr('standingsColPts'), tr('endGroup')], group.rows.map((row, index) => renderStandingRow(row, index, true, options)), 'standings-table')}</article>`).join('')}</div></section>`;
}

function renderTopSection(derived, options = {}) {
  return `<section class="section-block"><div class="card-columns two"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('top5Tracks'))}</h2></div></div>${renderTopFiveList(derived.trackUsage, 'track', options)}</article><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('top5Cups'))}</h2></div></div>${renderTopFiveList(derived.cupUsage, 'cup', options)}</article></div></section>`;
}

function renderCupOverview(cupOverview, trackDetail, filteredRaceCount, options = {}) {
  const topCupLabels = new Set(cupOverview.slice().sort((left, right) => right.count - left.count || byText(left.cupLabel, right.cupLabel)).slice(0, 5).filter((cup) => cup.count > 0).map((cup) => cup.cupLabel));
  const topTrackKeys = new Set(cupOverview.flatMap((cup) => cup.tracks).slice().sort((left, right) => right.count - left.count || byText(left.trackLabel, right.trackLabel)).slice(0, 5).filter((track) => track.count > 0).map((track) => track.trackKey));
  const interactiveTrackDetail = options.interactiveTrackDetail !== false;
  const showTrackDetail = options.showTrackDetail !== false;
  const trackUsage = Array.isArray(options.trackUsage) ? options.trackUsage : [];
  const detailHost = !showTrackDetail
    ? ''
    : (trackDetail
    ? `<div data-track-detail-host="1">${renderTrackDetail(trackDetail, options)}</div>`
    : emptyCard(tr('track'), options.staticExport ? tr('trackDetailEmptyExport') : tr('trackDetailEmptyInteractive')));
  const detailTemplates = showTrackDetail && options.staticExport && interactiveTrackDetail && trackUsage.length
    ? `<div class="track-detail-templates" hidden>${trackUsage.map((entry) => {
      const detail = buildTrackDetail(trackUsage, entry.trackKey);
      if (!detail) return '';
      return `<template data-track-detail-template="${esc(entry.trackKey)}">${renderTrackDetail(detail, options)}</template>`;
    }).join('')}</div>`
    : '';
  return `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('cupTrackOverview'))}</h2><p>${esc(tr('uniqueRacesBasis', { count: filteredRaceCount }))}</p></div></div><div class="cup-overview-grid">${cupOverview.map((cup) => `<article class="cup-overview-card${topCupLabels.has(cup.cupLabel) ? ' is-top-five' : ''}"><div class="cup-overview-head">${cup.cupImage ? `<img src="${esc(cup.cupImage)}" alt="" loading="lazy" decoding="async" />` : ''}<div><h3>${esc(cup.cupLabel)}</h3><p>${esc(cup.count)} ${esc(tr('picks')).toLowerCase()} · ${esc(formatPercent(cup.percentage))}</p></div></div><div class="track-list">${cup.tracks.map((track) => { const prominence = Math.min(1, track.count / Math.max(filteredRaceCount || 1, 1)); const trackImage = track.image || track.thumb || ''; const trackBackgroundImage = track.backgroundImage || ''; const trackStyle = `--track-prominence:${prominence}${trackBackgroundImage ? `;--track-image:url('${safeCssImageUrl(trackBackgroundImage)}')` : ''}`; if (options.staticExport && !interactiveTrackDetail) return `<div class="track-usage-row track-usage-row-static${track.count === 0 ? ' is-unused' : ''}${topTrackKeys.has(track.trackKey) ? ' is-top-five' : ''}" style="${esc(trackStyle)}"><span class="track-name">${trackImage ? `<img src="${esc(trackImage)}" alt="" loading="lazy" decoding="async" />` : ''}<span>${esc(track.trackLabel)}</span></span><span class="track-stats"><strong>${esc(track.count)}</strong><small>${esc(formatPercent(track.percentage))}</small></span></div>`; return `<button type="button" class="track-usage-row${track.count === 0 ? ' is-unused' : ''}${topTrackKeys.has(track.trackKey) ? ' is-top-five' : ''}${track.trackKey === trackDetail?.trackKey ? ' is-selected' : ''}" data-select-track="${esc(track.trackKey)}" style="${esc(trackStyle)}"><span class="track-name">${trackImage ? `<img src="${esc(trackImage)}" alt="" loading="lazy" decoding="async" />` : ''}<span>${esc(track.trackLabel)}</span></span><span class="track-stats"><strong>${esc(track.count)}</strong><small>${esc(formatPercent(track.percentage))}</small></span></button>`; }).join('')}</div></article>`).join('')}</div>${detailHost}${detailTemplates}</section>`;
}

function renderDeltaSection(derived) {
  return `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('momentumBetweenPlayers'))}</h2><p>${esc(tr('momentumDescription'))}</p></div></div>${createDeltaChart(buildDeltaSeries(derived.comparisonRaceRows, state.compareA, state.compareB), state.compareA, state.compareB)}</section>`;
}

function buildPlayerRecapRows(derived) {
  const finalGroupOrder = { kampioen: 0, talent: 1, wild: 2 };
  const groupRankOffsets = { kampioen: 0, talent: 12, wild: 24 };
  const qualifierOnlyMode = state.groupFilter === GROUP_FILTER_QUALIFIER_ONLY;
  return unique([...derived.filteredFinalRows.map((row) => row.playerName), ...derived.filteredRaceRows.map((row) => row.playerName)]).map((playerName) => {
    const finalStanding = sortStandingRows(derived.filteredFinalRows.filter((row) => row.playerName === playerName && row.phase === 'post'))[0] || null;
    const qualifierStanding = sortStandingRows(derived.filteredFinalRows.filter((row) => row.playerName === playerName && row.phase === 'qualifier'))[0] || null;
    const playerRaceRows = sortRaceRows(derived.filteredRaceRows.filter((row) => row.playerName === playerName));
    const raceCount = playerRaceRows.length;
    const winCount = playerRaceRows.filter((row) => Number(row.position || 99) === 1).length;
    const top3Count = playerRaceRows.filter((row) => Number(row.position || 99) <= 3).length;
    const bestFinish = raceCount ? Math.min(...playerRaceRows.map((row) => Number(row.position || 99))) : null;
    const avgFinish = raceCount ? playerRaceRows.reduce((sum, row) => sum + Number(row.position || 0), 0) / raceCount : null;
    const summaryStanding = qualifierOnlyMode ? qualifierStanding : finalStanding;
    const groupKey = norm(summaryStanding?.groupName || '');
    const groupRank = Number(summaryStanding?.position || 0);
    const overallRank = qualifierOnlyMode
      ? (groupRank || null)
      : (groupRank > 0 ? (groupRankOffsets[groupKey] ?? 0) + groupRank : null);
    const accentColor = chartColor(Math.max(0, groupRank - 1));
    const startRank = Number(summaryStanding?.allTimeRank || 0) > 0 ? Number(summaryStanding.allTimeRank) : null;
    const startSkill = Number.isFinite(Number(summaryStanding?.skillScore)) ? Number(summaryStanding.skillScore) : null;
    const tournamentPlayerCount = Math.max(1, Number(derived.allPlayerOptions?.length || 0));
    return {
      playerName,
      finalStanding,
      qualifierStanding,
      summaryStanding,
      playerRaceRows,
      raceCount,
      winCount,
      top3Count,
      bestFinish,
      avgFinish,
      groupRank,
      overallRank,
      accentColor,
      startRank,
      startSkill,
      tournamentPlayerCount,
    };
  }).filter((row) => row.summaryStanding).sort((left, right) => {
    if (qualifierOnlyMode) {
      if (byText(left.summaryStanding?.groupName, right.summaryStanding?.groupName) !== 0) return byText(left.summaryStanding?.groupName, right.summaryStanding?.groupName);
      if (Number(left.summaryStanding?.position || 999) !== Number(right.summaryStanding?.position || 999)) return Number(left.summaryStanding?.position || 999) - Number(right.summaryStanding?.position || 999);
      return byText(left.playerName, right.playerName);
    }
    const leftGroupWeight = finalGroupOrder[norm(left.summaryStanding?.groupName)] ?? 99;
    const rightGroupWeight = finalGroupOrder[norm(right.summaryStanding?.groupName)] ?? 99;
    if (leftGroupWeight !== rightGroupWeight) return leftGroupWeight - rightGroupWeight;
    if (Number(left.summaryStanding?.position || 999) !== Number(right.summaryStanding?.position || 999)) return Number(left.summaryStanding?.position || 999) - Number(right.summaryStanding?.position || 999);
    return byText(left.playerName, right.playerName);
  });
}

function recapGroupAccent(groupName) {
  const key = norm(groupName || '');
  if (key === 'kampioen') return '#9b5a31';
  if (key === 'talent') return '#275ea8';
  if (key === 'wild') return '#9b5c31';
  return '#275ea8';
}

function groupRankIcon(rank) {
  if (Number(rank) === 1) return '🏆';
  if (Number(rank) === 2) return '🥈';
  if (Number(rank) === 3) return '🥉';
  return '';
}

function recapRankParts(rec) {
  const standing = rec.summaryStanding || null;
  if (!standing) {
    return {
      overallRank: '-',
      groupName: tr('endGroup'),
      groupKey: 'endgroup',
      groupRank: '-',
      icon: '',
      tournamentPlayerCount: Number(rec.tournamentPlayerCount || 0) || '-',
    };
  }
  const groupName = standing.groupName || tr('endGroup');
  const groupKey = norm(groupName || '');
  const overallRank = Number(rec.overallRank || 0) || '-';
  const groupRank = Number(rec.groupRank || 0) || '-';
  const icon = groupRankIcon(groupRank);
  const tournamentPlayerCount = Number(rec.tournamentPlayerCount || 0) || '-';
  return { overallRank, groupName, groupKey, groupRank, icon, tournamentPlayerCount };
}

function renderRecapMetaRow(rec) {
  const parts = recapRankParts(rec);
  const overallRank = `Rank #${esc(parts.overallRank)} <small>out of #${esc(parts.tournamentPlayerCount)}</small>`;
  const groupRank = `${esc(parts.groupName)} #${esc(parts.groupRank)}${parts.icon ? ` <span class="recap-meta-icon">${esc(parts.icon)}</span>` : ''}`;
  return `<div class="recap-meta-row"><div class="recap-meta-line">${overallRank} | ${groupRank}</div></div>`;
}

function recapSeedMetaLabel(rec) {
  const hasSkill = Number.isFinite(Number(rec.startSkill));
  const hasRank = Number(rec.startRank || 0) > 0;
  const skill = hasSkill ? formatNumber(Number(rec.startSkill), 2) : '-';
  const rank = hasRank ? `#${Number(rec.startRank)}` : '#-';
  return `(SkillP ${skill} - ${rank})`;
}

function renderRecapLead(derived) {
  const champion = sortStandingRows(derived.filteredFinalRows.filter((row) => row.phase === 'post'))[0] || null;
  const mostPlayedTrack = derived.trackUsage[0] || null;
  const mostPlayedCup = derived.cupUsage[0] || null;
  const parts = [
    champion ? tr('leadChampion', { player: champion.playerName, points: champion.totalPoints }) : tr('leadFallback'),
    mostPlayedTrack ? tr('leadTrack', { track: mostPlayedTrack.trackLabel }) : '',
    mostPlayedCup ? tr('leadCup', { cup: mostPlayedCup.cupLabel }) : '',
  ].filter(Boolean);
  return `<section class="section-block recap-lead"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('fixedStoryTitle'))}</h2><p>${esc(tr('fixedStoryDescription'))}</p></div></div><p class="recap-lead-copy">${esc(parts.join(' '))}</p></article></section>`;
}

function buildRecapOpponent(rec, derived) {
  const standing = rec.summaryStanding || null;
  if (!standing) return null;
  const groupRows = sortStandingRows(derived.filteredFinalRows.filter((row) => row.phase === standing.phase && row.groupKey === standing.groupKey));
  if (groupRows.length < 2) return null;
  const currentIndex = groupRows.findIndex((row) => row.playerName === rec.playerName);
  if (currentIndex < 0) return null;
  const opponentIndex = currentIndex === 0 ? 1 : currentIndex - 1;
  const opponentStanding = groupRows[opponentIndex] || null;
  if (!opponentStanding) return null;
  const opponentRank = Number(opponentStanding.position || 0);
  const opponentColor = chartColor(Math.max(0, opponentRank - 1));
  return { opponentStanding, opponentColor, groupRows };
}

function renderRecapGapChart(rec, derived, options = {}) {
  const matchup = buildRecapOpponent(rec, derived);
  if (!matchup) return emptyCard(tr('directRankComparison'), tr('noDirectComparison'));
  const raceRows = derived.filteredRaceRows.filter((row) => row.groupKey === rec.summaryStanding.groupKey && (row.playerName === rec.playerName || row.playerName === matchup.opponentStanding.playerName));
  const deltaSeries = buildDeltaSeries(raceRows, rec.playerName, matchup.opponentStanding.playerName);
  const isLeaderComparison = Number(rec.summaryStanding.position || 0) === 1;
  const description = isLeaderComparison
    ? tr('leaderComparisonDescription', { player: rec.playerName, group: rec.summaryStanding.groupName })
    : tr('followerComparisonDescription', { player: rec.playerName, opponent: matchup.opponentStanding.playerName, group: rec.summaryStanding.groupName });
  const playerRank = Number(rec.summaryStanding?.position || 0) || '-';
  const opponentRank = Number(matchup.opponentStanding?.position || 0) || '-';
  const compactTitle = `#${playerRank} ${rec.playerName} VS #${opponentRank} ${matchup.opponentStanding.playerName}`;
  return createDeltaChart(deltaSeries, rec.playerName, matchup.opponentStanding.playerName, {
    title: compactTitle,
    description,
    exportId: `recap-gap-${slugify(rec.playerName)}`,
    exportLabel: `${rec.playerName}-vs-${matchup.opponentStanding.playerName}-delta`,
    positiveColor: rec.accentColor,
    negativeColor: matchup.opponentColor,
    yMinorStep: 3,
    yMajorStep: 9,
    staticExport: options.staticExport,
    interactiveCharts: options.interactiveCharts,
    emptyTitle: tr('directRankComparison'),
    emptyText: tr('noSharedTotalsPlayers'),
  });
}

function renderPlayerRecap(rec, derived, options = {}) {
  const qualifierOnlyMode = state.groupFilter === GROUP_FILTER_QUALIFIER_ONLY;
  const summaryStanding = rec.summaryStanding || null;
  const histogramGroupKey = summaryStanding?.groupKey || '';
  const playerScope = '__all__';
  const recapText = [
    tr('playerSectionIntro', { player: rec.playerName }),
    qualifierOnlyMode
      ? (rec.qualifierStanding ? tr('qualifierStandingSentence', { group: rec.qualifierStanding.groupName, position: standingLabel(rec.qualifierStanding), points: rec.qualifierStanding.totalPoints }) : tr('noQualifierStandingPlayer'))
      : (rec.finalStanding ? tr('finalStandingSentence', { group: rec.finalStanding.groupName, position: standingLabel(rec.finalStanding), points: rec.finalStanding.totalPoints }) : tr('noFinalStandingPlayer')),
    rec.raceCount ? tr('playerRaceSummary', { races: rec.raceCount, wins: rec.winCount, top3: rec.top3Count }) : tr('noRaceFramesPlayer'),
  ].filter(Boolean).join(' ');
  const winRate = rec.raceCount > 0 ? (rec.winCount / rec.raceCount) * 100 : 0;
  const top3Rate = rec.raceCount > 0 ? (rec.top3Count / rec.raceCount) * 100 : 0;
  const facts = [
    [qualifierOnlyMode ? tr('qualifierGroup') : tr('endGroup'), summaryStanding ? `${summaryStanding.groupName} · ${standingLabel(summaryStanding)}` : '-'],
    [tr('pointsLabel'), summaryStanding ? summaryStanding.totalPoints : '-'],
    [tr('racesLabel'), rec.raceCount],
    [tr('wins'), `${rec.winCount} (${formatPercent(winRate)})`],
    [tr('top3'), `${rec.top3Count} (${formatPercent(top3Rate)})`],
    [tr('bestFinish'), rec.bestFinish == null || rec.bestFinish === 99 ? '-' : rec.bestFinish],
    [tr('avgFinishLabel'), rec.avgFinish == null ? '-' : formatNumber(rec.avgFinish, 2)],
  ];
  const summaryTable = table([tr('keyLabel'), tr('valueLabel')], facts.map(([label, value]) => `<tr><td>${esc(label)}</td><td>${esc(value)}</td></tr>`), 'recap-player-facts');
  const playerColors = { [rec.playerName]: rec.accentColor };
  const benchmarkRaceRows = derived.filteredRaceRows.filter((row) => rec.playerRaceRows.some((playerRow) => playerRow.raceSlotKey === row.raceSlotKey));
  const analysis = renderParticipantAnalysisPanel(rec.playerRaceRows, rec.playerName, [rec.playerName], playerScope, { title: tr('raceProgressOf', { player: rec.playerName }), description: tr('allPlayerCharts'), hideSectionHead: true, exportPrefix: `recap-${slugify(rec.playerName)}`, playerColors, benchmarkRaceRows, staticExport: options.staticExport, interactiveCharts: options.interactiveCharts });
  const characterTable = renderPlayerCharacterTable(rec.playerName, rec.playerRaceRows);
  const gapChart = renderRecapGapChart(rec, derived, options);
  const histogram = histogramGroupKey
    ? renderHistogramPanel(rec.playerRaceRows, [summaryStanding].filter(Boolean), histogramGroupKey, [rec.playerName], { hideHeading: true, chartTitle: tr('positionDistribution'), exportPrefix: `recap-hist-${slugify(rec.playerName)}`, playerColors })
    : emptyCard(tr('positionDistribution'), tr('noGroupForPlayerHistogram'));
  return `<section class="section-block recap-player-section" id="${esc(`speler-${slugify(rec.playerName)}`)}" data-recap-group="${esc(norm(summaryStanding?.groupName || ''))}" style="--recap-accent:${esc(rec.accentColor)}"><article class="panel-card recap-player-shell"><div class="recap-player-shell-grid"><article class="panel-card recap-player-intro"><div class="recap-intro-head-block"><div class="section-head"><div>${renderRecapPlayerHeading(rec)}${renderRecapMetaRow(rec)}${renderPlayerKpiLine(rec)}</div></div></div><div class="recap-intro-summary-block"><h3 class="recap-summary-title">${esc(tr('summaryTitle'))}</h3><p class="recap-player-copy">${esc(recapText)}</p></div>${summaryTable}</article>${characterTable}${analysis}${gapChart}${histogram}</div></article></section>`;
}

function classicPlayerNoteHtml(playerName) {
  const customization = classicCustomizationState();
  const rawHtml = String(customization.playerNotesByPlayer?.[playerName] || '');
  return sanitizeClientEditableHtml(rawHtml);
}

function renderClassicEditableNoteBlock(target, currentHtml, label, options = {}) {
  const safeHtml = sanitizeClientEditableHtml(currentHtml || '');
  if (!options.classicEditable) {
    return `<div class="classic-inline-edit-view">${safeHtml || '<p></p>'}</div>`;
  }
  const isEditing = state.classicEditingTarget === target;
  const draftValue = String(state.classicEditingDrafts?.[target] ?? currentHtml ?? '');
  if (isEditing) {
    const draftHtml = sanitizeClientEditableHtml(draftValue || '');
    return `<div class="classic-note-editing classic-rich-editor"><label class="classic-inline-edit-label">${esc(label)}</label><div class="classic-rich-editor-surface" contenteditable="true" data-classic-edit-input="${esc(target)}">${draftHtml || '<p><br></p>'}</div>${classicRichToolbar()}<div class="classic-inline-edit-actions"><button type="button" class="analytics-ghost-btn" data-classic-save-target="${esc(target)}">${esc(tr('classicApply'))}</button><button type="button" class="analytics-ghost-btn" data-classic-cancel-target="${esc(target)}">${esc(tr('classicCancel'))}</button></div></div>`;
  }
  return `<div><div class="classic-inline-edit-view">${safeHtml || '<p></p>'}</div><div class="classic-inline-edit-actions"><button type="button" class="analytics-ghost-btn" data-classic-edit-target="${esc(target)}">${esc(tr('classicEdit'))}</button></div></div>`;
}

function renderPlayerKpiLine(rec) {
  const winRate = rec.raceCount > 0 ? (rec.winCount / rec.raceCount) * 100 : 0;
  const top3Rate = rec.raceCount > 0 ? (rec.top3Count / rec.raceCount) * 100 : 0;
  const avgFinish = rec.avgFinish == null ? '-' : formatNumber(rec.avgFinish, 2);
  return `<p class="classic-histogram-summary-line recap-kpi-line"><small>${esc(tr('wins'))}: ${esc(rec.winCount)} (${esc(formatPercent(winRate))}) | ${esc(tr('top3'))}: ${esc(rec.top3Count)} (${esc(formatPercent(top3Rate))}) | ${esc(tr('avgPosLabel'))}: ${esc(avgFinish)}</small></p>`;
}

function renderClassicPlayerHistogramSummary(rec) {
  return renderPlayerKpiLine(rec);
}

function renderClassicPlayerRecap(rec, derived, options = {}) {
  const summaryStanding = rec.summaryStanding || null;
  const histogramGroupKey = summaryStanding?.groupKey || '';
  const playerScope = '__all__';
  const playerColors = { [rec.playerName]: rec.accentColor };
  const benchmarkRaceRows = derived.filteredRaceRows.filter((row) => rec.playerRaceRows.some((playerRow) => playerRow.raceSlotKey === row.raceSlotKey));
  const noteHtml = classicPlayerNoteHtml(rec.playerName);
  const analysis = renderParticipantAnalysisPanel(rec.playerRaceRows, rec.playerName, [rec.playerName], playerScope, {
    title: tr('raceProgressOf', { player: rec.playerName }),
    description: tr('allPlayerCharts'),
    hideSectionHead: true,
    exportPrefix: `recap-${slugify(rec.playerName)}`,
    playerColors,
    benchmarkRaceRows,
    staticExport: options.staticExport,
    interactiveCharts: options.interactiveCharts,
    showTotalAfterRaceChart: classicVisibilityValue('showTotalAfterRaceChart'),
  });
  const histogram = histogramGroupKey
    ? renderHistogramPanel(rec.playerRaceRows, [summaryStanding].filter(Boolean), histogramGroupKey, [rec.playerName], {
      hideHeading: true,
      chartTitle: tr('positionDistribution'),
      exportPrefix: `recap-hist-${slugify(rec.playerName)}`,
      playerColors,
      showTable: classicVisibilityValue('showPositionDistributionTable'),
      staticExport: options.staticExport,
      interactiveCharts: options.interactiveCharts,
    })
    : emptyCard(tr('positionDistribution'), tr('noGroupForPlayerHistogram'));
  const gapChart = renderRecapGapChart(rec, derived, options);
  const returnTarget = standingAnchorId(summaryStanding?.groupKey || '', rec.playerName);
  return `<section class="section-block recap-player-section" id="${esc(`speler-${slugify(rec.playerName)}`)}" data-recap-group="${esc(norm(summaryStanding?.groupName || ''))}" style="--recap-accent:${esc(rec.accentColor)}"><article class="panel-card recap-player-shell"><div class="recap-player-shell-grid"><article class="panel-card recap-player-intro"><div class="recap-intro-head-block"><div class="section-head"><div>${renderRecapPlayerHeading(rec)}${renderRecapMetaRow(rec)}${renderPlayerKpiLine(rec)}</div></div></div><div class="recap-intro-summary-block"><h3 class="recap-summary-title">${esc(tr('summaryTitle'))}</h3><div class="recap-player-copy classic-player-note">${renderClassicEditableNoteBlock(classicEditTargetForPlayer(rec.playerName), noteHtml, tr('classicPlayerNoteLabel', { player: rec.playerName }), { classicEditable: options.classicEditable, rows: 4 })}</div></div></article>${analysis}${gapChart}${histogram}<div class="recap-player-return"><a class="analytics-backlink classic-return-link" style="--recap-accent:${esc(rec.accentColor)}" href="#${esc(returnTarget)}">${esc(tr('classicReturnToStandings'))}</a></div></div></article></section>`;
}

function renderClassicTopTracksSection(derived, options = {}) {
  const customization = classicCustomizationState();
  const introHtml = sanitizeClientEditableHtml(customization.topTracksIntroHtml || '');
  return `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('classicTopTracksHeader'))}</h2></div></div><div class="panel-card classic-note-block">${renderClassicEditableNoteBlock('topTracksIntro', introHtml, tr('classicTopTracksIntroLabel'), { classicEditable: options.classicEditable, rows: 4 })}</div><article class="panel-card">${renderTopFiveList(derived.trackUsage, 'track', { staticExport: true, trackBackgroundRows: true })}</article></section>`;
}

function renderClassicIntroSection(options = {}) {
  const introHtml = sanitizeClientEditableHtml(classicCustomizationState().introHtml || '');
  return `<section class="section-block"><article class="panel-card"><div class="section-head"><div><h2><strong>${esc(classicExportTitle())}</strong></h2></div></div><div class="panel-card classic-note-block">${renderClassicEditableNoteBlock('intro', introHtml, tr('classicIntroLabel'), { classicEditable: options.classicEditable, rows: 5 })}</div></article></section>`;
}

function renderClassicRecapContent(derived, trackDetail, options = {}) {
  const players = buildPlayerRecapRows(derived);
  const qualifierOnlyMode = state.groupFilter === GROUP_FILTER_QUALIFIER_ONLY;
  const standingsSection = qualifierOnlyMode
    ? renderQualifierStandings(derived.qualifierGroups, { hideSectionHeader: true, linkPlayerToRecap: true, includeAnchors: true })
    : renderEndStandings(derived.endGroups, { hideSectionHeader: true, linkPlayerToRecap: true, includeAnchors: true });
  const recapGroups = qualifierOnlyMode ? derived.qualifierGroups : derived.endGroups;
  const playerSections = recapGroups.map((group) => {
    const rows = players.filter((player) => player.summaryStanding?.groupKey === group.groupKey);
    if (!rows.length) return '';
    const groupKey = norm(group.groupName || '');
    const accent = recapGroupAccent(group.groupName);
    return `<section class="section-block recap-group-section classic-recap-group-section" data-recap-group="${esc(groupKey)}" style="--recap-group-accent:${esc(accent)}"><div class="section-head"><div><h2>${esc(group.groupName)}</h2><p><span class="group-tag group-tag-${esc(groupKey)}">${esc(group.groupName)}</span> · ${esc(tr('playersCount', { count: group.rows.length }))}</p></div></div>${rows.map((player) => renderClassicPlayerRecap(player, derived, options)).join('')}</section>`;
  }).join('');
  const topCupsSection = classicVisibilityValue('showTopCups')
    ? `<section class="section-block"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('top5Cups'))}</h2></div></div>${renderTopFiveList(derived.cupUsage, 'cup', { staticExport: true })}</article></section>`
    : '';
  const cupOverviewSection = classicVisibilityValue('showCupTrackOverview')
    ? renderCupOverview(derived.cupOverview, trackDetail, derived.filteredRaceCount, { ...options, trackUsage: derived.trackUsage, showTrackDetail: classicVisibilityValue('showTrackDetail'), interactiveTrackDetail: classicVisibilityValue('showTrackDetail') })
    : '';
  const characterHubSection = classicVisibilityValue('showCharacterHub')
    ? `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('characterHubTitle'))}</h2><p>${esc(tr('personagehubDescription'))}</p></div></div>${renderCharacterHub(derived.rosterUsage)}</section>`
    : '';
  return [
    options.classicEditable ? renderClassicIntroSection(options) : '',
    standingsSection,
    renderClassicTopTracksSection(derived, options),
    topCupsSection,
    cupOverviewSection,
    characterHubSection,
    playerSections,
  ].join('');
}

function renderRecapContent(derived, trackDetail, options = {}) {
  if (options.classicMode) {
    return renderClassicRecapContent(derived, trackDetail, options);
  }
  const players = buildPlayerRecapRows(derived);
  const groupRanges = { kampioen: 'Rank 1 - 12', talent: 'Rank 13 - 24', wild: 'Rank 25 - 36' };
  const playerNav = players.length ? `<section class="section-block recap-player-nav"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('playerIndex'))}</h2><p>${esc(tr('jumpToPlayerRecap'))}</p></div></div><div class="recap-chip-row">${players.map((player) => `<a class="recap-chip" style="--recap-accent:${esc(player.accentColor)}" href="#${esc(`speler-${slugify(player.playerName)}`)}">${esc(player.playerName)}</a>`).join('')}</div></article></section>` : '';
  const qualifierOnlyMode = state.groupFilter === GROUP_FILTER_QUALIFIER_ONLY;
  const recapGroups = qualifierOnlyMode ? derived.qualifierGroups : derived.endGroups;
  const playerSections = recapGroups.map((group) => {
    const rows = players.filter((player) => player.summaryStanding?.groupKey === group.groupKey);
    if (!rows.length) return '';
    return `<section class="section-block recap-group-section" data-recap-group="${esc(norm(group.groupName))}"><div class="section-head"><div><h2>${esc(group.groupName)}</h2><p>${esc(qualifierOnlyMode ? tr('playersCount', { count: group.rows.length }) : (groupRanges[norm(group.groupName)] || tr('playersCount', { count: group.rows.length })))}</p></div></div>${rows.map((player) => renderPlayerRecap(player, derived, options)).join('')}</section>`;
  }).join('');
  return [
    renderRecapLead(derived),
    qualifierOnlyMode ? renderQualifierStandings(derived.qualifierGroups) : renderEndStandings(derived.endGroups),
    renderTopSection(derived, options),
    renderCupOverview(derived.cupOverview, trackDetail, derived.filteredRaceCount, { ...options, trackUsage: derived.trackUsage }),
    `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('characterHubTitle'))}</h2><p>${esc(tr('personagehubDescription'))}</p></div></div>${renderCharacterHub(derived.rosterUsage)}</section>`,
    playerNav,
    playerSections,
    derived.renderMomentumSection === false ? '' : renderDeltaSection(derived),
    derived.renderComparisonSection === false ? '' : renderComparison(derived),
  ].join('');
}

function stripExportOnlyButtons(html) {
  return String(html || '')
    .replace(/<button[^>]*class="analytics-ghost-btn chart-download-btn"[\s\S]*?<\/button>/g, '')
    .replace(/<button[^>]*class="audio-chip[\s\S]*?<\/button>/g, '');
}

function getEmbeddedSourceText(id, globalKey) {
  const node = qs(id);
  if (node && typeof node.textContent === 'string' && node.textContent) return node.textContent;
  if (typeof window !== 'undefined' && typeof window[globalKey] === 'string') return window[globalKey];
  return '';
}

function getClassicExportCss() {
  return getEmbeddedSourceText('classicExportCssSource', '__CLASSIC_EXPORT_CSS__');
}

  function encodeBase64Utf8(value) {
    const source = String(value || '');
    if (!source) return '';
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(source)));
    if (typeof Buffer !== 'undefined') return Buffer.from(source, 'utf8').toString('base64');
    return '';
  }

  function getClassicTemplateHtml() {
    return getEmbeddedSourceText('classicTemplateSource', '__CLASSIC_EXPORT_TEMPLATE__');
  }

  function getClassicExportRuntimeJs() {
    const raceLabel = esc(tr('race'));
    const noDataPoint = esc(tr('noDataPoint'));
    const placeSuffix = esc(tr('placeSuffix'));
    const pointsLabel = esc(tr('points'));
    const runtimeRaw = `(function(){
      var RACE_LABEL=${JSON.stringify(raceLabel)};
      var NO_DATA=${JSON.stringify(noDataPoint)};
      var PLACE_SUFFIX=${JSON.stringify(placeSuffix)};
      var POINTS_LABEL=${JSON.stringify(pointsLabel)};
      var POSITION_DISTRIBUTION=${JSON.stringify(tr('positionDistribution'))};
      var POSITION_AFTER_RACE=${JSON.stringify(tr('positionAfterRace'))};
      var FINISH_POSITION_PER_RACE=${JSON.stringify(tr('finishPositionPerRace'))};
      function parseChartPayload(node){
        if(!node||!node.dataset||!node.dataset.chartPoints) return [];
        try {
          var parsed=JSON.parse(decodeURIComponent(node.dataset.chartPoints));
          if(Array.isArray(parsed)) return parsed;
          if(parsed&&parsed.c===1&&Array.isArray(parsed.s)&&Array.isArray(parsed.e)){
            var strings=parsed.s;
            var decodeRef=function(value){
              return (Number.isInteger(value)&&value>=0&&value<strings.length)?String(strings[value]||''):'';
            };
            var decodeMeta=function(value){
              if(Array.isArray(value)){
                return { rankIndex:Number(value[0]||0), benchmarkPlayer:decodeRef(value[1]), benchmarkTotal:value[2], playerTotal:value[3] };
              }
              return (value&&typeof value==='object')?value:{};
            };
            return parsed.e.map(function(entryRaw){
              if(!Array.isArray(entryRaw)) return null;
              var valuesRaw=Array.isArray(entryRaw[6])?entryRaw[6]:[];
              var values=valuesRaw.map(function(valueRaw){
                if(!Array.isArray(valueRaw)) return null;
                var linesRaw=Array.isArray(valueRaw[4])?valueRaw[4]:[];
                return {
                  label:decodeRef(valueRaw[0]),
                  color:decodeRef(valueRaw[1]),
                  value:valueRaw[2],
                  display:decodeRef(valueRaw[3]),
                  lines:linesRaw.map(function(lineRef){return decodeRef(lineRef);}).filter(function(line){return line!=='';}),
                  meta:decodeMeta(valueRaw[5])
                };
              }).filter(Boolean);
              return {
                index:Number.isFinite(Number(entryRaw[0]))?Number(entryRaw[0]):0,
                raceNumber:Number.isFinite(Number(entryRaw[1]))?Number(entryRaw[1]):0,
                x:Number.isFinite(Number(entryRaw[2]))?Number(entryRaw[2]):0,
                label:decodeRef(entryRaw[3]),
                title:decodeRef(entryRaw[4]),
                mode:decodeRef(entryRaw[5]),
                values:values
              };
            }).filter(Boolean);
          }
          return [];
        } catch(_){ return []; }
      }
      function escHtml(value){
        return String(value==null?'':value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
      }
      function renderValues(values, includeDetails, forceCompact, mode){
        var list=Array.isArray(values)?values:[];
        var compactMode=!!forceCompact || !includeDetails;
        var colspan=(mode==='place-track'?2:(mode==='benchmark-delta'?2:(compactMode?2:3)));
        if(!list.length) return '<tr><td colspan="'+colspan+'" class="mk-chart-readout-empty">'+NO_DATA+'</td></tr>';
        return list.map(function(item){
          var lines=Array.isArray(item&&item.lines)?item.lines.filter(function(line){return String(line||'').trim();}):[];
          var details=lines.length?lines.map(function(line){return escHtml(line);}).join('<br>'):'';
          var value=lines.length?'-':escHtml(item&&item.display||'-');
          if(mode==='place-track'){
            var displayRaw=String(item&&item.display||'').trim();
            var rawValue=Number(item&&item.value||0);
            var fallbackPlace=(Number.isFinite(rawValue) && rawValue>0) ? (String(Math.floor(rawValue))+' '+PLACE_SUFFIX) : '-';
            var placeText=(displayRaw && displayRaw!=='-') ? displayRaw : fallbackPlace;
            var trackName=lines[0]?escHtml(lines[0]):'-';
            var extraRows=lines.slice(1).map(function(line){
              return '<tr><td class="mk-chart-readout-track mk-chart-readout-tie" colspan="2">'+escHtml(line)+'</td></tr>';
            }).join('');
            return '<tr><td class="mk-chart-readout-place">'+escHtml(placeText)+'</td><td class="mk-chart-readout-track">'+trackName+'</td></tr>'+extraRows;
          }
          if(mode==='benchmark-delta'){
            var meta=item&&item.meta||{};
            var numeric=Number(item&&item.value||0);
            var sign=numeric>0?'+':'';
            var rankIndex=Number(meta&&meta.rankIndex||0);
            var targetName=String(meta&&meta.benchmarkPlayer||'-');
            var benchmarkTotal=(isFinite(Number(meta&&meta.benchmarkTotal))?String(Math.round(Number(meta.benchmarkTotal))):'-');
            var playerTotal=(isFinite(Number(meta&&meta.playerTotal))?String(Math.round(Number(meta.playerTotal))):'-');
            var summaryClass=numeric===0?(' mk-benchmark-tie mk-benchmark-tie-'+String(Math.max(1,rankIndex+1))):'';
            return '<tr class="mk-benchmark-row'+summaryClass+'"><td class="mk-benchmark-col mk-benchmark-col-label">'+escHtml(item&&item.label||'')+'</td><td class="mk-benchmark-pack-cell"><div class="mk-benchmark-pack"><span class="mk-benchmark-col mk-benchmark-col-name">'+escHtml(targetName)+'</span><span class="mk-benchmark-col mk-benchmark-col-score">'+escHtml(benchmarkTotal)+'</span><span class="mk-benchmark-col mk-benchmark-col-vs">vs</span><span class="mk-benchmark-col mk-benchmark-col-score">'+escHtml(playerTotal)+'</span><span class="mk-benchmark-col mk-benchmark-col-delta">'+escHtml(sign+String(Math.round(numeric)))+'</span><span class="mk-benchmark-col mk-benchmark-col-points">pts</span></div></td></tr>';
          }
          if(compactMode){
            var compactValue=lines.length?details:value;
            var wrappedValue=lines.length?('<span class="mk-chart-readout-track-lines">'+compactValue+'</span>'):compactValue;
            return '<tr><td><span class="mk-chart-readout-key"><i style="background:'+escHtml(item&&item.color||'')+'"></i>'+escHtml(item&&item.label||'')+'</span></td><td>'+wrappedValue+'</td></tr>';
          }
          return '<tr><td><span class="mk-chart-readout-key"><i style="background:'+escHtml(item&&item.color||'')+'"></i>'+escHtml(item&&item.label||'')+'</span></td><td>'+value+'</td><td class="mk-chart-readout-details">'+(details||'-')+'</td></tr>';
        }).join('');
      }
      function renderReadout(entry){
        if(!entry) return '';
        var head='<div class="mk-chart-readout-head"><strong>'+RACE_LABEL+' '+escHtml(entry.raceNumber||'')+'</strong>'+(entry.label?'<span>'+escHtml(entry.label)+'</span>':'')+'</div>';
        var list=Array.isArray(entry.values)?entry.values:[];
        var includeDetails=list.some(function(item){return Array.isArray(item&&item.lines) && item.lines.some(function(line){return String(line||'').trim();});});
        var forceCompact=String(entry&&entry.title||'')===String(POSITION_DISTRIBUTION);
        var placeTrackMode=String(entry&&entry.mode||'')==='place-track'
          || String(entry&&entry.title||'')===String(POSITION_AFTER_RACE)
          || String(entry&&entry.title||'')===String(FINISH_POSITION_PER_RACE);
        var benchmarkMode=String(entry&&entry.mode||'')==='benchmark-delta';
        var deltaPointsMode=String(entry&&entry.mode||'')==='delta-points';
        var tableClass='mk-chart-readout-table'+(forceCompact?' is-compact':'')+(forceCompact?' is-position-distribution':'')+(placeTrackMode?' is-place-track':'')+(benchmarkMode?' is-benchmark-delta':'')+(deltaPointsMode?' is-delta-points':'');
        return head+'<div class="mk-table-scroll"><table class="'+tableClass+'"><tbody>'+renderValues(list,includeDetails,forceCompact,benchmarkMode?'benchmark-delta':(placeTrackMode?'place-track':'default'))+'</tbody></table></div>';
      }
      function setEntry(shell, entry, index){
        if(!shell||!entry) return;
        var hoverLine=shell.querySelector('.chart-hover-line');
        if(hoverLine){
          hoverLine.removeAttribute('hidden');
          hoverLine.setAttribute('x1', entry.x);
          hoverLine.setAttribute('x2', entry.x);
        }
        if(shell._mkScrubberInput && Number.isFinite(index)){
          shell._mkScrubberInput.value=String(index);
        }
        var readout=shell.parentElement&&shell.parentElement.querySelector? shell.parentElement.querySelector('.mk-chart-readout'):null;
        if(readout){
          readout.innerHTML=renderReadout(entry);
        }
      }
      function hideHover(shell){
        if(!shell) return;
        if(shell._mkScrubberInput) return;
        var hoverLine=shell.querySelector('.chart-hover-line');
        if(hoverLine) hoverLine.setAttribute('hidden','hidden');
      }
      function syncScrubberWidth(shell, host){
        if(!shell||!host) return;
        var svg=shell.querySelector? shell.querySelector('svg'):null;
        var edgeExpandPx=8;
        if(!svg||!svg.getBoundingClientRect){
          host.style.width='100%';
          host.style.maxWidth='100%';
          host.style.marginLeft='0';
          host.style.marginRight='0';
          return;
        }
        var shellRect=shell.getBoundingClientRect?shell.getBoundingClientRect():null;
        var svgRect=svg.getBoundingClientRect?svg.getBoundingClientRect():null;
        var payload=parseChartPayload(shell);
        var xValues=payload.map(function(entry){ return Number(entry&&entry.x); }).filter(function(v){ return isFinite(v); }).sort(function(a,b){return a-b;});
        var vb=svg.viewBox&&svg.viewBox.baseVal?svg.viewBox.baseVal:null;
        if(xValues.length>=2 && vb && isFinite(vb.width) && vb.width>0){
          var payloadMin=xValues[0], payloadMax=xValues[xValues.length-1];
          if(isFinite(payloadMin) && isFinite(payloadMax) && payloadMax>payloadMin){
            var payloadScale=((svgRect&&svgRect.width)||0)/vb.width;
            var payloadOffset=Math.max(0,Math.round((payloadMin-vb.x)*payloadScale));
            var payloadWidth=Math.max(0,Math.round((payloadMax-payloadMin)*payloadScale));
            var shellWidth2=Math.round((shellRect&&shellRect.width)||payloadWidth||0);
            var expandedOffset=Math.max(0,payloadOffset-edgeExpandPx);
            var expandedWidth=Math.min(shellWidth2,Math.max(0,payloadWidth+(edgeExpandPx*2)));
            host.style.width=(expandedWidth>0?String(expandedWidth)+'px':'100%');
            host.style.marginLeft=String(Math.min(expandedOffset,Math.max(0,shellWidth2-(expandedWidth||0))))+'px';
            host.style.marginRight='0';
            host.style.maxWidth='100%';
            return;
          }
        }
        var labels=svg.querySelectorAll?svg.querySelectorAll('.chart-x-labels text'):[];
        var minX=null,maxX=null;
        Array.prototype.forEach.call(labels,function(node){
          var xa=Number(node&&node.getAttribute?node.getAttribute('x'):NaN);
          if(isFinite(xa)){
            minX=minX==null?xa:Math.min(minX,xa);
            maxX=maxX==null?xa:Math.max(maxX,xa);
            return;
          }
          try{
            var box=node&&node.getBBox?node.getBBox():null;
            if(box&&isFinite(box.x)&&isFinite(box.width)){
              var left=box.x,right=box.x+box.width;
              minX=minX==null?left:Math.min(minX,left);
              maxX=maxX==null?right:Math.max(maxX,right);
            }
          }catch(_){}
        });
        var canRange=(isFinite(minX)&&isFinite(maxX)&&maxX>minX&&vb&&isFinite(vb.width)&&vb.width>0);
        if(canRange){
          var scaleX=((svgRect&&svgRect.width)||0)/vb.width;
          var offsetPx=Math.max(0,Math.round((minX-vb.x)*scaleX));
          var widthPx=Math.max(0,Math.round((maxX-minX)*scaleX));
          var shellWidth=Math.round((shellRect&&shellRect.width)||widthPx||0);
          var expandedOffset2=Math.max(0,offsetPx-edgeExpandPx);
          var expandedWidth2=Math.min(shellWidth,Math.max(0,widthPx+(edgeExpandPx*2)));
          host.style.width=(expandedWidth2>0?String(expandedWidth2)+'px':'100%');
          host.style.marginLeft=String(Math.min(expandedOffset2,Math.max(0,shellWidth-(expandedWidth2||0))))+'px';
          host.style.marginRight='0';
          host.style.maxWidth='100%';
          return;
        }
        var targetWidth=Math.round(Math.max(0, Math.min((svgRect&&svgRect.width)||0, (shellRect&&shellRect.width)||((svgRect&&svgRect.width)||0))));
        host.style.width=(targetWidth>0?String(targetWidth)+'px':'100%');
        host.style.maxWidth='100%';
        host.style.marginLeft='0';
        host.style.marginRight='0';
      }
      function initScrubber(shell){
        if(!shell || shell.dataset.scrubberReady==='1') return;
        var points=parseChartPayload(shell);
        if(!points.length) return;
        shell.dataset.scrubberReady='1';
        var host=document.createElement('div');
        host.className='mk-chart-scrubber-wrap';
        var input=document.createElement('input');
        input.type='range';
        input.min='0';
        input.max=String(points.length-1);
        var stepRaw=Number(shell&&shell.dataset&&shell.dataset.chartStep||1);
        var stepValue=(isFinite(stepRaw)&&stepRaw>0)?stepRaw:1;
        input.step=String(stepValue);
        input.value='0';
        input.className='mk-chart-scrubber';
        var readout=document.createElement('div');
        readout.className='mk-chart-readout';
        host.appendChild(input);
        host.appendChild(readout);
        if(shell.parentElement){ shell.parentElement.appendChild(host); }
        syncScrubberWidth(shell, host);
        shell._mkScrubberInput=input;
        var update=function(indexValue){
          var idx=Math.max(0,Math.min(points.length-1,Number(indexValue)||0));
          input.value=String(idx);
          setEntry(shell, points[idx], idx);
        };
        input.addEventListener('input', function(){ update(input.value); });
        input.addEventListener('change', function(){ update(input.value); });
        update(0);
      }
      function extractContextItems(root){
        if(!root || typeof root.querySelectorAll!=='function') return [];
        var items=[];
        Array.prototype.forEach.call(root.querySelectorAll('.standings-grid > article.panel-card'),function(card){
          var title=(card.querySelector('.standings-group-title')&&card.querySelector('.standings-group-title').textContent||'').trim();
          if(!title) return;
          var subtitle=(card.querySelector('.section-head p')&&card.querySelector('.section-head p').textContent||'').trim();
          items.push({el:card,title:title,subtitle:subtitle});
        });
        Array.prototype.forEach.call(root.querySelectorAll('.section-block'),function(block){
          if(block.classList&&block.classList.contains('recap-player-section')) return;
          var heading=(block.querySelector('.section-head h2')&&block.querySelector('.section-head h2').textContent||block.querySelector('.section-head h3')&&block.querySelector('.section-head h3').textContent||'').trim();
          if(!heading || !/top\\s*5/i.test(heading)) return;
          items.push({el:block,title:heading,subtitle:''});
        });
        Array.prototype.forEach.call(root.querySelectorAll('.recap-player-section'),function(section){
          var titleNode=section.querySelector('.recap-player-intro .section-head h2');
          var title=(titleNode&&titleNode.textContent||'').trim();
          if(!title) return;
          var lineNode=section.querySelector('.recap-meta-row .recap-meta-line');
          var line=(lineNode&&lineNode.textContent||'').trim();
          items.push({el:section,title:title,subtitle:line,titleHtml:String(titleNode&&titleNode.innerHTML||''),subtitleHtml:String(lineNode&&lineNode.innerHTML||'')});
        });
        return items;
      }
      function initContextBar(){
        var tournamentRoot=document.querySelector('.mk-tournament');
        var topbarRoot=document.querySelector('.mk-topbar');
        if(!tournamentRoot || !topbarRoot) return;
        var items=extractContextItems(tournamentRoot);
        if(!items.length) return;
        var existing=document.getElementById('storyContextBar');
        if(existing&&existing.parentElement) existing.parentElement.removeChild(existing);
        var bar=document.createElement('div');
        bar.id='storyContextBar';
        bar.className='story-context-bar';
        bar.innerHTML='<strong class="story-context-title"></strong><span class="story-context-subtitle"></span>';
        topbarRoot.innerHTML='';
        topbarRoot.appendChild(bar);
        var titleNode=bar.querySelector('.story-context-title');
        var subtitleNode=bar.querySelector('.story-context-subtitle');
        function applyContextOffset(){
          var offset=Math.ceil(bar.getBoundingClientRect().height||0)+12;
          if(tournamentRoot && tournamentRoot.style && tournamentRoot.style.setProperty) tournamentRoot.style.setProperty('--story-context-offset',String(offset)+'px');
        }
        var activeKey='';
        function setActive(item){
          if(!item) return;
          var key=(item.title||'')+'__'+(item.subtitle||'');
          if(key===activeKey) return;
          activeKey=key;
          if(titleNode) titleNode.innerHTML=item.titleHtml||escHtml(item.title||'');
          if(subtitleNode){ subtitleNode.innerHTML=item.subtitleHtml||escHtml(item.subtitle||''); subtitleNode.style.display=item.subtitle?'':'none'; }
        }
        var ticking=false;
        function update(){
          ticking=false;
          applyContextOffset();
          var topOffset=(bar.getBoundingClientRect().height||38)+8;
          var activeProbeY=topOffset+18;
          var current=items[0];
          var lastAbove=null;
          var firstBelow=null;
          items.forEach(function(item){
            var rect=item.el&&item.el.getBoundingClientRect?item.el.getBoundingClientRect():null;
            if(!rect || !isFinite(rect.top) || !isFinite(rect.bottom)) return;
            if(rect.top<=activeProbeY && rect.bottom>activeProbeY){ current=item; firstBelow=null; lastAbove=null; return; }
            if(rect.bottom<=activeProbeY) lastAbove=item; else if(!firstBelow) firstBelow=item;
          });
          if(lastAbove && current===items[0]) current=lastAbove;
          if(firstBelow && !lastAbove && current===items[0]) current=firstBelow;
          setActive(current);
        }
        function onScroll(){ if(ticking) return; ticking=true; (window.requestAnimationFrame||function(cb){return setTimeout(cb,16);})(update); }
        window.addEventListener('scroll',onScroll,{passive:true});
        window.addEventListener('resize',onScroll);
        applyContextOffset();
        update();
      }
      function syncTrackSelection(trackKey){
        Array.prototype.forEach.call(document.querySelectorAll('[data-select-track]'),function(node){
          var active=node&&node.dataset&&node.dataset.selectTrack===trackKey;
          if(node.classList&&node.classList.toggle) node.classList.toggle('is-selected',!!active);
        });
      }
      function updateTrackDetail(trackKey){
        if(!trackKey) return;
        var host=document.querySelector('[data-track-detail-host]');
        var template=document.querySelector('[data-track-detail-template="'+String(trackKey).replace(/"/g,'\\\\\\"')+'"]');
        if(!host||!template) return;
        host.innerHTML=template.innerHTML;
        syncTrackSelection(trackKey);
      }
      Array.prototype.forEach.call(document.querySelectorAll('.interactive-chart'), initScrubber);
      window.addEventListener('resize', function(){
        Array.prototype.forEach.call(document.querySelectorAll('.interactive-chart'), function(shell){
          var host=shell&&shell.parentElement&&shell.parentElement.querySelector? shell.parentElement.querySelector('.mk-chart-scrubber-wrap'):null;
          if(host) syncScrubberWidth(shell, host);
        });
      });
      initContextBar();
      var hoverLock=null;
      function resolveHoverEvent(event){
        var zone=event&&event.target&&event.target.closest?event.target.closest('[data-hover-index]'):null;
        var shell=event&&event.target&&event.target.closest?event.target.closest('[data-chart-shell]'):null;
        if(zone&&shell) return {zone:zone,shell:shell};
        var touch=(event&&event.touches&&event.touches[0])||(event&&event.changedTouches&&event.changedTouches[0])||null;
        if(!touch||typeof document.elementFromPoint!=='function') return {zone:null,shell:null};
        var node=document.elementFromPoint(touch.clientX, touch.clientY);
        if(!node||!node.closest) return {zone:null,shell:null};
        return { zone: node.closest('[data-hover-index]'), shell: node.closest('[data-chart-shell]') };
      }
      function clearHoverLock(){
        if(!hoverLock) return;
        Array.prototype.forEach.call(document.querySelectorAll('.interactive-chart'), function(node){ hideHover(node); });
        hoverLock=null;
      }
      function showHoverEntry(shell, zone){
        if(!shell||!zone) return;
        var points=parseChartPayload(shell);
        var index=Number(zone.getAttribute('data-hover-index'));
        var entry=points[index]||null;
        if(entry) setEntry(shell, entry, index);
      }
      function onHoverMove(event){
        var resolved=resolveHoverEvent(event);
        if(hoverLock&&hoverLock.shell){
          if(resolved.zone && resolved.shell===hoverLock.shell){
            var movingIndex=String(resolved.zone.getAttribute('data-hover-index')||'');
            hoverLock.index=movingIndex;
            showHoverEntry(resolved.shell, resolved.zone);
            return;
          }
          var lockedPoints=parseChartPayload(hoverLock.shell);
          var lockedEntry=lockedPoints[Number(hoverLock.index)]||null;
          if(lockedEntry) setEntry(hoverLock.shell, lockedEntry, Number(hoverLock.index));
          return;
        }
        if(!resolved.zone||!resolved.shell) return;
        showHoverEntry(resolved.shell, resolved.zone);
      }
      function onHoverToggle(event){
        var isTouchLike=(event&&String(event.type||'').indexOf('touch')===0) || (!!event&&event.pointerType&&event.pointerType!=='mouse');
        if(!isTouchLike) return;
        var resolved=resolveHoverEvent(event);
        if(!resolved.zone||!resolved.shell){ clearHoverLock(); return; }
        var nextIndex=String(resolved.zone.getAttribute('data-hover-index')||'');
        var same=hoverLock&&hoverLock.shell===resolved.shell&&String(hoverLock.index)===nextIndex;
        if(same){ clearHoverLock(); return; }
        hoverLock={ shell: resolved.shell, index: nextIndex };
        Array.prototype.forEach.call(document.querySelectorAll('.interactive-chart'), function(node){
          if(node!==resolved.shell) hideHover(node);
        });
        showHoverEntry(resolved.shell, resolved.zone);
      }
      document.addEventListener('click',function(event){
        var trackNode=event.target&&event.target.closest?event.target.closest('[data-select-track]'):null;
        if(trackNode&&trackNode.dataset&&trackNode.dataset.selectTrack){
          event.preventDefault();
          updateTrackDetail(trackNode.dataset.selectTrack);
          return;
        }
        var onChart=event.target&&event.target.closest?event.target.closest('[data-chart-shell]'):null;
        if(!onChart && hoverLock) clearHoverLock();
      });
      document.addEventListener('mousemove', onHoverMove);
      document.addEventListener('pointermove', onHoverMove);
      document.addEventListener('pointerdown', onHoverToggle);
      document.addEventListener('mouseleave',function(event){
        var shell=event.target&&event.target.closest?event.target.closest('[data-chart-shell]'):null;
        if(shell && (!hoverLock || hoverLock.shell!==shell)) hideHover(shell);
      }, true);
      document.addEventListener('touchstart', onHoverToggle, {passive:true});
      document.addEventListener('touchmove', onHoverMove, {passive:true});
    })();`;
    // Keep exported WordPress embeds auditable and compatible with strict CSP/WAF rules.
    return runtimeRaw;
  }

  function absolutizeExportAssetReferences(html) {
    const assetBase = configuredExportAssetBaseUrl();
    if (!assetBase) return String(html || '');
    return String(html || '')
      .replace(/(\.\.\/)+(assets\/[^"'()\s]+)/g, (_match, _prefix, assetPath) => joinExportAssetUrl(assetBase, assetPath))
      .replace(/(["'(])\/assets\/([^"'()\s]+)/g, (_match, prefix, relative) => `${prefix}${joinExportAssetUrl(assetBase, `assets/${relative}`)}`);
  }

  function configuredExportAssetBaseUrl() {
    const configuredBase = String(window?.__CLASSIC_EXPORT_ASSET_BASE__ || currentUrlObject().searchParams.get('assetBase') || '').trim();
    if (configuredBase) return configuredBase.replace(/\/+$/, '');
    const origin = currentUrlObject().origin || '';
    return origin ? `${origin}/assets` : '';
  }

  function joinExportAssetUrl(assetBase, assetPath) {
    const relativeAssetPath = String(assetPath || '').replace(/^assets\//, '');
    return `${String(assetBase || '').replace(/\/+$/, '')}/${relativeAssetPath}`;
  }

  function arrayBufferToBase64(buffer) {
    if (typeof Buffer !== 'undefined') return Buffer.from(buffer).toString('base64');
    if (typeof btoa === 'function') {
      let binary = '';
      const bytes = new Uint8Array(buffer);
      const chunkSize = 0x8000;
      for (let index = 0; index < bytes.length; index += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
      }
      return btoa(binary);
    }
    throw new Error('Base64 encoding is not available in this runtime.');
  }

  async function fetchAssetAsDataUrl(url) {
    const cacheKey = String(url || '');
    if (!cacheKey) return '';
    if (exportAssetDataUrlCache.has(cacheKey)) return exportAssetDataUrlCache.get(cacheKey);
    const pending = fetch(cacheKey)
      .then(async (response) => {
        const blob = typeof response.blob === 'function'
          ? await response.blob()
          : new Blob([await response.arrayBuffer()], { type: response.headers?.get?.('content-type') || 'application/octet-stream' });
        const mimeType = blob.type || response.headers?.get?.('content-type') || 'application/octet-stream';
        const buffer = await blob.arrayBuffer();
        return `data:${mimeType};base64,${arrayBufferToBase64(buffer)}`;
      })
      .catch(() => cacheKey);
    exportAssetDataUrlCache.set(cacheKey, pending);
    return pending;
  }

  async function inlineExportAssetReferences(html) {
    const source = String(html || '');
    const assetBase = configuredExportAssetBaseUrl();
    if (!assetBase) return source;
    const escapedAssetBase = assetBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const absolutePattern = new RegExp(`${escapedAssetBase}/[^"'()\\s]+`, 'g');
    const localPattern = /\/assets\/[^"'()\s]+/g;
    const matches = unique([...(source.match(absolutePattern) || []), ...(source.match(localPattern) || []).map((value) => `${assetBase}${value.replace(/^\/assets/, '')}`)]);
    if (!matches.length) return source;
    const replacements = new Map();
    await Promise.all(matches.map(async (match) => {
      replacements.set(match, await fetchAssetAsDataUrl(match));
    }));
    return source
      .replace(absolutePattern, (match) => replacements.get(match) || match)
      .replace(localPattern, (match) => {
        const absolute = `${assetBase}${match.replace(/^\/assets/, '')}`;
        return replacements.get(absolute) || absolute;
      });
  }

function classicExportTitle() {
  const tournament = (state.payload?.availableTournaments || []).find((item) => item.tournamentId === state.scope) || null;
  return tournament?.tournamentName || tr('tournamentRecapTitle');
}

function addClassToken(classValue, classToken) {
  const tokens = unique(String(classValue || '').split(/\s+/).filter(Boolean));
  if (!tokens.includes(classToken)) tokens.push(classToken);
  return tokens.join(' ');
}

function normalizeClassicWordpressPostMarkup(sourceHtml) {
  return String(sourceHtml || '')
    .replace(/class="([^"]*\bsection-block\b[^"]*)"/g, (_match, classValue) => `class="${esc(addClassToken(classValue, 'mk-block'))}"`)
    .replace(/class="([^"]*\btable-wrap\b[^"]*)"/g, (_match, classValue) => `class="${esc(addClassToken(classValue, 'mk-table-scroll'))}"`)
    .replace(/class="([^"]*\bchart-shell\b[^"]*)"/g, (_match, classValue) => `class="${esc(addClassToken(addClassToken(classValue, 'mk-chart'), 'mk-race-chart'))}"`);
}

function getClassicWordpressPostCss() {
  return `
.mk-topbar,
.mk-topbar *,
.mk-topbar *::before,
.mk-topbar *::after { box-sizing: border-box; }

.mk-topbar {
  position:sticky;
  top:0;
  z-index:30;
  width:100%;
  max-width:100%;
  margin:0 0 10px;
  padding:0;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
}

.mk-topbar .story-context-bar{
  position:relative;
  top:auto;
  z-index:1;
  display:grid;
  grid-template-columns:1fr;
  justify-items:center;
  align-items:center;
  gap:2px;
  margin:0;
  padding:6px 10px;
  border:1px solid rgba(141,78,40,.26);
  border-radius:10px;
  background:rgba(255,253,248,.95);
  backdrop-filter:blur(8px);
  text-align:center;
}

.mk-topbar .story-context-title{
  display:block;
  width:100%;
  font-size:13px;
  font-weight:800;
  color:#1f2a3a;
  text-align:center;
}

.mk-topbar .story-context-title img{
  width:20px;
  height:20px;
  object-fit:contain;
  vertical-align:middle;
  margin-left:6px;
}

.mk-topbar .story-context-subtitle{
  display:block;
  width:100%;
  font-size:11px;
  color:#2a3748;
  text-align:center;
}
.mk-topbar .story-context-subtitle small{font-size:.9em;}

.mk-topbar table{width:100%;border-collapse:collapse;}
.mk-topbar th,.mk-topbar td{padding:0;text-align:left;}
.mk-topbar div{max-width:100%;}
.mk-topbar a{color:inherit;text-decoration:none;}

.mk-tournament,
.mk-tournament *,
.mk-tournament *::before,
.mk-tournament *::after { box-sizing: border-box; }

.mk-tournament {
  --mk-bg:#f7f8fa;
  --mk-card:#fff;
  --mk-line:#d8dee8;
  --mk-text:#1c2430;
  --mk-muted:#5e6a7d;
  --mk-accent:#1f5fa8;
  --mk-radius:14px;
  width:100%;
  max-width:100%;
  margin:0;
  padding:8px 0 12px;
  background:var(--mk-bg);
  color:var(--mk-text);
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  font-size:15px;
  line-height:1.45;
}

.mk-tournament :where(h1,h2,h3,h4,p,ul,ol,li,figure,table,thead,tbody,tr,th,td,details,summary){margin:0;padding:0;border:0;font:inherit;color:inherit;background:transparent;}
.mk-tournament :where(ul,ol){list-style:none;}
.mk-tournament :where(a){color:var(--mk-accent);text-decoration:none;}

.mk-tournament h1{font-size:24px;line-height:1.2;font-weight:800;}
.mk-tournament h2{font-size:18px;line-height:1.25;font-weight:750;}
.mk-tournament h3{font-size:16px;line-height:1.3;font-weight:700;}
.mk-tournament p,.mk-tournament li,.mk-tournament td,.mk-tournament th{font-size:14px;}

.mk-tournament .mk-block{
  display:block;
  background:var(--mk-card);
  border:1px solid var(--mk-line);
  border-radius:var(--mk-radius);
  padding:0;
  box-shadow:0 2px 8px rgba(20,30,45,.06);
}

.mk-tournament .section-block:not(.mk-block) {
  margin:0;
  padding:0;
  border:0;
  border-radius:0;
  background:transparent;
  box-shadow:none;
}

.mk-tournament .mk-block > * + * { margin-top:1.2rem; }

.mk-tournament .standings-grid{
  width:100%;
  max-width:100%;
  min-width:0;
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(min(360px,100%),1fr));
}

.mk-tournament .standings-grid > .panel-card{
  width:100%;
  max-width:100%;
  min-width:0;
}

.mk-tournament details.mk-block > summary{
  list-style:none;
  cursor:pointer;
  font-size:18px;
  font-weight:750;
  line-height:1.25;
  display:flex;
  align-items:center;
  justify-content:space-between;
}
.mk-tournament details.mk-block > summary::-webkit-details-marker{display:none;}
.mk-tournament details.mk-block > summary::after{content:"▾";font-size:14px;color:var(--mk-muted);}
.mk-tournament details.mk-block:not([open]) > summary::after{content:"▸";}

.mk-tournament .mk-table-scroll{
  width:100%;
  overflow-x:visible;
  overflow-y:hidden;
  -webkit-overflow-scrolling:touch;
  border:1px solid var(--mk-line);
  border-radius:10px;
  background:#fff;
}

.mk-tournament table{
  width:100%;
  border-collapse:collapse;
  font-size:14px;
}

.mk-tournament th,
.mk-tournament td{
  padding:6px 8px;
  text-align:left;
}

.mk-tournament .mk-table-scroll > table{
  width:100%;
  min-width:0;
  border-collapse:collapse;
  table-layout:fixed;
}

.mk-tournament .mk-table-scroll th,
.mk-tournament .mk-table-scroll td{
  border-bottom:1px solid var(--mk-line);
  padding:8px 10px;
  white-space:normal;
  word-break:break-word;
  overflow-wrap:anywhere;
  vertical-align:middle;
  text-align:left;
}
.mk-tournament .mk-table-scroll th{background:#eef4fb;font-weight:700;}
.mk-tournament .mk-table-scroll tr:nth-child(even) td{background:#fafcff;}

.mk-tournament .standings-table .analytics-table{
  table-layout:fixed;
}

.mk-tournament .standings-table .analytics-table th:nth-child(1),
.mk-tournament .standings-table .analytics-table td:nth-child(1){
  width:8%;
  min-width:2.8ch;
  white-space:nowrap;
  word-break:normal;
  overflow-wrap:normal;
  font-variant-numeric:tabular-nums;
  font-size:12px;
  font-weight:700;
}

.mk-tournament .standings-table .analytics-table th:nth-child(2),
.mk-tournament .standings-table .analytics-table td:nth-child(2){width:54%;}

.mk-tournament .standings-table .analytics-table th:nth-child(3),
.mk-tournament .standings-table .analytics-table td:nth-child(3){width:20%;}

.mk-tournament .standings-table .analytics-table th:nth-child(4),
.mk-tournament .standings-table .analytics-table td:nth-child(4){width:18%;}

.mk-tournament .standings-table .analytics-table th:nth-child(1):nth-last-child(5),
.mk-tournament .standings-table .analytics-table td:nth-child(1):nth-last-child(5){width:8%;min-width:2.8ch;}
.mk-tournament .standings-table .analytics-table th:nth-child(2):nth-last-child(4),
.mk-tournament .standings-table .analytics-table td:nth-child(2):nth-last-child(4){width:42%;}
.mk-tournament .standings-table .analytics-table th:nth-child(3):nth-last-child(3),
.mk-tournament .standings-table .analytics-table td:nth-child(3):nth-last-child(3){width:17%;}
.mk-tournament .standings-table .analytics-table th:nth-child(4):nth-last-child(2),
.mk-tournament .standings-table .analytics-table td:nth-child(4):nth-last-child(2){width:13%;}
.mk-tournament .standings-table .analytics-table th:nth-child(5):nth-last-child(1),
.mk-tournament .standings-table .analytics-table td:nth-child(5):nth-last-child(1){width:20%;}

.mk-tournament .mk-chart{
  display:grid;
  gap:8px;
  border:1px solid var(--mk-line);
  border-radius:10px;
  padding:8px 0 0;
  background:#fff;
}

.mk-tournament .mk-race-chart{
  display:flex;
  flex-wrap:wrap;
  gap:4px;
  font-size:20px;
}

.mk-tournament .mk-chart,
.mk-tournament .chart-shell,
.mk-tournament .mk-table-scroll{
  width:100%;
  max-width:100%;
  min-width:0;
}

.mk-tournament .mk-chart > svg,
.mk-tournament .chart-shell > svg,
.mk-tournament .line-chart,
.mk-tournament .delta-chart,
.mk-tournament .position-histogram-chart{
  display:block;
  width:100% !important;
  max-width:100%;
  height:auto;
}

.mk-tournament .chart-tooltip{
  display:none !important;
}

.mk-tournament .chart-shell .chart-legend,
.mk-tournament .chart-shell .delta-meta{
  padding-inline:8px;
}

.mk-tournament .mk-block > .section-head{
  position: static;
  background: #ffffff;
  padding: 6px 0;
  border-bottom: 1px solid var(--mk-line);
}

.mk-tournament .panel-card > .section-head{
  position: static;
  background: #ffffff;
  padding-top: 6px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--mk-line);
}

.mk-tournament .recap-group-section > .section-head{
  position: static;
}

.mk-tournament .recap-player-section .recap-player-intro > .recap-intro-head-block > .section-head{
  position: static;
}

.mk-tournament .recap-player-section{
  scroll-margin-top:calc(var(--story-context-offset,84px) + 8px);
}

.mk-tournament .mk-chart-scrubber-wrap{
  display:grid;
  gap:8px;
  margin-top:8px;
}

.mk-tournament .mk-chart-scrubber{
  width:100%;
  margin-left:0;
  padding:0;
  accent-color:#14b8d4;
}

.mk-tournament input,
.mk-tournament select,
.mk-tournament button,
.mk-tournament textarea{
  padding:0;
}

.mk-tournament .mk-chart-readout{
  border:1px solid rgba(141,78,40,.28);
  border-radius:8px;
  background:#fffdf8;
  padding:0;
  font-size:12px;
  line-height:1.35;
  overflow:hidden;
}

.mk-tournament .mk-chart-readout-head{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  justify-content:space-between;
  gap:6px;
  padding:8px 10px;
  border-bottom:1px solid rgba(141,78,40,.22);
  background:linear-gradient(180deg,#f7efe4 0%,#efe3d4 100%);
  color:#2b2117;
}

.mk-tournament .mk-chart-readout-table{
  width:100%;
  border-collapse:collapse;
}

.mk-tournament .mk-chart-readout-table td{
  border-top:1px solid rgba(141,78,40,.16);
  padding:6px 8px;
  vertical-align:top;
  color:#2c231a;
}

.mk-tournament .mk-chart-readout-table.is-position-distribution td:nth-child(2){
  text-align:right;
}

.mk-tournament .mk-chart-readout-table.is-position-distribution{
  table-layout:fixed;
}

.mk-tournament .mk-chart-readout-table.is-position-distribution td:nth-child(1){
  width:24%;
  white-space:nowrap;
}

.mk-tournament .mk-chart-readout-table.is-position-distribution td:nth-child(2){
  width:76%;
  font-size:10.5px;
  white-space:nowrap;
}

.mk-tournament .mk-chart-readout-table.is-place-track{
  table-layout:fixed;
}

.mk-tournament .mk-chart-readout-table.is-place-track td:nth-child(1){
  width:33%;
  white-space:nowrap;
}

.mk-tournament .mk-chart-readout-table.is-place-track td:nth-child(2){
  width:67%;
  font-size:10.5px;
  white-space:nowrap;
  text-align:right;
}

.mk-tournament .mk-chart-readout-track{
  text-align:right;
}

.mk-tournament .mk-chart-readout-tie{
  text-align:left !important;
}

.mk-tournament .mk-chart-readout-track-lines{
  display:inline-block;
  text-align:left;
}

.mk-tournament .mk-chart-readout-key{
  display:inline-flex;
  align-items:center;
  gap:6px;
  color:#3a2a1d;
}

.mk-tournament .mk-chart-readout-key i{
  width:9px;
  height:9px;
  border-radius:999px;
  display:inline-block;
}

.mk-tournament .mk-chart-readout-details{
  font-size:11px;
  line-height:1.25;
  white-space:nowrap;
}

.mk-tournament .chart-hover-line{
  stroke:#14b8d4 !important;
  stroke-width:2px;
  stroke-dasharray:6 4;
}

.mk-tournament .chart-axis-title,
.mk-tournament .chart-grid text,
.mk-tournament .chart-x-labels text,
.mk-tournament .delta-player-label{
  font-size:15px !important;
  font-weight:700;
}

.mk-tournament .mk-chart-readout-empty{
  color:var(--mk-muted);
  text-align:center;
  padding:10px 8px;
}

.mk-tournament .recap-intro-head-block{
  border-radius:0;
}

.mk-tournament .recap-player-intro .recap-intro-head-block .section-head h2{
  color:#000;
  text-align:center;
}

.mk-tournament .recap-meta-line{
  display:block;
  width:100%;
  text-align:center;
  font-family:"Noto Sans","Segoe UI",sans-serif;
  font-size:14px;
  font-weight:700;
  line-height:1.3;
  color:#2a3748;
}

.mk-tournament .recap-meta-line small{font-size:.86em;font-weight:600;color:#5b6f87;}
.mk-tournament .recap-meta-icon{margin-left:4px;}
.mk-tournament .top-list-track .top-list-head{background:rgba(217,237,247,.92);border:1px solid rgba(44,58,78,.16);border-radius:10px;font-weight:800;}
.mk-tournament .recap-player-return{padding-right:10px;}
.mk-tournament .mk8-classic-export .recap-player-shell{border-radius:18px;}
.mk-tournament .mk8-classic-export .recap-player-intro{border-radius:18px;}
.mk-tournament .mk8-classic-export .recap-player-return{display:flex;justify-content:flex-end;padding-right:10px;}
.mk-tournament .classic-histogram-summary-line{text-align:center;}
.mk-tournament .mk-chart-readout-table.is-benchmark-delta{table-layout:auto;}
.mk-tournament .mk-chart-readout-table.is-benchmark-delta td{font-size:.62rem;padding:4px 4px;}
.mk-tournament .mk-benchmark-col{display:inline-block;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;}
.mk-tournament .mk-benchmark-col-label{text-align:left;font-weight:700;width:100%;min-width:9ch;}
.mk-tournament .mk-benchmark-col-name{text-align:right;min-width:16ch;max-width:16ch;overflow:hidden;text-overflow:ellipsis;}
.mk-tournament .mk-benchmark-col-delta{width:4ch;font-weight:800;}
.mk-tournament .mk-benchmark-col-points,.mk-tournament .mk-benchmark-col-vs{text-align:center;padding-left:2px;padding-right:2px;}
.mk-tournament .mk-benchmark-col-score{width:3ch;padding-left:3px;padding-right:3px;}
.mk-tournament .mk-benchmark-col-points{width:6ch;}
.mk-tournament .mk-benchmark-col-vs{width:2ch;padding-left:5px;}
.mk-tournament .mk-benchmark-col-delta{min-width:4ch;font-weight:800;}
.mk-tournament .mk-benchmark-col-points{min-width:6ch;}
.mk-tournament .mk-benchmark-col-vs{min-width:2ch;}
.mk-tournament .mk-benchmark-col-score{min-width:3ch;}
.mk-tournament .mk-benchmark-pack-cell{text-align:right;white-space:nowrap;overflow:hidden;min-width:0;}
.mk-tournament .mk-benchmark-pack{display:inline-flex;width:max-content;max-width:100%;gap:2px;align-items:center;overflow:hidden;margin-left:auto;}
.mk-tournament .mk-chart-readout-table.is-delta-points td:nth-child(2){text-align:right;font-variant-numeric:tabular-nums;}
.mk-tournament .mk-benchmark-tie-1 td{background:rgba(246,196,83,.28);}
.mk-tournament .mk-benchmark-tie-2 td{background:rgb(125 128 133 / 32%);}
.mk-tournament .mk-benchmark-tie-3 td{background:rgba(212,131,82,.28);}

@media (max-width:720px){
  .mk-tournament .mk-chart-readout-table.is-benchmark-delta td{font-size:.56rem;padding:3px 3px;}
  .mk-tournament .mk-benchmark-pack{gap:1px;}
}

.mk-tournament .mk-chart-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0;}
.mk-tournament .mk-chart-label{font-size:13px;color:var(--mk-muted);margin-right:4px;}
.mk-tournament .mk-chip{display:inline-flex;align-items:center;justify-content:center;min-height:28px;padding:2px 7px;border:1px solid var(--mk-line);border-radius:999px;background:#f7fbff;font-size:14px;line-height:1;}

@media (hover:hover) and (pointer:fine){
  .mk-tournament .mk-block:hover{border-color:#c7d3e4;box-shadow:0 4px 14px rgba(20,30,45,.1);}
  .mk-tournament .mk-table-scroll tr:hover td{background:#f2f8ff;}
  .mk-tournament .mk-chip:hover{background:#e9f3ff;border-color:#c7dbf5;}
}
`.trim();
}

function buildClassicFragmentHtml(derived) {
  const trackDetail = buildTrackDetail(derived.trackUsage, state.selectedTrack);
  const rawBody = stripExportOnlyButtons(renderRecapContent(derived, trackDetail, { staticExport: true, interactiveCharts: state.exportInteractive, classicMode: true }));
  const body = normalizeClassicWordpressPostMarkup(rawBody);
  const introHtml = sanitizeClientEditableHtml(classicCustomizationState().introHtml || '');
  return absolutizeExportAssetReferences(`<div class="mk-topbar"></div>
<div class="mk8-classic-export mk8-classic-export-theme-light mk8-font-scope mk-tournament" data-classic-format="fragment" data-classic-language="${esc(state.language)}">
<section class="mk8-classic-export-intro mk-block">
  <h2><strong>${esc(classicExportTitle())}</strong></h2>
  <div class="classic-note-block">${introHtml || '<p></p>'}</div>
</section>
${body}
</div>`);
}

  function buildClassicFullHtml(derived) {
    const template = getClassicTemplateHtml();
    const fragmentHtml = buildClassicFragmentHtml(derived);
    const wordpressCss = getClassicWordpressPostCss();
    const exportCss = getClassicExportCss();
    const inlineCss = [wordpressCss, exportCss].filter((chunk) => String(chunk || '').trim()).join('\n\n');
    const exportRuntimeJs = getClassicExportRuntimeJs();
    const title = classicExportTitle();
    const runtimeScript = `<script id="mk8-classic-export-runtime">${exportRuntimeJs}</script>`;
    const fallback = `<!doctype html><html lang="nl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${esc(title)}</title><style>${inlineCss}</style></head><body class="analytics-body analytics-body-classic mk8-classic-template-body"><main class="mk8-classic-template-fallback"><h1>${esc(title)}</h1>${fragmentHtml}</main>${runtimeScript}</body></html>`;
    if (!template) return fallback;
    let html = template;
  html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)} – Mariokart 8 Deluxe tournament</title>`);
  html = html.replace(/<h1 class="entry-title">[\s\S]*?<\/h1>/i, `<h1 class="entry-title">${esc(title)}</h1>`);
  const withCommentMarker = html.replace(/<div class="entry-content">[\s\S]*?<\/div><!-- \.entry-content -->/i, `<div class="entry-content">\n${fragmentHtml}\n\t\t\t</div><!-- .entry-content -->`);
    html = withCommentMarker !== html
      ? withCommentMarker
      : html.replace(/<div class="entry-content">[\s\S]*?<\/div>\s*<\/article>/i, `<div class="entry-content">\n${fragmentHtml}\n\t\t\t</div>\n</article>`);
    html = html.replace(/<\/head>/i, `<base href="https://mk8dx.example/tn11/" />\n<style id="mk8-classic-export-inline-css">\n${inlineCss}\n</style>\n</head>`);
    html = html.replace(/<body class="([^"]*)"/i, '<body class="$1 analytics-body analytics-body-classic mk8-classic-template-body"');
    html = html.replace(/<\/body>/i, `<script id="mk8-classic-export-runtime">${exportRuntimeJs}</script>\n</body>`);
    return absolutizeExportAssetReferences(html);
  }

  function buildClassicExportPayloads(derived) {
    const classicDerived = buildClassicDerived(derived);
    return {
      title: classicExportTitle(),
      fragmentHtml: buildClassicFragmentHtml(classicDerived),
      fullHtml: buildClassicFullHtml(classicDerived),
    };
  }

  function formatExportHtml(source) {
    const raw = String(source || '');
    if (!raw) return '';
    const protectedBlocks = [];
    const masked = raw.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, (block) => {
      const token = `__MK8_EXPORT_BLOCK_${protectedBlocks.length}__`;
      protectedBlocks.push(block);
      return token;
    });
    const formatted = masked
      .replace(/></g, '>\n<')
      .replace(/\n{3,}/g, '\n\n');
    return formatted.replace(/__MK8_EXPORT_BLOCK_(\d+)__/g, (_match, indexValue) => {
      const index = Number(indexValue);
      return Number.isFinite(index) && protectedBlocks[index] != null ? protectedBlocks[index] : '';
    });
  }

  async function buildClassicDownloadPayloads(derived) {
    const exports = buildClassicExportPayloads(derived);
    if (state.exportEmbedImages) {
      const fragmentHtml = await inlineExportAssetReferences(exports.fragmentHtml);
      const fullHtml = await inlineExportAssetReferences(exports.fullHtml);
      return {
        title: exports.title,
        fragmentHtml: formatExportHtml(fragmentHtml),
        fullHtml: formatExportHtml(fullHtml),
      };
    }
    return {
      title: exports.title,
      fragmentHtml: formatExportHtml(exports.fragmentHtml),
      fullHtml: formatExportHtml(exports.fullHtml),
    };
  }

function renderClassicContent(derived) {
  const exports = buildClassicExportPayloads(derived);
  const trackDetail = buildTrackDetail(derived.trackUsage, state.selectedTrack);
  const editableContent = renderRecapContent(buildClassicDerived(derived), trackDetail, { classicMode: true, classicEditable: true, staticExport: true, interactiveCharts: true });
  const exportMode = state.exportInteractive ? tr('interactiveExportLabel') : tr('compactExportLabel');
  const imageMode = state.exportEmbedImages ? tr('embeddedImagesLabel') : tr('linkedImagesLabel');
  return `<section class="section-block classic-export-summary"><article class="panel-card"><div class="section-head"><div><h2>${esc(tr('classicPreviewTitle'))}</h2><p>${esc(tr('classicPreviewDescription'))}</p></div></div><div class="summary-strip"><span>${esc(tr('formatLabel'))}: <strong>${esc(state.exportFormat)}</strong></span><span>${esc(tr('languageLabel'))}: <strong>${esc(state.language.toUpperCase())}</strong></span><span>${esc(tr('exportInteractiveLabel'))}: <strong>${esc(exportMode)}</strong></span><span>${esc(tr('exportEmbedImagesLabel'))}: <strong>${esc(imageMode)}</strong></span><span>${esc(tr('groupFilterLabelShort'))}: <strong>${esc(groupFilterLabel(state.groupFilter, derived.baseGroups))}</strong></span><span>${esc(tr('playerFilterLabelShort'))}: <strong>${esc(state.playerFilter || tr('allPlayers'))}</strong></span></div></article></section><section class="section-block classic-wordpress-divider"><article class="panel-card"><p>${esc(tr('classicWordpressStart'))}</p></article></section><div class="mk8-classic-export mk8-classic-export-theme-light mk8-font-scope classic-live-content">${editableContent}</div>`;
}

function buildClassicDerived(derived) {
  return {
    ...derived,
    renderMomentumSection: false,
    renderComparisonSection: false,
  };
}

function renderContent(derived) {
  const trackDetail = buildTrackDetail(derived.trackUsage, state.selectedTrack);
  qs('analyticsMount').innerHTML = isClassicView()
    ? renderClassicContent(buildClassicDerived(derived))
    : (isRecapView()
      ? renderRecapContent(derived, trackDetail)
      : [renderEndStandings(derived.endGroups), renderQualifierStandings(derived.qualifierGroups), renderTopSection(derived), `<section class="section-block"><div class="section-head"><div><h2>${esc(tr('characterHubTitle'))}</h2><p>${esc(tr('personagehubDescription'))}</p></div></div>${renderCharacterHub(derived.rosterUsage)}</section>`, renderCupOverview(derived.cupOverview, trackDetail, derived.filteredRaceCount, { trackUsage: derived.trackUsage }), renderGlobalComparisonControls(derived), renderParticipantAnalysis(derived), renderDeltaSection(derived), renderHistogram(derived), renderComparison(derived)].join(''));
  updateAudioUi();
}

function extractStoryContextItems(mountNode) {
  const mount = mountNode || qs('analyticsMount');
  if (!mount || typeof mount.querySelectorAll !== 'function') return [];
  const items = [];
  mount.querySelectorAll('.standings-grid > article.panel-card').forEach((card) => {
    const title = (card.querySelector('.standings-group-title')?.textContent || '').trim();
    if (!title) return;
    const subtitle = (card.querySelector('.section-head p')?.textContent || '').trim();
    items.push({ el: card, title, subtitle });
  });
  mount.querySelectorAll('.section-block').forEach((block) => {
    if (block.classList.contains('recap-player-section')) return;
    const heading = (block.querySelector('.section-head h2')?.textContent || block.querySelector('.section-head h3')?.textContent || '').trim();
    if (!heading || !/top\s*5/i.test(heading)) return;
    items.push({ el: block, title: heading, subtitle: '' });
  });
  mount.querySelectorAll('.recap-player-section').forEach((section) => {
    const titleNode = section.querySelector('.recap-player-intro .section-head h2');
    const title = (titleNode?.textContent || '').trim();
    if (!title) return;
    const lineNode = section.querySelector('.recap-meta-row .recap-meta-line');
    const line = (lineNode?.textContent || '').trim();
    items.push({
      el: section,
      title,
      subtitle: line,
      titleHtml: String(titleNode?.innerHTML || ''),
      subtitleHtml: String(lineNode?.innerHTML || ''),
    });
  });
  return items.filter((item) => item?.el && item.title);
}

function teardownStoryContextBar() {
  if (typeof storyContextCleanup === 'function') {
    storyContextCleanup();
    storyContextCleanup = null;
  }
  const bar = qs('storyContextBar');
  if (bar?.parentElement) bar.parentElement.removeChild(bar);
}

function initStoryContextBar() {
  teardownStoryContextBar();
  if (!isStoryView()) return;
  const mount = qs('analyticsMount');
  const statusNode = qs('analyticsStatus');
  if (!mount || !statusNode) return;
  const items = extractStoryContextItems(mount);
  if (!items.length) return;
  const bar = document.createElement('div');
  bar.id = 'storyContextBar';
  bar.className = 'story-context-bar';
  bar.innerHTML = '<strong class="story-context-title"></strong><span class="story-context-subtitle"></span>';
  statusNode.insertAdjacentElement('beforebegin', bar);
  const titleNode = bar.querySelector('.story-context-title');
  const subtitleNode = bar.querySelector('.story-context-subtitle');
  const applyContextOffset = () => {
    const offset = Math.ceil(bar.getBoundingClientRect().height || 0) + 12;
    mount.style.setProperty('--story-context-offset', `${offset}px`);
  };
  let activeKey = '';
  const setActive = (item) => {
    if (!item) return;
    const key = `${item.title}__${item.subtitle || ''}`;
    if (key === activeKey) return;
    activeKey = key;
    if (titleNode) titleNode.innerHTML = item.titleHtml || esc(item.title);
    if (subtitleNode) {
      subtitleNode.innerHTML = item.subtitleHtml || esc(item.subtitle || '');
      subtitleNode.style.display = item.subtitle ? '' : 'none';
    }
  };
  let ticking = false;
  const update = () => {
    ticking = false;
    applyContextOffset();
    const topOffset = (bar.getBoundingClientRect().height || 38) + 8;
    const activeProbeY = topOffset + 18;
    let current = items[0];
    let lastAbove = null;
    let firstBelow = null;
    items.forEach((item) => {
      const rect = item.el.getBoundingClientRect();
      if (!rect || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) return;
      if (rect.top <= activeProbeY && rect.bottom > activeProbeY) {
        current = item;
        firstBelow = null;
        lastAbove = null;
        return;
      }
      if (rect.bottom <= activeProbeY) lastAbove = item;
      else if (!firstBelow) firstBelow = item;
    });
    if (lastAbove && current === items[0]) current = lastAbove;
    if (firstBelow && !lastAbove && current === items[0]) current = firstBelow;
    setActive(current);
  };
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(update);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  applyContextOffset();
  update();
  storyContextCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
  };
}
function buildDerived() {
  const catalog = buildCatalog(state.catalog);
  const baseRaceRows = resolveAfterRaceStandings((state.payload.dataset?.raceRows || []).map((row) => enrichRaceRow(row, catalog)));
  const baseFinalRows = sortStandingRows((state.payload.dataset?.finalRows || []).map((row) => enrichFinalRow(row, catalog)));
  const allPlayerOptions = unique([...baseFinalRows.map((row) => row.playerName), ...baseRaceRows.map((row) => row.playerName)]).sort(byText);
  const playerScopedRaceRows = state.playerFilter ? baseRaceRows.filter((row) => row.playerName === state.playerFilter) : baseRaceRows;
  const playerScopedFinalRows = state.playerFilter ? baseFinalRows.filter((row) => row.playerName === state.playerFilter) : baseFinalRows;
  const baseGroups = buildGroupList(playerScopedFinalRows);
  const matchesGroupFilter = groupFilterPredicate(state.groupFilter);
  const comparisonRaceRows = baseRaceRows.filter(matchesGroupFilter);
  const comparisonFinalRows = baseFinalRows.filter(matchesGroupFilter);
  const filteredRaceRows = playerScopedRaceRows.filter(matchesGroupFilter);
  const filteredFinalRows = playerScopedFinalRows.filter(matchesGroupFilter);
  const filteredGroups = buildGroupList(filteredFinalRows);
  return {
    catalog,
    baseRaceRows,
    baseFinalRows,
    playerScopedRaceRows,
    playerScopedFinalRows,
    baseGroups,
    comparisonRaceRows,
    comparisonFinalRows,
    filteredRaceRows,
    filteredFinalRows,
    filteredGroups,
    filteredRaceCount: unique(filteredRaceRows.map((row) => row.raceSlotKey)).length,
    endGroups: buildStandingsByGroup(filteredFinalRows.filter((row) => row.phase === 'post')),
    qualifierGroups: buildStandingsByGroup(filteredFinalRows.filter((row) => row.phase === 'qualifier')),
    trackUsage: aggregateTrackUsage(filteredRaceRows),
    cupUsage: aggregateCupUsage(filteredRaceRows),
    rosterUsage: aggregateRosterUsage(filteredRaceRows),
    cupOverview: buildCupOverview(filteredRaceRows, catalog),
    allPlayerOptions,
    playerOptions: unique([...playerScopedFinalRows.map((row) => row.playerName), ...playerScopedRaceRows.map((row) => row.playerName)]).sort(byText),
  };
}

function ensureSelectionState(derived) {
  const scopeOptions = state.payload.availableTournaments || [];
  if (!scopeOptions.some((item) => item.tournamentId === state.scope)) state.scope = state.payload.selection?.scope || state.payload.selection?.defaultScope || '';
  if (state.playerFilter && !derived.allPlayerOptions.includes(state.playerFilter)) state.playerFilter = '';
  const groupKeys = [GROUP_FILTER_ALL, GROUP_FILTER_QUALIFIER_ONLY, GROUP_FILTER_POST_ONLY, ...derived.baseGroups.map((group) => group.groupKey)];
  if (!groupKeys.includes(state.groupFilter)) state.groupFilter = GROUP_FILTER_ALL;
  if (state.playerFilter) state.participant = state.playerFilter;
  if (!derived.playerOptions.includes(state.participant)) state.participant = state.playerFilter || state.payload.selection?.player || derived.playerOptions[0] || '';
  const participantScopeOptions = buildParticipantScopeOptions(derived.playerScopedFinalRows, state.participant).map((option) => option.value);
  const selectedGroup = isPhaseOnlyGroupFilter(state.groupFilter) || state.groupFilter === GROUP_FILTER_ALL ? null : derived.baseGroups.find((group) => group.groupKey === state.groupFilter) || null;
  const preferredScopedParticipantScope = participantScopeForGroup(selectedGroup);
  const participantScopeHasRows = (scope) => filterParticipantRows(derived.filteredRaceRows, state.participant, scope).length > 0;
  if (!participantScopeOptions.includes(state.participantScope)) {
    state.participantScope = (preferredScopedParticipantScope && participantScopeOptions.includes(preferredScopedParticipantScope))
      ? preferredScopedParticipantScope
      : defaultParticipantScope(derived.playerScopedFinalRows, state.participant);
  }
  if (preferredScopedParticipantScope && participantScopeOptions.includes(preferredScopedParticipantScope) && !participantScopeHasRows(state.participantScope)) {
    state.participantScope = preferredScopedParticipantScope;
  }
  if (!participantScopeHasRows(state.participantScope)) {
    state.participantScope = participantScopeHasRows('__all__') ? '__all__' : (participantScopeOptions[0] || '__all__');
  }
  if (!state.playerFilter) {
    const nextPlayers = state.comparisonMode === 'manual' && state.comparisonPlayers.filter(Boolean).length
      ? normalizeComparisonPlayers(state.comparisonPlayers, derived.allPlayerOptions)
      : defaultComparisonPlayers(derived);
    state.comparisonPlayers = nextPlayers;
    state.participant = state.comparisonPlayers[0] || state.participant;
  } else {
    const seededPlayers = state.comparisonMode === 'manual' && state.comparisonPlayers.filter(Boolean).length
      ? state.comparisonPlayers
      : defaultComparisonPlayers(derived);
    state.comparisonPlayers = normalizeComparisonPlayers(seededPlayers, derived.allPlayerOptions, state.playerFilter);
    state.participant = state.playerFilter || state.participant;
  }
  syncComparisonSlots(derived, state.playerFilter || state.comparisonPlayers[0] || '');
  const histogramGroups = derived.filteredGroups.filter((group) => group.phase === 'post' || group.phase === 'qualifier').map((group) => group.groupKey);
  const preferredHistogram = (derived.filteredGroups.find((group) => group.phase === 'post')?.groupKey) || histogramGroups[0] || '';
  if (!histogramGroups.includes(state.histogramGroup)) state.histogramGroup = (state.groupFilter !== GROUP_FILTER_ALL && histogramGroups.includes(state.groupFilter)) ? state.groupFilter : preferredHistogram;
  const histogramRows = buildHistogramData(derived.filteredRaceRows, derived.filteredFinalRows, state.histogramGroup).rows;
  const histogramPlayers = histogramRows.map((row) => row.standing.playerName);
  const preferredHistogramPlayer = state.playerFilter && histogramPlayers.includes(state.playerFilter)
    ? state.playerFilter
    : (histogramPlayers[0] || '');
  if (!histogramPlayers.includes(state.histogramPlayer)) state.histogramPlayer = preferredHistogramPlayer;
  const trackKeys = derived.trackUsage.map((entry) => entry.trackKey);
  if (!trackKeys.includes(state.selectedTrack)) state.selectedTrack = trackKeys[0] || '';
}

function renderToolbar(derived) {
  if (hasNode('classicHeroKicker')) qs('classicHeroKicker').textContent = tr('classicHeroKicker');
  if (hasNode('scopeLabel')) qs('scopeLabel').textContent = tr('scopeLabel');
  if (hasNode('groupLabel')) qs('groupLabel').textContent = tr('groupLabel');
  if (hasNode('playerLabel')) qs('playerLabel').textContent = tr('playerLabelShort');
  if (hasNode('languageLabel')) qs('languageLabel').textContent = tr('languageLabel');
  if (hasNode('exportInteractiveLabel')) qs('exportInteractiveLabel').textContent = tr('exportInteractiveLabel');
  if (hasNode('exportInteractiveText')) qs('exportInteractiveText').textContent = tr('exportInteractiveText');
  if (hasNode('exportInteractiveCheckbox')) qs('exportInteractiveCheckbox').checked = Boolean(state.exportInteractive);
  if (hasNode('exportEmbedImagesLabel')) qs('exportEmbedImagesLabel').textContent = tr('exportEmbedImagesLabel');
  if (hasNode('exportEmbedImagesText')) qs('exportEmbedImagesText').textContent = tr('exportEmbedImagesText');
  if (hasNode('exportEmbedImagesCheckbox')) qs('exportEmbedImagesCheckbox').checked = Boolean(state.exportEmbedImages);
  if (hasNode('classicSectionVisibilityLabel')) qs('classicSectionVisibilityLabel').textContent = tr('classicSectionVisibilityLabel');
  const visibilityTextMap = {
    showTopCups: 'classicShowTopCups',
    showCupTrackOverview: 'classicShowCupTrackOverview',
    showTrackDetail: 'classicShowTrackDetail',
    showCharacterHub: 'classicShowCharacterHub',
    showTotalAfterRaceChart: 'classicShowTotalAfterRaceChart',
    showPositionDistributionTable: 'classicShowPositionDistributionTable',
    showChartDownloadButtons: 'classicShowChartDownloadButtons',
  };
  Object.entries(visibilityTextMap).forEach(([key, textKey]) => {
    const checkboxId = classicVisibilityCheckboxId(key);
    const textId = checkboxId.replace('Checkbox', 'Text');
    if (checkboxId && hasNode(checkboxId)) qs(checkboxId).checked = classicVisibilityValue(key);
    if (textId && hasNode(textId)) qs(textId).textContent = tr(textKey);
  });
  if (hasNode('downloadClassicFullBtn')) qs('downloadClassicFullBtn').textContent = tr('downloadIndex');
  if (hasNode('downloadClassicFragmentBtn')) qs('downloadClassicFragmentBtn').textContent = tr('downloadEntry');
  if (hasNode('saveClassicContentBtn')) {
    qs('saveClassicContentBtn').textContent = state.classicCustomizationSaving ? tr('classicSaving') : tr('classicSave');
    qs('saveClassicContentBtn').disabled = Boolean(state.classicCustomizationSaving || state.classicCustomizationLoading || !state.scope);
  }
  if (hasNode('classicSaveStatus')) {
    const statusNode = qs('classicSaveStatus');
    if (state.classicCustomizationSaving) statusNode.textContent = tr('classicSaving');
    else if (state.classicCustomizationDirty) statusNode.textContent = tr('classicSaveIdle');
    else statusNode.textContent = state.classicCustomization?.updatedAt ? tr('classicSaveSuccess') : '';
  }
  if (hasNode('backToBoardLink')) qs('backToBoardLink').textContent = tr('backToBoard');
  if (hasNode('openRecapLink')) qs('openRecapLink').textContent = tr('openRecap');
  if (hasNode('openDashboardLink')) qs('openDashboardLink').textContent = tr('openDashboard');
  if (hasNode('resetFiltersBtn')) {
    qs('resetFiltersBtn').textContent = isClassicView() || isRecapView() ? tr('resetDefault') : tr('resetFilters');
  }
  if (hasNode('downloadAllChartsBtn')) qs('downloadAllChartsBtn').textContent = tr('downloadAllCharts');
  if (hasNode('audioToggleBtn')) qs('audioToggleBtn').textContent = state.audioEnabled ? tr('musicOn') : tr('musicOff');
  fillSelect(qs('scopeSelect'), state.payload.availableTournaments || [], state.scope, (item) => item.tournamentId, (item) => `${item.tournamentName}${item.tournamentDirector ? ` · ${item.tournamentDirector}` : ''}`);
  fillSelect(qs('playerFilterSelect'), [{ playerName: '', label: tr('allPlayersCapitalized') }, ...derived.allPlayerOptions.map((player) => ({ playerName: player, label: player }))], state.playerFilter, (item) => item.playerName, (item) => item.label);
  fillSelect(qs('groupFilterSelect'), [
    { groupKey: GROUP_FILTER_ALL, groupName: tr('allGroupsCapitalized'), phase: '' },
    { groupKey: GROUP_FILTER_QUALIFIER_ONLY, groupName: tr('allQualifiersCapitalized'), phase: 'qualifier_only' },
    { groupKey: GROUP_FILTER_POST_ONLY, groupName: tr('allEndGroupsCapitalized'), phase: 'post_only' },
    ...derived.baseGroups,
  ], state.groupFilter, (item) => item.groupKey, (item) => {
    if (item.groupKey === GROUP_FILTER_ALL || item.groupKey === GROUP_FILTER_QUALIFIER_ONLY || item.groupKey === GROUP_FILTER_POST_ONLY) return item.groupName;
    return `${item.phase === 'qualifier' ? 'Kwalificatie' : 'Eindgroep'} · ${item.groupName}`;
  });
  if (isClassicView()) {
    const nlButton = qs('languageNlBtn');
    const ukButton = qs('languageUkBtn');
    if (nlButton) {
      const active = state.language === 'nl';
      nlButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      nlButton.classList.toggle('is-active', active);
    }
    if (ukButton) {
      const active = state.language === 'uk';
      ukButton.setAttribute('aria-pressed', active ? 'true' : 'false');
      ukButton.classList.toggle('is-active', active);
    }
  }
}

function renderStatus(derived) {
  const tournament = (state.payload.availableTournaments || []).find((item) => item.tournamentId === state.scope) || null;
  qs('heroTitle').textContent = tournament?.tournamentName || (isStoryView() ? (isClassicView() ? tr('classicHeroFallbackTitle') : tr('tournamentRecapTitle')) : 'MK8DX Toernooi-analyse');
  qs('heroSubtitle').textContent = tournament
    ? (isClassicView()
      ? tr('classicHeroLoadedSubtitle')
      : (isRecapView()
      ? (state.language === 'uk' ? 'Automatically generated recap overview for this Step 10 tournament, built from existing tables, charts and a fixed section for every participant.' : 'Automatisch opgebouwd recap-overzicht voor dit Stap 10-toernooi, met bestaande tabellen, grafieken en een vaste sectie voor iedere deelnemer.')
      : (state.language === 'uk' ? `All statistics are based on the selected Step 10 tournament. Player filter: ${state.playerFilter || tr('allPlayers')}. Group filter: ${groupFilterLabel(state.groupFilter, derived.baseGroups)}.` : `Alle statistieken zijn gebaseerd op het geselecteerde Stap 10-toernooi. Spelerfilter: ${state.playerFilter || 'alle spelers'}. Groepsfilter: ${groupFilterLabel(state.groupFilter, derived.baseGroups)}.`)))
    : tr('noStep10');
  qs('analyticsStatus').textContent = tournament
    ? (isClassicView()
      ? tr('exportReady', { tournament: tournament.tournamentName, participants: derived.playerOptions.length, format: state.exportFormat, language: state.language.toUpperCase(), mode: state.exportInteractive ? tr('interactiveExportLabel') : tr('compactExportLabel'), imageMode: state.exportEmbedImages ? tr('embeddedImagesLabel') : tr('linkedImagesLabel'), races: derived.filteredRaceCount })
      : (isRecapView()
      ? `Geselecteerd: ${tournament.tournamentName} · ${derived.playerOptions.length} deelnemers · ${derived.filteredRaceCount} unieke groepsraces · ${derived.filteredGroups.length} groep(en) in recap.`
      : `Geselecteerd: ${tournament.tournamentName} · Spelerfilter: ${state.playerFilter || 'alle spelers'} · ${derived.filteredRaceCount} unieke groepsraces · ${derived.filteredGroups.length} zichtbare groep(en).`))
    : 'Geen Stap 10-toernooien gevonden.';
}

  async function renderAll() {
  if (!state.payload || !(state.payload.availableTournaments || []).length) {
    teardownStoryContextBar();
    qs('overviewCards').innerHTML = '';
    qs('analyticsMount').innerHTML = emptyCard('Geen analyseerbare toernooien', 'Er is nog geen toernooi dat volgens de bestaande workflow Stap 10 heeft bereikt.');
    qs('analyticsStatus').textContent = 'Geen Stap 10-toernooien beschikbaar.';
    return;
  }
  const derived = buildDerived();
  ensureSelectionState(derived);
  if (isClassicView()) await ensureClassicCustomizationLoaded();
  renderToolbar(derived);
  renderStatus(derived);
  syncUrlState();
  renderMetricCards(derived);
  renderContent(derived);
  initializeInteractiveCharts(qs('analyticsMount'));
  initStoryContextBar();
  const deferScroll = () => {
    scrollToRequestedPlayer();
    syncClassicPreviewFrameScroll();
  };
  if (window?.requestAnimationFrame) {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(deferScroll);
    });
  } else {
    deferScroll();
  }
    if (isClassicView() && state.pendingDownload) {
      await triggerClassicDownload(state.exportFormat, derived);
      state.pendingDownload = false;
      syncUrlState();
    }
  }

async function refresh() {
  qs('analyticsStatus').textContent = 'Laden…';
  const response = await fetchAnalytics();
  if (!response.ok) {
    qs('analyticsStatus').textContent = response.error || 'Analytics laden mislukt.';
    qs('analyticsMount').innerHTML = emptyCard('Laden mislukt', response.error || 'De analyticsdata kon niet geladen worden.');
    qs('overviewCards').innerHTML = '';
    return;
  }
  state.payload = response.data;
  state.catalog = state.catalog || await fetchCatalog();
  if (!state.scope) state.scope = response.data.selection?.scope || response.data.selection?.defaultScope || '';
    await renderAll();
  }

async function persistClassicCustomization() {
  if (!isClassicView() || state.classicCustomizationSaving) return;
  state.classicCustomizationSaving = true;
  renderToolbar(buildDerived());
  const response = await saveClassicCustomization();
  if (response?.ok) {
    state.classicCustomizationVersion = Number(response.version || state.classicCustomizationVersion || 0);
    state.classicCustomizationDirty = false;
    if (state.classicCustomization) {
      state.classicCustomization.updatedAt = String(response.content?.updatedAt || new Date().toISOString());
      state.classicCustomization.updatedBy = String(response.content?.updatedBy || 'classic-editor');
      if (response.content?.playerNotesByPlayer) state.classicCustomization.playerNotesByPlayer = { ...response.content.playerNotesByPlayer };
      if (response.content?.visibility) state.classicCustomization.visibility = { ...CLASSIC_VISIBILITY_DEFAULTS, ...response.content.visibility };
      if (typeof response.content?.introHtml === 'string') state.classicCustomization.introHtml = response.content.introHtml;
      if (typeof response.content?.topTracksIntroHtml === 'string') state.classicCustomization.topTracksIntroHtml = response.content.topTracksIntroHtml;
    }
    await renderAll();
  } else {
    state.classicCustomizationDirty = true;
    if (hasNode('classicSaveStatus')) qs('classicSaveStatus').textContent = `${tr('classicSaveFailed')}: ${response?.error || 'onbekend'}`;
  }
  state.classicCustomizationSaving = false;
  renderToolbar(buildDerived());
}

function bind() {
  if (window?.addEventListener) {
    window.addEventListener('hashchange', () => {
      state.scrollTargetId = String(window.location?.hash || '').replace(/^#/, '');
      scrollToRequestedPlayer();
      syncClassicPreviewFrameScroll();
    });
  }
  if (hasNode('scopeSelect')) qs('scopeSelect').addEventListener('change', async (event) => {
    state.scope = event.target.value || '';
    state.playerFilter = '';
    state.groupFilter = '__all__';
    state.selectedTrack = '';
    state.participantScope = '';
    state.comparisonMode = 'default';
    await refresh();
  });
  if (hasNode('playerFilterSelect')) qs('playerFilterSelect').addEventListener('change', () => {
      state.playerFilter = qs('playerFilterSelect').value || '';
      state.selectedTrack = '';
      state.participantScope = '';
      state.comparisonPlayers = state.playerFilter ? [state.playerFilter] : [];
      state.comparisonMode = 'default';
      renderAll();
    });
  if (hasNode('groupFilterSelect')) qs('groupFilterSelect').addEventListener('change', () => {
    state.groupFilter = qs('groupFilterSelect').value || '__all__';
    state.participantScope = '';
    state.comparisonMode = 'default';
    renderAll();
  });
  if (hasNode('resetFiltersBtn')) qs('resetFiltersBtn').addEventListener('click', () => {
      state.playerFilter = '';
      state.groupFilter = '__all__';
      state.selectedTrack = '';
      state.participantScope = '';
      state.comparisonPlayers = [];
      state.comparisonMode = 'default';
      renderAll();
    });
  if (hasNode('audioToggleBtn')) qs('audioToggleBtn').addEventListener('click', () => {
    state.audioEnabled = !state.audioEnabled;
    if (bgAudio) bgAudio.muted = !state.audioEnabled;
    updateAudioUi();
  });
  if (hasNode('downloadAllChartsBtn')) qs('downloadAllChartsBtn').addEventListener('click', async () => {
    await downloadAllCharts();
  });
  if (hasNode('downloadClassicFullBtn')) qs('downloadClassicFullBtn').addEventListener('click', async () => {
      const derived = buildDerived();
      ensureSelectionState(derived);
      await triggerClassicDownload('full', derived);
      syncUrlState();
      renderContent(derived);
    });
  if (hasNode('downloadClassicFragmentBtn')) qs('downloadClassicFragmentBtn').addEventListener('click', async () => {
      const derived = buildDerived();
      ensureSelectionState(derived);
      await triggerClassicDownload('fragment', derived);
      syncUrlState();
      renderContent(derived);
    });
  if (hasNode('saveClassicContentBtn')) qs('saveClassicContentBtn').addEventListener('click', async () => {
      await persistClassicCustomization();
    });
  if (hasNode('languageNlBtn')) qs('languageNlBtn').addEventListener('click', async () => {
      if (state.language === 'nl') return;
      state.language = 'nl';
      await renderAll();
    });
  if (hasNode('languageUkBtn')) qs('languageUkBtn').addEventListener('click', async () => {
      if (state.language === 'uk') return;
      state.language = 'uk';
      await renderAll();
    });
  if (hasNode('exportInteractiveCheckbox')) qs('exportInteractiveCheckbox').addEventListener('change', () => {
      state.exportInteractive = Boolean(qs('exportInteractiveCheckbox').checked);
      renderAll();
    });
  if (hasNode('exportEmbedImagesCheckbox')) qs('exportEmbedImagesCheckbox').addEventListener('change', () => {
      state.exportEmbedImages = Boolean(qs('exportEmbedImagesCheckbox').checked);
      renderAll();
    });
  Object.keys(CLASSIC_VISIBILITY_DEFAULTS).forEach((key) => {
    const checkboxId = classicVisibilityCheckboxId(key);
    if (!checkboxId || !hasNode(checkboxId)) return;
    qs(checkboxId).addEventListener('change', () => {
      const customization = classicCustomizationState();
      customization.visibility[key] = Boolean(qs(checkboxId).checked);
      state.classicCustomizationDirty = true;
      if (hasNode('classicSaveStatus')) qs('classicSaveStatus').textContent = tr('classicSaveIdle');
      renderAll();
    });
  });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('click', async (event) => {
    const editorCommandNode = event.target.closest('[data-classic-cmd]');
    if (editorCommandNode) {
      event.preventDefault();
      const command = String(editorCommandNode.dataset?.classicCmd || '');
      const value = String(editorCommandNode.dataset?.classicValue || '');
      if (command) classicApplyEditorCommand(command, value, editorCommandNode);
      return;
    }
    const editTarget = event.target.closest('[data-classic-edit-target]')?.dataset?.classicEditTarget || '';
    if (editTarget) {
      setScrollTargetFromInteractionNode(event.target);
      classicBeginInlineEdit(editTarget);
      renderAll();
      return;
    }
    const saveTarget = event.target.closest('[data-classic-save-target]')?.dataset?.classicSaveTarget || '';
    if (saveTarget) {
      setScrollTargetFromInteractionNode(event.target);
      classicSaveInlineEdit(saveTarget);
      renderAll();
      await persistClassicCustomization();
      return;
    }
    const cancelTarget = event.target.closest('[data-classic-cancel-target]')?.dataset?.classicCancelTarget || '';
    if (cancelTarget) {
      setScrollTargetFromInteractionNode(event.target);
      classicCancelInlineEdit(cancelTarget);
      renderAll();
      return;
    }
    const audioNode = event.target.closest('[data-audio-src]');
    if (audioNode) {
      await toggleTrackMusic(audioNode.dataset.audioSrc || '');
      return;
    }
    const trackNode = event.target.closest('[data-select-track]');
    if (trackNode && trackNode.dataset.selectTrack) {
      state.selectedTrack = trackNode.dataset.selectTrack;
      renderAll();
      const detail = qs('trackDetailCard');
      if (detail) detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const downloadNode = event.target.closest('[data-download-chart]');
    if (downloadNode) {
      await downloadChartFromTrigger(downloadNode);
      return;
    }
    if (event.target.closest('#comparisonSelectAllBtn')) {
      const derived = buildDerived();
      state.comparisonPlayers = selectAllComparisonPlayers(derived);
      state.comparisonMode = 'manual';
      state.participant = state.comparisonPlayers[0] || state.participant;
      state.participantScope = defaultParticipantScope(derived.playerScopedFinalRows, state.participant);
      syncComparisonSlots(derived, state.playerFilter || state.comparisonPlayers[0] || '');
      renderAll();
      return;
    }
    if (event.target.closest('#comparisonDefaultBtn')) {
      const derived = buildDerived();
      state.comparisonPlayers = defaultComparisonPlayers(derived);
      state.comparisonMode = 'default';
      state.participant = state.comparisonPlayers[0] || state.participant;
      state.participantScope = defaultParticipantScope(derived.playerScopedFinalRows, state.participant);
      syncComparisonSlots(derived, state.playerFilter || state.comparisonPlayers[0] || '');
      renderAll();
      return;
    }
      });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('input', (event) => {
    const target = event.target;
    if (!isClassicView() || !target) return;
    const editorSelectCommand = target.dataset?.classicCmdSelect || '';
    if (editorSelectCommand && target.matches?.('input[type="color"]')) {
      classicApplyEditorCommand(String(editorSelectCommand), String(target.value || ''), target);
      return;
    }
    const editTarget = target.dataset?.classicEditInput || '';
    if (editTarget) {
      state.classicEditingDrafts[editTarget] = target.isContentEditable ? String(target.innerHTML || '') : String(target.value || '');
      if (target.isContentEditable) classicRememberSelection(target);
    }
  });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('change', (event) => {
    const target = event.target;
    if (!isClassicView() || !target) return;
    const editorSelectCommand = target.dataset?.classicCmdSelect || '';
    if (editorSelectCommand) {
      classicApplyEditorCommand(String(editorSelectCommand), String(target.value || ''), target);
    }
  });
  if (typeof document?.addEventListener === 'function') {
    document.addEventListener('selectionchange', () => {
      if (!isClassicView() || !state.classicEditingTarget) return;
      const selection = window?.getSelection ? window.getSelection() : null;
      if (!selection || selection.rangeCount < 1) return;
      const range = selection.getRangeAt(0);
      const textNodeType = typeof Node !== 'undefined' ? Node.TEXT_NODE : 3;
      const node = range.commonAncestorContainer?.nodeType === textNodeType
        ? range.commonAncestorContainer.parentElement
        : range.commonAncestorContainer;
      const surface = node?.closest ? node.closest('[data-classic-edit-input][contenteditable="true"]') : null;
      if (surface) classicRememberSelection(surface);
    });
  }
  const resolveChartHoverFromEvent = (event) => {
    if (!event) return { zone: null, shell: null };
    const target = event.target || null;
    if (target?.closest) {
      const directZone = target.closest('[data-hover-index]');
      const directShell = target.closest('[data-chart-shell]');
      if (directZone && directShell) return { zone: directZone, shell: directShell };
    }
    const touch = event.touches?.[0] || event.changedTouches?.[0] || null;
    if (!touch || typeof document?.elementFromPoint !== 'function') return { zone: null, shell: null };
    const node = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!node?.closest) return { zone: null, shell: null };
    return {
      zone: node.closest('[data-hover-index]'),
      shell: node.closest('[data-chart-shell]'),
    };
  };
  let chartHoverLock = null;
  const clearChartHoverLock = () => {
    if (!chartHoverLock) return;
    document.querySelectorAll('.interactive-chart').forEach((node) => hideLineChartHover(node));
    chartHoverLock = null;
  };
  const isTouchLikeHoverEvent = (event) => {
    if (!event) return false;
    if (String(event.type || '').startsWith('touch')) return true;
    const pointerType = String(event.pointerType || '').toLowerCase();
    return Boolean(pointerType && pointerType !== 'mouse');
  };
  const handleChartHover = (event, options = {}) => {
    const { toggleLock = false } = options;
    const { zone, shell } = resolveChartHoverFromEvent(event);
    if (toggleLock && isTouchLikeHoverEvent(event)) {
      if (!zone || !shell) {
        clearChartHoverLock();
        return;
      }
      const nextIndex = String(zone.dataset?.hoverIndex || '');
      const sameSelection = chartHoverLock && chartHoverLock.shell === shell && String(chartHoverLock.index) === nextIndex;
      if (sameSelection) {
        clearChartHoverLock();
        return;
      }
      chartHoverLock = { shell, index: nextIndex };
      document.querySelectorAll('.interactive-chart').forEach((node) => {
        if (node !== shell) hideLineChartHover(node);
      });
      updateLineChartHover(shell, nextIndex, event);
      return;
    }
    if (chartHoverLock?.shell) {
      if (zone && shell === chartHoverLock.shell) {
        chartHoverLock.index = String(zone.dataset?.hoverIndex || chartHoverLock.index);
        updateLineChartHover(shell, chartHoverLock.index, event);
        return;
      }
      updateLineChartHover(chartHoverLock.shell, chartHoverLock.index, event);
      return;
    }
    document.querySelectorAll('.interactive-chart').forEach((node) => {
      if (node !== shell) hideLineChartHover(node);
    });
    if (!zone || !shell) return;
    updateLineChartHover(shell, zone.dataset.hoverIndex, event);
  };
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('mousemove', handleChartHover);
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('pointermove', handleChartHover);
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('pointerdown', (event) => handleChartHover(event, { toggleLock: true }));
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('touchstart', (event) => handleChartHover(event, { toggleLock: true }), { passive: true });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('touchmove', handleChartHover, { passive: true });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('pointerdown', (event) => {
      const onChart = event.target.closest?.('[data-chart-shell]') || event.target.closest?.('[data-hover-index]');
      if (!onChart && chartHoverLock) clearChartHoverLock();
    }, true);
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('touchstart', (event) => {
      const onChart = event.target.closest?.('[data-chart-shell]') || event.target.closest?.('[data-hover-index]');
      if (!onChart && chartHoverLock) clearChartHoverLock();
    }, { passive: true, capture: true });
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('mouseleave', (event) => {
      const shell = event.target.closest?.('[data-chart-shell]');
      if (shell && (!chartHoverLock || chartHoverLock.shell !== shell)) hideLineChartHover(shell);
    }, true);
  if (hasNode('analyticsMount')) qs('analyticsMount').addEventListener('change', (event) => {
    const target = event.target;
      if (target.id === 'participantSelect') {
        state.participant = target.value || '';
        state.comparisonPlayers[0] = state.participant;
        state.participantScope = '';
        renderAll();
        return;
    }
    if (target.id === 'participantScopeSelect') {
      state.participantScope = target.value || '__all__';
      renderAll();
      return;
    }
      if (/^compareSlot\d+Select$/.test(target.id)) {
        const slotIndex = COMPARISON_SLOT_IDS.indexOf(target.id);
        if (slotIndex >= 0) {
          state.comparisonPlayers[slotIndex] = target.value || '';
          state.comparisonMode = 'manual';
          if (slotIndex === 0) state.participant = target.value || '';
        }
        renderAll();
        return;
      }
    if (target.id === 'histogramGroupSelect') {
      state.histogramGroup = target.value || '';
      state.histogramPlayer = '';
      renderAll();
      return;
    }
    if (target.id === 'histogramPlayerSelect') {
      state.histogramPlayer = target.value || '';
      renderAll();
    }
  });
  if (window?.addEventListener) {
    window.addEventListener('resize', () => {
      if (!hasNode('analyticsMount')) return;
      initializeInteractiveCharts(qs('analyticsMount'));
    });
  }
}

bind();
hydrateStateFromUrl();
refresh();
