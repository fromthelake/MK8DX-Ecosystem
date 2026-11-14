# LiveTrial: Zeitfahren unter Windows aufzeichnen

*Dies ist eine maschinelle Übersetzung der [englischen Anleitung](../../LIVETRIAL.md); maßgeblich ist die englische Fassung. Korrekturen sind willkommen über das Issue-Formular „Translation correction“.*

[Alle Anleitungen](../../../../README.md#get-started) · [README der LiveTrial-Komponente](../../../../apps/timetrials-desktop/README.md)

LiveTrial ist ein Windows-Programm, das deine Zeitfahren über eine Capture-Karte verfolgt oder aufgezeichnete Videos
liest, jeden Lauf erkennt (Gesamt- und Rundenzeiten, Fahrer und Fahrzeugkombination, Geist) und ihn mit einem Clip
auf deinem PC speichert. Nachdem du dich einmal angemeldet hast, kann es die Ergebnisse an die Website deiner
Community senden. Ergebnisse, die noch nicht gesendet werden können, warten auf dem PC.

## Ohne Community-Website

LiveTrial funktioniert auch für sich allein. Aufnahme, Videoanalyse, **Laufverlauf**, Clips und Korrekturen funktionieren
alle lokal. Läufe, die ohne Konto aufgezeichnet wurden, bleiben nur auf diesem PC, bis du sie mit **Senden als <account>**
sendest. Die Tabs **Meine Rekorde**, **Rang** und **Kombination** brauchen eine angemeldete Community.

## Voraussetzungen

- Windows auf x86-64 (getestet unter Windows 11). Etwa 1 GB für das Programm plus Platz für deine Aufnahmen.
- Für die Live-Aufnahme: eine Capture-Karte, die Windows als Videogerät aufführt, mit ihrem Treiber, und **FFmpeg**
  (kostenlos, wegen seiner Lizenz nicht enthalten; siehe Schritt 4 unten). Für Videodateien: keine Capture-Karte und kein FFmpeg.
- Zum Senden von Ergebnissen: die Adresse der Website deiner Community und ein Konto dort (siehe [Spieler](PLAYERS.md)).
  Auf demselben Computer wie eine lokale Testinstallation funktioniert `http://127.0.0.1:<port>`; sonst nutze die
  vertrauenswürdige HTTPS-Adresse.

## Installieren

1. Lade auf der Seite [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) des Projekts (die
   Release-Pakete hängen an jedem Release) `desktop-client-….zip` und `SHA256SUMS.txt` herunter. Mit einem Klon kannst
   du dasselbe Paket stattdessen selbst bauen: [Client builds](../../../CLIENT_BUILDS.md#livetrial-windows). Prüfe es in PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` und vergleiche den ganzen Wert.
2. Entpacke das **ganze** ZIP in einen Ordner, der dir gehört, zum Beispiel unter Dokumente. Behalte seine
   Ordnerstruktur bei; das Paket bringt seine eigene Python-Laufzeit, Erkennungs-Engine und Spiel-Assets mit.
3. Doppelklicke auf `LiveTrial.exe`. Das Dashboard öffnet sich als eigenes Fenster (Edge, sonst Chrome, sonst dein
   Standardbrowser). Das Analysieren von Videos funktioniert sofort.
4. Installiere für die Live-Aufnahme einmal FFmpeg. Am einfachsten: Öffne PowerShell und führe `winget install Gyan.FFmpeg`
   aus, beende dann LiveTrial und starte es neu, damit es den neuen PATH sieht. Ohne winget lade einen Windows-Build
   herunter (zum Beispiel das Release-ZIP von gyan.dev, verlinkt auf [ffmpeg.org/download.html](https://ffmpeg.org/download.html)),
   entpacke ihn und kopiere `bin\ffmpeg.exe` nach `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Fehlt FFmpeg,
   sagt **Aufnahme starten** das und zeigt diese Schritte.

## Mit deiner Community verbinden

1. Öffne **Einstellungen**. Gib die Adresse deiner Community unter **Adresse der Community-Website** ein (zum Beispiel
   `https://www.example.org`) und wähle **Server speichern**. LiveTrial startet sich selbst neu; lass es geöffnet.
2. Prüfe nach dem Neustart, dass die Einstellungen genau deine Adresse zeigen, und melde dich dann über das Kontomenü
   an (E-Mail-Code, E-Mail-Link oder Freigabe auf der Website).
3. Wenn der automatische Neustart fehlschlägt, wähle in der App **LiveTrial beenden**, warte, bis es geschlossen ist,
   und starte `LiveTrial.exe` erneut. Nur das Fenster zu schließen reicht nicht: LiveTrial läuft womöglich im
   Hintergrund weiter.

Konten und wartende Läufe werden pro Server getrennt aufbewahrt: Ein Serverwechsel sendet nie alte Läufe an die neue
Community. Gib in LiveTrial niemals die Adresse des lokalen E-Mail-Posteingangs oder die interne Adresse eines Servers ein.

## Später verbinden

Du kannst zuerst aufzeichnen und später einer Community beitreten. Was mit den Läufen passiert, die schon auf diesem PC sind:

- **Wähle die Community, bevor du aufzeichnest.** Läufe werden pro Server aufbewahrt. Läufe, die aufgezeichnet wurden,
  bevor du eine Community-Adresse gespeichert hast, oder während eine andere Community eingestellt war, bleiben bei
  diesem Server und werden der neuen nie angeboten. Um eine solche Aufnahme mitzunehmen, führe nach dem Verbinden
  **Ein Video analysieren** erneut mit ihrer Videodatei aus.
- **Ohne Konto aufgezeichnete Läufe** werden nicht gesendet, wenn du dich später anmeldest. Wähle **Senden als <account>**
  bei einem Lauf (im **Laufverlauf** oder in der Zeile nach dem Rennen) oder in der Zeile **Kein Konto** der Warteliste
  (der Zähler oben), um sie alle dem angemeldeten Konto zu geben. Sie landen beim Spieler dieses Kontos; ohne diese
  Wahl wird nichts zugeordnet.
- **Angemeldet aufgezeichnete Läufe** gehen immer mit genau diesem Konto hinaus. **Jetzt senden** sendet jeden wartenden
  Lauf, jeden mit seinem eigenen Konto; ein Lauf, dessen Konto abgemeldet ist, wartet, bis sich dieses Konto wieder anmeldet.
- **Jeder Lauf wird einmal gespeichert.** Jeder Lauf trägt seine eigene Einreichungs-ID, und die Website nimmt keine
  zweite Kopie desselben Laufs an.
- **Clips und Videos bleiben auf diesem PC.** Nur das Ergebnis (Zeiten, Strecke, Kombination) geht an die Website; ein
  YouTube-Upload ist ein separater, optionaler Schritt.

## Benutzung

- **Aufnahme starten**: Wähle die Capture-Karte. LiveTrial zeigt zuerst ein Standbild von ihr, damit du prüfen kannst,
  dass es das richtige Gerät ist. Der Tab **Live** zeigt dann das Bild und jeden erkannten Lauf.
- **Ein Video analysieren**: Wähle eine `.mp4`/`.mkv`-Datei (sie wird nach
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos` kopiert), und LiveTrial verarbeitet sie wie eine Aufnahme.
- Nach jedem Rennen sagt die Zeile **Letztes Rennen**, wo der Lauf ist: auf der Website, gespeichert und wartend auf
  das Senden (**Jetzt senden**) oder nur auf diesem PC (**Senden als <account>**).
- **Laufverlauf** listet jeden Lauf mit seinem Clip auf. Du kannst eine Erkennung korrigieren; eine Korrektur speichert
  eine neue Version und behält die frühere.
- Das automatische Senden ist standardmäßig aus; schalte es in den Einstellungen ein. Ein Lauf wird immer zuerst lokal
  gespeichert.

Stelle in den Einstellungen **Sprache deiner Switch** ein, wenn die Sprache der Konsole von der Sprache des Dashboards abweicht.

## Probleme

- Falsche Website, oder die Anmeldung öffnet die falsche Seite: Beende LiveTrial mit **LiveTrial beenden**, starte es
  erneut und prüfe die Adresse in den Einstellungen. Ein anderes Windows-Konto auf demselben PC hat LiveTrial vielleicht
  noch laufen.
- Kein Aufnahmegerät aufgeführt: Prüfe die USB-Verbindung und den Treiber, warte ein paar Sekunden und versuche es erneut.
- Erkennungsfehler: Korrigiere den Lauf im Laufverlauf, bevor du ihn sendest. Die Erkennung ersetzt nie die Prüfung
  deines eigenen Ergebnisses.

LiveTrial gibt es nur für Windows; es gibt keinen Build für macOS oder Linux. Um es selbst zu bauen, siehe
[Client builds](../../../CLIENT_BUILDS.md).
