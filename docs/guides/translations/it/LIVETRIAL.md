# LiveTrial: registrare le Prove a tempo su Windows

*Questa è una traduzione automatica della [guida inglese](../../LIVETRIAL.md); fa fede la versione inglese. Le correzioni sono benvenute tramite il modulo di issue «Translation correction».*

[Tutte le guide](../../../../README.md#get-started) · [README del componente LiveTrial](../../../../apps/timetrials-desktop/README.md)

LiveTrial è un programma per Windows che segue le tue Prove a tempo tramite una scheda di acquisizione, oppure legge
video registrati, riconosce ogni tempo (tempo totale e tempi sul giro, personaggio e combinazione del kart, fantasma) e lo
salva sul tuo PC con una clip. Dopo che hai effettuato l'accesso una volta, può inviare i risultati al sito della tua
community. I risultati che non si possono ancora inviare restano in attesa sul PC.

## Senza un sito della community

LiveTrial funziona anche da solo. Acquisizione, analisi dei video, **Storico dei tempi**, clip e correzioni funzionano
tutti in locale. I tempi registrati senza un account restano solo su questo PC finché non li invii con **Invia come <account>**.
Le schede **I miei record**, **Rank** e **Combinazione** richiedono una community con accesso effettuato.

## Requisiti

- Windows su x86-64 (testato su Windows 11). Circa 1 GB per il programma più lo spazio per le tue registrazioni.
- Per l'acquisizione dal vivo: una scheda di acquisizione che Windows elenca come dispositivo video, con il suo driver, e
  **FFmpeg** (gratuito, non incluso a causa della sua licenza; vedi il passaggio 4 qui sotto). Per i file video: nessuna
  scheda di acquisizione e nessun FFmpeg.
- Per inviare i risultati: l'indirizzo del sito della tua community e un account lì (vedi [Giocatori](PLAYERS.md)).
  Sullo stesso computer di un'installazione di prova locale funziona `http://127.0.0.1:<port>`; altrimenti usa
  l'indirizzo HTTPS attendibile.

## Installazione

1. Dalla pagina [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del progetto (i pacchetti
   sono allegati a ogni release), scarica `desktop-client-….zip` e `SHA256SUMS.txt`. Con un clone puoi invece
   compilare tu stesso lo stesso pacchetto: [Client builds](../../../CLIENT_BUILDS.md#livetrial-windows). Controllalo in PowerShell:
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` e confronta l'intero valore.
2. Estrai l'**intero** ZIP in una cartella tua, per esempio sotto Documenti. Mantieni la sua struttura di cartelle;
   il pacchetto contiene il proprio runtime Python, il motore di riconoscimento e le risorse del gioco.
3. Fai doppio clic su `LiveTrial.exe`. La dashboard si apre in una finestra propria (Edge, altrimenti Chrome, altrimenti
   il tuo browser predefinito). L'analisi dei video funziona subito.
4. Per l'acquisizione dal vivo, installa FFmpeg una volta. Il modo più semplice: apri PowerShell ed esegui `winget install Gyan.FFmpeg`,
   poi chiudi e riavvia LiveTrial perché veda il nuovo PATH. Senza winget, scarica una build per Windows (per esempio
   lo zip di release di gyan.dev, collegato da [ffmpeg.org/download.html](https://ffmpeg.org/download.html)), estrailo
   e copia `bin\ffmpeg.exe` in `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Se FFmpeg manca,
   **Avvia acquisizione** lo segnala e mostra questi passaggi.

## Collegarti alla tua community

1. Apri **Impostazioni**. Inserisci l'indirizzo della tua community in **Indirizzo del sito della community** (per esempio
   `https://www.example.org`) e scegli **Salva server**. LiveTrial si riavvia da solo; lascialo aperto.
2. Dopo il riavvio, controlla che le Impostazioni mostrino esattamente il tuo indirizzo, poi accedi dal menu dell'account
   (codice via email, link via email o approvazione sul sito).
3. Se il riavvio automatico non riesce, scegli **Esci da LiveTrial** nell'app, aspetta che si sia chiuso e avvia di nuovo
   `LiveTrial.exe`. Chiudere solo la finestra non basta: LiveTrial può continuare a funzionare in background.

Gli account e i tempi in attesa sono conservati separatamente per ogni server: cambiare server non invia mai i vecchi
tempi alla nuova community. Non inserire mai in LiveTrial l'indirizzo della casella di posta locale o l'indirizzo interno di un server.

## Collegarti più tardi

Puoi prima registrare e unirti a una community in seguito. Cosa succede ai tempi già presenti su questo PC:

- **Scegli la community prima di registrare.** I tempi sono conservati per server. I tempi registrati prima che tu
  salvassi l'indirizzo di una community, o mentre era impostata un'altra community, restano con quel server e non
  vengono mai offerti a quella nuova. Per portare con te una registrazione del genere, esegui di nuovo **Analizza un video**
  sul suo file video dopo esserti collegato.
- **I tempi registrati senza account** non vengono inviati quando accedi più tardi. Scegli **Invia come <account>** su un
  tempo (in **Storico dei tempi** o sulla riga dopo la gara), oppure sulla riga **Nessun account** della lista d'attesa (il
  contatore in alto), per assegnarli tutti all'account con cui hai effettuato l'accesso. Finiscono sul Giocatore di
  quell'account; senza questa scelta non viene assegnato nulla.
- **I tempi registrati con l'accesso effettuato** partono sempre con quello stesso account. **Invia ora** invia ogni tempo
  in attesa, ciascuno con il proprio account; un tempo il cui account ha effettuato la disconnessione aspetta finché
  quell'account non accede di nuovo.
- **Ogni tempo viene salvato una sola volta.** Ogni tempo ha il proprio ID di invio, e il sito non accetta una seconda
  copia dello stesso tempo.
- **Clip e video restano su questo PC.** Al sito va solo il risultato (tempi, percorso, combinazione); un caricamento su
  YouTube è un passaggio separato e facoltativo.

## Uso

- **Avvia acquisizione**: scegli la scheda di acquisizione. LiveTrial mostra prima un'immagine fissa da essa, così puoi
  controllare che sia il dispositivo giusto. La scheda **Live** mostra poi l'immagine e ogni tempo riconosciuto.
- **Analizza un video**: scegli un file `.mp4`/`.mkv` (viene copiato in
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) e LiveTrial lo elabora come un'acquisizione.
- Dopo ogni gara la riga **Ultima gara** dice dove si trova il tempo: sul sito, salvato e in attesa di invio
  (**Invia ora**), oppure solo su questo PC (**Invia come <account>**).
- **Storico dei tempi** elenca ogni tempo con la sua clip. Puoi correggere un riconoscimento; una correzione salva una
  nuova versione e conserva quella precedente.
- L'invio automatico è disattivato per impostazione predefinita; attivalo nelle Impostazioni. Un tempo viene sempre
  salvato prima in locale.

Imposta **Lingua della tua Switch** nelle Impostazioni quando la lingua della console è diversa da quella della dashboard.

## Problemi

- Sito sbagliato, o l'accesso apre il sito sbagliato: chiudi LiveTrial con **Esci da LiveTrial**, riavvialo e controlla
  l'indirizzo nelle Impostazioni. Un altro account di Windows sullo stesso PC potrebbe avere ancora LiveTrial in esecuzione.
- Nessun dispositivo di acquisizione elencato: controlla il collegamento USB e il driver, aspetta qualche secondo e riprova.
- Errori di riconoscimento: correggi il tempo nello Storico dei tempi prima di inviarlo. Il riconoscimento non sostituisce
  mai il controllo del tuo risultato.

LiveTrial è solo per Windows; non esiste una build per macOS o Linux. Per compilarlo da solo, vedi
[Client builds](../../../CLIENT_BUILDS.md).
