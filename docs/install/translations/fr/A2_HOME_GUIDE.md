# MK8DX à la maison ou dans ton club — manuel

*Ceci est une traduction automatique du [guide anglais](../../A2_HOME_GUIDE_EN.md) ; la version anglaise fait foi. Les corrections sont les bienvenues via le formulaire de ticket « Translation correction ».*

Ce manuel t'accompagne pas à pas, d'un ordinateur vide jusqu'à une soirée de jeu. Tu n'as besoin d'aucune connaissance en informatique. Lis les chapitres dans l'ordre ; chaque chapitre s'appuie sur le précédent.

**D'abord, en toute franchise :** l'installation pour la maison et le club est disponible depuis la version 0.2.0. Windows 11 est testé de bout en bout, y compris avec un téléphone Android sur le réseau. Linux n'a été testé que sous WSL 2, pas encore sur un PC Linux séparé ni sur un Raspberry Pi. Les paquets macOS sont compilés, mais pas encore testés sur un vrai Mac, et aucun iPhone n'a encore été testé. Chaque fois que quelque chose n'est pas encore testé ou pas encore compilé, l'étape le dit.

**Comment lire une étape :** après **À faire** vient ce que tu fais, après **Tu vois** ce qui doit se passer ensuite, et après **Tu vois autre chose ?** ce qu'il faut faire dans ce cas. Les mots en gras sont des boutons ou des textes que tu vois exactement ainsi à l'écran.

## 1. Qu'est-ce que MK8DX à la maison ou dans ton club, et de quoi as-tu besoin ?

MK8DX est un site web pour Mario Kart 8 Deluxe : conserver et comparer des contre-la-montre, des enregistrements LiveTrial et des soirées tournoi. Avec cette installation, le site tourne sur un seul ordinateur de ton propre réseau. Les téléphones, tablettes et autres ordinateurs du même réseau ouvrent le site via cet ordinateur. Rien ne part sur internet.

Chacun se connecte avec une **carte de connexion** personnelle : une carte avec un code QR. Un code QR est un code-barres carré que tu scannes avec l'appareil photo de ton téléphone ou de ta tablette.

Dans ce manuel, l'ordinateur qui fait tourner MK8DX s'appelle **l'ordinateur MK8DX**.

Ce dont tu as besoin :

- **Un ordinateur qui reste allumé pendant qu'on joue :** Windows 11 avec un processeur Intel ou AMD, Linux ou macOS. 8 Go de mémoire sont recommandés. L'installation vérifie qu'au moins 6 Go d'espace disque sont libres.
- **Un réseau domestique :** le Wi-Fi ou les câbles réseau de ton routeur. Un routeur est le boîtier qui crée ton réseau (souvent fourni par ton fournisseur d'accès à internet). Tous les appareils doivent être sur le même réseau. N'utilise pas de réseau invité : il isole généralement les appareils les uns des autres.
- **Des téléphones, tablettes ou autres ordinateurs** pour les joueurs, de préférence avec un appareil photo pour scanner les codes QR.
- **Une imprimante** est pratique pour imprimer les cartes de connexion et le code de récupération, mais elle n'est pas obligatoire.

Ce dont tu n'as pas besoin :

- **Pas d'internet pendant le jeu.** Seulement pendant la préparation, tu télécharges une fois Docker, Python et le paquet MK8DX (ou quelqu'un te les donne sur une clé USB).
- **Pas de compte auprès d'une autre entreprise**, pas d'adresse e-mail et pas de cloud.
- **Pas d'abonnement.** MK8DX et Python sont gratuits. Docker Desktop est gratuit pour un usage personnel et pour les petites organisations ; les conditions sont sur le site de Docker. Sous Linux, tu utilises le Docker Engine gratuit.

<!-- image: network-overview -->

## 2. Préparer l'ordinateur

MK8DX a besoin de deux programmes d'aide gratuits :

- **Docker** fait tourner des programmes dans des « conteneurs » isolés. Le site MK8DX et sa base de données tournent dans ces conteneurs. Sous Windows et macOS, le programme s'appelle Docker Desktop.
- **Python** est un langage de programmation. Le programme d'installation de MK8DX est écrit en Python. Il te faut Python 3.12 à 3.15.

Fais uniquement la partie qui correspond à ton ordinateur (2A, 2B ou 2C) et saute les deux autres.

## 2A. Préparer Windows 11

