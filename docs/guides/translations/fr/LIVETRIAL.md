# LiveTrial : enregistrer des contre-la-montre sous Windows

*Ceci est une traduction automatique du [guide anglais](../../LIVETRIAL.md) ; la version anglaise fait foi. Les corrections sont les bienvenues via le formulaire de ticket « Translation correction ».*

[Tous les guides](../../../../README.md#get-started) · [README du composant LiveTrial](../../../../apps/timetrials-desktop/README.md)

LiveTrial est un programme Windows qui suit tes contre-la-montre via une carte d'acquisition, ou lit des vidéos
enregistrées, reconnaît chaque run (temps total et temps au tour, personnage et combinaison du kart, fantôme) et
l'enregistre sur ton PC avec un clip. Une fois que tu t'es connecté, il peut envoyer les résultats au site de ta
communauté. Les résultats qui ne peuvent pas encore être envoyés attendent sur le PC.

## Sans site de communauté

LiveTrial fonctionne aussi tout seul. La capture, l'analyse de vidéos, l'**Historique des runs**, les clips et les
corrections fonctionnent tous en local. Les runs enregistrés sans compte restent uniquement sur ce PC jusqu'à ce que
tu les envoies avec **Envoyer en tant que <account>**. Les onglets **Mes records**, **Rang** et **Combinaison**
nécessitent une communauté avec une connexion.

## Configuration requise

- Windows sur x86-64 (testé sous Windows 11). Environ 1 Go pour le programme, plus de la place pour tes
  enregistrements.
- Pour la capture en direct : une carte d'acquisition que Windows liste comme périphérique vidéo, avec son pilote, et
  **FFmpeg** (gratuit, non inclus à cause de sa licence ; voir l'étape 4 ci-dessous). Pour les fichiers vidéo : ni
  carte d'acquisition ni FFmpeg.
- Pour envoyer des résultats : l'adresse du site de ta communauté et un compte sur ce site (voir [Joueurs](PLAYERS.md)).
  Sur le même ordinateur qu'une installation d'essai locale, `http://127.0.0.1:<port>` fonctionne ; sinon, utilise
  l'adresse HTTPS de confiance.

## Installation

1. Sur la page [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) du projet (les paquets
   sont joints à chaque release), télécharge `desktop-client-….zip` et `SHA256SUMS.txt`. Avec un clone, tu peux
   aussi compiler toi-même le même paquet : [Client builds](../../../CLIENT_BUILDS.md#livetrial-windows). Vérifie-le dans PowerShell :
   `Get-FileHash '.\desktop-client-<version>.zip' -Algorithm SHA256` et compare la valeur entière.
2. Extrais le ZIP **entier** dans un dossier qui t'appartient, par exemple sous Documents. Garde sa structure de
   dossiers ; le paquet contient son propre environnement Python, son moteur de reconnaissance et les ressources du jeu.
3. Double-clique sur `LiveTrial.exe`. Le tableau de bord s'ouvre dans sa propre fenêtre (Edge, sinon Chrome, sinon ton
   navigateur par défaut). L'analyse de vidéos fonctionne tout de suite.
4. Pour la capture en direct, installe FFmpeg une fois. Le plus simple : ouvre PowerShell et lance `winget install Gyan.FFmpeg`,
   puis quitte et relance LiveTrial pour qu'il voie le nouveau PATH. Sans winget, télécharge une version Windows (par
   exemple le zip de release de gyan.dev, accessible depuis [ffmpeg.org/download.html](https://ffmpeg.org/download.html)),
   décompresse-la et copie `bin\ffmpeg.exe` dans `%LOCALAPPDATA%\MK8DX\LiveTrial\tools\ffmpeg\bin\`. Si FFmpeg manque,
   **Démarrer la capture** le signale et affiche ces étapes.

## Se connecter à ta communauté

1. Ouvre **Paramètres**. Saisis l'adresse de ta communauté sous **Adresse du site de la communauté** (par exemple
   `https://www.example.org`) et choisis **Enregistrer le serveur**. LiveTrial redémarre tout seul ; laisse-le ouvert.
2. Après le redémarrage, vérifie que les Paramètres affichent exactement ton adresse, puis connecte-toi depuis le menu
   du compte (code par e-mail, lien par e-mail ou approbation sur le site).
3. Si le redémarrage automatique échoue, choisis **Quitter LiveTrial** dans l'application, attends qu'il soit fermé et
   relance `LiveTrial.exe`. Fermer seulement la fenêtre ne suffit pas : LiveTrial peut continuer à tourner en arrière-plan.

Les comptes et les runs en attente sont conservés séparément pour chaque serveur : changer de serveur n'envoie jamais
d'anciens runs à la nouvelle communauté. Ne saisis jamais dans LiveTrial l'adresse de la boîte de réception locale ni
l'adresse interne d'un serveur.

## Se connecter plus tard

Tu peux d'abord enregistrer et rejoindre une communauté plus tard. Voici ce qu'il advient des runs déjà sur ce PC :

- **Choisis la communauté avant d'enregistrer.** Les runs sont conservés par serveur. Les runs enregistrés avant que tu
  aies enregistré une adresse de communauté, ou pendant qu'une autre communauté était réglée, restent avec ce serveur
  et ne sont jamais proposés à la nouvelle. Pour transférer un tel enregistrement, relance **Analyser une vidéo** sur
  son fichier vidéo une fois connecté.
- **Les runs enregistrés sans compte** ne sont pas envoyés quand tu te connectes plus tard. Choisis **Envoyer en tant
  que <account>** sur un run (dans l'**Historique des runs** ou sur la ligne après la course), ou sur la ligne **Aucun
  compte** de la liste d'attente (le compteur en haut), pour tous les donner au compte connecté. Ils arrivent sur le
  Joueur de ce compte ; rien n'est attribué sans ce choix.
- **Les runs enregistrés en étant connecté** partent toujours avec ce même compte. **Envoyer maintenant** envoie chaque
  run en attente, chacun avec son propre compte ; un run dont le compte est déconnecté attend que ce compte se
  reconnecte.
- **Chaque run est stocké une seule fois.** Chaque run porte son propre identifiant de soumission, et le site n'accepte
  pas une deuxième copie du même run.
- **Les clips et les vidéos restent sur ce PC.** Seul le résultat (temps, circuit, combinaison) va sur le site ; un envoi
  sur YouTube est une étape distincte et facultative.

## Utilisation

- **Démarrer la capture** : choisis la carte d'acquisition. LiveTrial en affiche d'abord une image fixe, pour que tu
  puisses vérifier que c'est le bon périphérique. L'onglet **En direct** affiche ensuite l'image et chaque run reconnu.
- **Analyser une vidéo** : choisis un fichier `.mp4`/`.mkv` (il est copié dans
  `%LOCALAPPDATA%\MK8DX\LiveTrial\videos`) et LiveTrial le traite comme une capture.
- Après chaque course, la ligne **Dernière course** indique où se trouve le run : sur le site, enregistré et en attente
  d'envoi (**Envoyer maintenant**), ou seulement sur ce PC (**Envoyer en tant que <account>**).
- L'**Historique des runs** liste chaque run avec son clip. Tu peux corriger une reconnaissance ; une correction
  enregistre une nouvelle version et garde l'ancienne.
- L'envoi automatique est désactivé par défaut ; active-le dans les Paramètres. Un run est toujours enregistré d'abord
  en local.

Règle **Langue de ta Switch** dans les Paramètres quand la langue de la console diffère de celle du tableau de bord.

Le tableau de bord ne se commande que depuis cet ordinateur : dans la fenêtre LiveTrial ou sur la page du tableau de
bord ouverte sur ce PC. Si le moteur est lancé avec `--lan` (voir le
[README du composant LiveTrial](../../../../apps/timetrials-desktop/README.md)), les téléphones et tablettes du réseau
peuvent regarder la vue en direct et les courses, mais ne peuvent rien modifier.

## Noms de clip lisibles

Dans LiveTrial, un clip garde son nom interne. Chaque clip terminé apparaît aussi dans un seul dossier,
`Documents\MK8DX\LiveTrial-clips`, sous un nom lisible :

```
2026-11-16 10h25m  Mario Kart Stadium  150cc  1m46s784.mp4
```

- Date et heure du début du clip (l'horloge de ce PC), circuit, catégorie (50cc, 100cc, 150cc, 200cc ou Mirror) et
  le temps, avec deux espaces entre les champs. Un clip enregistré avec le bouton d'enregistrement s'appelle
  `Manual`, un replay de fantôme `Ghost <circuit>`. Un circuit ou un temps que LiveTrial n'a pas reconnu est omis
  (`Unknown track`), jamais deviné. Si un nom est déjà pris, ` (2)` est ajouté.
- Le circuit est nommé dans la langue de LiveTrial. Les noms n'utilisent que des lettres, des chiffres, des espaces
  et `-` : les apostrophes et autres signes disparaissent et les accents deviennent des lettres simples (Yoshi's
  Circuit devient Yoshis Circuit). En russe, japonais, coréen ou chinois, le circuit est nommé en anglais, pour que
  les noms de fichier restent en lettres simples.
- Sur le même disque que les données de LiveTrial, l'entrée est un lien physique (hard link) qui ne prend pas de
  place en plus ; sur un autre disque, c'est une copie. Quand le nettoyage du stockage de LiveTrial supprime un
  clip, sa copie lisible part aussi ; un clip épinglé garde sa copie.
- L'**Historique des runs** affiche le nom sous le clip, avec **Open folder**. Désactive les copies ou choisis un
  autre dossier sous **Copie lisible des clips** dans les **Paramètres**.

La copie se fait en arrière-plan une fois le clip terminé. Si elle échoue (par exemple, le dossier est
inaccessible), le clip lui-même n'est pas touché.

## Problèmes

- Mauvais site, ou la connexion ouvre le mauvais site : quitte LiveTrial avec **Quitter LiveTrial**, relance-le et
  vérifie l'adresse dans les Paramètres. Un autre compte Windows sur le même PC peut encore faire tourner LiveTrial.
- Aucun périphérique de capture listé : vérifie la connexion USB et le pilote, attends quelques secondes et réessaie.
- Erreurs de reconnaissance : corrige le run dans l'Historique des runs avant de l'envoyer. La reconnaissance ne
  remplace jamais la vérification de ton propre résultat.

LiveTrial fonctionne uniquement sous Windows ; il n'existe pas de version macOS ni Linux. Pour le compiler toi-même,
voir [Client builds](../../../CLIENT_BUILDS.md).
