# OpenCV 5-herkwalificatie (2026-11-05)

## Aanvullende gelijkbroncontrole op 6 november

De eerdere lokale kwalificatie hieronder is aangevuld na twee gerichte
tijdcorrecties op drie- en zevenrondenresultaten. De huidige private
broncommit is `ccd42b3e`; de publieke kandidaat is nog een lokale
OSS-branch. De tweede ghost-kolomproef begint bij drie ronden nu na de
bestaande veld- en leestekenuitlijning; de zevenrondenroute behoudt zijn
volgorde. Als een rondesom meerdere pixelonderbouwde veldcorrecties
oplevert, kiest Web/Android alleen de ene kandidaat die de bestaande
veldvergelijking ten opzichte van zijn eigen oorspronkelijke lezing
verbetert. Geen drempel of OpenCV-parameter veranderde.

De proef is stapsgewijs uitgebreid: drie echte eindschermen, vijf HDMI-
eindschermen, 17 beelden uit dezelfde sessie, de 58 HDMI-resultaatkaarten,
staff8, staff76 en daarna staff192. Op de drie gerichte Android-beelden
geven 4.10 en 5.0 dezelfde status, tijdvelden en rondesom; 31/32 tijden
zijn in beide exact tegen het onafhankelijke label, met één bestaande
niet veilig geaccepteerde zevenrondenfout. De 58 Android-HDMI-kaarten
leveren in beide versies 584/584 exacte tijden en geen veranderde
beslissing of markering. Web op dezelfde 58 kaarten is eveneens 584/584
exact en zonder markeringverschuiving.

De volledige Web-staff192-herhaling heeft onder **beide** versies
192/192 HDMI en 192/192 telefoonpanelen juist: alle tijden, ronden en
vijf onderdelen per beeld. Op 384/384 beelden zijn scanstatus, tijdvelden,
rondesom en onderdeelmarkeringen tussen 4.10 en 5.0 identiek. Daarmee is
het samengestelde staff192-bewijs hieronder vervangen door een volledige
run op de actuele kandidaat. Web-staff76 heeft geen tijds- of statusdrift;
drie veilige acceptatie→onzeker-verschuivingen op 720 markeringen (0,42%),
één correct geaccepteerde verbetering en één onzeker kandidaatswissel.
De private galerij is voor alle vijf verschuivingen opnieuw uit de actuele
workeruitvoer opgebouwd: echte canonieke beelden, exacte picker-PNG's en
voorbereide OCR-invoer. In Chromium laadden 48/48 afbeeldingen.

Android-staff76 is op 152 uitgevouwen panelen opnieuw op dezelfde bron,
pack en wegwerp-AVD vergeleken: nul veranderde statussen of tijden en twee
webcammarkeringen van onzeker-correct naar geaccepteerd-correct; HDMI blijft
ongewijzigd. Android-staff192 is nu op beide versies volledig gescoord:
192/192 HDMI en 192/192 telefoonpanelen slagen, zonder veranderd status-,
tijd- of onderdeelbesluit. De 5.0-instrumentatie werd na 205 beelden door
een onderbroken QA-hostsessie vervolgd met de laatste 181 beelden. Twee
overlapbeelden hadden identieke beslisgegevens; de combinatie controleerde
de exacte manifestvolgorde en 384 unieke resultaten. Interne scores en
marges verschuiven, maar geen markering of tijd.

De bron van 108 relevante Python-, Tournament- en LiveTrial-Pythonbestanden
is bytegelijk aan de al gekwalificeerde OpenCV-5-QA-boom; de eerdere
productbewijzen worden onder dezelfde pack- en runtimeaannames hergebruikt.
De publieke herkenningsset is op de huidige Web-kandidaat 12/12 groen.
De OSS-privacycheck onderzocht bij de laatste controle 9.337 paden zonder bevinding na het
verplaatsen van één lokaal gegenereerd Playwright-foutcontextbestand naar
de private QA-map. Publieke Verify en PR blijven aparte integratiepoorten.
Geen release of productiehandeling.

Dit verslag volgt op de [eerste analyse](OPENCV5_QUALIFICATION_2026-11-04.md).
Die vond onder meer een gewijzigde perspectiefwarp en twee fout
geaccepteerde Ghost Select-onderdelen in de Web-scanner. De fout ontstond
na de warp, bij de OCR-naamkeuze: `Parafoil` in plaats van `MKTV Parafoil`
en `Normal` in plaats van `Normal Blue`. De crop en de icoonranglijst
wezen in beide gevallen naar het juiste onderdeel. Een algemene dubbele
OCR-lezing (`gray` en `bin`) is verworpen omdat zij elders een fout
telefoonwiel accepteerde.

De centrale Ghost Select-picker in Python, TypeScript en Java gebruikt nu
de onafhankelijk geaccepteerde visuele topkandidaat als de gelezen sterke
naam een volledige woordreeks in diens langere catalogusnaam is, de twee
namen conflicteren en de panelkleur betrouwbaar is. Hij verandert geen
OCR-voorbereiding of drempel. De picker heeft `decisionVersion` 2 en
veldsemantiek 0.4.2. Android past daarnaast de OpenCV-5 Geometry-API en
de nieuwe HoughLinesP-Mat-vorm aan. De Web-loader ondersteunt de Promise-
wrapper en splitst de 5.0-WASM uit de nieuwe distributievorm.

