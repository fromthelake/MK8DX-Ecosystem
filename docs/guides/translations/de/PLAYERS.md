# Spieler: die Website und die Android-App

*Dies ist eine maschinelle Übersetzung der [englischen Anleitung](../../PLAYERS.md); maßgeblich ist die englische Fassung. Korrekturen sind willkommen über das Issue-Formular „Translation correction“.*

[Alle Anleitungen](../../../../README.md#get-started)

Du brauchst die Adresse der MK8DX-Website deiner Community, zum Beispiel `https://www.example.org`. Jede Community
betreibt ihre eigene Installation mit eigenen Konten und Ergebnissen; frag die Leute, die deine Community betreiben,
nach der Adresse und nach Hilfe mit deinem Konto. Um die Website zu nutzen, musst du nichts installieren.

## Die Website

### Anmelden

1. Öffne die Adresse deiner Community und wähle das Kontosymbol (oben rechts), dann **Anmelden**.
2. Gib deine E-Mail-Adresse ein und wähle **Schick mir einen Link**. Öffne die E-Mail und folge dem Link. Es gibt
   kein Passwort. Der Link funktioniert einmal und läuft ab; fordere einen neuen an, wenn er nicht funktioniert.
3. Beim ersten Mal öffnet der Link direkt eine Einrichtung in drei Schritten. Schritt 1, **Bist du schon auf dieser
   Website?**, fragt, ob deine Zeitfahren-Zeiten schon auf der Website stehen und ob du an einem dort aufgeführten
   Turnier teilgenommen hast. Wenn ja, findest du in Schritt 2 den Spieler, der du bist, und bittest darum, ihn mit
   deinem Konto zu verknüpfen; ein Administrator oder der Turnierleiter des Abends prüft eine solche Anfrage, bevor
   sie verknüpft wird, und nichts wird allein anhand des Namens verknüpft. Wenn nein, legt Schritt 2 deinen Spieler
   an (in einer Community, in der nur Turnierleiter Spieler anlegen, erklärt er stattdessen, wen du fragen kannst).
   Schritt 3 bietet ein paar optionale Einstellungen, die du überspringen kannst.

Dein Konto (die E-Mail-Adresse, mit der du dich anmeldest) und dein Spieler (der Name in den Ranglisten) sind zwei
verschiedene Dinge.

### Eine Zeitfahren-Zeit posten

- **Zeit posten** (obere Leiste) oder **Strecken** → eine Strecke → **Zeit posten**: Gib deine Zeit in 150cc oder
  200cc ein, prüfe die Werte in der Bestätigung und veröffentliche sie.
- **Scannen**: Öffne `<your community address>/scanner/` auf einem Handy oder Tablet. Richte die Kamera auf den
  Ergebnisbildschirm auf deinem Fernseher oder wähle **Bild hochladen** mit einem Foto oder Screenshot. Der Scanner
  liest die Zeiten, Runden und, wenn sichtbar, den Fahrer, die Fahrzeugkombination und die Flagge. Prüfe jeden Wert,
  bevor du ihn einreichst; die Erkennung kann sich irren. Die Kamera braucht eine vertrauenswürdige HTTPS-Adresse
  (auf `localhost` funktioniert sie auch); das Hochladen von Bildern funktioniert überall.
- Je nach den Regeln der Community wird eine Einreichung sofort veröffentlicht oder wartet auf die Prüfung durch
  einen Administrator. Ein Administrator kann eine veröffentlichte Zeit korrigieren oder zurückziehen.

### Deinen Fortschritt verfolgen

**Strecken**, **Rangliste** und **Rekorde** zeigen deine Bestzeiten und Runden neben der Community, deinen gewählten
Rivalen, den Nintendo-Mitarbeiter-Geistern und den Weltrekorden. **Kombination** hilft bei Fahrer- und
Fahrzeugkombinationen, **Community** zeigt andere Spieler und **Turniere** die veröffentlichten Turnierabende,
Tabellen und Berichte. Wenn jemand eine deiner veröffentlichten Zeiten schlägt, bekommst du eine Benachrichtigung
(die Glocke). Die Website kann auch Push-Benachrichtigungen im Browser senden, wenn deine Community das eingerichtet
hat; schalte sie in deinen Kontoeinstellungen ein.

Die Website gibt es in den 15 Sprachen des Spiels (wähle deine in den Einstellungen). Englisch und Niederländisch
sind geprüft; die anderen 13 sind maschinelle Übersetzungen, und Korrekturen sind willkommen: siehe
[Change UI text and translations](../../../DEVELOPMENT.md#change-ui-text-and-translations) für die zu bearbeitende
Datei und [Contributing](../../../../CONTRIBUTING.md) für den Pull Request.

## Die Android-App

Die App bietet einen schnelleren Scan direkt auf dem Handy, deine Zeiten und Benachrichtigungen. Sie ist optional.

### Voraussetzungen

- Android 8.0 oder neuer; ein arm64-Handy wird empfohlen. Das Release-APK ist groß (etwa 530 MB): Halte während der
  Installation etwa 1 GB frei.
- Eine Community, die die App erreichen kann: eine **Online-Community** mit einer vertrauenswürdigen HTTPS-Adresse
  oder eine **Installation zu Hause oder im Verein** (A2) im selben WLAN. Eine computerlokale Adresse
  (`http://127.0.0.1:…`) funktioniert in der App nicht.

### Installieren

1. Hol dir das APK auf der Seite **Hol dir die App** deiner Community, wenn sie Downloads anbietet (du musst
   angemeldet sein, um sie zu sehen; das ist die Version, die deine Community unterstützt), oder auf der Seite
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) des Projekts: Nimm
   `mk8dx-android-release-….apk`. Mit einem Klon des Repositorys kannst du das APK auch selbst bauen:
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Prüfe die Datei anhand von `SHA256SUMS.txt` aus demselben Release (auf einem Computer: `Get-FileHash` in
   PowerShell, `sha256sum` unter Linux, `shasum -a 256` unter macOS).
3. Kopiere das APK auf das Handy und öffne es über **Dateien** oder **Downloads**. Android fragt, ob du die
   Installation aus dieser App erlauben willst; erlaube es nur für diese geprüfte Datei und schalte es danach wieder
   aus, wenn du möchtest.

Dies ist keine Play-Store-App. Frühere öffentliche APKs waren mit einem Debug-Schlüssel signiert; das Release-APK
verwendet den dauerhaften Schlüssel des Maintainers. Sichere alle noch nicht gesendeten Ergebnisse und deinstalliere
ein früheres Debug-APK einmal, bevor du dieses Release installierst. Spätere APKs, die mit demselben
Release-Schlüssel signiert sind, aktualisieren die App direkt. Auch der Wechsel zu einem APK einer Community oder
einem selbst gebauten APK mit einem anderen Schlüssel erfordert eine Deinstallation.

### Erster Start

Die App öffnet sich mit **Wähle deine Community**, in der Sprache des Handys, wenn die App sie hat. Um eine andere
Sprache zu wählen, tippe oben auf **Sprache / Language** (mit dem Globus); die App merkt sich diese Wahl. Dann fragt
sie nur eine Sache: wie deine Community spielt. Nicht sicher? Frag die
Person, die deine Community betreibt.

- **Zu Hause oder im Verein** (A2, MK8DX läuft dort auf einem Computer): Tippe auf **QR-Code scannen** und scanne die
  Karte **Prepare a device** (Gerät vorbereiten), die dein Administrator auf diesem Computer zeigt oder auf Papier
  verteilt. Das Handy muss im selben WLAN sein. Die App zeigt dann die Adresse und den Schlüssel der Installation;
  sie stehen auch auf der Seite **Prepare this device** (Dieses Gerät vorbereiten) unter **Full fingerprints**
  (Vollständige Fingerabdrücke). Tippe auf **Verbinden**, wenn sie übereinstimmen. Kein Internet nötig. Schritt für
  Schritt: [die A2-Anleitung, Kapitel 7](../../../install/translations/de/A2_HOME_GUIDE.md#7-die-android-app-und-livetrial).
- **Online-Community** (eine Website im Internet): Gib die Adresse ein, mit der du sie im Browser öffnest, zum
  Beispiel `https://www.example.org` (ohne Pfad, ohne Schrägstrich am Ende), und tippe auf **Speichern**. Wenn das
  fehlschlägt, öffne dieselbe Adresse im Browser des Handys: Sie muss sich ohne Zertifikatswarnung öffnen.

Dann melde dich an: Tippe oben rechts auf das Personensymbol und auf **Anmelden**; Einstellungen › **Spieler auf
diesem Handy** macht dasselbe. Die App zeigt einen Code und öffnet deine Community im Browser, wo du mit deinem
eigenen Konto bestätigst (bei einer Installation zu Hause oder im Verein erinnert dich die App daran: Melde dich dort
zuerst mit deiner persönlichen Anmeldekarte an).

### Sich zurechtfinden

Oben in der App siehst du das Logo (zurück zur Startseite), den **Community-Chip** mit dem Namen der Community, die
du gerade nutzt, die Glocke und deinen Namen. Dein Name öffnet **Du**: deinen Spieler mit **Spieler wechseln** und
die Tabs **Meine Zeiten**, **Rekorde** und **Rivalen**, darunter eine Zeile **Einstellungen**.

- **Mehrere Communities**: Tippe auf den Community-Chip, um **Communities** zu öffnen. Die aktive ist grün;
  **Community wechseln** wechselt mit einem Tippen zu einer anderen, **Von diesem Telefon entfernen** vergisst eine (erst, wenn
  nichts mehr auf das Senden wartet), und **Eine Community hinzufügen** öffnet wieder den Startbildschirm. Jede
  Community behält ihre eigene Anmeldung, ihre eigenen ungesendeten Läufe und, zu Hause oder im Verein, ihr eigenes
  Vertrauen; nichts wandert von selbst zwischen ihnen. Wenn der Administrator der Community einen Namen gegeben hat,
  zeigt die App diesen Namen statt der Adresse.
- **Meine Zeiten** ist eine einzige Liste: deine Karrierezahlen, dann eine Zeile pro Strecke und Klasse mit deiner
  persönlichen Bestzeit; tippe auf eine Zeile für ältere Läufe und nutze **⋯** bei einem Lauf für **Details**,
  **Bearbeiten**, **Zurückziehen** oder **In eine andere Community mitnehmen…**.
- **Ohne Internet**: Die App behält pro Community eine Kopie deiner eigenen Zeiten und der Bestzeiten deiner Rivalen
  und zeigt sie mit „Offline — zuletzt aktualisiert …“ an.
- **Wartet auf das Senden**: Läufe, die noch nur auf dem Handy sind, erscheinen als orangefarbenes Banner auf der
  Startseite und unter Du; tippe darauf oder nutze Einstellungen › **Auf diesem Telefon gespeichert**, um sie zu
  sehen.
- **Einstellungen** sind in **Spieler**, **App**, **Community** und **Über** gegliedert und speichern jede Änderung
  von selbst. Die Sprache findest du unter App; **Hol dir die App** und **Auf diesem Telefon gespeichert** unter
  Community; **Testscan ausführen** unter Über.

### Zeiten in eine andere Community mitnehmen

Wenn du zu mehr als einer Community gehörst, kann eine Zeit auch in einer anderen zählen: **In eine andere Community
mitnehmen…** bei einem Lauf oder **Meine Bestzeiten mitnehmen** unter deinen Karrierezahlen in Meine Zeiten (Strecken,
auf denen die andere Community schon eine bessere Zeit von dir hat, werden übersprungen). Die Kopie wartet, bis du
dort angemeldet bist. Die **empfangende** Community entscheidet: Standardmäßig nimmt sie keine Zeiten von anderswo an,
sie kann einen Administrator jede Zeit zuerst freigeben lassen, oder sie nimmt sie wie jede andere Zeit an. Eine
mitgenommene Zeit zeigt immer, woher sie stammt („Mitgenommen von … · ursprünglich …“). Dasselbe Original wird nur
einmal übernommen; eine gleiche Zeit ergänzt nur, was dem vorhandenen Lauf noch fehlte.

### Benachrichtigungen

Benachrichtigungen in der App werden aus dem Posteingang deiner Community abgerufen; die
Benachrichtigungsberechtigung von Android und der eigene Schalter der App müssen beide eingeschaltet sein.

## Probleme

- Keine Anmelde-E-Mail: Prüfe den Spam-Ordner und die genaue Adresse und fordere einen neuen Link an. Bei einer lokalen
  Testinstallation kommt die E-Mail im lokalen Test-Posteingang an, nicht in deinem Postfach.
- Etwas sieht auf der Website deiner Community falsch aus: Frag zuerst die Leute, die sie betreiben. Fehler in der
  Software selbst kannst du in den Issues des Projekts melden; siehe [SUPPORT.md](../../../../SUPPORT.md). Poste
  niemals Anmeldelinks oder die Namen anderer Leute.
