# OpenCV 5-kwalificatie voor MK8DX (2026-11-04)

Dit verslag hoort bij [PR #93](https://github.com/fromthelake/MK8DX-Ecosystem/pull/93).
Het volgt de doelpipeline uit
[`COMPONENTS.md`](../architecture/COMPONENTS.md):
Capture (app) → ROI Searcher → ROI Matcher → Frame/Sequence Decision → Result
(centraal in Python/TypeScript/Java) → Presentation (app). De resterende
producteigen pixelstappen worden per fase gemeten; dit verslag vervangt geen
besluit tot pipeline-eenwording.
De ruwe QA-invoer, array-snapshots, uitvoer en diffbeelden staan uitsluitend onder
`<private QA root>/post-release-opencv5/`. Bewaarde beelden,
namen, labels en modellen worden niet naar Git gekopieerd. De labels worden
uitsluitend gebruikt voor validatie, niet als herkenningsinput.

## Bronnen en versies

- [Officiële OpenCV 4→5-migratiegids](https://github.com/opencv/opencv/wiki/OpenCV-4-to-5-migration),
  [officiële changelog](https://github.com/opencv/opencv/wiki/OpenCV-Change-Logs),
  [OpenCV 5-overzicht](https://opencv.org/blog/opencv-5/) en
  [HoughLinesP-vormwijziging #29637](https://github.com/opencv/opencv/issues/29637),
  plus de [5.0.0-releaseopmerking](https://github.com/opencv/opencv/releases/tag/5.0.0)
  over het aparte Android-SDK-pakket voor apparaten met 16 KiB-geheugenpagina's.
- Python: `opencv-python` en `opencv-python-headless` 4.13.0.92 tegen 5.0.0.93.
  De twee `pip freeze`-lijsten verschillen uitsluitend in deze twee pakketten;
  `pip check` is in beide omgevingen schoon. OpenCV heeft één thread en vaste
  RNG-seeds. `freeze4-actual.txt` en `freeze5-actual.txt` bewaren de closure.
- Android: uitgebrachte OpenCV 4.10.0 tegen kandidaat 5.0.0.1. Web-scanner:
  `@techstark/opencv-js` 4.10.0-release.1, met OpenCV 4.10.0 in de lokale WASM.
  De Web-scanner en zijn ONNX Runtime 1.31.1 veranderen niet door #93.
  De 4.10-QA-worktree (`65b3f622`) en de 5.0-bron (`27f4f8f9`) verschillen
  als gecommitte bron uitsluitend in de Tournament `python-dateutil`-lock;
  de Android-productbron is gelijk, op de expliciet bewaarde QA-kandidaatpatch
  voor OpenCV 5 na.
- De huidige gedeelde referentiecatalogus is SHA-256 `2375050f…950c0`
  (`recognition-pack-0.4.1-20261102`). Een eerste Android-kandidaat gebruikte
  abusievelijk het pack van 1 november (`03725419…34a1`); de Web-run weigerde
  dat pack terecht met `Shared icon catalog version mismatch`. Die Android-run
  en de mislukte Web-run tellen **niet** mee voor de huidige pariteit. De
  vervangende Web- en Android4/5-runs gebruiken de 2-novembercatalogus;
  `qa-pack-selection.json` legt de correctie vast.
- Reproduceerbare inventarissen: `python-call-inventory.json` (1.027 expliciete
  `cv2`-aanroepen, 220 Python-bestanden; 528 product, 499 tooling) en
  `cross-platform-call-inventory.json` (448 Web-OpenCV.js-, 172 Android-OpenCV-
  en 23 overige Android-beeldbewerkingsaanroepen, inclusief argumenten en
  vlaggen). Generatie: `python tooling/review/opencv_call_inventory.py --output
  <QA>/python-call-inventory.json` en `python
  tooling/review/opencv_cross_platform_inventory.py --output
  <QA>/cross-platform-call-inventory.json`.

## Impactmatrix 4.x → 5.0

| Wijziging | Eigen aanroep en invoer | Effect | Onderbouwing |
| --- | --- | --- | --- |
| Java-geometrie uit `Imgproc`/`Calib3d` naar `Geometry` | Android-perspectieftransformatie en RANSAC-homografie | API-breuk | #93 compileert zonder gewijzigde import/aanroep niet; de nieuwe import bouwt. |
| Vector-Mat wordt 1D in plaats van Nx1 | Android `HoughLinesP`, gevolgd door `raw.rows()` en `raw.get(i,0)` | API-/vormbreuk | Dezelfde Canny-array geeft 11 lijnen in beide versies, als `11×1×4` versus `11×4`; de oude lus leest in 5.0 één lijn. `reshape(4, total())` geeft weer dezelfde 11 coördinaten. |
| Andere bilineaire warp-interpolatie | LiveTrial `warpAffine`; Android `warpPerspective`; enkele Python-toolingwarps | Gedragsverschil | Een enkele functieaanroep op dezelfde bewaarde arrays geeft maximaal 4 respectievelijk 5 pixelwaarden verschil. De migratiegids kondigt dit aan. |
| Nearest-neighbor-interpolatie zou Pillow volgen | `resize` van maskers en beelden; Web blijft 4.10 | Kans, nog niet toepassen | In onze 5.0.0.93-wheel blijft `INTER_NEAREST` op een bewaard masker 543 pixels van Pillow afwijken, net als 4.13; `INTER_NEAREST_EXACT` wijkt in beide nul pixels af. De gids en dit wheel komen op deze proef niet overeen. |
| FFmpeg-/decoderbuild gewijzigd | Python `VideoCapture`, `imread`/`imdecode` op scherm- en camerabeelden | Mogelijk gedrag | De vier gepeilde videoframes hebben dezelfde index, timestamp en gedecodeerde hash; volledige replay hieronder. OpenCV 4 heeft FFmpeg avcodec 58.134.100, OpenCV 5 avcodec 61.19.100. |
| Onbekende `VideoCapture.get`-property: −1 i.p.v. 0 | FPS/positie van eigen videolezer | Geen waargenomen breuk | De gebruikte FPS- en frame-properties zijn ondersteund en gelijk in de replay; controle van onondersteunde properties blijft relevant bij nieuwe backends. |
| Nieuwe DNN-engine / ONNX; Caffe/Darknet weg | Product gebruikt ONNX Runtime, geen OpenCV DNN; opt-in spike met RF-DETR | Kans, geen directe productimpact | 5.0 laadt het model dat 4.13 niet laadt; twaalf beelden tonen momenteel een tragere en numeriek afwijkende alternatieve inference-route. |
| Android 5.0.0-SDK en 16 KiB-pagina's | `org.opencv:opencv:5.0.0.1` in #93; Android-distributie | Packaging-risico bij latere toelating | De officiële 5.0.0-release raadt de `16kb-page-fix`-SDK aan voor Google Play. De gebruikte Maven-kandidaat is daarmee niet automatisch op 16 KiB-apparaten gekwalificeerd; de huidige wegwerp-AVD toetst dit niet. |
| `features2d` → `features`, ALIKED/DISK/LightGlue en objdetect-vernieuwing | Eigen ROI-zoeker en icon-matcher gebruiken geregistreerde panelen, klassieke template-/kleurvergelijking en RF-DETR via ONNX Runtime; geen SIFT/ORB/Haar/HOG-aanroep in de actieve beslisroute | Geen directe API-breuk; mogelijke toekomstige zoekstrategie | De Android 5.0.0.1-JAR bevat `ALIKED`, `DISK` en `LightGlueMatcher`, maar Web zit op OpenCV.js 4.10. Een geleerd featuremodel kan de bestaande pariteit niet zonder corpusbewijs vervangen. De 5.0-kans wordt daarom niet als productspike geselecteerd. |
| `calib3d`/`imgproc`-geometrie herverdeeld; USAC/ChArUco verbeterd | Python `findHomography` blijft `cv2.*`; Android `findHomography` en `getPerspectiveTransform` gebruiken nu `Geometry`; geregistreerde Select-a-Ghost-ROI gebruikt geen ArUco | Android-API-breuk, mogelijke numerieke verschuiving in homografie | De nieuwe Java-import is nodig om te compileren. De bestaande homografie-/warp-stappen worden in de fasevergelijking gemeten; fiducials toevoegen zou een aparte pipelinewijziging zijn. |
| Haar/HOG/ML/G-API verplaatst, features herverdeeld, nieuwe datatypes | Geen runtimeaanroep van deze modules of nieuwe datatypes | Geen | Volledige call-inventarissen hierboven. |
| Andere tekstweergave | Android-dossier/overlay, onder meer fase 07 | Alleen visuele QA-uitvoer | Previewpixels verschillen; deze overlays gaan niet terug de herkenningspipeline in. |

## Opstelling en tussenstappen

De tracing-harnascode in `tooling/review/opencv_step_trace.py` laat iedere
OpenCV-functie precies eenmaal uitvoeren en schrijft per aanroep bronlocatie,
argumenthashes, resultaat-hash, vorm, dtype en looptijd. Een limiet van 10.000
aanroepen begrenst de trace zonder de rest van de productrun te wijzigen.
`opencv_trace_compare.py` vergelijkt de resultaten en schrijft bij een verschil
maximale/gemiddelde pixelafwijking, gewijzigd percentage, PSNR en diffbeeld.
De losse `opencv_hough_probe.py`, `opencv_affine_probe.py` en
`opencv_warp_probe.py` bewijzen de eerste afwijkende functie op identieke
invoerarrays.

| Product / invoerklasse | Ruisvloer 4→4 | Eerste 4→5-afwijking | Gevolg |
| --- | --- | --- | --- |
| Icon-matcher, 261 opgeslagen ROI's: 22 capture, 2 demo, 193 telefoon, 44 webcam | 0 verschillen in beslissingen, score, marge, top 3 | Geen verschil in 2.961 gemeten OpenCV-aanroepen | Alle vier de invoerklassen behouden 261/261 dezelfde beslissingen en scores. |
| Tournament, 530 schermrijen in 45 races | Tweede 4.13-run: 0 verschillen in de eerste 10.000 aanroepen en dezelfde 530 rijobjecten | Geen verschil in de eerste 10.000 gemeten aanroepen | 530/530 dezelfde rijobjecten inclusief zekerheden; volledige gate 0 slechter. |
| Tournament, opgenomen capture-video | Dezelfde decodeerhashes bij herhaling van 4.13 | Geen invoer-/decoderverschil: alle 7.500 frames van de bewaarde demo-race hebben in 4.13 en 5.0 dezelfde index, timestamp en pixelhash | Volledige video `Demo_CaptureCard_Race.mp4` is op decoderniveau gecontroleerd; de 530-rijenpoort controleert de productherkenning op opgeslagen frames. Een volledige 7.500-frame extractie is niet gedraaid. |
| Python-invoerproef, 230 telefoon-JPEG's en 22 webcam-JPEG's | 4.13 twee keer: 0 verschillen voor drie decodeervlaggen per beeld | 4.13→5.0: 0 van 756 decodevarianten anders (`IMREAD_COLOR`, `IMREAD_UNCHANGED`, `IMREAD_IGNORE_ORIENTATION`) | Deze bronfoto's hebben geen EXIF-oriëntatie en geen ingebed ICC-profiel; hun specifieke oriëntatie-/kleurprofielgedrag is dus niet proefbaar met deze corpusleden. Dit is een decoderproef, niet een Web/Android-productscore. |
| Synthetische EXIF-/ICC-controle | Een 23×17-JPEG met EXIF-oriëntatie 6 en ingebed sRGB-profiel, buiten Git | Alle drie decodevarianten pixelgelijk tussen 4.13 en 5.0 | Dit controleert de decoderopties, maar bewijst niets over herkenningskwaliteit op echte foto's. |
| LiveTrial, HDMI-scenario's en video | 0 verschillen in 14.167 aanroepen; 12 scenario's en 13 panelen semantisch gelijk | `ghostmenu.py:267` `warpAffine`: zelfde input, max 4, gemiddelde 0,0581, 5,740% pixels, PSNR 60,38 dB | Scenario-/paneelbeslissingen en 214 score-/margewaarden gelijk. Video: 4.317 frames, 3.967 verwerkt, identieke run en identiteit. |
| Android, endscreen/scherm (vóór correctie) | Bestaande 4.10-dossier | Na gelijke Canny-stap: Hough-Mat-vorm | Eén i.p.v. elf lijnen; zekerheden zakten. Vormcorrectie herstelt voor het eerste beeld de vijf iconzekerheden exact. |
| Android, HDMI-scherm (na QA-correctie) | Twee runs van dezelfde 4.10-bron: geen fase-JSON- of PNG-verschillen | Eerste herkenningspixelverschil in `warpPerspective` fase 17: max 6, 6,986% pixelkanalen, PSNR 59,18 dB; fase 07 is alleen een preview-overlay | 152/152 staff76-HDMI- en 192/192 staff192-HDMI-panelen behouden status, tijd en markeringen; ruwe scores verschuiven. |
| Android, telefoonfoto (na QA-correctie) | Gelijke bewaarde bron en referentiecatalogus | Fase 17 `warpPerspective`: max 2, 7,960% pixelkanalen, PSNR 59,11 dB | 192/192 staff192-telefoonpanelen behouden status, tijd en markeringen; eerste JSON-verschil in fase 18-geometrie. |
| Android, webcamfoto (na QA-correctie) | Gelijke bewaarde bron en referentiecatalogus | Fase 17 `warpPerspective`: bij track 07 max 2, 3,905% pixelkanalen, PSNR 62,13 dB; bij track 36 max 1, 2,142%, PSNR 64,82 dB | 152/152 staff76-webcampanelen behouden de paneelstatus, maar twee veldmarkeringen veranderen; eerste JSON-verschil in fase 18 (track 07) of 19 (track 36). |

De telefoon-/webcam-foto's uit `TT_EXISTING_DATASETS.md` zijn Time Trial-
scannerinvoer, geen Tournament-scorebordproductpad. LiveTrial verwerkt de
bewaarde HDMI-/videosignalen; de staff76/192-telefoon- en webcamhelften zijn
Web-/Android-invoer. Deze klassen worden dus niet als geslaagde LiveTrial-
of Tournament-productpoort geteld. De icon-matcher vergelijkt wel bewaarde
ROI's uit alle vier de genoemde beeldfamilies.

De volledige LiveTrial-staff76-run (152 HDMI-panelen) heeft dezelfde eindstatussen,
velden en acceptatiemarkeringen in 4.13 en 5.0. Per veld zijn de ruwe scores,
marges, beslisbasis en numerieke evidence opnieuw vastgelegd in
`livetrial-staff76-full-evidence-{4,5}.json`. Van 1.124 vergeleken numerieke
waarden veranderen sommige, maar precies één visuele match kruist de actieve
`IconMatcher`-margegrens 0,02: het karakter in
`track_85_200_ghost_expanded_hdmi` gaat van 0,0195270 naar 0,0312299.
`matcher.py` behandelt de match daardoor eerst als `unknown` en daarna als
`accepted`. De centrale picker kiest eerst `family_then_colour` en daarna
`colour`; de uiteindelijke ID en acceptatiemarkering blijven gelijk. De
familieafstand 0,152451→0,142072 blijft ver boven de eigen grens 0,02.
Dit is toch een echte drempelkruising volgens beslisregel B, dus die regel is
**niet** gehaald. Twee op het eerste gezicht kritieke deelmarges van
glider/kart in staff76 zijn niet de actieve route: beide velden gebruiken
`name_family_character_colour` met dezelfde naamzekerheid (1,0) en
naammarge (respectievelijk 0,181818 en 0,333333) in beide versies.

De grotere LiveTrial-staff192-set (192 HDMI-panelen uit de telefoon/HDMI-paren)
is volledig opnieuw uitgevoerd met onafgeronde interne metrics. Er zijn 0
beslissingsverschillen, 0 andere acceptatiemarkeringen en 0 kruisingen van de
generieke score-/margegrenzen over 1.908 numerieke waarden. Herhaling van de
4.13-run gaf eveneens 0 verschillen in beslissingen en markeringen. De grootste
berekende afstand-afname tot een *generieke* grens is 11,19% voor de visuele
kartmarge van `tour_sydney_sprint_200_hdmi` (0,0188434→0,0189729), maar dat
veld wordt via `name_family_character_colour` beslist: de daadwerkelijk
gebruikte naamzekerheid is 1,0 en de naammarge 0,7 in beide versies, ruim
boven de 0,85/0,15-grenzen. De 0,02-visuele grens beslist dit veld niet. Het
staff76-geval hierboven kruist wél een actieve matchergrens; regel B blijft
daardoor onmogelijk, ongeacht deze ruimere staff192-uitkomst.

Een eerste Android5-staff76-gate op 304 panelen en staff192-gate op 384 panelen
liepen succesvol, maar gebruikten het verkeerde, oudere referentiepack. Ze
bewijzen alleen dat de QA-kandidaat start en de gate kan doorlopen; hun
herkenningsuitkomsten tellen niet voor de huidige pariteitsvergelijking. Een
verse Android4-run met het huidige pack was bovendien noodzakelijk: de bewaarde
Android4-samenvatting dateert van 29-10, terwijl de centrale
ROI-/grid-/registratiebron op 30-10 nog is gewijzigd. Geen van beide oude
samenvattingen wordt als exact 4.10-tegenbewijs hergebruikt. De verse run staat
hieronder. Er wordt niets aan herkenningsdrempels aangepast.

Met de correcte 2-novembercatalogus zijn de nieuwe Android5-staff76- en
staff192-runs op respectievelijk 304 en 384 panelen voltooid. De 76 uitgebreide
HDMI-panelen van staff76 hebben alle vijf velden juist geaccepteerd. De
staff192-telefoon-/HDMI-paren halen de tijd-, ronde- en vijfveldpoort 192/192
per invoerklasse. Tegen de **huidige** Web-run zijn er in staff192 0
veldverschillen op 192 HDMI- en 192 telefoonpanelen (1.920 veldparen); in
staff76 zijn er 0 op 152 HDMI-panelen en 8 op 152 webcampanelen. De
Android5-staff76-gate meldt wel één slechter webcamwiel ten opzichte van de
eerder geaccepteerde 29-oktoberbaseline (`track_36_200_ghost_expanded_webcam`:
`? shown right` → `? shown wrong`). De verse Android4-run op dezelfde bron en
catalogus wijst ditzelfde webcamwiel met `id=null`, `ok=false`, score `0,760`
en marge `0,368` af. Deze specifieke verslechtering is dus geen
OpenCV5-effect. De oude 1-novemberpack-runs tellen niet mee.

De verse Android4-staff192-tegenproef is intussen ook voltooid met de juiste
catalogus: 384/384 panelen hebben in 4.10 en de gecorrigeerde 5.0-kandidaat
dezelfde eindstatus, tijden, veld-ID's en acceptatiemarkeringen. De Web-pariteit
blijft in beide versies exact gelijk: nul veldverschillen in 1.920 paren. Ruwe
zekerheden zijn niet gelijk: op de 384 panelen veranderen 555 HDMI- en 547
telefoonscores, plus 536 respectievelijk 597 marges. De grootste absolute
scoreverschuiving is 0,092 voor een telefoonvlag; de grootste margeverschuiving
0,280 voor een HDMI-vlag. Deze cijfers alleen kwalificeren OpenCV 5 niet.

De huidige Android4- en Android5-staff76-runs zijn nu allebei voltooid met de
2-novembercatalogus. Voor de 152 HDMI-panelen zijn status, tijd en alle
markeringen gelijk; er verschuiven 212 scores en 206 marges. Voor de 152
webcampanelen blijven paneelstatus en tijden gelijk, maar twee veldmarkeringen
veranderen: `track_07_200_ghost_expanded_webcam` ghost-wheel wordt
`ok=false`→`true` bij score 0,812 en marge 0,361→0,362;
`track_36_200_ghost_expanded_webcam` ghost-glider wordt
`ok=false`→`true` bij score 0,7605→0,7604 en marge 0,0248. De IDs blijven
gelijk. Daarnaast verschuiven 178 webcam-scores en 164 marges. Beide versies
hebben acht veldverschillen met de onveranderde Web-scanner op deze
webcamset, maar niet op dezelfde twee velden; de HDMI-pariteit blijft exact
gelijk. Dit is een directe herkenningsuitkomstwijziging en bevestigt regel C.
De huidige 4.10-run heeft twee en de 5.0-run één verslechtering tegenover de
oudere 29-oktoberacceptatie; de gedeelde track36-wheel-verslechtering komt
ook in 4.10 voor en is dus geen OpenCV5-effect. De 4→5-markeringen hierboven
zijn wel echte OpenCV-kandidaatafwijkingen.

Het aparte 58-frame-dossier uit dezelfde actuele bron en catalogus behoudt
alle eindbeslissingen en markeringen. In alle 58 frames verschillen de
fase-17- en fase-18-PNG's; fase 07 verschilt al als versieafhankelijke
QA-overlay, maar is geen herkenningsinvoer. De diagnostische vergelijking
registreert één kruising van de generieke `ghost.wheel.margin`-waarde
0,004→0,055 bij frame 57 en vijf dalingen van een generieke grensafstand
van meer dan 10%. Zonder controle van de actieve beslisbasis zijn dit
diagnoses, geen extra beweerde productdrempelkruisingen. De ongewijzigde
eindmarkering doet niets af aan de twee webcammarkeringverschillen op staff76.
Bewijs: `android-58frames-4v5-nov2.json`,
`android-staff76-4v5-current.json`, `android-staff192-4v5-current.json`,
`stage-{hdmi,phone,webcam07,webcam36}-4v5-nov2.json` en de bijbehorende
pixelverschilbestanden onder de private QA-map.

`opencv_video_probe.py --all-frames` bewaart frame-index, timestamp, backend,
FFmpeg-versie en framehashes van de 7.500-frame Tournament-demo-MP4 in beide
venvs (`tournament-video-all{4,5}.json`; 0 hash- en tijdverschillen). Vier
gespreide LiveTrial-videoframes zijn daarnaast exact gelijk. `opencv_image_diff.py` en
`android_scan_dossier_diff.py` leveren de fasevergelijking van de APK-dossiers.
`opencv_image_input_probe.py` legt de drie OpenCV-decodevarianten en de
aanwezigheid van EXIF-oriëntatie/ICC vast zonder pixels in Git op te slaan.
Alle vastgelegde QA-arrays komen van een bestaande testscan; het model is
uitsluitend een beschermd, lokaal invoerbestand.

Een expliciete poging om `INTER_LINEAR_EXACT` aan `warpAffine` en
`warpPerspective` mee te geven faalt in OpenCV 5.0 met `Unknown interpolation
method` (`warp-exact-attempt.json`). Deze vlag herstelt het 4.x-warpgedrag dus
niet. Ook `cv2.setUseOptimized(False)` verandert de affine-uitvoer in geen van
beide versies: 4→5 blijft 5,740% pixelkanalen verschillen, terwijl 4 met/zonder
optimalisaties bytegelijk is (`affine-noopt-summary.json`). De 4→5-afwijking in
een warp is niet teruggebracht tot de nul-ruisvloer.

## Opt-in verbeterkansen, geen productdefault

| Rang en kans | Concreet probleem | Gemeten effect op dezelfde invoer | Kosten | Pariteit Python / Web / Android | Risico | Advies |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Nauwkeuriger en mogelijk snellere warp | Perspectief- en affinewarps zijn duur in de ROI-uitlijning | Op één bewaarde Android-perspectiefbron 5,758 ms (4.13) versus 4,057 ms (5.0), 29,5% sneller; output is niet pixelgelijk. Proces-RSS nam in dezelfde kleine spike 3,90 respectievelijk 3,79 MiB toe; dit verschil is geen betrouwbare geheugenwinst | Beperkte prototypecode, maar volledige corpuskwalificatie vereist | Python en Android 5 kunnen dit; Web blijft 4.10 | Scoreverschuiving en drempelkruising al aangetoond | Alleen bij pipeline-eenwording verder onderzoeken |
| 2. Pillow-gelijke maskerschaling met `INTER_NEAREST_EXACT` | Maskergrenzen kunnen per taal afwijken | Op één bewaard masker 543 afwijkende pixels met standaard `INTER_NEAREST` in zowel 4.13 als 5.0, nul met `INTER_NEAREST_EXACT`; geen gemeten beslissingswinst. Gemeten mediaan 0,0102 ms (4.13) en 0,0127 ms (5.0), bij dit kleine masker te ruisgevoelig voor een snelheidsclaim | Klein experiment, daarna alle maskerconsumenten en corpora | Python bewezen; Web/Android nog niet | Grenspixels kunnen matchscores veranderen | Bij pipeline-eenwording testen, geen default |
| 3. OpenCV 5 DNN voor RF-DETR | Eén inference-engine zou op termijn packaging kunnen vereenvoudigen | 5.0 laadt het beschermde 121 MB-model waar 4.13 op ONNX-operator `And` faalt; twaalf corpusbeelden: 2,340 s mediaan versus huidige ONNX Runtime 0,458 s, 471 versus 322 MiB na één inferentie. Detectie-aan/uit bij 0,2 gelijk; actieve box maximaal 0,000164 genormaliseerd anders | Hoge model-, geheugen- en distributiekosten | Geen bewezen Web/Android-route | Trager, meer geheugen, ruwe tensors anders | Nu niet oppakken |

De opt-in scripts `opencv5_imgproc_spike.py`, `opencv5_dnn_spike.py` en
`opencv5_dnn_memory_probe.py` schrijven alleen buiten Git. Deze kleine proeven
vervangen geen volledige corpusvergelijking en wijzigen geen productdefault.

## Herhalen met de afgeschermde corpusconfiguratie

Gebruik twee Python 3.12-venvs op dezelfde `freeze5-actual.txt`-closure.
Vervang daarin **alleen** `opencv-python` en `opencv-python-headless` door
4.13.0.92 voor de oude venv; `freeze4-actual.txt` en `freeze5-actual.txt`
bewaren de exacte verschillen. `pip check` moet in beide venvs slagen. Houd
invoer, machine, threadaantal (`cv2.setNumThreads(1)`) en seeds gelijk.
`<QA>` is een afgeschermde map buiten Git met de bestaande, alleen voor
validatie gebruikte corpora en `central_regression`-configuraties.

```powershell
python tooling/review/opencv_call_inventory.py --output <QA>/python-call-inventory.json
python tooling/review/opencv_cross_platform_inventory.py --output <QA>/cross-platform-call-inventory.json
<venv4>/python -m pip check
<venv5>/python -m pip check
<venv4>/python tooling/review/opencv_step_trace.py --output <QA>/tournament4.jsonl --max-calls 10000 tooling/recognition/central_regression.py --config <QA>/tournament-config-4.json --gates tournament
<venv5>/python tooling/review/opencv_step_trace.py --output <QA>/tournament5.jsonl --max-calls 10000 tooling/recognition/central_regression.py --config <QA>/tournament-config-5.json --gates tournament
python tooling/review/opencv_trace_compare.py <QA>/tournament4.jsonl <QA>/tournament5.jsonl --output <QA>/tournament-trace-4v5.json --diff-dir <QA>/diffs
<venv4>/python tooling/review/opencv_video_probe.py <private-demo-video> --all-frames --output <QA>/tournament-video-all4.json
<venv5>/python tooling/review/opencv_video_probe.py <private-demo-video> --all-frames --output <QA>/tournament-video-all5.json
<venv4>/python tooling/review/opencv_image_input_probe.py --directory <private-phone-frames> --directory <private-webcam-frames-1> --directory <private-webcam-frames-2> --output <QA>/image-input4.json
<venv5>/python tooling/review/opencv_image_input_probe.py --directory <private-phone-frames> --directory <private-webcam-frames-1> --directory <private-webcam-frames-2> --output <QA>/image-input5.json
```

Herhaal de 4.x-run voor dezelfde invoer vóór de 4→5-vergelijking. De
LiveTrial-run gebruikt `tooling/livetrial/measure_shared_shadow.py` voor de
12 scenario's, 13 panelen en bewaarde video, en
`measure_ghost_select.py --include-metrics` voor de staff76/192-panelen.
Deze LiveTrial-meetscripts en de beschermde engine-invoer staan alleen in de
private ontwikkelcheckout; het openbare harnas bevat geen bewaarde beelden.
De Android-run gebruikt `central_regression.py --gates android,android-staff76,android-staff192`
met een expliciet gecontroleerde wegwerp-AVD; de extra instrumentatietest
`OpenCvQualificationMetricsTest` bewaart stagehashes en één volledige
telefoon-/HDMI-/webcamfase. `opencv_android_qualification_compare.py`
vergelijkt de twee afgeronde stagebestanden. De werkelijke private config,
freeze-lijsten en uitvoer blijven uitsluitend onder `<QA>`.

## Besluit en resterende bewijsstukken

**Beslisregel C (vastgesteld op de volledige LiveTrial-staff76-set): #93 niet
mergen.** Regel A faalt omdat de identieke affine-/perspectiefinvoer boven de
nul-ruisvloer andere pixels oplevert en `INTER_LINEAR_EXACT` de oude warp niet
herstelt. Regel B faalt doordat de visuele karaktermarge in
`track_85_200_ghost_expanded_hdmi` de actieve 0,02-grens kruist. De uiteindelijke
ID en acceptatiemarkering blijven in dit geval gelijk, maar de beslisbasis
verschuift; B staat geen enkele drempelkruising toe. Geen drempel wordt aangepast.
Android 5 heeft bovendien een broncompatibele Mat-vormcorrectie nodig, die
uitsluitend in de QA-kandidaat bestaat. De proefpatch staat buiten Git als
`android5-qa-candidate.patch` en is geen productdefault. Herbeoordeel met een
gekwalificeerde OpenCV 5.1-kandidaat of bij de centrale pipeline-eenwording,
uiterlijk 2027-02-01. De Gradle-major-5-ignore moet alleen deze major treffen;
security-advisories blijven een aparte aanleiding voor onmiddellijke review.

**Aanvullend Android-bewijs:** op dezelfde bron, dezelfde 2-novembercatalogus
en de wegwerp-AVD zijn staff76 en staff192 zowel onder 4.10 als onder de
5.0-kandidaat gedraaid. De volledige staff76-run verandert twee
webcam-acceptatiemarkeringen; staff192 houdt alle markeringen gelijk. Web
heeft op staff76 acht webcamveldverschillen met beide Android-versies, maar
de twee veranderde velden wisselen van positie. De herhaalde 4.10-HDMI-fasetest
heeft nul JSON-/PNG-verschillen. Op HDMI, telefoon en webcam is de eerste
herkenningspixelafwijking fase 17, de perspectiefwarp; de eerdere fase-07-PNG
is slechts een overlay. Stage-JSON verschilt voor het eerst in fase 18
(HDMI/telefoon/track07-webcam) of fase 19 (track36-webcam). De 58 bewaarde
frames hebben gelijke beslissingen en markeringen, maar alle 58 hebben
verschillende fase-17-warpbeelden. Eén generieke marge kruist 0,02 en vijf
generieke grensafstanden krimpen meer dan 10%; hun actieve beslisbasis is
niet vastgesteld en ze worden dus alleen diagnostisch geteld.
Pakketbouw en runtime-smoke van Tournament/LiveTrial met OpenCV 5 zijn niet
nodig voor een afgewezen productdefault; de kandidaat-APK is wel gebouwd en op
een wegwerp-AVD uitgevoerd. Fysieke telefoon en productie zijn niet getest.