## Opstelling en bewijsgrens

- Android 4.10 en 5.0: dezelfde QA-bron `289d0219256fbc8c2c6757f8e1c40d23d7819e50`
  plus identieke picker 2, dezelfde invoer, packinhoud en wegwerp-AVD
  `Vivo_X200_Pro_API36`. Het release-AVD is niet gebruikt.
- Web 4.10 en 5.0: dezelfde bron, afbeeldingen en pack. De 5.0-kandidaat
  heeft alleen de noodzakelijke WASM-lader/splitter aangepast. De
  herkenningspack bevat 5.396 identieke inhoudsbestanden en dezelfde
  pack-ID `1fe69b44ba3c92b682c424f49106d619f01399031e0411624495deedc82bd6bd`;
  bij veldsemantiek 0.4.2 verschilt alleen het manifestversieveld.
- De publieke assetcollectie `master-schema9-v5.10-pack-0.4.2-2026-11-05-r1`
  vervangt alleen het versieveld in het herkenningsmanifest en in de
  Android-stagemetadata. De overige objecten blijven gelijk. De volledige
  collectiecontrole bevestigt 15.014 logische bestanden en 7.025 unieke objecten.
- De twee Python-venvs verschilden alleen in `opencv-python` en
  `opencv-python-headless` (4.13.0.92 tegenover 5.0.0.93); `pip check`
  was in beide schoon. Eén thread en vaste seeds beperkten ruis.
- Alle originele beelden, labels, volledige traces, verschilafbeeldingen,
  logcat en een galerij met echte tussenbeelden blijven in de private
  QA-opslag. Alleen meetmetadata staat in Git. Labels zijn uitsluitend
  voor validatie gebruikt.

| Poort | Uitkomst | Hergebruik/afbakening |
| --- | --- | --- |
| Android 58 resultaatkaarten | Eindbeslissingen, tijden en markeringen gelijk | Eerdere gelijkbronmeting hergebruikt: picker 2 leest alleen Ghost Select-onderdeelnaamregels. |
| Android staff192 | 192/192 HDMI en 192/192 telefoon juist onder beide versies; nul gewijzigde eindkeuzes, markeringen, tijden of ronden | Volledige 4.10/picker-2- en 5.0/picker-2-runs; interne scores/marges verschillen. |
| Android staff76 | HDMI zonder regressie; eerdere veilige webcamverbeteringen blijven | De 152 uitgevouwen panelen opnieuw met 5.0/picker 2: nul eind- of metriekverschillen tegenover 5.0/picker 1. De 152 samengevouwen panelen lezen geen gedrukte onderdeelnaam. |
| Web staff192 | 4.10 en definitief 5.0: elk 192/192 HDMI en 192/192 telefoon juist; 384/384 gelijke status, tijden, rondesom, identiteit en markeringen | De volledige gelijkbronherhaling van 6 november vervangt het samengestelde bewijs van 5 november. |
| Web staff76 | 304 invoeren; picker 2 verandert geen enkele eindbeslissing tegenover 5.0/picker 1 | De eerdere 4.10→5.0-meting blijft geldig: drie veilige verschuivingen op 720 markeringen (0,42%), geen nieuwe fout geaccepteerd. |
| LiveTrial staff76/staff192 | 152/192 HDMI-panelen: picker 2 geeft nul gewijzigde eindbeslissingen, markeringen of drempelkruisingen tegenover 5.0/picker 1 | Eerdere 4.13→5.0-vergelijkingen hergebruikt. Tournament gebruikt deze Ghost Select-naamregel niet; zijn eerdere OCR-/scoreboard-vergelijking blijft geldig. |
| Taalpariteit en pakketten | Python 6 gerichte tests geslaagd, 1 private catalogusvector overgeslagen; 20 TypeScript-vectoren gelijk; Java-pariteit groen. LiveTrial- en Tournament Tools-pakketten gebouwd, ZIP CRC groen, launchers gestart, runtime OpenCV 5.0.0/Pillow 13.0.0; Tournament `pip check` groen. | Private assetpakketten blijven buiten Git. |
| Android-product-APK | Debug-APK met packveld 0.4.2 en uitsluitend OpenCV-5-libraries gebouwd, 16 KiB-uitlijning groen; installatie/start en een galerijscan leverden een canonieke inzending, zonder AndroidRuntime-fatal. | Op wegwerp-AVD; geen fysieke telefoon of productietest. |

**Besluit:** nul nieuwe geaccepteerd-maar-foute resultaten, exacte tijden
en ronden, geen onveilige HDMI-verschuiving, drie veilige Web-staff76-
verschuivingen (0,42% van 720), en ongewijzigde drempels. De update voldoet
aan de op 5 november afgesproken herkenningsregel. De oorspronkelijke
karaktermarge `0,019527→0,031230` kruiste de eerdere striktere regel,
maar het onderdeel bleef juist en de acceptatiemarkering gelijk. De
perspectiefwarp is nog steeds de eerste pixelstap die boven de gemeten
ruisvloer afwijkt; de twee Web-HDMI-fouten kwamen pas in de tekstkeuze
tot uiting en zijn door de gedeelde naam/icoonregel gecorrigeerd.

De bron en pakketten zijn lokaal gekwalificeerd. Een groene publieke Verify
en PR-review blijven aparte integratiepoorten. Er is geen tag, release of
productie-uitrol uit deze kwalificatie voortgekomen.