1. **À faire :** vérifie quel processeur a ton ordinateur : Démarrer → **Settings** (Paramètres) → **System** (Système) → **About** (Informations système), ligne **System type** (Type du système). → **Tu vois :** « 64-bit operating system, x64-based processor » (système d'exploitation 64 bits, processeur x64). → **Tu vois autre chose ?** S'il est écrit ARM, le paquet Windows de MK8DX ne convient pas : il n'existe que pour x64 (Intel et AMD).
2. **À faire :** installe d'abord **WSL** (Windows Subsystem for Linux, le sous-système Windows pour Linux). C'est une partie de Windows sur laquelle Docker s'appuie ; sans WSL, Docker Desktop ne peut pas s'installer. Fais un clic droit sur le bouton Démarrer et choisis **Terminal (Admin)** (Terminal (administrateur)) ou **Windows PowerShell (Admin)** (Windows PowerShell (administrateur)). Clique sur **Yes** (Oui) quand Windows demande l'autorisation. Tape `wsl --install` et appuie sur Entrée. → **Tu vois :** Windows télécharge et installe WSL et Ubuntu ; cela prend quelques minutes. À la fin, il indique que tu dois redémarrer l'ordinateur. Redémarre l'ordinateur. → **Tu vois autre chose ?** Si, après le redémarrage, une fenêtre s'ouvre et demande un nom d'utilisateur et un mot de passe pour Ubuntu : saisis le nom et le mot de passe de ton choix (MK8DX n'en a pas besoin), puis ferme la fenêtre. S'il est indiqué que WSL est déjà installé, tape `wsl --update` et appuie sur Entrée. S'il est question de **virtualization** (virtualisation) (« Virtual Machine Platform » ou « virtualization »), la virtualisation est désactivée dans le BIOS de l'ordinateur ; active-la (les fabricants l'appellent souvent Intel VT-x ou AMD-V) ou demande de l'aide.
3. **À faire :** télécharge **Docker Desktop** pour Windows (x86_64 / AMD64) sur docker.com et ouvre le fichier téléchargé. → **Tu vois :** le programme d'installation de Docker avec le choix d'utiliser WSL 2. WSL est une partie de Windows sur laquelle Docker s'appuie. Laisse ce choix coché et clique sur **OK**. → **Tu vois autre chose ?** Si Windows demande si cette application peut apporter des modifications, clique sur **Yes** (Oui).
4. **À faire :** attends que l'installation soit terminée et redémarre l'ordinateur si Docker le demande. → **Tu vois :** après le redémarrage, Docker Desktop s'ouvre (ou ouvre-le toi-même depuis le menu Démarrer). La première fois, Docker te demande d'accepter ses conditions. → **Tu vois autre chose ?** Si Docker te demande de te connecter ou de créer un compte : MK8DX n'a pas besoin d'un compte Docker, passe cette étape si Docker le propose. Si Docker indique toujours que WSL manque ou doit être mis à jour, refais l'étape 2 (`wsl --install` ou `wsl --update`) et redémarre.
5. **À faire :** attends dans la fenêtre de Docker Desktop. → **Tu vois :** **Engine running** (moteur en marche) en bas à gauche. → **Tu vois autre chose ?** « Engine starting » (démarrage du moteur) peut prendre quelques minutes. Si cela bloque ou affiche une erreur, redémarre l'ordinateur et rouvre Docker Desktop. Docker doit être dans le mode normal des conteneurs Linux (pas « Windows containers »).
6. **À faire :** va sur python.org → **Downloads** (Téléchargements) et télécharge le **Python install manager** (gestionnaire d'installation de Python) pour Windows (le fichier se termine par `.msix`). C'est désormais la méthode officielle pour installer Python sous Windows. Ouvre le fichier téléchargé et clique sur **Install** (Installer). → **Tu vois :** Windows installe le Python install manager ; tu peux ensuite fermer la fenêtre. → **Tu vois autre chose ?** Tu peux aussi l'installer depuis le Microsoft Store : cherche « Python install manager » et clique sur **Install** (Installer). Utilise l'une des deux méthodes, pas les deux.
7. **À faire :** clique sur Démarrer, tape `PowerShell`, ouvre **Windows PowerShell**, tape `py install 3.15` et appuie sur Entrée. Cela installe Python lui-même (le gestionnaire d'installation n'est que l'outil qui va chercher Python). → **Tu vois :** la première fois, quelques questions pour vérifier les paramètres ; réponds avec Entrée (le choix proposé) ou `y`. Python est ensuite téléchargé et installé. À une question sur l'ajout d'un dossier à ton PATH, tu peux répondre `y` ; ce n'est pas obligatoire. → **Tu vois autre chose ?** Installe exactement la version 3.15 comme ci-dessus ; 3.12, 3.13 ou 3.14 fonctionnent aussi, une version plus récente (3.16 ou ultérieure) pas encore.
8. **À faire :** ferme PowerShell, rouvre-le, tape `python --version` et appuie sur Entrée. → **Tu vois :** `Python 3.15` suivi d'un numéro, par exemple `Python 3.15.2`. → **Tu vois autre chose ?** Si le Microsoft Store s'ouvre, ou s'il est indiqué que python est introuvable : clique sur Démarrer, tape **Manage app execution aliases** (Gérer les alias d'exécution d'application) et ouvre-le. Active **Python (default)** (Python (par défaut)) et désactive **App Installer python.exe** et **python3.exe**. Si tu as installé par le passé un ancien Python ou le « Python launcher », supprime-le via **Settings → Apps → Installed apps** (Paramètres → Applications → Applications installées) et réessaie.

<!-- image: docker-engine-running -->

<!-- image: python-install-manager -->

## 2B. Préparer Linux (Ubuntu ou Debian)

Linux n'a pas encore été testé de bout en bout avec MK8DX. Les étapes sont écrites pour Ubuntu 24.04 ou plus récent. Tu les tapes dans un **terminal** : une fenêtre où tu donnes des commandes texte (sous Ubuntu, tu l'ouvres avec Ctrl+Alt+T). Termine chaque commande par Entrée. **sudo** devant une commande signifie « en tant qu'administrateur de cet ordinateur » : Linux te demande alors ton mot de passe, et tu ne vois aucun caractère pendant la saisie. C'est normal.

1. **À faire :** tape `python3 --version`. → **Tu vois :** `Python 3.12`, `3.13`, `3.14` ou `3.15`. → **Tu vois autre chose ?** Un numéro plus bas (Debian 12, par exemple, a la 3.11) est trop ancien ; 3.16 ou plus n'est pas encore pris en charge. Il te faut alors une version plus récente de ton Linux ; Ubuntu 24.04 a Python 3.12.
2. **À faire :** tape `sudo apt update` puis `sudo apt install docker.io docker-compose-v2 python3-venv`. À la question de savoir s'il faut continuer, réponds Y puis Entrée. → **Tu vois :** les paquets sont téléchargés et installés. → **Tu vois autre chose ?** Si apt ne trouve pas un paquet, celui-ci porte un autre nom sur ton Linux (cela peut arriver sous Debian). Continue et vérifie à l'étape 5 si Docker Compose fonctionne.
3. **À faire :** tape `sudo systemctl enable --now docker`. Cela démarre Docker maintenant et à chaque démarrage de l'ordinateur. → **Tu vois :** aucune erreur (parfois une ligne qui commence par « Created symlink »).
4. **À faire :** tape `sudo usermod -aG docker $USER`. Cela donne à ton utilisateur le droit d'utiliser Docker. Déconnecte-toi ensuite puis reconnecte-toi (ou redémarre) : le droit ne prend effet qu'après une nouvelle connexion. → **Tu vois :** aucune erreur. → **Remarque :** toute personne du groupe docker dispose en pratique des droits d'administrateur sur cet ordinateur. N'ajoute que toi-même.
5. **À faire :** vérifie avec `docker info` puis `docker compose version`. → **Tu vois :** une liste de détails sans erreur, et « Docker Compose version » suivi d'un numéro. → **Tu vois autre chose ?** « permission denied » (permission refusée) : fais l'étape 4 et n'oublie pas de te déconnecter. « Cannot connect to the Docker daemon » (impossible de se connecter au démon Docker) : fais l'étape 3.

Un **pare-feu** est une protection qui décide quelles connexions un ordinateur laisse entrer. Si le pare-feu ufw ou firewalld est actif sur ton Linux, l'installation du chapitre 3 indique quelle commande laisse passer MK8DX.

## 2C. Préparer macOS

**Remarque :** macOS n'a pas encore été testé sur un vrai Mac. Les étapes ci-dessous suivent ce que l'installation attend sous macOS.

1. **À faire :** choisis menu Pomme → **About This Mac** (À propos de ce Mac) et regarde **Chip** (Puce) ou **Processor** (Processeur). → **Tu vois :** une puce Apple (M1, M2 et ultérieures) : prends le paquet `macos-arm64`. → **Tu vois autre chose ?** Un processeur Intel : prends le paquet `macos-amd64`. Il faut macOS 10.15 ou plus récent et un Docker Desktop qui prend encore en charge ton Mac.
2. **À faire :** télécharge **Docker Desktop** pour Mac avec la puce correspondante sur docker.com, ouvre le fichier téléchargé et fais glisser Docker dans **Applications**. → **Tu vois :** Docker dans ton dossier Applications.
3. **À faire :** ouvre Docker. Accepte les conditions ; si macOS demande ton mot de passe, saisis-le. → **Tu vois :** au bout d'un moment, **Engine running** (moteur en marche) dans la fenêtre de Docker Desktop. → **Tu vois autre chose ?** Si Docker te demande de te connecter : MK8DX n'a pas besoin d'un compte Docker, passe cette étape si Docker le propose.
4. **À faire :** télécharge le programme d'installation macOS de Python 3.15 sur python.org et ouvre-le. Parcours les étapes avec **Continue** (Continuer) et **Install** (Installer). → **Tu vois :** le message indiquant que l'installation a réussi.
5. **À faire :** ouvre **Terminal** (Applications → Utilitaires → Terminal), tape `python3 --version` et appuie sur Entrée. → **Tu vois :** `Python 3.12` à `3.15`. → **Tu vois autre chose ?** Un numéro plus bas (par exemple la 3.9 d'Apple elle-même) : ferme Terminal et rouvre-le. Si le numéro est toujours plus bas, réinstalle Python depuis python.org.
6. **À faire :** tape `docker info` dans Terminal. → **Tu vois :** une liste de détails sans erreur. → **Tu vois autre chose ?** Lance Docker Desktop et attends Engine running.

## 3. Installer MK8DX

**Décompresser le paquet**

1. **À faire :** télécharge le paquet MK8DX pour la maison ou le club pour ton système : Windows, Linux ou macOS, et pour Linux et macOS aussi pour ton processeur (amd64 ou arm64). Pour vérifier que le téléchargement est correct, compare son SHA-256 avec sa ligne dans `SHA256SUMS.txt` de la même release (Windows : `Get-FileHash <file> -Algorithm SHA256` ; Linux : `sha256sum <file>` ; macOS : `shasum -a 256 <file>`) ; voir aussi `docs/RELEASE_PACKAGES.md#check-a-download`. → **Tu vois :** un fichier zip dans ton dossier Téléchargements. → **Tu vois autre chose ?** Si le navigateur avertit que le fichier n'est pas sûr ou rarement téléchargé : choisis **Keep** (Conserver). Windows : fais ensuite un clic droit sur le fichier zip → **Properties** (Propriétés), coche **Unblock** (Débloquer) en bas et clique sur **OK**. Fais-le avant de décompresser ; sinon Windows (Smart App Control, le contrôle intelligent des applications) risque de bloquer plus tard `Start-MK8DX-LAN.cmd`. Ne désactive pas Smart App Control : il ne pourrait alors être réactivé qu'avec une nouvelle installation de Windows.
2. **À faire :** décompresse le fichier zip dans un dossier permanent, par exemple un dossier MK8DX dans Documents. Windows : clic droit sur le fichier zip → **Extract All** (Extraire tout). Choisis un dossier qui restera : MK8DX démarrera toujours plus tard depuis ce dossier, alors ne le déplace pas et ne le supprime pas. → **Tu vois :** un dossier contenant entre autres `Start-MK8DX-LAN.cmd`, `README-FIRST.txt` et les dossiers `docs`, `images` et `tooling`. → **Tu vois autre chose ?** Si tu as seulement ouvert le fichier zip dans l'Explorateur de fichiers, extrais-le vraiment : démarrer depuis l'intérieur du fichier zip ne fonctionne pas.

<!-- os: windows -->

**Démarrer sous Windows**

1. **À faire :** dans le dossier décompressé, double-clique sur **Start-MK8DX-LAN.cmd**. → **Tu vois :** une fenêtre avec le logo MK8DX et un compte à rebours 3-2-1-GO avec des bips ([pour le supprimer](../../../guides/HOSTING.md#the-launcher-window-look-and-options)), puis des lignes comme « MK8DX package: » (paquet MK8DX) et « Private installation: » (installation privée). La première fois, elle affiche aussi « Preparing the included Python packages (once, without internet). » (préparation des paquets Python inclus, une seule fois, sans internet) et « Loading the included Docker images. This can take several minutes. » (chargement des images Docker incluses ; cela peut prendre plusieurs minutes). Cela prend quelques minutes. Elle affiche ensuite « MK8DX setup is open in your browser: » (l'installation de MK8DX est ouverte dans ton navigateur) et l'installation s'ouvre dans ton navigateur. → **Tu vois autre chose ?** Voir les messages ci-dessous.
2. **À faire :** garde la fenêtre noire ouverte jusqu'à ce que tu aies cliqué sur **Finish** (Terminer) dans l'installation. La fenêtre le dit aussi : « Keep this window open until you click Finish. » (garde cette fenêtre ouverte jusqu'à ce que tu cliques sur Finish).

Messages dans la fenêtre noire sous Windows :

- **« Python 3.12 to 3.15 is missing. Install the Python install manager from python.org (or the Microsoft Store), run: py install 3.15, reopen PowerShell and retry. »** (Python 3.12 à 3.15 est absent.) Fais les étapes 6 à 8 du chapitre 2A, puis double-clique à nouveau sur Start-MK8DX-LAN.cmd.
- **« Docker Desktop is missing or not running. Start Docker Desktop in Linux-container mode, wait until it shows "Engine running", and retry. »** (Docker Desktop est absent ou ne tourne pas.) Lance Docker Desktop, attends Engine running et double-clique à nouveau.
- Sous une erreur, la fenêtre affiche **« The selected step stopped. Read the message above before retrying. »** (l'étape choisie s'est arrêtée ; lis le message ci-dessus avant de réessayer). Lis la ligne au-dessus, corrige le problème et appuie sur une touche pour fermer la fenêtre.

<!-- /os -->

<!-- os: linux macos -->

**Démarrer sous Linux et macOS**

1. **À faire :** ouvre un terminal dans le dossier décompressé. Linux : fais un clic droit dans le dossier et choisis « Ouvrir dans un terminal » si ton gestionnaire de fichiers le propose. Sous macOS et Linux, ceci fonctionne aussi : ouvre Terminal, tape `cd ` (avec une espace après), fais glisser le dossier dans la fenêtre et appuie sur Entrée. → **Tu vois :** le terminal est dans le dossier du paquet.
2. **À faire :** tape `sh tooling/start-mk8dx.sh` et appuie sur Entrée. → **Tu vois :** le logo MK8DX et un compte à rebours 3-2-1-GO, puis « MK8DX package: » (paquet MK8DX), le numéro de Python, « Docker Compose version ». La première fois aussi « Loading the included Docker images. This can take several minutes. » (chargement des images Docker incluses) et « Preparing the included Python packages (once, without internet). » (préparation des paquets Python inclus). Ensuite « Private installation: » (installation privée) et « MK8DX setup is open in your browser: » (l'installation est ouverte dans ton navigateur), et l'installation s'ouvre dans ton navigateur. → **Tu vois autre chose ?** Si aucun navigateur ne s'ouvre, copie depuis le terminal l'adresse qui commence par `http://127.0.0.1:` dans ton navigateur.
3. **À faire :** garde le terminal ouvert jusqu'à ce que tu aies cliqué sur **Finish** (Terminer).

Messages dans le terminal sous Linux et macOS :

- **« Python 3.12 to 3.15 is missing. Install it (Ubuntu/Debian: sudo apt install python3 python3-venv; macOS: python.org) and retry. »** (Python 3.12 à 3.15 est absent.) Refais le chapitre 2B ou 2C.
- **« Docker is not running or this user may not use it (Linux: sudo systemctl start docker, and join the docker group; macOS: start Docker Desktop). »** (Docker ne tourne pas ou cet utilisateur n'a pas le droit de l'utiliser.) Linux : fais les étapes 3 et 4 du chapitre 2B. macOS : lance Docker Desktop.
- **« Could not create the private Python environment (Ubuntu/Debian: sudo apt install python3-venv). »** (impossible de créer l'environnement Python privé.) Installe python3-venv comme à l'étape 2 du chapitre 2B.

<!-- /os -->

**L'installation dans le navigateur**

L'installation est une page de ton navigateur qui ne fonctionne que sur l'ordinateur MK8DX lui-même. Elle est en néerlandais si ton navigateur utilise le néerlandais, et sinon en anglais. En haut à droite se trouve **Manual** (Manuel) : il ouvre ce manuel. En bas se trouvent **Back** (Retour), parfois **Advanced** (Avancé), et **Next** (Suivant). Les points en haut indiquent où tu en es.

1. **Welcome to MK8DX.** (Bienvenue sur MK8DX.) **À faire :** lis l'écran et clique sur **Next** (Suivant). → **Tu vois :** « Quick check » (vérification rapide). Le bouton **Restore a backup** (Restaurer une sauvegarde) de cet écran est réservé à un nouvel ordinateur (chapitre 10).
2. **Quick check.** (Vérification rapide.) **À faire :** patiente un instant. → **Tu vois :** trois coches vertes à **Docker Desktop is running** (Docker Desktop tourne), **Enough free disk space** (assez d'espace disque libre, avec le nombre de Go) et **Windows, Linux or macOS** (Windows, Linux ou macOS). Clique sur **Next**. → **Tu vois autre chose ?** Un point d'exclamation avec une explication, par exemple « Start Docker Desktop, wait for 'Engine running' and click Try again. » (lance Docker Desktop, attends « Engine running » et clique sur Try again) ou « Free at least 6 GB on this drive. » (libère au moins 6 Go sur ce disque). Corrige le problème et clique sur **Try again** (Réessayer). Sous Linux, la première vérification s'appelle aussi « Docker Desktop is running » ; il s'agit là de Docker Engine.
3. **What kind of installation?** (Quel type d'installation ?) **À faire :** laisse **Home, club or LAN-night network, no internet needed** (réseau domestique, de club ou de soirée LAN, sans internet ; recommandé) sélectionné et clique sur **Next**. → **Tu vois :** « Your network » (ton réseau).
4. **Your network.** (Ton réseau.) Une **adresse réseau** (adresse IP) est le numéro grâce auquel les appareils trouvent cet ordinateur dans ton réseau, comme un numéro de maison. **À faire :** lis l'adresse sous « Phones, tablets and other PCs reach MK8DX at this address: » (les téléphones, tablettes et autres PC accèdent à MK8DX à cette adresse) et note-la, par exemple `https://192.168.1.50`. Clique sur **Install** (Installer). → **Tu vois :** sous Windows « This network is set up as a home (private) network. » (ce réseau est configuré comme réseau domestique, privé) ou « Windows currently treats this network as public. When you click Install, MK8DX marks it private and allows only MK8DX. » (Windows traite actuellement ce réseau comme public ; quand tu cliques sur Install, MK8DX le marque comme privé et n'autorise que MK8DX). Sous Linux et macOS, aucune phrase sur le réseau ne s'affiche ici. → **Tu vois autre chose ?** Si l'ordinateur a plusieurs connexions (câble et Wi-Fi), clique sur **Advanced** (Avancé) et, à « Choose another address of this computer: » (choisir une autre adresse de cet ordinateur), choisis l'adresse du réseau sur lequel se trouvent aussi les téléphones. S'il est indiqué « No network address found. » (aucune adresse réseau trouvée), connecte l'ordinateur à ton réseau domestique et clique sur **Try again** (Réessayer).
5. **Installing.** (Installation en cours.) **À faire :** patiente et garde la fenêtre ouverte. → **Tu vois :** « MK8DX is being set up. Keep this window open. » (MK8DX est en cours d'installation ; garde cette fenêtre ouverte) puis, l'un après l'autre, « Preparing the installation » (préparation de l'installation), « Allowing the network (Windows asks for permission) » (autorisation du réseau, Windows demande la permission), « Starting the database and website » (démarrage de la base de données et du site), « Checking » (vérification) et enfin « MK8DX is running. Two short steps left. » (MK8DX tourne ; il reste deux courtes étapes). Clique sur **Next**. Sous Windows, une fenêtre Windows demande une fois si Windows PowerShell peut apporter des modifications : clique sur **Yes** (Oui). MK8DX marque ainsi ton réseau domestique comme privé et ne laisse passer que MK8DX à travers le pare-feu (la protection de Windows). → **Tu vois autre chose ?** Une erreur en rouge : clique sur **Details** (Détails) pour lire ce qui n'a pas marché, corrige-le et clique sur **Try again**. Si tu as cliqué sur No (Non) dans la fenêtre Windows, il est indiqué que Windows n'a pas autorisé la modification ; clique sur **Try again** puis sur **Yes**.
6. **Linux uniquement : le pare-feu.** **À faire :** pendant ou après l'installation, clique sur **Details** (Détails) et cherche la ligne qui commence par « Network: » (réseau). → **Tu vois :** « not-needed » (rien à faire), ou « manual: » (manuel) suivi d'une commande comme `sudo ufw allow from 192.168.1.0/24 to 192.168.1.50 port 80,443 proto tcp`. → **Fais ensuite :** tape exactement cette commande (avec ton adresse, telle qu'elle est affichée) dans un terminal. Sans cette commande, les téléphones ne peuvent pas ouvrir le site.
7. **Your administrator account.** (Ton compte administrateur.) L'**administrateur** est la personne qui ajoute des personnes et crée les cartes de connexion ; c'est toi. **À faire :** saisis un nom à **Your name** (ton nom), par exemple « Papa » ou « Équipe du club », et clique sur **Next**. Le nom n'est visible qu'à l'intérieur de cette installation. → **Tu vois :** « Who plays? » (qui joue ?)
8. **Who plays?** (Qui joue ?) **À faire :** tape les noms des joueurs à **Names (one per line)** (noms, un par ligne), chacun sur sa propre ligne, et clique sur **Add** (Ajouter). Ou clique tout de suite sur **Skip** (Passer) : tu pourras le faire plus tard exactement de la même façon dans MK8DX beheer (chapitre 5). → **Tu vois :** les noms sous « In this installation: » (dans cette installation), et toi-même avec « (administrator) » (administrateur) après ton nom. Clique sur **Next**.
9. **Sign in on phones and PCs.** (Se connecter sur les téléphones et les PC.) **À faire :** tu peux déjà créer des cartes de connexion ici (les chapitres 5 et 6 expliquent comment), ou simplement cliquer sur **Next**. → **Tu vois :** « Done! Enjoy the races. » (Terminé ! Bonnes courses.)
10. **Done! Enjoy the races.** (Terminé ! Bonnes courses.) **À faire :** note les deux adresses : **Website** (site web, par exemple `https://192.168.1.50`) et **New device** (nouvel appareil, par exemple `http://192.168.1.50/setup`). Laisse les trois coches activées : **Start MK8DX with Windows** (démarrer MK8DX avec Windows), **Make a backup every night** (faire une sauvegarde chaque nuit) et **Put an 'MK8DX beheer' shortcut on the desktop** (mettre un raccourci « MK8DX beheer » sur le bureau). Clique sur **Finish** (Terminer). → **Tu vois :** ton code de récupération (chapitre 4). → **Sous Linux et macOS**, la première coche s'appelle « Start MK8DX when the computer starts » (démarrer MK8DX au démarrage de l'ordinateur). Sous macOS, elle ouvre alors Docker Desktop quand tu te connectes. Sous Linux, c'est `sudo systemctl enable --now docker` du chapitre 2B qui s'en charge ; si tu ne l'as pas encore fait, l'installation affiche exactement cette commande après Finish.
11. **Closing.** (Fermeture.) **À faire :** lis le chapitre 4 et conserve le code de récupération. Clique ensuite sur **Close** (Fermer). → **Tu vois :** « You can close this window now. » (tu peux fermer cette fenêtre maintenant). Ferme l'onglet du navigateur. Sous Windows, la fenêtre noire demande une touche ; appuie sur une touche et elle se ferme. Si tu ne fais rien, la page d'installation s'arrête d'elle-même au bout de 10 minutes. MK8DX lui-même continue de tourner.

![assistant : bienvenue](../../guide/img/wizard-welcome-en.png)

![assistant : vérification](../../guide/img/wizard-check-en.png)

![assistant : réseau](../../guide/img/wizard-network-en.png)

<!-- image: windows-permission -->

![assistant : terminé](../../guide/img/wizard-done-en.png)

## 4. Le code de récupération et le dossier des sauvegardes

Une **sauvegarde** est une copie de secours de tout ce qui se trouve dans MK8DX : personnes, temps, tournois et paramètres. MK8DX fait une sauvegarde chaque nuit à 03:00 et conserve les 7 plus récentes. Les sauvegardes sont chiffrées : sans la clé, elles ne peuvent pas être lues.

Le **code de récupération** est cette clé. Il se compose de cinq groupes de quatre lettres et chiffres, par exemple `ABCD-EFGH-JKLM-NPQR-STUV`. Tu n'en as besoin que pour restaurer une sauvegarde sur un autre ordinateur.

1. **À faire :** après **Finish** (Terminer), regarde la carte **MK8DX recovery code** (code de récupération MK8DX). → **Tu vois :** le code, la phrase « A backup cannot be opened without this code. It is shown only once. » (une sauvegarde ne peut pas être ouverte sans ce code ; il n'est affiché qu'une seule fois) et en dessous le dossier où vont les sauvegardes.
2. **À faire :** recopie le code sur papier ou clique sur **Print cards** (Imprimer les cartes) pour imprimer cette page. Vérifie-le lettre par lettre. → **Tu vois :** le code sur papier. → **Pourquoi une seule fois ?** MK8DX garde le code protégé sur cet ordinateur pour la sauvegarde de nuit, mais ne l'affiche plus jamais. Si l'ordinateur tombe en panne, il ne reste que le papier.
3. **À faire :** range le papier en lieu sûr, pas à côté de l'ordinateur. Quiconque possède le code et une sauvegarde peut tout ouvrir.

Où se trouvent les sauvegardes :

- **Windows :** dans le dossier Documents, dossier `MK8DX-backups` (sur le disque : `C:\Users\<your name>\Documents\MK8DX-backups`).
- **Linux et macOS :** dans ton dossier personnel, dossier `Documents/MK8DX-backups` (donc `~/Documents/MK8DX-backups`). Même sur un Linux dans une autre langue, ce dossier s'appelle Documents.
- L'installation affiche le dossier exact sous le code de récupération.

De temps en temps, copie le dossier `MK8DX-backups` sur une clé USB ou un autre disque. Sinon, si l'ordinateur tombe en panne, les sauvegardes ne se trouvent que sur cet ordinateur en panne.

Si tu décoches **Make a backup every night** (faire une sauvegarde chaque nuit), tu n'obtiens pas de code de récupération et aucune sauvegarde n'est faite. Si tu la réactives plus tard dans MK8DX beheer et cliques sur **Finish**, tu vois ton code de récupération à ce moment-là.

![code de récupération](../../guide/img/recovery-code-en.png)

## 5. Les personnes et les cartes de connexion (MK8DX beheer)

**MK8DX beheer** (« administration MK8DX » en néerlandais) est la même page que l'installation, mais pour plus tard : ajouter des personnes et créer des cartes de connexion. Elle ne fonctionne que sur l'ordinateur MK8DX lui-même. Le raccourci sur le bureau s'appelle « MK8DX beheer » dans toutes les langues ; le titre de la page en anglais est **MK8DX administration** (administration MK8DX).

Un **compte** est celui qui se connecte. Un **Joueur** est le joueur dans les classements, avec ses temps. Après s'être connecté, chacun choisit ou revendique son propre Joueur sur le site. Les noms ne sont jamais liés automatiquement.

**Ouvrir MK8DX beheer**

1. **À faire (Windows) :** double-clique sur **MK8DX beheer** sur le bureau. Ce raccourci démarre la même chose que Start-MK8DX-LAN.cmd. → **Tu vois :** la fenêtre du lanceur avec sa courte intro de course, puis, dans le navigateur, la page avec « administration » en haut et le titre **MK8DX administration**. → **Tu vois autre chose ?** Pas de raccourci : double-clique sur Start-MK8DX-LAN.cmd dans le dossier MK8DX.
2. **À faire (Linux) :** lance **MK8DX beheer** depuis le bureau ou depuis le menu des applications. Sur certains bureaux Linux, tu dois d'abord autoriser une telle icône (clic droit dessus, puis l'option qui autorise le lancement). Cela fonctionne aussi avec `sh tooling/start-mk8dx.sh` dans le dossier MK8DX, comme au chapitre 3. → **Tu vois :** un terminal puis la page **MK8DX administration**.
3. **À faire (macOS, non testé) :** double-clique sur **MK8DX beheer.command** sur le bureau, ou lance `sh tooling/start-mk8dx.sh` comme au chapitre 3. → **Tu vois :** Terminal puis la page **MK8DX administration**.

**Ajouter des personnes**

1. **À faire :** tape les noms à **Names (one per line)** (noms, un par ligne) et clique sur **Add** (Ajouter). → **Tu vois :** les noms sous « In this installation: » (dans cette installation).
2. **À faire :** clique sur **Next** (Suivant). → **Tu vois :** « Sign in on phones and PCs » (se connecter sur les téléphones et les PC) en deux étapes : **Step 1 · Prepare the device** (étape 1 · préparer l'appareil) avec la carte **Prepare a device** (préparer un appareil ; une fois par appareil, elle ne te connecte pas encore) et **Step 2 · Sign in as the right person** (étape 2 · se connecter en tant que la bonne personne) avec, pour chaque personne, un cadre avec le bouton **Make card** (créer la carte).

**Créer et imprimer des cartes**

1. **À faire :** clique sur **Make card** (créer la carte) à côté d'une personne. → **Tu vois :** un code QR avec « Valid until » (valable jusqu'à) et une heure. Une carte fonctionne une seule fois et pendant 15 minutes. Fais-la scanner tout de suite par la personne (chapitre 6), ou imprime-la.
2. **À faire :** crée d'abord les cartes que tu veux, puis clique sur **Print cards** (Imprimer les cartes). → **Tu vois :** la fenêtre d'impression de ton navigateur avec toutes les cartes à l'écran, y compris la carte Prepare a device.
3. **À faire :** crée aussi une carte pour toi-même (le nom avec « (administrator) ») si tu veux te connecter sur ton téléphone.

**Remplacer ou révoquer une carte**

- **New card :** (nouvelle carte) crée une nouvelle carte pour cette personne. La carte précédente de cette personne sur cet écran cesse alors de fonctionner.
- **Revoke card :** (révoquer la carte) la carte cesse immédiatement de fonctionner. Tu vois « Revoked: this card no longer works. » (révoquée : cette carte ne fonctionne plus). Utilise cette option quand une carte est perdue ou a été remise à la mauvaise personne.
- Tu ne peux révoquer qu'une carte qui est encore sur cet écran. Si tu as déjà fermé MK8DX beheer, une carte non utilisée expire d'elle-même au bout de 15 minutes. Si elle a peut-être déjà été utilisée, choisis **Sign out everywhere** (déconnecter partout) plus bas.

**Déconnecter quelqu'un partout**

1. **À faire :** ouvre MK8DX beheer. Sur le premier écran, chaque personne a un bouton **Sign out everywhere** (déconnecter partout). Clique dessus. → **Tu vois :** le bouton devient **Sure? Click again** (sûr ? clique encore).
2. **À faire :** clique encore une fois. → **Tu vois :** « Signed out on every device. A new card lets this person sign in again. » (déconnecté sur tous les appareils ; une nouvelle carte permet à cette personne de se reconnecter). Cette personne est maintenant déconnectée sur le site et dans l'appli, le changement d'une touche vers ce compte disparaît et les cartes ouvertes de cette personne cessent de fonctionner. → **Tu vois autre chose ?** À côté de ton propre nom, il est indiqué « Sign yourself out from the account menu on the website ('Sign out on all devices'). » (déconnecte-toi depuis le menu du compte sur le site, « Se déconnecter sur tous les appareils »).

**Fermer MK8DX beheer**

1. **À faire :** clique sur **Next** (Suivant) jusqu'à « Done! Enjoy the races. » (Terminé ! Bonnes courses.), laisse les coches activées, clique sur **Finish** (Terminer) puis sur **Close** (Fermer). → **Tu vois :** « You can close this window now. » (tu peux fermer cette fenêtre maintenant). MK8DX continue de tourner.

![administration : personnes](../../guide/img/admin-people-en.png)

![administration : cartes](../../guide/img/admin-cards-en.png)

## 6. Préparer un appareil et se connecter

Un **certificat** est une preuve d'identité numérique. Grâce à lui, un téléphone sait avec certitude qu'il parle à ton ordinateur MK8DX et à rien d'autre, et la connexion est chiffrée (https). Comme MK8DX fonctionne sans internet, l'installation crée son propre certificat. Chaque appareil doit apprendre une fois à lui faire confiance. L'**empreinte** est un code court qui appartient exactement à ce certificat ; grâce à elle, tu vérifies que tu installes le bon certificat.

**Pourquoi un certificat, même à la maison sans internet ?**

- **Savoir avec certitude que c'est ton MK8DX.** Sur un réseau domestique ou de club, n'importe qui sur le même Wi-Fi peut se faire passer pour ton ordinateur MK8DX, par exemple un invité avec un ordinateur portable. Sans certificat, ton téléphone ne peut pas faire la différence. Avec le certificat, le navigateur refuse tout autre ordinateur.
- **Personne n'écoute.** Les cartes de connexion, ta session et tout ce que tu saisis circulent chiffrés sur le Wi-Fi.
- **Pourquoi MK8DX crée son propre certificat.** Les sites sur internet utilisent des certificats d'émetteurs connus, déjà présents dans chaque appareil. Ceux-ci ne délivrent pas de certificat pour une adresse domestique comme `192.168.1.50` et ne fonctionnent pas sans internet. MK8DX crée donc son propre certificat pendant l'installation, et tu indiques une fois à chaque appareil qu'il peut lui faire confiance.
- **Ce que tu autorises en l'installant.** Le certificat est destiné uniquement aux adresses réseau privées de MK8DX, et sa clé secrète reste protégée sur l'ordinateur MK8DX. N'installe que le certificat de ton propre MK8DX (vérifie l'empreinte) et supprime-le d'un appareil quand tu n'utilises plus cette installation.

**Qu'est-ce qui ne fonctionne pas si tu n'installes pas le certificat ?**

- Le navigateur affiche à chaque visite un avertissement pleine page, comme « Votre connexion n'est pas privée ». Tu peux le contourner, mais ne le fais pas : tu ne pourrais alors plus voir si tu parles vraiment à ton MK8DX.
- Même après l'avoir contourné, les **notifications du navigateur** ne fonctionnent pas : le navigateur ne les autorise qu'avec un certificat de confiance. D'autres fonctions du navigateur peuvent aussi refuser.
- Ce qui fonctionne sans certificat installé : l'**application Android**. Elle apprend le certificat elle-même grâce à la carte **Prepare a device** (préparer un appareil ; chapitre 7). Un navigateur sur le même appareil a quand même besoin du certificat.

**L'ordinateur MK8DX lui-même**

L'ordinateur sur lequel tourne MK8DX doit lui aussi faire confiance une fois à MK8DX, sinon son navigateur affiche un avertissement pour le site.

1. **À faire :** ouvre MK8DX beheer, clique sur **Next** (Suivant) jusqu'à « Sign in on phones and PCs » (se connecter sur les téléphones et les PC) et regarde le bloc **This computer** (cet ordinateur) sous **Step 1** (étape 1). → **Tu vois :** « This computer already trusts MK8DX. » (cet ordinateur fait déjà confiance à MK8DX). Tu as alors terminé. → **Tu vois autre chose ?** S'il affiche le bouton **Prepare this computer** (préparer cet ordinateur), passe à l'étape 2.
2. **À faire :** clique sur **Prepare this computer** (préparer cet ordinateur). → **Tu vois :** une fenêtre Windows, **Security Warning** (Avertissement de sécurité), qui demande si tu veux installer le certificat, avec une **thumbprint (sha1)** (empreinte numérique sha1). Compare-la avec l'empreinte dans MK8DX beheer ; si elles correspondent, clique sur **Yes** (Oui). → **Tu vois :** « This computer already trusts MK8DX. » → **Tu vois autre chose ?** Si tu as cliqué sur **No** (Non) ou si les empreintes diffèrent : ne clique pas sur Yes, ferme la fenêtre et demande de l'aide. Sous Linux ou macOS, au lieu du bouton, il est indiqué d'ouvrir l'adresse sous Prepare a device dans le navigateur de cet ordinateur ; suis alors les étapes ci-dessous sur cet ordinateur.

**Une fois par appareil : Prepare a device (préparer un appareil)**

1. **À faire :** connecte le téléphone, la tablette ou le PC au même réseau Wi-Fi ou filaire que l'ordinateur MK8DX. Sur un téléphone, n'utilise pas les données mobiles à la place du Wi-Fi. → **Tu vois :** le nom de ton propre Wi-Fi dans la connexion.
2. **À faire :** avec l'appareil photo, scanne le code QR de la carte **Prepare a device** (dans MK8DX beheer ou sur papier) et touche le lien qui apparaît. Sans appareil photo, tape l'adresse **New device** (nouvel appareil) dans le navigateur, par exemple `http://192.168.1.50/setup`. → **Tu vois :** la page **Prepare this device** (préparer cet appareil) avec « Do this once per phone, tablet or PC. Afterwards, scan your personal sign-in card. » (fais-le une fois par téléphone, tablette ou PC ; scanne ensuite ta carte de connexion personnelle). → **Tu vois autre chose ?** Si la page ne s'ouvre pas : vérifie le réseau et que l'ordinateur MK8DX est allumé (chapitre 11).
3. **À faire :** compare le code sous « First check this code. » (vérifie d'abord ce code) avec la **Fingerprint** (empreinte) de la carte Prepare a device (quatre groupes de quatre caractères). → **Tu vois :** exactement le même code. → **Tu vois autre chose ?** Si le code diffère, n'installe rien. Tu es peut-être sur un autre réseau ou à une autre adresse ; vérifie cela d'abord.
4. **À faire :** suis la partie correspondant à ton appareil. La partie pour l'appareil que tu utilises est déjà ouverte ; pour un autre appareil, ouvre-la sous « Another kind of device? » (un autre type d'appareil ?). Touche **Download certificate** (télécharger le certificat ; iPhone et iPad : **Download profile**, télécharger le profil) et suis les étapes ci-dessous. → **Tu vois :** en bas « Done? Scan your personal sign-in card, or open » (terminé ? scanne ta carte de connexion personnelle, ou ouvre) suivi de l'adresse du site.

Les étapes de la page Prepare this device :

<!-- filter: device -->

- **Android :** touche le bouton pour télécharger le certificat. Ouvre Paramètres et cherche « certificat » (souvent : Sécurité → Plus de paramètres de sécurité → Chiffrement et identifiants → Installer un certificat → Certificat CA). Choisis le fichier MK8DX téléchargé et confirme avec ton code PIN. Les noms des menus varient selon la marque du téléphone.
- **iPhone et iPad (pas encore testés avec cette installation) :** touche le bouton pour télécharger le profil et autorise-le. Ouvre Réglages → Profil téléchargé → Installer. Puis Réglages → Général → Informations → Réglages des certificats → active MK8DX.
- **Windows :** télécharge le certificat et ouvre-le. Choisis Install Certificate (Installer le certificat) → Current User (Utilisateur actuel) → Place all certificates in the following store (Placer tous les certificats dans le magasin suivant) → Trusted Root Certification Authorities (Autorités de certification racines de confiance). Ne choisis pas Intermediate Certification Authorities (Autorités intermédiaires). Redémarre le navigateur.
- **Mac (macOS n'est pas encore testé de bout en bout) :** télécharge le certificat et ouvre-le ; Trousseau d'accès s'ouvre. Ouvre le certificat MK8DX → Se fier → Toujours approuver.
- **Linux (pas encore testé de bout en bout pour cette voie) :** ajoute le même certificat au magasin de racines de confiance de ta distribution ou de ton navigateur. Les étapes exactes varient selon la distribution.

<!-- /filter -->

**Se connecter avec ta carte personnelle**

1. **À faire :** scanne ta propre carte (la carte avec ton nom) et touche le lien. → **Tu vois :** **Join this MK8DX installation** (rejoindre cette installation MK8DX) et « First check that this HTTPS address belongs to the host you trust. The invitation can be used once. » (vérifie d'abord que cette adresse HTTPS appartient à l'hôte auquel tu fais confiance ; l'invitation ne peut être utilisée qu'une fois). La barre d'adresse du navigateur doit afficher l'adresse du site, par exemple `https://192.168.1.50`. → **Tu vois autre chose ?** Un avertissement du navigateur concernant le certificat ou une connexion non sécurisée : ne le contourne jamais. Fais d'abord Prepare a device ci-dessus.
2. **À faire :** vérifie le nom de la carte sous **You sign in as:** (tu te connectes en tant que). Si c'est ton nom, attends « Invitation ready. Confirm to sign in. » (invitation prête ; confirme pour te connecter) et touche **Accept invitation** (accepter l'invitation). S'il affiche un autre nom, ne touche pas Accepter : la carte reste valable pour la bonne personne. → **Tu vois :** « You are signed in as » (tu es connecté en tant que) avec ton nom, et **Continue to MK8DX** (continuer vers MK8DX). Touche-le. → **Tu vois autre chose ?** « This invitation is invalid. Ask the administrator for a new QR code. » (cette invitation n'est pas valable ; demande un nouveau code QR à l'administrateur) ou « Sign-in failed. Ask the administrator for a new invitation. » (la connexion a échoué ; demande une nouvelle invitation à l'administrateur) : la carte a déjà été utilisée, a expiré ou a été révoquée. Demande à l'administrateur de créer une **New card** (nouvelle carte).
3. **À faire :** suis les étapes de bienvenue sur le site : si tu as déjà des temps ou des tournois ici, et comment tu veux t'appeler. C'est ainsi que tu choisis ou revendiques ton propre Joueur. → **Tu vois :** ton nom et tes temps. → **Tu vois autre chose ?** Si le nom de ta carte (par exemple « Papa ») n'est pas déjà rempli : c'est normal. Le nom sur la carte n'est que l'étiquette dans MK8DX administration ; c'est ici que tu choisis toi-même ton nom de joueur.

**Un autre appareil pour la même personne**

- Un joueur peut créer une carte lui-même : le menu du compte sur le site propose **Se connecter aussi sur un autre appareil**. Cela ouvre **Se connecter sur un autre appareil** avec une carte qui « fonctionne une fois, valable jusqu'à » une heure. Scanne-la avec l'autre appareil. Ne la montre qu'à ton propre appareil : quiconque la scanne est connecté à ton compte.
- Les administrateurs n'ont pas ce bouton. Ils créent eux-mêmes une **New card** (nouvelle carte) pour eux dans MK8DX beheer.
- Un nouvel appareil fait toujours d'abord une fois Prepare a device.
- **Pas d'appareil photo, ou connexion sur l'ordinateur MK8DX lui-même ?** Crée la carte de cette personne dans MK8DX beheer et clique sur **Sign in on this computer** (se connecter sur cet ordinateur ; ouvre la page de connexion dans le navigateur de l'ordinateur MK8DX) ou **Copy link** (copier le lien). N'envoie un lien copié qu'à la personne elle-même, par exemple dans un message privé : quiconque l'ouvre peut se connecter en tant que cette personne. Il fonctionne une fois et pendant 15 minutes. Sur la carte Prepare a device, **Copy address** (copier l'adresse) copie l'adresse ; elle n'est pas secrète.

**Quitter cette installation sur un appareil :** supprime à nouveau le certificat dans les mêmes paramètres que ceux utilisés pour l'installer.

![téléphone : préparer l'appareil](../../guide/img/phone-prepare-device-en.png)

![téléphone : accepter l'invitation](../../guide/img/phone-accept-invitation-en.png)

## 7. L'application Android et LiveTrial

**Associer l'application Android**

Il faut la version 2.95.0 de l'application ou plus récente. L'application n'a pas besoin du certificat dans les paramètres d'Android, mais la connexion passe par le navigateur du téléphone. Fais donc d'abord le chapitre 6 sur ce téléphone : Prepare a device (préparer un appareil) et connexion avec ta carte dans le navigateur.

1. **À faire :** ouvre l'application. Lors d'une nouvelle installation, elle démarre sur **Choisis ta communauté** ; sinon, touche le nom de la communauté en haut de l'application, puis **Ajouter une communauté**. → **Tu vois :** **Choisis ta communauté** avec les panneaux **À la maison ou au club** et **Communauté en ligne**. Sous **À la maison ou au club**, touche **Scanner le code QR**.
2. **À faire :** si nécessaire, touche **Utiliser l'appareil photo** et autorise l'appareil photo. Scanne le code QR de la carte **Prepare a device**. → **Tu vois :** **Vérifie qu'il s'agit bien de ton installation** avec une **Adresse** et une **Empreinte de la clé (SHA-256)**. → **Tu vois autre chose ?** « This is not the QR code of a Prepare a device card. » (ce n'est pas le code QR d'une carte Prepare a device) : tu as scanné une carte personnelle. Scanne la carte Prepare a device. Si le scan échoue, tape l'adresse New device (par exemple `http://192.168.1.50/setup`) à **Ou colle le lien de configuration** et touche **Suivant**.
3. **À faire :** compare l'adresse avec l'adresse du site, et la longue clé avec la page Prepare this device : ouvre là-bas **Full fingerprints** (empreintes complètes) et regarde « Root public key SHA-256 (SPKI) » (clé publique racine SHA-256). Tu peux ouvrir cette page sur un autre appareil, ou sur l'ordinateur MK8DX lui-même via l'adresse New device. → **Tu vois :** les deux exactement identiques. Touche **Se connecter** (si l'application était déjà réglée sur un autre serveur, confirme le changement). → **Tu vois autre chose ?** S'ils diffèrent, touche **Retour** et ne te connecte pas. « Could not get a matching certificate from » (impossible d'obtenir un certificat correspondant de) : vérifie le réseau et que l'ordinateur MK8DX est allumé, puis réessaie.
4. **À faire :** dans **Paramètres**, à **Joueur sur ce téléphone**, touche **Se connecter**. L'application te rappelle qu'à la maison ou au club tu te connectes avec ta carte de connexion personnelle, et non par e-mail. Touche **Connecte-toi pour synchroniser**. → **Tu vois :** le navigateur ouvre la page d'approbation. Vérifie que le site affiche le même code que l'application et approuve l'appareil. Reviens dans l'application. → **Tu vois autre chose ?** Si le navigateur te demande de te connecter, connecte-toi d'abord avec ta carte (chapitre 6).
5. **À faire :** publie un temps dans l'application. → **Tu vois :** le temps sur le site de l'installation.

Dissocier : touche le nom de la communauté en haut → **Ajouter une communauté** → **Oublier cette installation**.

Club et maison dans une seule application : l'application peut contenir plusieurs communautés. Touche le nom de la communauté en haut, puis **Changer de communauté** ; chaque communauté garde son propre compte et ses temps non envoyés. Tes propres temps se trouvent sous ton nom → **Mes temps**, même quand le téléphone ne peut pas joindre l'ordinateur MK8DX.

**LiveTrial sur un second PC Windows**

LiveTrial est un programme Windows qui reconnaît et conserve tes contre-la-montre grâce à une carte d'acquisition (un boîtier qui envoie l'image de ta Switch au PC). L'installation de LiveTrial elle-même est décrite au chapitre 6 de `docs/install/MK8DX_User_Guide_EN.txt`. Testé sur une installation de test avec LiveTrial 3.37.0. Les étapes en bref :

1. Fais d'abord confiance à l'installation sur ce PC : chapitre 6, partie Windows. Vérifie que le site s'ouvre dans le navigateur sans avertissement.
2. Assure-toi que ton compte a un **Joueur** sur le site.
3. Ouvre LiveTrial, clique sur la roue dentée (**Paramètres**) et saisis l'adresse du site à **Adresse du site de la communauté**, par exemple `https://192.168.1.50`.
4. Clique sur **Se connecter** et choisis **Ouvrir la page d'approbation**. Approuve l'appareil dans le navigateur.
5. Envoie les runs avec **Envoyer maintenant**, ou active **Envoyer automatiquement les nouveaux runs** dans Paramètres.

Bon à savoir : sans Joueur, la connexion de LiveTrial se termine par un message te demandant de configurer d'abord ton Joueur sur le site. Après un changement d'adresse, LiveTrial redémarre ; s'il ne le fait pas, quitte-le et rouvre-le. Les comptes et les runs en attente pour un autre serveur restent avec ce serveur. Quand tu n'utilises plus ce PC avec l'installation, supprime à nouveau le certificat MK8DX des **Trusted Root Certification Authorities** (Autorités de certification racines de confiance ; chapitre 6).

![android : changer de serveur](../../guide/img/android-change-server-en.png)

![android : comparer](../../guide/img/android-compare-en.png)

## 8. L'utilisation au quotidien

**L'ordinateur MK8DX doit être allumé.** Tant que quelqu'un veut jouer, l'ordinateur MK8DX doit être allumé, éveillé et connecté au réseau. De préférence, désactive la mise en veille pendant une soirée de jeu. Docker doit tourner ; sous Windows et macOS, Docker Desktop démarre tout seul quand tu te connectes (chapitre 10).

**Un seul téléphone ou une seule tablette pour toute la famille**

- Chacun se connecte une fois avec sa propre carte sur cet appareil.
- **Site web :** ensuite, tu changes d'une seule touche depuis le menu du compte : choisis **Changer de compte**, puis la personne.
- **Code PIN :** chacun peut définir un code PIN à 4 chiffres sur le site sous **Paramètres** → **Code PIN pour changer de compte**. Passer à ce compte demande alors d'abord ce code PIN.
- **Application Android :** touche ton nom en haut → **Changer de joueur** (ou **Paramètres** → **Joueur sur ce téléphone**), et choisis la personne avec **Changer de joueur**. Si cette personne a un code PIN, l'application demande **Code PIN requis** et **Code PIN (4 chiffres)**. Un mauvais code PIN donne « Ce code PIN n'est pas correct. ».
- Les **administrateurs** ne figurent dans cette liste que s'ils ont défini un code PIN (Paramètres → Code PIN pour changer de compte). Sans code PIN, ils se reconnectent avec une carte. C'est plus strict pour un administrateur : après le 5e mauvais code PIN, le compte administrateur disparaît de cet appareil, ainsi qu'après 14 jours sans utilisation ; une carte est alors de nouveau nécessaire. Dans l'application Android, les administrateurs ne figurent pas (encore) dans la liste.

**Se déconnecter**

- Sur le site, depuis le menu du compte en haut à droite : **Se déconnecter** (cet appareil uniquement) ou **Se déconnecter sur tous les appareils**.
- Déconnecter quelqu'un d'autre partout, c'est l'administrateur qui le fait dans MK8DX beheer avec **Sign out everywhere** (déconnecter partout ; chapitre 5).

**Carte perdue ou téléphone perdu**

- Carte perdue pas encore utilisée : **Revoke card** (révoquer la carte) si elle est encore à l'écran dans MK8DX beheer ; sinon, elle expire d'elle-même au bout de 15 minutes.
- Téléphone perdu, ou une carte a peut-être déjà été utilisée : dans MK8DX beheer, choisis **Sign out everywhere** à côté de cette personne et clique encore une fois. Donne ensuite à la personne une **New card** (nouvelle carte).

**Clair ou sombre :** sur un nouvel appareil, le site suit le réglage **Système** de cet appareil. Après la connexion, choisis **Compte** → **Paramètres** → **Apparence** → **Sombre** pour l'apparence sombre ; ce choix est enregistré avec ton compte.

![site : changer de compte](../../guide/img/website-switch-account-en.png)

**Un nom pour ta communauté :** un administrateur peut donner un nom à l'installation, comme « Club Noord », sur le site sous **Administration** → **Paramètres de l'installation** → **Nom de la communauté**, puis cliquer sur **Enregistrer le nom**. Les applications affichent alors ce nom au lieu de l'adresse web. Laisse le champ vide et enregistre pour supprimer le nom.

**Temps d'autres communautés :** quelqu'un qui joue aussi dans une autre communauté (un autre club, ou un site sur internet) peut emporter ses temps ici depuis l'application Android. Un administrateur choisit sur le site sous **Administration** → **Paramètres de l'installation** → **Temps d'autres communautés** : **Désactivé** (la valeur par défaut : ces temps sont refusés), **Avec approbation** (chaque temps apporté reste invisible jusqu'à ce qu'un administrateur clique sur **Publier** à côté sous **Administration** → **Contre-la-montre**) ou **Autorisé**. Un temps apporté indique toujours sa provenance.

## 9. Une soirée tournoi

Ce chapitre n'est qu'un aperçu. Les vraies étapes se trouvent dans les manuels cités ci-dessous. Tu mènes une soirée tournoi sur le site de ton installation ; le **Directeur** est la personne qui dirige la soirée.

- **La soirée sur le site :** les étapes 0 à 10 (participants et présences, consoles, groupes et places, scores, finales et clôture) se trouvent dans `docs/guides/TOURNAMENT_DIRECTORS.md` (dans le dépôt sur GitHub ; pas dans le paquet) et au chapitre 6 « Use Android, LiveTrial, the scanner, and Tournament » de `docs/install/MK8DX_User_Guide_EN.txt` (dans le paquet).
- **Tournament Live :** un programme Windows qui lit les courses depuis une carte d'acquisition. Voir `docs/product/README_TOURNAMENT_LIVE_LAPTOP.md` dans le dépôt.
- **Tournament Processor :** lit une vidéo enregistrée (.mp4 ou .mkv) et la transforme en fichiers Excel, CSV et de résultats. Voir `docs/product/README_TOURNAMENT_PROCESSOR_FALLBACK_LAPTOP.md` et `docs/product/USING_MK8DX_TOURNAMENT_TOOLS.md` dans le dépôt.
- **Excel ou CSV en solution de repli :** sur le site, tu peux aussi saisir les scores à la main ou les importer depuis un fichier Excel/CSV. Tu n'as besoin d'aucun programme supplémentaire pour cela.
- **La reconnaissance ne rend jamais un résultat officiel toute seule.** Le Directeur vérifie et confirme chaque course.
- **Pas encore testé :** la connexion des Tournament Tools à une installation à la maison ou au club n'est pas encore décrite ni testée. Tu peux importer les fichiers de résultats du Processor ou de Tournament Live via le site.

## 10. Sauvegardes, nouvel ordinateur, nouvelle adresse, redémarrages et mises à jour

**Conserver les sauvegardes**

1. **À faire :** de temps en temps, branche une clé USB sur l'ordinateur MK8DX et copie-y tout le dossier `MK8DX-backups` (chapitre 4). → **Tu vois :** sur la clé, un dossier `MK8DX-backups` avec des dossiers qui commencent par une date, par exemple `20261111-030000`.
2. **À faire :** range la clé et le papier avec le code de récupération à des endroits différents.

**Restaurer sur un nouvel ordinateur**

Cela ne fonctionne que sur un ordinateur où MK8DX n'est pas encore installé.

1. **À faire :** prépare le nouvel ordinateur comme au chapitre 2. → **Tu vois :** Docker tourne et Python fonctionne.
2. **À faire :** copie le dossier `MK8DX-backups` de ta clé USB dans le dossier Documents (Windows) ou `~/Documents` (Linux et macOS). Ou laisse la clé USB branchée. → **Tu vois :** le dossier `MK8DX-backups` sur le nouvel ordinateur ou sur la clé.
3. **À faire :** décompresse le paquet MK8DX et lance-le comme au chapitre 3. Sur l'écran de bienvenue, clique sur **Restore a backup** (restaurer une sauvegarde). → **Tu vois :** « Quick check » (vérification rapide) puis **Restore a backup** avec « Choose the backup and enter the recovery code you wrote down during the first installation. » (choisis la sauvegarde et saisis le code de récupération que tu as noté lors de la première installation).
4. **À faire :** choisis la sauvegarde (la plus récente est en haut, avec la date et l'heure). → **Tu vois autre chose ?** « There is no MK8DX backup in this folder. » (il n'y a aucune sauvegarde MK8DX dans ce dossier ; ce message cite le dossier Windows, même sous Linux et macOS) : tape le dossier contenant les sauvegardes à **Another folder (for example a USB stick):** (un autre dossier, par exemple une clé USB) et clique sur **Search** (rechercher). Ce champ apparaît aussi quand tu cliques sur **Advanced** (Avancé).
5. **À faire :** tape ton code depuis le papier à **Recovery code** (code de récupération). Les espaces, les minuscules ou l'absence des tirets n'ont pas d'importance. Clique sur **Next** (Suivant). → **Tu vois :** « Your network » (ton réseau). Le bouton Next ne fonctionne qu'une fois le code entièrement saisi.
6. **À faire :** vérifie l'adresse comme au chapitre 3 et clique sur **Restore** (restaurer). → **Tu vois :** « Opening and restoring the backup » (ouverture et restauration de la sauvegarde) puis « MK8DX is running again, with everything from the backup. » (MK8DX tourne de nouveau, avec tout le contenu de la sauvegarde). Sous Windows, Windows demande encore une fois l'autorisation : clique sur **Yes** (Oui). → **Tu vois autre chose ?** « This recovery code does not open the backup. Check the code and try again. » (ce code de récupération n'ouvre pas la sauvegarde ; vérifie le code et réessaie) : clique deux fois sur **Back** (Retour) jusqu'à revenir au code de récupération, corrige le code (ou choisis une autre sauvegarde) et réessaie.
7. **À faire :** clique sur **Next** à travers MK8DX beheer jusqu'à « Done! Enjoy the races. » (Terminé ! Bonnes courses.) et clique sur **Finish** (Terminer). → **Tu vois :** « New backups use the same recovery code as before. » (les nouvelles sauvegardes utilisent le même code de récupération qu'avant). Ton code sur papier reste valable.
8. **Après la restauration :** tout le monde, tous les temps, tournois et paramètres sont de retour. Les téléphones et les PC continuent de faire confiance à MK8DX. Si le nouvel ordinateur a une autre adresse, chacun scanne une fois la carte **Prepare a device** (préparer un appareil) et se reconnecte ; associe à nouveau les applications (chapitre 7).

**Une autre adresse réseau**

Ton routeur donne son adresse à l'ordinateur MK8DX. En général, elle reste la même, mais ce n'est pas garanti : après un nouveau routeur, une coupure de courant ou quand l'ordinateur est resté longtemps éteint, ou sur un autre réseau (par exemple au club), l'adresse peut changer. MK8DX doit alors déménager et chacun scanne de nouveau la carte. Une adresse fixe évite cela.

**Donner une adresse fixe à l'ordinateur (recommandé, une seule fois)**

Une adresse fixe se règle de préférence dans le routeur, avec une **réservation DHCP** : le routeur garde alors une adresse pour cet ordinateur et ne la donne jamais à un autre appareil.

1. **À faire :** trouve l'adresse et l'adresse physique de l'ordinateur. Windows : ouvre **Command Prompt** (Invite de commandes), tape `ipconfig /all` et appuie sur Entrée. Linux : tape `ip -br addr` et `ip -br link`. → **Tu vois :** pour la connexion que tu utilises (**Wi-Fi** ou **Ethernet**), une **IPv4 Address** (Adresse IPv4, par exemple `192.168.1.50`) et une **Physical Address** (Adresse physique, aussi appelée adresse MAC, par exemple `3C-52-82-AB-CD-EF`). Le câble et le Wi-Fi ont chacun leur propre adresse physique : prends celle de la connexion que l'ordinateur utilise vraiment (de préférence un câble).
2. **À faire :** ouvre les paramètres de ton routeur dans le navigateur. L'adresse et le mot de passe se trouvent souvent sur une étiquette collée sur le routeur (par exemple `192.168.1.1` ou `192.168.0.1`).
3. **À faire :** trouve la réservation. Le nom varie selon la marque, par exemple « Réservation DHCP », « Réservation d'adresse », « IP statique », « Bail statique » ou « Toujours attribuer la même adresse IPv4 à cet appareil ». Elle se trouve généralement sous **LAN**, **Réseau**, **DHCP** ou **Réseau domestique**, à côté de la liste des appareils connectés.
4. **À faire :** choisis l'ordinateur MK8DX dans la liste (ou saisis son adresse physique), garde son adresse **actuelle** et enregistre. → **Tu vois :** l'ordinateur figure dans la liste des réservations.
5. **À faire :** redémarre l'ordinateur et vérifie avec `ipconfig` que l'adresse est restée la même. Si c'est l'adresse que MK8DX utilise déjà, il n'y a rien d'autre à faire. Si tu as choisi une autre adresse dans le routeur, déménage MK8DX comme ci-dessous.

**Éviter un conflit d'adresses**

Un conflit d'adresses se produit quand deux appareils utilisent la même adresse. L'un d'eux (parfois l'ordinateur MK8DX) est alors injoignable de temps en temps ou en permanence ; Windows indique parfois « There is an IP address conflict » (il existe un conflit d'adresses IP).

- Utilise une réservation dans le routeur, pas une adresse que tu tapes toi-même dans les paramètres réseau de Windows ou de Linux. Le routeur ne connaît pas une adresse tapée à la main : il peut plus tard la donner à un téléphone ou à une console.
- Si tu ne peux pas accéder au routeur (par exemple au club) et que cela doit se faire à la main : choisis une adresse en dehors de la plage que le routeur distribue (le « pool DHCP » ; si le routeur distribue `192.168.1.100` à `192.168.1.199`, choisis par exemple `192.168.1.50`) et vérifie d'abord que personne ne l'utilise : `ping 192.168.1.50` ne doit obtenir aucune réponse. Reprends le masque de sous-réseau, la passerelle et le DNS fournis par le routeur. De préférence, demande à la personne qui gère ce réseau.
- Ne laisse qu'un seul appareil distribuer les adresses dans un réseau. Deux routeurs l'un derrière l'autre (par exemple le modem de ton fournisseur et ton propre routeur Wi-Fi) forment deux réseaux : mets l'ordinateur MK8DX et tous les téléphones dans le même réseau, ou passe le second routeur en **mode point d'accès**.
- Après un conflit : donne une autre adresse à l'autre appareil (ou une réservation à l'ordinateur MK8DX) et ouvre MK8DX beheer. Si tu vois **This computer has a new network address** (cet ordinateur a une nouvelle adresse réseau), suis les étapes ci-dessous.

**Déménager vers une nouvelle adresse**

1. **À faire :** si l'ordinateur a quand même reçu une autre adresse, ouvre **MK8DX beheer** (chapitre 5). → **Tu vois :** **This computer has a new network address** (cet ordinateur a une nouvelle adresse réseau) avec « MK8DX was on » (MK8DX était sur) l'ancienne adresse et la nouvelle adresse en dessous.
2. **À faire :** clique sur **Move** (déménager). Avec **Advanced** (Avancé), tu peux choisir une autre adresse si nécessaire. → **Tu vois :** « Moving to the new address (Windows asks for permission) » (déménagement vers la nouvelle adresse ; Windows demande la permission) ; clique sur **Yes** (Oui) dans la fenêtre Windows. Puis « MK8DX runs on the new address. » (MK8DX tourne à la nouvelle adresse).
3. **À faire :** clique sur **Next** (Suivant) et continue comme dans MK8DX beheer. Fais scanner une fois la carte **Prepare a device** par les téléphones et les PC et reconnecte-les ; associe à nouveau les applications. Ils continuent de faire confiance à MK8DX ; la carte Prepare a device porte maintenant la nouvelle adresse.

**Après un redémarrage de l'ordinateur**

- **Windows :** la tâche « MK8DX start » démarre Docker Desktop dès que tu te connectes à Windows ; MK8DX se remet alors en ligne tout seul. Quelqu'un doit donc se connecter : si l'ordinateur reste sur l'écran de connexion après une mise à jour de Windows, MK8DX n'est de nouveau joignable qu'après la connexion.
- **Linux :** Docker Engine démarre au démarrage de l'ordinateur (grâce à `sudo systemctl enable --now docker` du chapitre 2B), et MK8DX suit tout seul.
- **macOS (non testé) :** une tâche de connexion ouvre Docker Desktop quand tu te connectes.

**Tâches de nuit**

- À 03:00, MK8DX fait la sauvegarde. À 03:30, MK8DX renouvelle son propre certificat si nécessaire ; tu ne le remarques pas.
- **Windows :** si l'ordinateur était éteint ou en veille, les tâches manquées s'exécutent dès que possible ensuite. La sauvegarde attend alors que Docker tourne.
- **Linux :** les tâches s'exécutent sous ton utilisateur. Une tâche manquée s'exécute quand même dès que tu es de nouveau connecté.
- **macOS (non testé) :** une tâche manquée s'exécute dès que le Mac sort de veille.

**Mises à jour**

1. **À faire :** télécharge le nouveau paquet MK8DX et décompresse-le dans un **nouveau** dossier, exactement comme au chapitre 3 (y compris le déblocage). Garde l'ancien dossier pour le moment. → **Tu vois :** un second dossier avec `Start-MK8DX-LAN.cmd`.
2. **À faire :** double-clique sur `Start-MK8DX-LAN.cmd` dans le **nouveau** dossier. → **Tu vois :** d'abord le chargement des programmes avec une horloge qui tourne, puis dans le navigateur **A newer version of MK8DX** (une version plus récente de MK8DX) avec l'ancienne et la nouvelle version. → **Tu vois autre chose ?** Si MK8DX beheer s'ouvre simplement, cette version tourne déjà. S'il est indiqué que le paquet est plus ancien que l'installation, utilise le paquet le plus récent.
3. **À faire :** clique sur **Update** (mettre à jour). → **Tu vois :** « Making and checking a backup » (création et vérification d'une sauvegarde) puis « Installing and starting the new version » (installation et démarrage de la nouvelle version), chacun avec une horloge qui tourne ; au bout de quelques minutes, **MK8DX is updated** (MK8DX est mis à jour) avec l'ancienne et la nouvelle version. Toutes les personnes, tous les temps, tournois et connexions sont conservés ; les téléphones n'ont rien à refaire. La sauvegarde automatique, le renouvellement du certificat et le raccourci **MK8DX beheer** sont déjà passés au nouveau dossier. La sauvegarde faite juste avant se trouve dans Documents\MK8DX-backups avec `before-update` dans son nom. Si tu viens d'une version antérieure à 0.2.3, la mise à jour fait aussi passer la base de données de MySQL 8.4 à 9.7 LTS ; cette première mise à jour prend un peu plus de temps, et la sauvegarde faite juste avant est ton moyen de revenir en arrière. La fenêtre de démarrage noire indique `OK  MK8DX update completed`. → **Tu vois autre chose ?** Si la fenêtre de démarrage indique `MK8DX update FAILED` avec une raison, ou si le navigateur affiche une erreur : lis la raison, corrige-la (par exemple en lançant Docker Desktop) et relance depuis le nouveau dossier.
4. **À faire :** clique sur **Close** (Fermer). Si tu veux régler autre chose ensuite, clique d'abord sur **Go to MK8DX beheer** (aller à MK8DX beheer). → **Tu vois :** la fenêtre du navigateur se ferme ; appuie sur une touche dans la fenêtre de démarrage pour la fermer.
5. **À faire :** supprime ensuite l'ancien dossier. → **Tu vois :** MK8DX continue de fonctionner.

Les autres voies d'installation (un seul ordinateur, ton propre serveur, un hébergement web) se trouvent dans `docs/install/MK8DX_User_Guide_EN.txt`.

![assistant : restauration](../../guide/img/wizard-restore-en.png)

![assistant : déménagement](../../guide/img/wizard-move-en.png)

## 11. Résolution des problèmes

- **Un téléphone n'arrive pas à ouvrir le site.** Le téléphone est-il sur le même réseau Wi-Fi (pas sur les données mobiles ni sur un réseau invité) ? L'ordinateur MK8DX est-il allumé, éveillé et connecté à une session, et Docker tourne-t-il ? L'adresse correspond-elle à **Website** (site web) du chapitre 3 ? Linux : as-tu exécuté la commande de pare-feu du chapitre 3 ? L'ordinateur a-t-il une nouvelle adresse : voir plus bas.
- **Le navigateur affiche un avertissement sur le certificat.** Ne contourne pas l'avertissement. Fais Prepare a device (préparer un appareil) sur cet appareil (chapitre 6) et vérifie l'empreinte.
- **Une carte ne fonctionne plus.** Une carte fonctionne une seule fois et pendant 15 minutes, et cesse de fonctionner après **Revoke card** (révoquer la carte), **New card** (nouvelle carte) ou **Sign out everywhere** (déconnecter partout). Crée une nouvelle carte dans MK8DX beheer.
- **« This recovery code does not open the backup. »** (ce code de récupération n'ouvre pas la sauvegarde.) Vérifie le code lettre par lettre ; majuscules, minuscules, espaces et tirets n'ont pas d'importance. Le code ne contient jamais les lettres I et O ni les chiffres 0 et 1. Choisis aussi la bonne sauvegarde : une sauvegarde d'une autre installation ne s'ouvre pas avec ton code.
- **« MK8DX is already installed on this computer; restore needs a computer without it ».** (MK8DX est déjà installé sur cet ordinateur ; la restauration nécessite un ordinateur sans MK8DX.) La restauration ne fonctionne que sur un ordinateur sans MK8DX. Demande de l'aide à une personne qui s'y connaît en informatique (chapitre 12).
- **Docker ne tourne pas.** Windows et macOS : lance Docker Desktop, attends **Engine running** (moteur en marche) et clique sur **Try again** (Réessayer), ou relance MK8DX. Linux : `sudo systemctl start docker`.
- **L'ordinateur a une nouvelle adresse.** Ouvre MK8DX beheer et choisis **Move** (déménager ; chapitre 10).
- **Windows : « The network is 'DomainAuthenticated'; ask its administrator to allow TCP 80/443 ».** (le réseau est un réseau de domaine ; demande à son administrateur d'autoriser TCP 80/443.) L'ordinateur est sur un réseau d'entreprise que MK8DX n'a pas le droit de modifier lui-même. Demande à l'administrateur de ce réseau d'autoriser les connexions entrantes sur les ports TCP 80 et 443.
- **Windows : « Windows did not allow the change (the permission prompt was declined or failed) ».** (Windows n'a pas autorisé la modification ; la demande d'autorisation a été refusée ou a échoué.) Clique sur **Try again** (Réessayer) puis sur **Yes** (Oui) dans la fenêtre Windows.
- **Linux : les téléphones n'arrivent pas à se connecter et le pare-feu est actif.** Pendant Install, clique sur **Details** (Détails) et exécute la commande après « manual: », par exemple `sudo ufw allow from 192.168.1.0/24 to 192.168.1.50 port 80,443 proto tcp`. Avec firewalld, c'est `sudo firewall-cmd --permanent --add-service=http --add-service=https && sudo firewall-cmd --reload`.
- **L'application Android indique « This is not the QR code of a Prepare a device card. »** (ce n'est pas le code QR d'une carte Prepare a device.) Scanne la carte **Prepare a device**, pas une carte personnelle.

## 12. Pour les informaticiens (facultatif)

Ce chapitre n'est pas nécessaire pour une utilisation normale.

**Où se trouvent les données privées**

- **Windows :** `%LOCALAPPDATA%\MK8DX\LAN` (Start-MK8DX-LAN.cmd transmet ce dossier).
- **Linux :** `~/.local/share/mk8dx/LAN` (ou `$XDG_DATA_HOME/mk8dx/LAN` quand cette variable est définie).
- **macOS :** `~/Library/Application Support/MK8DX/LAN`.
- À côté de ce dossier se trouve un environnement Python privé `python-offline-<code>` avec les paquets Python inclus : sous Windows avec `Scripts\python.exe`, sous Linux et macOS avec `bin/python`. Utilise ce Python pour les commandes ci-dessous.
- Ne partage jamais ce dossier ni les sauvegardes. Les secrets sont protégés par DPAPI sous Windows, dans le Trousseau sous macOS et avec `systemd-creds --user` sous Linux lorsque c'est disponible, sinon uniquement par les permissions des fichiers.

**Commandes** (à exécuter dans le dossier du paquet, avec le Python ci-dessus et `--state-dir` pointant vers le dossier des données privées) :

- `tooling/install.py status --state-dir <folder>` : vérifie que le profil, les certificats et les paramètres concordent.
- `tooling/install.py check --state-dir <folder>` : status, plus les paramètres de Docker Compose et les conteneurs.
- `tooling/auto_backup.py run --state-dir <folder>` : fait tout de suite une sauvegarde chiffrée avec le code de récupération stocké, comme la tâche de nuit (avec `--backup-root <folder>` dans un autre dossier). Remarque : `install.py backup` sert aux autres voies et ne fait pas de sauvegarde A2.
- `tooling/install.py maintain-ca --qa-offline-candidate --state-dir <folder>` : renouvelle le certificat à l'échéance et sinon ne fait rien ; `--force-ca-rotation` le renouvelle immédiatement.
- `tooling/install.py change-lan-address --lan-bind-address 192.168.1.51 --qa-offline-candidate --state-dir <folder>` : déménage vers une nouvelle adresse, comme **Move**.
- `tooling/install.py stop --state-dir <folder>` et `tooling/install.py start --qa-offline-candidate --state-dir <folder>` : arrêter et démarrer.
- `tooling/install.py upgrade --backup-output <new folder> --qa-offline-candidate --state-dir <folder>` : fait et vérifie d'abord une sauvegarde, applique ensuite les mises à jour de la base de données et redémarre les conteneurs avec les images avec lesquelles cette installation a été configurée. Le passage aux images d'un paquet plus récent n'en fait pas encore partie, et cette voie n'est pas testée pour A2.
- `tooling/setup_wizard.py --state-dir <folder>` : la page d'installation elle-même ; `--no-browser` n'ouvre pas de navigateur.
- `--qa-offline-candidate` est l'option interne avec laquelle un paquet A2 active ses propres fonctions hors ligne ; la page d'installation et le fichier de démarrage la transmettent eux-mêmes.

**Tâches planifiées et réseau**

- **Windows (Planificateur de tâches) :** « MK8DX backup » (03:00), « MK8DX certificate renewal » (03:30) et « MK8DX start » (à la connexion), toutes les trois pour l'utilisateur connecté, sans droits d'administrateur.
- **Linux :** les minuteurs utilisateur systemd `mk8dx-mk8dx-backup.timer` et `mk8dx-mk8dx-certificate-renewal.timer` (avec Persistent=true).
- **macOS :** des LaunchAgents dans `~/Library/LaunchAgents` dont les noms commencent par `nl.mariokart8.mk8dx-`.
- Le site écoute sur TCP 80 et 443 de l'adresse choisie. La page d'administration n'écoute que sur `127.0.0.1` de l'ordinateur MK8DX lui-même.
- **Windows :** la règle de pare-feu `MK8DX-A2-offline-<address>` autorise TCP 80 et 443 sur cette adresse, pour le profil Privé uniquement. Un réseau public est marqué comme privé ; un réseau de domaine n'est jamais modifié.
- **Linux :** MK8DX ne demande jamais sudo lui-même. Avec ufw ou firewalld actif, l'installation affiche la commande ; sans pare-feu actif, il n'y a rien à faire. **macOS :** Docker Desktop ouvre les ports lui-même.
- Si une restauration échoue à mi-chemin, l'installation à moitié faite est mise de côté dans un dossier à côté des données privées, avec `.failed-` et une heure dans son nom, pour que tu puisses réessayer.
