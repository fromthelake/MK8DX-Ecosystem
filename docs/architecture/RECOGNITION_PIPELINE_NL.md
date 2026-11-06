# Herkenningspijplijn: gedeelde regels en lokale apps

[English](RECOGNITION_PIPELINE.md) ·
[Bron van de centrale lezer](../../packages/icon-matcher/README.md) ·
[Ontwikkelaarshandleiding](../DEVELOPMENT_NL.md)

De centrale lezer staat als broncode in `packages/icon-matcher/`. Het is geen
server: iedere scanner bouwt zijn eigen taalimplementatie mee en herkent lokaal.
De API valideert en bewaart voorgestelde resultaten; een gelezen naam bewijst
geen Player-identiteit.

```text
Opname → ROI zoeken → matchen → frame-/sequentiebesluit → resultaat → nakijken/verzenden
  app         gedeelde regels en lokale pixelbewerking             app en API
```

**Dezelfde regel** betekent een Python-referentie, een TypeScript- en een
Java-implementatie met dezelfde geversioneerde pariteitsvectoren. Java voert
geen Python uit. Ook is de pixelbewerking nog niet overal gelijk. De huidige
`main` heeft veldsemantiekversie **0.4.2** in alle drie talen; de gepubliceerde
`v0.1.0` bevat **0.4.1**. Nieuwe broncode is nog geen nieuwe release.

## Wat is centraal en wat blijft lokaal?

| Stap | Gedeeld | Nog per app |
| --- | --- | --- |
| Opname | Bron- en framemetadata volgen de pijplijn. | Camera, foto, HDMI/video en frametiming. |
| ROI zoeken | `card_roi`, `card_quad`, `frame_geometry`, `detections`, `lap_grid`, `panel_registration` en vastgelegde framebeschrijvingen. | Detectorinferentie en OpenCV-pixelwerk in Web/Android; vaste HDMI-posities en video in LiveTrial; scoreboardopname in Tournament. |
| Velden matchen | Centrale iconen-, zevensegment-, naam- en Ghost Select-regels. | OCR en voorbereiding van de afbeelding verschillen. Tournament gebruikt de centrale icoonlezer nu voor geëxporteerde **personages**, niet voor ieder kartonderdeel. |
| Framebesluit | Centrale resultaat-, tijd-, Mii- en veldbesluiten waar geïntegreerd. | Apps geven echte waarnemingen en kandidaatbeperking door; een beperkte lijst maakt een onzeker resultaat niet zeker. |
| Sequentiebesluit | Gedeelde veldstemregels en pariteitsvectoren. | Web/Android gebruiken wrappers; LiveTrial-video en Tournament houden nog eigen meerframebesluiten. |
| Resultaat | Centraal `scan_result` voor Time Trial-velden. | Nakijken, wachtrij, verzending en officiële Tournament-acceptatie blijven productwerkstromen. |

Dit is de **huidige** grens. [Issue #99](https://github.com/fromthelake/MK8DX-Ecosystem/issues/99)
gaat over de resterende eenwording van zoeker, matcher, besluit en resultaat.
Een gedeelde klassenaam of geslaagde build bewijst geen gelijke uitkomst op
dezelfde afbeelding.

## Hoe komt de code in een pakket?

| Product | Gebouwde implementatie |
| --- | --- |
| Web-scanner | TypeScript uit `packages/icon-matcher/ts/` wordt door Vite in de scanner gebundeld; `stage_shared_fields.mjs` zet een vastgelegde herkenningspack in `public/shared-icon/`. |
| Android | Gradle compileert `packages/icon-matcher/java/` en `java-result/` in de scanruntime; de app bevat lokaal gestagede referenties. |
| LiveTrial | `tooling/livetrial/prepare_engine.py` kopieert de Python-lezer in de voorbereide engine; de Windows-bouwer voegt de herkenningspack toe. Enginewijzigingen lopen via `engine-overlay/`. |
| Tournament-tools | De Windows-bouwer pint de Python-wheel `mk8dx-icon-matcher` met de andere runtimepakketten. |

De pack bevat de frameposities, ankers en referenties. Controleer bij een
release zowel de codeversie **als** de pack-ID in het gebouwde pakket. Private
testbeelden en labels komen niet in Git of openbare diagnoserapporten.

Het normale lokale LiveTrial-dashboard haalt namen, iconen, vlaggen en
circuitbeelden uit de verpakte `MK8DX Clean Assets/database.json` en serveert
beeldpaden onder de lokale `/assets/`-root. Het haalt deze afbeeldingen niet
van de Web-server. De oude pagina's `/grid` en `/deltagrid` zijn
kalibratiehulpen: hun `/api/grid/ref`- en `/api/deltagrid/ref`-routes kiezen
afzonderlijke lokale QA-referentiefoto's. De pakketbouwer sluit de
delta-/rondereferentiefoto's uit; ze zijn geen canonieke herkenningsreferenties
en geen runtimeafhankelijkheid.

## Een herkenningsregel aanpassen

1. Zoek op dezelfde invoer en bronprofiel de eerste afwijkende stap. Vergelijk
   alleen met een baseline uit **dezelfde broncommit**; noteer pack en pakket.
2. Pas eerst de Python-referentie en tests aan, daarna TypeScript en Java.
   Vernieuw vectoren en de semantiekversie als de beslissing kan veranderen.
3. Draai de centrale tests uit [Testing](../TESTING.md) en de geraakte apps.
   Controleer op gelabelde beelden tijden, gekozen IDs, onzekerheid,
   drempelmarges en de eerste afwijkende stap. Labels zijn alleen voor toetsing.
4. Controleer de gebouwde pakketten en voer een echte scan of replay uit voor
   de geraakte invoerklasse. Gelijke bronversies alleen zijn onvoldoende.

De gebruiker kijkt een voorgesteld resultaat na. Accountkoppeling en officiële
publicatie blijven afzonderlijke API-regels; OCR-tekst is geen identiteitsbewijs.
