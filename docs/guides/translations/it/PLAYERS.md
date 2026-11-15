# Giocatori: il sito web e l'app Android

*Questa è una traduzione automatica della [guida inglese](../../PLAYERS.md); fa fede la versione inglese. Le correzioni sono benvenute tramite il modulo di issue «Translation correction».*

[Tutte le guide](../../../../README.md#get-started)

Ti serve l'indirizzo del sito web MK8DX della tua community, per esempio `https://www.example.org`. Ogni community
gestisce una propria installazione con i propri account e risultati; chiedi l'indirizzo e aiuto per il tuo account
alle persone che gestiscono la tua. Per usare il sito web non devi installare nulla.

## Il sito web

### Accedere

1. Apri l'indirizzo della tua community e scegli l'icona dell'account (in alto a destra), poi **Accedi**.
2. Inserisci il tuo indirizzo email e scegli **Inviami un link via email**. Apri l'email e segui il link. Non c'è
   nessuna password. Il link funziona una sola volta e scade; se non funziona, chiedine uno nuovo.
3. La prima volta il link apre direttamente una configurazione in tre passaggi. Il passaggio 1, **Sei già su questo sito?**,
   chiede se i tuoi tempi di Prova a tempo sono già sul sito e se hai partecipato a un torneo elencato lì.
   Se è così, il passaggio 2 ti permette di trovare il Giocatore che sei tu e di chiedere che venga collegato al tuo account; un
   amministratore o il Direttore del torneo della serata controlla questa richiesta prima del collegamento, e nulla viene
   collegato solo in base al nome. Se non è così, il passaggio 2 crea il tuo Giocatore (in una community dove solo i Direttori creano
   i Giocatori, spiega invece a chi chiedere). Il passaggio 3 offre alcune impostazioni facoltative che puoi saltare.

Il tuo account (l'email con cui accedi) e il tuo Giocatore (il nome nelle classifiche) sono due cose distinte.

### Pubblicare un tempo di Prova a tempo

- **Pubblica un tempo** (barra in alto), oppure **Percorsi** → un percorso → **Pubblica un tempo**: inserisci il tuo tempo in 150cc o 200cc, controlla
  i valori nella conferma e pubblica.
- **Scansionalo**: apri `<your community address>/scanner/` su un telefono o un tablet. Punta la fotocamera sulla schermata dei risultati
  sulla TV, oppure scegli **caricamento immagine** con una foto o uno screenshot. Lo scanner legge i tempi, i giri
  e, quando visibili, il personaggio, la combinazione del kart e la bandiera. Controlla ogni valore prima di inviare; il riconoscimento può
  sbagliare. La fotocamera richiede un indirizzo HTTPS attendibile (funziona anche su `localhost`); il caricamento di immagini funziona ovunque.
- A seconda delle regole della community, un invio può essere pubblicato subito oppure attendere il controllo di un
  amministratore. Un amministratore può correggere o ritirare un tempo pubblicato.

### Seguire i tuoi progressi

**Percorsi**, **Classifica** e **Record** mostrano i tuoi tempi e giri migliori accanto a quelli della community, dei rivali che hai scelto,
dei fantasmi dello staff Nintendo e dei record mondiali. **Combinazione** aiuta con personaggi e combinazioni del kart, **Community**
mostra gli altri Giocatori e **Tornei** le serate di torneo pubblicate, le classifiche e i resoconti. Quando qualcuno
batte uno dei tuoi tempi pubblicati, ricevi una notifica (la campanella). Il sito web può anche inviare notifiche push del browser
se la tua community le ha configurate; attivale nelle impostazioni del tuo account.

Il sito web è disponibile nelle 15 lingue del gioco (scegli la tua nelle impostazioni). L'inglese e l'olandese sono
revisionati; le altre 13 sono traduzioni automatiche e le correzioni sono benvenute: vedi
[Change UI text and translations](../../../DEVELOPMENT.md#change-ui-text-and-translations) per il file da modificare e
[Contributing](../../../../.github/CONTRIBUTING.md) per la pull request.

## L'app Android

L'app offre una scansione più veloce direttamente sul telefono, i tuoi tempi e le notifiche. È facoltativa.

### Requisiti

- Android 8.0 o più recente; è consigliato un telefono arm64. L'APK di rilascio è grande (circa 530 MB): durante l'installazione tieni
  liberi circa 1 GB.
- Una community che l'app possa raggiungere: una **community online** con un indirizzo HTTPS attendibile, oppure un'**installazione a casa
  o al club** (A2) sulla stessa rete Wi-Fi. Un indirizzo locale del computer (`http://127.0.0.1:…`) non funziona nell'app.

### Installare

1. Scarica l'APK dalla pagina **Scarica l'app** della tua community, se offre download (per vederli devi aver
   effettuato l'accesso; è la build supportata dalla tua community), oppure dalla pagina
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) del progetto: prendi
   `mk8dx-android-release-….apk`. Con un clone del repository puoi anche compilare l'APK da solo:
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Verifica il file con `SHA256SUMS.txt` della stessa release (su un computer: `Get-FileHash` in PowerShell,
   `sha256sum` su Linux, `shasum -a 256` su macOS).
3. Copia l'APK sul telefono e aprilo da **File** o **Download**. Android chiede di consentire l'installazione da
   quell'app; consentila solo per questo file verificato e, se vuoi, disattivala di nuovo dopo.

Questa non è un'app del Play Store. I precedenti APK pubblici erano firmati con una chiave di build di debug; l'APK di rilascio usa la
chiave conservata dal manutentore. Salva i risultati non ancora inviati e disinstalla una volta un vecchio APK di debug prima di installare
questa release. Gli APK successivi firmati con la stessa chiave di rilascio si aggiornano sul posto. Anche il passaggio all'APK di una community o a un
APK compilato da te con una chiave diversa richiede una disinstallazione.

### Primo avvio

L'app si apre su **Scegli la tua community**, nella lingua del telefono se l'app la offre. Per scegliere un'altra
lingua, tocca **Lingua / Language** (con il globo) in alto; l'app ricorda questa scelta. Poi chiede una sola cosa:
come gioca la tua community. Non sei sicuro? Chiedi alla
persona che gestisce la tua community.

- **A casa o al club** (A2, MK8DX gira lì su un computer): tocca **Scansiona il codice QR** e scansiona la scheda
  **Prepare a device** (Prepara un dispositivo) che il tuo amministratore mostra su quel computer o distribuisce su carta. Il telefono deve essere sulla
  stessa rete Wi-Fi. L'app mostra poi l'indirizzo e la chiave dell'installazione; si trovano anche nella pagina **Prepare this
  device** (Prepara questo dispositivo) sotto **Full fingerprints** (Impronte complete). Tocca **Connetti** quando corrispondono. Non serve internet. Passo dopo passo:
  [la guida A2, capitolo 7](../../../install/translations/it/A2_HOME_GUIDE.md#7-lapp-android-e-livetrial).
- **Community online** (un sito web su internet): inserisci l'indirizzo con cui la apri nel browser, per esempio
  `https://www.example.org` (senza percorso, senza barra finale), e tocca **Salva**. Se non funziona, apri lo stesso indirizzo nel
  browser del telefono: deve aprirsi senza avvisi sul certificato.

Poi accedi: tocca l'icona della persona in alto a destra e **Accedi**; Impostazioni › **Giocatore su questo telefono** fa la
stessa cosa. L'app mostra un codice e apre la tua community nel browser, dove confermi con il tuo account (in
un'installazione a casa o al club l'app te lo ricorda: prima accedi lì con la tua scheda di accesso personale).

### Orientarsi

In alto l'app mostra il logo (torna alla Home), il **chip della community** con il nome della community che stai
usando, la campanella e il tuo nome. Il tuo nome apre **Tu**: il tuo Giocatore con **Cambia Giocatore**, e le schede
**I miei tempi**, **Record** e **Rivali**, con sotto una riga **Impostazioni**.

- **Più community**: tocca il chip della community per aprire **Community**. Quella attiva è verde; **Cambia community**
  passa a un'altra con un tocco, **Rimuovi da questo telefono** ne dimentica una (solo quando non c'è più nulla in attesa di invio), e
  **Aggiungi una community** riapre la schermata del primo avvio. Ogni community conserva il proprio accesso, i propri tempi
  non inviati e, a casa o al club, la propria attendibilità; nulla passa da una all'altra da solo. Quando l'amministratore
  ha dato un nome alla community, l'app mostra quel nome al posto dell'indirizzo.
- **I miei tempi** è un unico elenco: i numeri della tua carriera, poi una riga per ogni percorso e classe con il tuo record personale; tocca una
  riga per i tempi precedenti e usa **⋯** su un tempo per **Dettagli**, **Modifica**, **Ritira** o
  **Porta in un'altra community…**.
- **Senza internet**: l'app conserva una copia dei tuoi tempi e dei migliori tempi dei tuoi rivali per ogni community e
  la mostra con "Offline — ultimo aggiornamento …".
- **In attesa di invio**: i tempi che sono ancora solo sul telefono compaiono come un banner arancione in Home e in Tu; toccalo,
  oppure usa Impostazioni › **Salvato su questo telefono**, per vederli.
- **Impostazioni** è suddiviso in **Giocatore**, **App**, **Community** e **Informazioni**, e salva ogni modifica da solo.
  La lingua è sotto App; **Scarica l'app** e **Salvato su questo telefono** sono sotto Community; **Esegui una scansione di test**
  è sotto Informazioni.

### Portare i tempi in un'altra community

Se fai parte di più community, un tempo può contare anche in un'altra: **Porta in un'altra community…**
su un tempo, oppure **Porta i miei tempi migliori** sotto i numeri della tua carriera in I miei tempi (i percorsi in cui l'altra community
ha già un tuo tempo migliore vengono saltati). La copia attende finché non hai effettuato l'accesso lì. Decide la community
**che riceve**: per impostazione predefinita non accetta tempi da altrove, può far approvare prima ciascuno da un amministratore,
oppure può accettarli come qualsiasi altro tempo. Un tempo portato mostra sempre da dove proviene ("Portato da … ·
originariamente …"). Lo stesso originale viene accettato una sola volta; un tempo uguale completa solo ciò che mancava al tempo
già esistente.

### Notifiche

Le notifiche nell'app vengono recuperate dalla casella in arrivo della tua community; devono essere attivi sia il permesso di notifica di Android sia
l'interruttore dell'app stessa.

## Problemi

- Nessuna email di accesso: controlla lo spam e l'indirizzo esatto, e chiedi un nuovo link. In un'installazione di prova locale
  l'email arriva nella casella di posta di test locale, non nella tua casella di posta.
- Una rivendicazione viene rifiutata con *Troppe azioni di rivendicazione in questo momento…*: attendi il tempo
  indicato e riprova. Un account può avere al massimo 5 rivendicazioni in attesa di decisione alla volta (un giocatore
  al massimo 5 da tutti gli account insieme). Raggiunto questo limite, attendi che una rivendicazione in sospeso venga
  gestita, oppure ritirane una con **Ritira questa richiesta**, e riprova.
- Qualcosa sembra sbagliato sul sito della tua community: chiedi prima alle persone che lo gestiscono. I bug del software stesso
  si possono segnalare nelle issue del progetto; vedi [SUPPORT.md](../../../../.github/SUPPORT.md). Non pubblicare mai link di accesso o nomi
  di altre persone.
