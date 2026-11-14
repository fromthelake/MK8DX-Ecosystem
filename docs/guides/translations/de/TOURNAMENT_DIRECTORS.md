# Tournament Directors: einen Turnierabend leiten

*Dies ist eine maschinelle Übersetzung der [englischen Anleitung](../../TOURNAMENT_DIRECTORS.md); maßgeblich ist die englische Fassung. Korrekturen sind willkommen über das Issue-Formular „Translation correction“.*

[Alle Anleitungen](../../../../README.md#get-started) · [Referenz der Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Ein Tournament Director (Turnierleiter) leitet einen Turnierabend auf der Community-Website: Teilnehmer, Konsolen,
Gruppen, Punkte, Finale und der veröffentlichte Bericht. Die Windows-**Tournament Tools** können die Rennergebnisse aus
Aufnahmen oder einer Live-Aufnahme lesen, sodass du nicht jede Platzierung von Hand eintippen musst. Sie sind optional:
Punkte können auch von Hand eingegeben oder aus Excel/CSV importiert werden.

**Ohne Website:** Die Windows-Tournament-Tools in [Abschnitt 3](#3-die-windows-tournament-tools) (Processor,
Analysis und Live) funktionieren für sich allein. Sie schreiben Excel-, CSV- und JSON-Dateien auf deinen PC; Connect ist optional.

Die Erkennung macht nie ein Ergebnis offiziell. Du prüfst jedes Rennen, bevor es zählt, und du entscheidest über die Veröffentlichung.

## 1. Turnierleiterrechte auf der Website deiner Community bekommen

1. Melde dich auf der Website an (siehe [Spieler](PLAYERS.md)).
2. Wähle auf der Seite **Turniere** die Option **Anfrage zum Ausrichten**. Ein Administrator nimmt die Anfrage an oder lehnt sie ab.
   Administratoren und, nach der Freigabe, Turnierleiter sehen diese Schaltfläche nicht: Sie sehen **Neues Turnier erstellen**
   auf derselben Seite (in der Leiste **Rennleitung**) und starten den Abend von dort.
3. Um erkannte Rennen aus den Windows-Tools an die Website zu senden, gewährt ein Administrator deinem angemeldeten
   Spieler außerdem Zugriff unter **Verwaltung → Turniere → Turnierleiter**. Das gibt Turnierzugriff,
   keine allgemeine Verwaltung.

## 2. Den Abend auf der Website leiten

Öffne das Turnier über **Turniere** (Administratoren erreichen es auch unter **Verwaltung → Turniere**).
Der Abend ist eine Folge von Schritten; die Seite zeigt, wo du gerade bist:

| Schritt | Was du tust |
| --- | --- |
| 0 | Den Turnierleiter wählen |
| 1 | Das Turnier starten |
| 2 | Die Teilnehmer auswählen, markieren, wer anwesend ist und welche Switches sie mitbringen (die Häkchen **NS1**/**NS2** neben jedem Namen) |
| 3-4 | Die Aufteilung der Qualifikation erstellen und exportieren (Gruppen und Sitzplätze) |
| 5 | Die Punkte der Qualifikation eingeben: von Hand, aus einer Excel/CSV-Datei oder aus **Eingehende Ergebnisse** |
| 6 | Die Ergebnisse der Qualifikation exportieren |
| 7-8 | Die Finalgruppen prüfen und exportieren |
| 9 | Die Punkte der Finalgruppen eingeben; ein Import arbeitet pro Gruppe und lehnt eine Gruppe ab, solange ein Name noch nicht zugeordnet ist |
| 10 | Abschließen und teilen: Endtabelle, Bericht und der WordPress-Export |

Schritt 2 geht nur weiter, wenn es genug Switches gibt: Jede Switch bietet zwei Spielern Platz, also braucht der Abend
mindestens die Hälfte der anwesenden Teilnehmer, aufgerundet, in abgehakten Switches (9 anwesende Spieler brauchen 5). Das
Bereitschaftsfeld unter der Liste zeigt, wie viele fehlen; hake die Switches ab, die die Leute mitbringen, oder verschiebe
Teilnehmer nach **Warteliste** oder **Abwesend**.

Für Rennen, die aus den Tournament Tools kamen: Öffne **Eingehende Ergebnisse** für die Gruppe, ordne jeden erkannten
Namen dem richtigen Spieler zu, prüfe die Strecke und die Platzierungen im Ziel und wähle **Bestätigen**. Eine vorläufige
Live-Tabelle ist kein offizielles Ergebnis. Du kannst auch eine Ergebnisdatei direkt importieren, mit **Offline-Ausweichlösung:
eine gespeicherte Live-/Processor-Ergebnisdatei importieren** innerhalb einer Gruppe oder mit **Verwaltung → Turniere → Kanonische Rennergebnisse importieren**.

Veröffentlichung und Community-Wertung sind getrennte Entscheidungen im letzten Schritt.

## 3. Die Windows-Tournament-Tools

### Voraussetzungen

- Windows auf x86-64 (getestet unter Windows 11) und mehrere GB freier Speicher. Das ZIP ist etwa 450 MB groß und entpackt etwa 1,3 GB; das
  Installationsprogramm braucht einmal Internet, um Python 3.12 und öffentliche Pakete herunterzuladen (mehr mit GPU/CUDA); alle OCR-Modelle
  sind enthalten. Nach der Installation funktioniert die Verarbeitung offline. Eine NVIDIA-Karte
  beschleunigt nur den OCR-Schritt; der erste Scan einer Aufnahme läuft immer auf der CPU (siehe
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Für die Live-Aufnahme: eine Capture-Karte mit einem funktionierenden Windows-Treiber (DirectShow). Für Aufnahmen: nichts weiter.
- Optional, zum Senden von Ergebnissen: die Website-Adresse und Zugriff als Turnierbetreiber (Schritt 1).

### Installieren

1. Lade auf der Seite [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) des Projekts (die
   Release-Pakete hängen an jedem Release) `tournament-tools-….zip` und `SHA256SUMS.txt` herunter. Mit einem Klon
   kannst du es stattdessen selbst bauen ([Die Tools selbst bauen](#die-tools-selbst-bauen)). In PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, und vergleiche den ganzen Wert.
2. Entpacke das vollständige ZIP in einen beschreibbaren Ordner (nicht `Program Files`). Lass `runtime-assets\` neben den
   Startdateien.
3. Doppelklicke auf `Install-MK8DX-TournamentTools.cmd` und warte auf `SUCCESS`. Es wählt für diesen Computer selbst
   NVIDIA CUDA oder CPU-PyTorch. Wenn es fehlschlägt, lies `install.log` im Paketordner.

Das Installationsprogramm schreibt diese Startdateien:

| Startdatei | Verwendung |
| --- | --- |
| `TournamentProcessor.cmd` | Ziehe eine `.mp4`- oder `.mkv`-Aufnahme darauf. Es schreibt einen Sitzungsordner neben das Video (`<name>_TournamentSession\Output_Results\`) mit Excel, CSV und `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Ein Fenster für dieselbe Analyse aufgezeichneter Videos, mit mehreren Videos oder einem Ordner pro Turnier ([unten](#aufnahmen-nachträglich-analysieren)). |
| `TournamentLive.cmd` | Live-Aufnahme während des Abends oder ein Video abspielen: **Videodatei hinzufügen** (oder füge ein Aufnahmegerät hinzu), **Alle starten**, prüfe **Bestätigter Stand**, dann **Exporte öffnen**. Zum Abliefern des Laufs siehe [Tournament Live zur Website](#tournament-live-zur-website). |
| `TournamentConnect.cmd` | Optionale Verbindung zur Website (unten). |
| `TournamentLiveCli.cmd` | Diagnose: Geräteerkennung, Wiedergabe- und Ergebnisbefehle. Kein Ersatz für das Live-Fenster. |

`TournamentTools.config.cmd` enthält lokale Pfade und Spracheinstellungen. Behalte sie, den Sitzungsordner `TournamentLive\`
und deine Ausgabeordner, wenn du ein neueres Paket installierst.

### Aufnahmen nachträglich analysieren

Nutze Tournament Live, wenn du den Abend aufnimmst, während er stattfindet. Wenn der Abend ohne es lief und du nur
Aufnahmen hast, analysiere sie nachträglich mit dem Fenster **Tournament Analysis**:

1. Doppelklicke auf `TournamentAnalysis.cmd` im Paketordner.
2. **① Choose recordings** (Aufnahmen wählen): **Add videos...** (Videos hinzufügen...) wählt eine oder mehrere Aufnahmen (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Add folder...** (Ordner hinzufügen...) fügt einen Ordner hinzu, der die Aufnahmen eines Turniers enthält.
3. **② Choose videos** (Videos wählen): Alles, was du hinzugefügt hast, ist abgehakt; entferne das Häkchen bei dem, was nicht analysiert werden soll (**All** (Alle), **None** (Keine),
   **Clear** (Leeren)).
4. **③ Run the analysis** (Analyse ausführen): Prüfe die **Session id** (Sitzungs-ID; aus dem ersten Namen und dem Datum ausgefüllt; sie wird
   bei jedem Rennen gespeichert) und den **Results folder** (Ergebnisordner; standardmäßig `<first name>_TournamentSession` neben der ersten
   Aufnahme) und wähle dann **START ANALYSIS** (Analyse starten). Das Fenster führt dieselbe Verarbeitung aus wie `TournamentProcessor.cmd`;
   das Aktivitätsprotokoll zeigt seine farbige Ausgabe, das Startlicht wird bernsteinfarben, und **Cancel** (Abbrechen) beendet sie. Aufnahmen
   werden in `Input_Videos\` des Ergebnisordners verknüpft oder kopiert, wenn sie auf einem anderen Laufwerk liegen.
5. **🏁 Results** (Ergebnisse): Wenn dort **Finished** (Fertig) steht, **Open Latest Excel** (Neueste Excel-Datei öffnen) oder **Open Results Folder** (Ergebnisordner öffnen): `Output_Results\`
   enthält die Excel-Arbeitsmappe, die CSV und `*_TournamentRaceResultsV1.json`. Prüfe die Rennen und importiere dann die JSON
   auf der Website wie oben beschrieben.

Die Texte folgen der Windows-Sprache (Englisch oder Niederländisch); `MK8DX_TOURNAMENT_LANGUAGE` in
`TournamentTools.config.cmd` überschreibt sie. Um ein anderes Bild im Banner zu zeigen, setze `MK8DX_ANALYSIS_BACKGROUND`
in `TournamentTools.config.cmd` auf diese Datei. Aus einem Klon öffnet `python -m tournament_processor.gui` dasselbe Fenster, wenn der
Tournament Processor und seine Erkennungs-Assets installiert sind; es braucht PySide6 (das `gui`-Extra des Processors) und
öffnet sonst, oder mit `--classic-gui`, ein einfacheres Tkinter-Fenster.

### Mit der Website verbinden (optional)

In PowerShell, im Paketordner:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Nutze `http://127.0.0.1:<port>` (oder `http://localhost:<port>`) nur, wenn die Website auf demselben Windows-Computer
läuft, wie bei A1 und A3: Einfaches HTTP wird für diese Adressen auf diesem PC akzeptiert und für nichts sonst; jede andere
Adresse braucht ihre vertrauenswürdige HTTPS-Adresse. Ohne Terminal (zum Beispiel aus einem Skript) fragt `sign-in` nicht:
Setze die Adresse zuerst mit `TournamentConnect.cmd server <address>`. Uploads, die auf einen Server warten, bleiben bei
diesem Server. Ein abgeliefertes Rennen landet in **Eingehende Ergebnisse**; es wird nie automatisch veröffentlicht.

### Tournament Live zur Website

1. Wähle in Tournament Live **Mit Tournament Manager verbinden** (später **Turnier wechseln**), schließe die Anmeldung im
   Browser ab und wähle den Abend in **Choose Tournament** (Turnier wählen). Diese Wahl ist nur ein Vorschlag; du kannst sie vor
   oder nach dem Lauf treffen.
2. Starte die Feeds (**Videodatei hinzufügen** oder eine Capture-Karte, dann **Alle starten**). Tournament Live fügt eine
   Capture-Karte, die es sich gemerkt hat, womöglich selbst hinzu, als zusätzliche Quelle in Group 1 (Gruppe 1). Liegt auch ein Video
   in Group 1, stoppt **Alle starten** mit *Assign every feed to exactly one different group* (Weise jeden Feed genau einer anderen
   Gruppe zu): Wähle die zusätzliche Quelle aus und wähle **Auswahl entfernen**, oder gib ihr eine eigene Gruppe, und starte erneut.
3. Öffne auf der Website den Abend, gehe zu Schritt 5 (Schritt 9 für die Finalgruppen) und suche den Lauf unter **Verfügbare Tournament-Live-Aufnahmen**.
   Wähle seine Gruppe in **Mit Gruppe verknüpfen** und dann **Geprüfte Aufnahme verknüpfen**. Die Rennen warten als ausstehende
   Belege, bis du sie annimmst.

### Später verbinden

Ein ohne Verbindung verarbeiteter Abend ist auf deinem PC vollständig: `Output_Results\` enthält die Excel-Arbeitsmappe, die CSV
und `*_TournamentRaceResultsV1.json`. Auch Tournament Live ohne Verbindung schreibt seine Excel-Arbeitsmappe: wenn du
die Feeds stoppst, wenn die Analyse fertig ist oder wenn du das Fenster schließt, während noch Feeds laufen (es stoppt sie
zuerst). Die Dateien bleiben in `Live_Output\exports` (**Exporte öffnen**), nachdem du es geschlossen hast. Wird Live beendet, bevor
die Feeds stoppen, fehlt diese letzte Arbeitsmappe; die Aufnahmen bleiben, und Tournament Analysis oder der Processor
erstellen daraus dieselbe Arbeitsmappe. Danach wird nichts von selbst gesendet; bring es auf einem dieser Wege zur
Website:

- In der Gruppe auf der Website: **Offline-Ausweichlösung: eine gespeicherte Live-/Processor-Ergebnisdatei importieren** mit der JSON
  oder der Excel-Import der Gruppe. Jeder erkannte Name muss zuerst einem Spieler zugeordnet sein; ein Import lehnt eine Gruppe ab,
  solange ein Name nicht zugeordnet ist.
- Ein Administrator: **Verwaltung → Turniere → Kanonische Rennergebnisse importieren**. Importierte Rennen bleiben privat,
  bis sie veröffentlicht werden.
- Mit TournamentConnect: `.\TournamentConnect.cmd sign-in`, dann
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Es fragt nach dem Abend, der Gruppe und der
  ersten Rennnummer; die Rennen kommen in **Eingehende Ergebnisse** an. Ist die Website nicht erreichbar, bleibt die Datei,
  wo sie ist; sende sie später erneut.
- In Tournament Live: Wählst du den Abend mit **Mit Tournament Manager verbinden**, nachdem eine Sitzung beendet ist, wird
  diese beendete Sitzung dem Abend angeboten. Uploads, die fehlschlugen, während Live verbunden war, werden aufbewahrt und erneut gesendet,
  automatisch oder mit **Upload erneut versuchen**, nur für dasselbe angemeldete Konto. Eine mit **Offline arbeiten** ausgeführte Sitzung
  wird nicht für den Upload aufbewahrt; nutze für ihre Datei einen der Wege oben.

Die Anmeldung bringt zwei Dinge: die Liste der Abende, an die du abliefern darfst, und den Live-Feed während des Abends (`target`),
der jedes Rennen an die gewählte Gruppe sendet, sobald Tournament Live es erkennt. So oder so zählt ein Rennen erst, nachdem
du es in **Eingehende Ergebnisse** bestätigt hast.

### Prüfen, was gelesen wurde

Die OCR kann einen Namen, eine Platzierung oder eine Gesamtpunktzahl falsch lesen. Vergleiche jedes Rennen mit dem Bildschirm oder der Aufnahme, bevor
du es bestätigst. Eine bekannte Einschränkung: Tournament Live kann ein korrektes Rennergebnis mit einer falsch gelesenen
Gesamtpunktzahl exportieren, und die Prüfung auf der Website kann den beobachteten Namen oder die Gesamtpunktzahl nicht bearbeiten (siehe
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

Die Tools lesen das Spiel in seinen 15 Konsolensprachen. Tournament Live hat mit dem Paket v0.2.2 einen physischen
1×-Abnahmelauf bestanden: Drei Quell-PCs spielten aufgezeichnete Qualifikationsvideos in ihre eigenen Capture-Karten ab
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Eine Videowiedergabe ohne Capture-Karte
testet den Aufnahmeweg nicht.

## Die Tools selbst bauen

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` aus einem Klon baut
dasselbe Paket; siehe [Client builds](../../../CLIENT_BUILDS.md).
