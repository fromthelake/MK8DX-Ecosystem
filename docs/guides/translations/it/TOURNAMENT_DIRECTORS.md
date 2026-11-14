# Tournament Directors: gestire una serata

*Questa è una traduzione automatica della [guida inglese](../../TOURNAMENT_DIRECTORS.md); fa fede la versione inglese. Le correzioni sono benvenute tramite il modulo di issue «Translation correction».*

[Tutte le guide](../../../../README.md#get-started) · [Riferimento dei Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Un Tournament Director (Direttore del torneo) gestisce una serata di torneo sul sito della community: partecipanti,
console, gruppi, punteggi, finali e il resoconto pubblicato. I **Tournament Tools** per Windows possono leggere i
risultati delle gare da registrazioni o da un'acquisizione dal vivo, così non devi digitare ogni piazzamento a mano.
Sono facoltativi: i punteggi si possono anche inserire a mano o importare da Excel/CSV.

**Senza un sito:** i Tournament Tools per Windows della [sezione 3](#3-i-tournament-tools-per-windows) (Processor,
Analysis e Live) funzionano da soli. Scrivono file Excel, CSV e JSON sul tuo PC; Connect è facoltativo.

Il riconoscimento non rende mai ufficiale un risultato. Sei tu a controllare ogni gara prima che conti, e sei tu a decidere la pubblicazione.

## 1. Ottenere i diritti di Direttore sul sito della tua community

1. Accedi al sito (vedi [Giocatori](PLAYERS.md)).
2. Nella pagina **Tornei** scegli **Chiedi di organizzare**. Un amministratore approva o rifiuta la richiesta.
   Gli amministratori, e i Direttori una volta approvati, non vedono quel pulsante: vedono **Crea nuovo torneo** nella
   stessa pagina (nella barra **Direzione gara**) e avviano la serata da lì.
3. Per inviare al sito le gare riconosciute dai tool per Windows, un amministratore concede inoltre al tuo Giocatore
   con accesso effettuato l'accesso in **Amministrazione → Tornei → Direttori**. Questo dà accesso ai Tornei,
   non all'amministrazione generale.

## 2. Gestire la serata sul sito

Apri il torneo da **Tornei** (gli amministratori lo raggiungono anche da **Amministrazione → Tornei**).
La serata è una sequenza di passaggi; la pagina mostra a che punto sei:

| Passaggio | Cosa fai |
| --- | --- |
| 0 | Scegli il Direttore |
| 1 | Avvia il torneo |
| 2 | Seleziona i partecipanti, segna chi è presente e quali Switch porta (le spunte **NS1**/**NS2** accanto a ogni nome) |
| 3-4 | Crea ed esporta la disposizione delle qualificazioni (gruppi e posti) |
| 5 | Inserisci i punteggi delle qualificazioni: a mano, da un file Excel/CSV, oppure da **Risultati in arrivo** |
| 6 | Esporta i risultati delle qualificazioni |
| 7-8 | Controlla ed esporta i gruppi finali |
| 9 | Inserisci i punteggi dei gruppi finali; un'importazione lavora per gruppo e rifiuta un gruppo finché un nome non è ancora abbinato |
| 10 | Concludi e condividi: classifica finale, resoconto e l'esportazione per WordPress |

Il passaggio 2 prosegue solo quando ci sono abbastanza Switch: ogni Switch ospita due Giocatori, quindi la serata ha
bisogno di almeno metà dei partecipanti presenti, arrotondata per eccesso, in Switch spuntate (9 Giocatori presenti ne
richiedono 5). Il riquadro di disponibilità sotto l'elenco mostra quante ne mancano; spunta le Switch che le persone portano,
oppure sposta i partecipanti in **Lista d'attesa** o **Assente**.

Per le gare arrivate dai Tournament Tools: apri **Risultati in arrivo** per il gruppo, abbina ogni nome riconosciuto
al Giocatore giusto, controlla il percorso e i piazzamenti all'arrivo e scegli **Conferma**. Una classifica live
provvisoria non è un risultato ufficiale. Puoi anche importare direttamente un file di risultati con **Alternativa offline:
importa un file di risultati Live / Processor salvato** all'interno di un gruppo, oppure con **Amministrazione → Tornei → Importa i risultati canonici delle gare**.

Pubblicazione e rating della community sono decisioni separate nell'ultimo passaggio.

## 3. I Tournament Tools per Windows

### Requisiti

- Windows su x86-64 (testato su Windows 11) e diversi GB di spazio libero. Lo ZIP è di circa 160 MB e circa 1 GB una volta estratto;
  il programma di installazione ha bisogno di internet una volta, per scaricare Python 3.12 e pacchetti pubblici (di più con GPU/CUDA);
  i modelli di rilevamento e di OCR per la scrittura latina sono inclusi, e la prima esecuzione OCR in inglese scarica una volta un altro modello (english_g2.pth,
  circa 15 MB). Dopo di che l'elaborazione funziona offline. Una scheda
  NVIDIA accelera solo il passaggio OCR; la prima scansione di una registrazione gira sempre sulla CPU (vedi
  [which steps use the graphics card](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Per l'acquisizione dal vivo: una scheda di acquisizione con un driver Windows (DirectShow) funzionante. Per le registrazioni: nient'altro.
- Facoltativo, per inviare i risultati: l'indirizzo del sito e l'accesso da operatore dei Tornei (passaggio 1).

### Installazione

1. Dalla pagina [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del progetto (i pacchetti
   sono allegati a ogni release), scarica `tournament-tools-….zip` e `SHA256SUMS.txt`. Con un clone puoi invece
   compilarlo tu stesso ([Compilare i tool da soli](#compilare-i-tool-da-soli)). In PowerShell:
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, e confronta l'intero valore.
2. Estrai lo ZIP completo in una cartella scrivibile (non `Program Files`). Tieni `runtime-assets\` accanto ai
   file di avvio.
3. Fai doppio clic su `Install-MK8DX-TournamentTools.cmd` e aspetta `SUCCESS`. Sceglie da solo NVIDIA CUDA o PyTorch
   per CPU per questo computer. Se non riesce, leggi `install.log` nella cartella del pacchetto.

Il programma di installazione crea questi file di avvio:

| File di avvio | Uso |
| --- | --- |
| `TournamentProcessor.cmd` | Trascinaci sopra una registrazione `.mp4` o `.mkv`. Scrive una cartella di sessione accanto al video (`<name>_TournamentSession\Output_Results\`) con Excel, CSV e `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Una finestra per la stessa analisi dei video registrati, con più video o una cartella per torneo ([più sotto](#analizzare-le-registrazioni-in-seguito)). |
| `TournamentLive.cmd` | Acquisizione dal vivo durante la serata, oppure riproduzione di un video: **Aggiungi file video** (o aggiungi un dispositivo di acquisizione), **Avvia tutto**, controlla **Classifiche confermate**, poi **Apri le esportazioni**. Per consegnare la sessione, vedi [Da Tournament Live al sito](#da-tournament-live-al-sito). |
| `TournamentConnect.cmd` | Collegamento facoltativo al sito (più sotto). |
| `TournamentLiveCli.cmd` | Diagnostica: rilevamento dei dispositivi, comandi di riproduzione e di risultato. Non sostituisce la finestra Live. |

`TournamentTools.config.cmd` contiene i percorsi locali e le preferenze di lingua. Conservalo, insieme alla cartella di sessione
`TournamentLive\` e alle tue cartelle di output, quando installi un pacchetto più recente.

### Analizzare le registrazioni in seguito

Usa Tournament Live quando acquisisci la serata mentre si svolge. Quando la serata si è svolta senza di esso e hai solo
le registrazioni, analizzale in seguito con la finestra **Tournament Analysis**:

1. Fai doppio clic su `TournamentAnalysis.cmd` nella cartella del pacchetto.
2. **① Scegli registrazioni**: **Aggiungi video...** sceglie una o più registrazioni (`.mp4`, `.mkv`, `.mov`, `.avi`,
   `.ts`); **Aggiungi cartella...** aggiunge una cartella che contiene le registrazioni di un torneo.
3. **② Scegli video**: tutto ciò che hai aggiunto è spuntato; togli la spunta a ciò che non va analizzato (**Tutti**, **Nessuno**,
   **Cancella**).
4. **③ Avvia l'analisi**: controlla il **ID sessione** (compilato dal primo nome e dalla data; viene salvato
   con ogni gara) e il **Cartella dei risultati** (per impostazione predefinita `<first name>_TournamentSession` accanto alla prima
   registrazione), poi scegli **AVVIA ANALISI**. La finestra esegue la stessa elaborazione di `TournamentProcessor.cmd`;
   il registro delle attività mostra il suo output colorato, la luce di avvio diventa ambra e **Annulla** la interrompe. Le registrazioni
   vengono collegate in `Input_Videos\` della cartella dei risultati, oppure copiate quando si trovano su un'altra unità.
5. **🏁 Risultati**: quando compare **Completato**, **Apri l'ultimo Excel** o **Apri cartella dei risultati**: `Output_Results\`
   contiene la cartella di lavoro Excel, il CSV e `*_TournamentRaceResultsV1.json`. Controlla le gare, poi importa il JSON
   sul sito come descritto sopra.

I testi seguono la lingua di Windows (inglese o olandese); `MK8DX_TOURNAMENT_LANGUAGE` in
`TournamentTools.config.cmd` la sostituisce. Per mostrare un'altra immagine nel banner, imposta `MK8DX_ANALYSIS_BACKGROUND`
in `TournamentTools.config.cmd` su quel file. Da un clone, `python -m tournament_processor.gui` apre la stessa finestra quando
il Tournament Processor e le sue risorse di riconoscimento sono installati; richiede PySide6 (l'extra `gui` del processor) e
altrimenti, o con `--classic-gui`, apre una finestra Tkinter più semplice.

### Collegarsi al sito (facoltativo)

In PowerShell, nella cartella del pacchetto:

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

Usa `http://127.0.0.1:<port>` (o `http://localhost:<port>`) solo quando il sito gira sullo stesso computer Windows,
come fanno A1 e A3: l'HTTP semplice è accettato per questi indirizzi su questo PC e per nient'altro; ogni altro
indirizzo richiede il suo indirizzo HTTPS attendibile. Senza un terminale (per esempio da uno script) `sign-in` non chiede nulla:
imposta prima l'indirizzo con `TournamentConnect.cmd server <address>`. I caricamenti in attesa per un server restano con quel
server. Una gara consegnata finisce in **Risultati in arrivo**; non viene mai pubblicata automaticamente.

### Da Tournament Live al sito

1. In Tournament Live scegli **Collegati a Tournament Manager** (in seguito **Cambia Torneo**), completa l'accesso nel
   browser e scegli la serata in **Scegli Torneo**. Quella scelta è solo un suggerimento; puoi farla prima
   o dopo la sessione.
2. Avvia i feed (**Aggiungi file video** o una scheda di acquisizione, poi **Avvia tutto**). Tournament Live può aggiungere
   da solo una scheda di acquisizione che ricorda, come sorgente in più su Gruppo 1. Con un video anche su Group 1,
   **Avvia tutto** si ferma con *Assegna ogni feed a esattamente un gruppo diverso del passaggio attuale prima di premere START*:
   seleziona la sorgente in più e scegli **Rimuovi selezionati**, oppure dalle un gruppo proprio, e avvia di nuovo.
3. Sul sito apri la serata, vai al passaggio 5 (passaggio 9 per i gruppi finali) e trova la sessione in **Registrazioni Tournament Live disponibili**.
   Scegli il suo gruppo in **Collega al gruppo**, poi **Collega la registrazione controllata**. Le gare restano in attesa come prove
   finché non le accetti.

### Collegarsi più tardi

Una serata elaborata senza collegamento è completa sul tuo PC: `Output_Results\` contiene la cartella di lavoro Excel, il CSV
e `*_TournamentRaceResultsV1.json`. Anche Tournament Live senza collegamento scrive la sua cartella di lavoro Excel: quando
fermi i feed, quando l'analisi termina, o quando chiudi la finestra mentre i feed sono ancora in corso (prima li
ferma). I file restano in `Live_Output\exports` (**Apri le esportazioni**) dopo che l'hai chiuso. Se Live viene terminato prima
che i feed si fermino, quell'ultima cartella di lavoro manca; le registrazioni restano e Tournament Analysis o il Processor
ne ricavano la stessa cartella di lavoro. In seguito nulla viene inviato da solo; portala sul sito in uno di
questi modi:

- Nel gruppo sul sito: **Alternativa offline: importa un file di risultati Live / Processor salvato** con il JSON,
  oppure l'importazione Excel del gruppo. Ogni nome riconosciuto deve prima essere abbinato a un Giocatore; un'importazione
  rifiuta un gruppo finché un nome non è abbinato.
- Un amministratore: **Amministrazione → Tornei → Importa i risultati canonici delle gare**. Le gare importate restano private
  finché non vengono pubblicate.
- Con TournamentConnect: `.\TournamentConnect.cmd sign-in`, poi
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Chiede la serata, il gruppo e il numero della
  prima gara; le gare arrivano in **Risultati in arrivo**. Se il sito non è raggiungibile, il file resta
  dov'è; invialo di nuovo più tardi.
- In Tournament Live: scegliere la serata con **Collegati a Tournament Manager** dopo che una sessione è terminata offre
  quella sessione terminata alla serata. I caricamenti falliti mentre Live era collegato vengono conservati e inviati di nuovo,
  automaticamente o con **Riprova il caricamento**, solo per lo stesso account con accesso effettuato. Una sessione eseguita con **Lavora offline**
  non viene conservata per il caricamento; usa uno dei percorsi qui sopra per il suo file.

L'accesso aggiunge due cose: l'elenco delle serate a cui puoi consegnare e il feed live durante la serata (`target`),
che invia ogni gara al gruppo scelto man mano che Tournament Live la riconosce. In ogni caso una gara conta solo dopo che
l'hai confermata in **Risultati in arrivo**.

### Controllare cosa è stato letto

L'OCR può leggere male un nome, un piazzamento o un punteggio cumulativo. Confronta ogni gara con lo schermo o la registrazione prima
di confermarla. Una limitazione nota: Tournament Live può esportare un risultato di gara corretto con un totale cumulativo
letto male, e il controllo sul sito non può modificare il nome o il totale osservato (vedi
[Tournament Live on a local laptop](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

I tool leggono il gioco nelle sue 15 lingue della console. Tournament Live ha superato una prova di accettazione fisica a 1× con il
pacchetto v0.2.2: tre PC sorgente hanno riprodotto video di qualificazione registrati nelle proprie schede di acquisizione
([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Una riproduzione video senza scheda di acquisizione
non verifica il percorso di acquisizione.

## Compilare i tool da soli

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` da un clone compila
lo stesso pacchetto; vedi [Client builds](../../../CLIENT_BUILDS.md).
