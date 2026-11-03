// Port van UiText: dezelfde zes talen en dezelfde sleutels/strings.
export const LANG_CODES = ['en', 'nl', 'de', 'fr', 'es', 'it'] as const;
export const LANG_NAMES = ['English', 'Nederlands', 'Deutsch', 'Français', 'Español', 'Italiano'];
export const VOCAB_TAGS = ['en-GB', 'nl-NL', 'de-DE', 'fr-FR', 'es-ES', 'it-IT'];
export type LangCode = (typeof LANG_CODES)[number];

const T: Record<string, string[]> = {};
function put(key: string, en: string, nl: string, de: string, fr: string, es: string, it: string): void {
  T[key] = [en, nl, de, fr, es, it];
}

put('aim', 'aim at the results screen and press SCAN', 'richt op het resultaatscherm en druk SCAN', 'auf den Ergebnisbildschirm zielen und SCAN drücken', "visez l'écran des résultats et appuyez sur SCAN", 'apunta a la pantalla de resultados y pulsa SCAN', 'inquadra la schermata dei risultati e premi SCAN');
put('burst', 'taking photos… hold still', "foto's maken… houd stil", 'Fotos werden aufgenommen… ruhig halten', 'photos en cours… ne bougez pas', 'haciendo fotos… no te muevas', 'scatto foto… resta fermo');
put('no_lock', 'no result — aim straighter/sharper (less glare) and scan again', 'niet gelukt — richt rechter/scherper (minder spiegeling) en scan opnieuw', 'kein Ergebnis — gerader/schärfer zielen (weniger Spiegelung) und erneut scannen', 'échec — visez plus droit/net (moins de reflets) et rescannez', 'sin resultado — apunta más recto/nítido (menos reflejos) y escanea de nuevo', 'nessun risultato — inquadra più dritto/nitido (meno riflessi) e riprova');
put('locked', '✓ captured', '✓ vastgelegd', '✓ erfasst', '✓ enregistré', '✓ capturado', '✓ registrato');
put('rescan_hint', 'RESCAN = new scan', 'RESCAN = nieuwe scan', 'RESCAN = neuer Scan', 'RESCAN = nouveau scan', 'RESCAN = nuevo escaneo', 'RESCAN = nuova scansione');
put('identifying', 'identifying setup…', 'setup herkennen…', 'Setup wird erkannt…', 'identification du setup…', 'identificando el equipo…', 'riconoscimento assetto…');
put('processing', 'processing photo…', 'foto verwerken…', 'Foto wird verarbeitet…', 'traitement de la photo…', 'procesando foto…', 'elaborazione foto…');
put('guide3', '3-lap guide', '3-laps-gids', '3-Runden-Hilfe', 'guide 3 tours', 'guía de 3 vueltas', 'guida 3 giri');
put('guide7', '7-lap guide (Baby Park)', '7-laps-gids (Baby Park)', '7-Runden-Hilfe (Baby Park)', 'guide 7 tours (Baby Park)', 'guía de 7 vueltas (Baby Park)', 'guida 7 giri (Baby Park)');
put('ph_card', 'Finding card…', 'Kaart zoeken…', 'Karte suchen…', 'Recherche de la carte…', 'Buscando la tarjeta…', 'Ricerca scheda…');
put('ph_slots', 'Finding time slots…', 'Tijdvakken vinden…', 'Zeitfelder suchen…', 'Recherche des temps…', 'Buscando los tiempos…', 'Ricerca dei tempi…');
put('ph_read', 'Reading times…', 'Tijden lezen…', 'Zeiten lesen…', 'Lecture des temps…', 'Leyendo tiempos…', 'Lettura tempi…');
put('ph_setup', 'Identifying setup…', 'Setup herkennen…', 'Setup erkennen…', 'Identification du setup…', 'Identificando el equipo…', 'Riconoscimento assetto…');
put('ph_confirm', 'Confirming setup…', 'Setup bevestigen…', 'Setup bestätigen…', 'Confirmation du setup…', 'Confirmando el equipo…', 'Conferma assetto…');
put('ph_finish', 'Finish! 🏁', 'Finish! 🏁', 'Ziel! 🏁', 'Arrivée ! 🏁', '¡Meta! 🏁', 'Traguardo! 🏁');
put('won_by', 'You won by', 'Gewonnen met', 'Gewonnen mit', 'Gagné de', 'Ganaste por', 'Hai vinto di');
put('lost_by', 'You lost by', 'Verloren met', 'Verloren mit', 'Perdu de', 'Perdiste por', 'Hai perso di');
put('lap', 'Lap', 'Ronde', 'Runde', 'Tour', 'Vuelta', 'Giro');
put('you', 'You', 'Jij', 'Du', 'Vous', 'Tú', 'Tu');
put('ghost', 'Ghost', 'Ghost', 'Geist', 'Fantôme', 'Fantasma', 'Fantasma');
put('build_stats', 'Build stats', 'Build-stats', 'Build-Werte', 'Stats du build', 'Stats del equipo', 'Statistiche assetto');
put('detail_specs', 'Detail specs', 'Detail-specs', 'Detail-Werte', 'Specs détaillées', 'Specs detalladas', 'Specifiche dettagliate');
put('detail_sub', 'Stat build-up of both builds', 'Stat-opbouw van beide builds', 'Stat-Aufbau beider Builds', 'Composition des stats des deux builds', 'Composición de stats de ambos equipos', 'Composizione statistiche di entrambi');
put('new_best', 'New best', 'Nieuw record', 'Neue Bestzeit', 'Nouveau record', 'Nuevo récord', 'Nuovo record');
put('back', 'back', 'terug', 'zurück', 'retour', 'atrás', 'indietro');
put('checked_sum', '✓ times checked (lap sum matches)', '✓ tijden gecontroleerd (rondesom klopt)', '✓ Zeiten geprüft (Rundensumme stimmt)', '✓ temps vérifiés (somme des tours OK)', '✓ tiempos verificados (suma de vueltas OK)', '✓ tempi verificati (somma giri OK)');
put('captured', '✓ result captured', '✓ resultaat vastgelegd', '✓ Ergebnis erfasst', '✓ résultat enregistré', '✓ resultado capturado', '✓ risultato registrato');
put('speed', 'Speed', 'Snelheid', 'Tempo', 'Vitesse', 'Velocidad', 'Velocità');
put('handling', 'Handling', 'Besturing', 'Handling', 'Maniabilité', 'Manejo', 'Manovrabilità');
put('other', 'Other', 'Overig', 'Sonstiges', 'Autres', 'Otros', 'Altro');
put('legend_note', 'Top = you · bottom (dim) = ghost · scale 0–6', 'Boven = jij · onder (gedimd) = ghost · schaal 0–6', 'Oben = du · unten (gedimmt) = Geist · Skala 0–6', 'Haut = vous · bas (atténué) = fantôme · échelle 0–6', 'Arriba = tú · abajo (atenuado) = fantasma · escala 0–6', 'Sopra = tu · sotto (attenuato) = fantasma · scala 0–6');
put('language', 'Language', 'Taal', 'Sprache', 'Langue', 'Idioma', 'Lingua');
put('layout_endscreen', 'scanning the Time Trial result screen (you + ghost)', 'scant het Time Trial-resultaatscherm (jij + ghost)', 'scannt den Time-Trial-Ergebnisbildschirm (du + Geist)', "scanne l'écran de résultats du contre-la-montre (vous + fantôme)", 'escanea la pantalla de resultados de contrarreloj (tú + fantasma)', 'scansiona la schermata dei risultati della prova a tempo (tu + fantasma)');
put('ph_attempt', 'attempt', 'poging', 'Versuch', 'essai', 'intento', 'tentativo');
put('ph_hard', 'tricky image', 'beeld is lastig', 'schwieriges Bild', 'image difficile', 'imagen difícil', 'immagine difficile');
put('layout_ghost', 'scanning the Select-a-Ghost details panel', 'scant het Select-a-Ghost-detailpaneel', 'scannt das Geister-Auswahl-Detailfeld', 'scanne le panneau de détails du fantôme', 'escanea el panel de detalles del fantasma', 'scansiona il pannello dei dettagli del fantasma');
// browser-specifiek (geen APK-equivalent): camera/PWA-status — in alle zes talen
put('rotate_hint', 'landscape gives the best read', 'liggend scant het best', 'Querformat liest am besten', 'le mode paysage lit le mieux', 'horizontal lee mejor', 'orizzontale legge meglio');
put('setup_title', 'First-time setup', 'Eerste keer instellen', 'Ersteinrichtung', 'Premiere configuration', 'Configuracion inicial', 'Prima configurazione');
put('setup_note', 'downloading the scanner (about 140 MB) - once, then it works offline', 'scanner downloaden (ca. 140 MB) - eenmalig, daarna werkt hij offline', 'Scanner wird geladen (ca. 140 MB) - einmalig, danach offline', 'telechargement du scanner (140 Mo) - une fois, ensuite hors ligne', 'descargando el escaner (140 MB) - una vez, luego funciona sin conexion', 'download dello scanner (140 MB) - una volta, poi funziona offline');
put('setup_cached_title', 'Loading scanner', 'Scanner laden', 'Scanner laden', 'Chargement du scanner', 'Cargando el escaner', 'Caricamento scanner');
put('setup_cached_note', 'using saved scanner files - no download unless an update is available', 'opgeslagen scannerbestanden gebruiken - geen download tenzij er een update is', 'Gespeicherte Scannerdateien werden verwendet - Download nur bei einem Update', 'utilisation des fichiers enregistres - telechargement uniquement lors d une mise a jour', 'usando archivos guardados - solo se descargan de nuevo al actualizar', 'uso dei file salvati - nuovo download solo per un aggiornamento');
put('stall_retry', 'no progress - restarting with 1 thread and scanning again', 'geen voortgang - herstart met 1 thread en scan opnieuw', 'kein Fortschritt - Neustart mit 1 Thread, erneut scannen', 'pas de progression - redemarrage avec 1 thread, nouveau scan', 'sin progreso - reinicio con 1 hilo y nuevo escaneo', 'nessun progresso - riavvio con 1 thread e nuova scansione');
put('setup_ready', 'ready', 'klaar', 'fertig', 'pret', 'listo', 'pronto');
put('gallery_own', 'own photo…', 'eigen foto…', 'eigenes Foto…', 'ma photo…', 'foto propia…', 'foto propria…');
put('gallery_demo', 'or a built-in test image', 'of een ingebouwde testafbeelding', 'oder ein eingebautes Testbild', 'ou une image de test intégrée', 'o una imagen de prueba integrada', 'o un’immagine di prova integrata');
put('camera_denied', 'camera access denied — use GALLERY', 'camera geweigerd — gebruik GALLERY', 'Kamera verweigert — GALLERY verwenden', 'caméra refusée — utilisez GALLERY', 'cámara denegada — usa GALLERY', 'fotocamera negata — usa GALLERY');
put('loading_engine', 'loading scanner…', 'scanner laden…', 'Scanner wird geladen…', 'chargement du scanner…', 'cargando el escáner…', 'caricamento scanner…');
put('camera_starting', 'starting camera…', 'camera starten…', 'Kamera wird gestartet…', 'démarrage de la caméra…', 'iniciando cámara…', 'avvio fotocamera…');
put('stopped', 'scan stopped', 'scan gestopt', 'Scan gestoppt', 'scan arrêté', 'escaneo detenido', 'scansione interrotta');
put('gallery_or_retry', 'RESCAN or choose another photo via GALLERY', 'RESCAN of kies een andere foto via GALLERY', 'RESCAN oder anderes Foto über GALLERY wählen', 'RESCAN ou choisissez une autre photo via GALLERY', 'RESCAN o elige otra foto con GALLERY', 'RESCAN o scegli un’altra foto con GALLERY');
put('save_mk8dx', 'Save in MK8DX', 'Opslaan in MK8DX', 'In MK8DX speichern', 'Enregistrer dans MK8DX', 'Guardar en MK8DX', 'Salva in MK8DX');
put('save_mk8dx_none', 'no readable time to hand over', 'geen leesbare tijd om door te geven', 'keine lesbare Zeit zum \u00dcbergeben', 'aucun temps lisible \u00e0 transmettre', 'no hay un tiempo legible que pasar', 'nessun tempo leggibile da passare');
put('for_mk8dx', 'scanning for MK8DX', 'scannen voor MK8DX', 'Scannen f\u00fcr MK8DX', 'scan pour MK8DX', 'escaneando para MK8DX', 'scansione per MK8DX');

let idx = 0;

export function setLanguage(code: string): void {
  const i = LANG_CODES.indexOf(code as LangCode);
  idx = i >= 0 ? i : 0;
}

export function currentCode(): LangCode {
  return LANG_CODES[idx];
}

export function vocabTag(): string {
  return VOCAB_TAGS[idx];
}

export function defaultCode(): LangCode {
  const sys = (typeof navigator !== 'undefined' ? navigator.language : 'en').split('-')[0];
  return (LANG_CODES as readonly string[]).includes(sys) ? (sys as LangCode) : 'en';
}

export function t(key: string): string {
  const row = T[key];
  if (!row) return key;
  const v = row[idx];
  return v && v.length > 0 ? v : row[0];
}
