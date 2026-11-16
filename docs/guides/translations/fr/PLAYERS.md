# Joueurs : le site web et l'application Android

*Ceci est une traduction automatique du [guide anglais](../../PLAYERS.md) ; la version anglaise fait foi. Les corrections sont les bienvenues via le formulaire de ticket « Translation correction ».*

[Tous les guides](../../../../README.md#get-started)

Il te faut l'adresse du site MK8DX de ta communauté, par exemple `https://www.example.org`. Chaque communauté
fait tourner sa propre installation avec ses propres comptes et résultats ; demande l'adresse aux personnes qui
gèrent la tienne, ainsi que de l'aide pour ton compte. Tu n'installes rien pour utiliser le site.

## Le site web

### Se connecter

1. Ouvre l'adresse de ta communauté et choisis l'icône du compte (en haut à droite), puis **Se connecter**.
2. Saisis ton adresse e-mail et choisis **M'envoyer un lien par e-mail**. Ouvre l'e-mail et suis le lien. Il n'y
   a pas de mot de passe. Le lien fonctionne une fois et expire ; demandes-en un nouveau s'il ne fonctionne pas.
3. La première fois, le lien ouvre directement une configuration en trois étapes. L'étape 1, **Es-tu déjà sur ce site ?**,
   demande si tes temps de contre-la-montre sont déjà sur le site et si tu as participé à un tournoi qui y
   figure. Si oui, l'étape 2 te permet de trouver le Joueur qui est toi et de demander qu'il soit lié à ton compte ;
   un administrateur ou le directeur du tournoi de la soirée examine une telle revendication avant qu'elle soit
   liée, et rien n'est jamais lié sur la seule base d'un nom. Si non, l'étape 2 crée ton Joueur (dans une communauté
   où seuls les directeurs créent les Joueurs, elle explique plutôt à qui t'adresser). L'étape 3 propose quelques
   réglages facultatifs que tu peux passer.

Ton compte (l'e-mail avec lequel tu te connectes) et ton Joueur (le nom dans les classements) sont deux choses distinctes.

### Publier un contre-la-montre

- **Publier un temps** (barre du haut), ou **Circuits** → un circuit → **Publier un temps** : saisis ton temps en
  150cc ou 200cc, vérifie les valeurs sur la confirmation et publie.
- **Scanne-le** : ouvre `<your community address>/scanner/` sur un téléphone ou une tablette. Pointe l'appareil photo
  vers l'écran de résultats sur ta télé, ou choisis **image upload** (envoi d'image) avec une photo ou une capture
  d'écran. Le scanner lit les temps, les tours et, quand ils sont visibles, le personnage, la combinaison du kart et le
  drapeau. Vérifie chaque valeur avant de soumettre ; la reconnaissance peut se tromper. L'appareil photo a besoin d'une
  adresse HTTPS de confiance (il fonctionne aussi sur `localhost`) ; l'envoi d'image fonctionne partout.
- Selon les règles de la communauté, une soumission peut être publiée immédiatement ou attendre la vérification
  d'un administrateur. Un administrateur peut corriger ou retirer un temps publié.

### Suivre tes progrès

**Circuits**, **Classement** et **Records** affichent tes meilleurs temps et tours à côté de ceux de la communauté, de
tes rivaux choisis, des fantômes du staff Nintendo et des records du monde. **Combinaison** t'aide à choisir tes
personnages et combinaisons de kart, **Communauté** montre les autres Joueurs et **Tournois** les soirées tournoi
publiées, les classements et les rapports. Quand quelqu'un bat l'un de tes temps publiés, tu reçois une notification
(la cloche). Le site peut aussi envoyer des notifications push dans le navigateur si ta communauté l'a configuré ;
active-les dans les paramètres de ton compte.

Le site est disponible dans les 15 langues du jeu (choisis la tienne dans les paramètres). L'anglais et le néerlandais
sont relus ; les 13 autres sont des traductions automatiques, et les corrections sont les bienvenues : voir
[Modifier les textes de l'interface et les traductions](../../../DEVELOPMENT.md#change-ui-text-and-translations) pour le fichier à modifier et
[Contributing](../../../../.github/CONTRIBUTING.md) pour la pull request.

## L'application Android

L'application propose un scan plus rapide sur le téléphone lui-même, tes temps et les notifications. Elle est facultative.

### Configuration requise

- Android 8.0 ou plus récent ; un téléphone arm64 est recommandé. L'APK de release est volumineux (environ 530 Mo) :
  garde environ 1 Go libre pendant l'installation.
- Une communauté que l'application peut joindre : une **communauté en ligne** avec une adresse HTTPS de confiance, ou une
  **installation à la maison ou au club** (A2) sur le même Wi-Fi. Une adresse locale à un ordinateur (`http://127.0.0.1:…`) ne fonctionne pas dans l'application.

### Installation

1. Récupère l'APK sur la page **Obtenir l'appli** de ta communauté quand elle propose des téléchargements (tu dois être
   connecté pour les voir ; c'est la version que ta communauté prend en charge), ou sur la page
   [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) du projet : prends
   `mk8dx-android-release-….apk`. Avec un clone du dépôt, tu peux aussi compiler l'APK toi-même :
   [Client builds](../../../CLIENT_BUILDS.md#android).
2. Vérifie le fichier avec `SHA256SUMS.txt` de la même release (sur un ordinateur : `Get-FileHash` dans PowerShell,
   `sha256sum` sous Linux, `shasum -a 256` sous macOS).
3. Copie l'APK sur le téléphone et ouvre-le depuis **Fichiers** ou **Téléchargements**. Android demande d'autoriser
   l'installation depuis cette application ; ne l'autorise que pour ce fichier vérifié et désactive-la ensuite si tu veux.

Ce n'est pas une application du Play Store. Les APK publics précédents étaient signés avec une clé de compilation debug ;
l'APK de release utilise la clé conservée par le mainteneur. Enregistre les résultats pas encore envoyés et désinstalle une
fois un ancien APK debug avant d'installer cette release. Les APK ultérieurs signés avec la même clé de release se mettent
à jour sur place. Passer à l'APK d'une communauté ou à un APK compilé soi-même avec une autre clé nécessite aussi une
désinstallation.

### Premier démarrage

L'application s'ouvre sur **Choisis ta communauté**, dans la langue du téléphone quand l'application la propose. Pour
choisir une autre langue, touche **Langue / Language** (avec le globe) en haut ; l'application retient ce choix. Elle ne
demande ensuite qu'une chose : comment ta communauté joue. Tu n'es pas sûr ? Demande à la
personne qui gère ta communauté.

- **À la maison ou au club** (A2, MK8DX tourne sur un ordinateur sur place) : touche **Scanner le code QR** et scanne la
  carte **Prepare a device** (préparer un appareil) que ton administrateur affiche sur cet ordinateur ou distribue sur papier. Le téléphone doit être sur
  le même Wi-Fi. L'application affiche alors l'adresse et la clé de l'installation ; elles figurent aussi sur la page **Prepare this
  device** (préparer cet appareil) sous **Full fingerprints** (empreintes complètes). Touche **Se connecter** quand elles correspondent. Pas besoin d'internet. Pas à pas :
  [le guide A2, chapitre 7](../../../install/translations/fr/A2_HOME_GUIDE.md#7-lapplication-android-et-livetrial).
- **Communauté en ligne** (un site sur internet) : saisis l'adresse avec laquelle tu l'ouvres dans le navigateur, par exemple
  `https://www.example.org` (sans chemin ni barre oblique finale), et touche **Enregistrer**. En cas d'échec, ouvre la même adresse dans
  le navigateur du téléphone : elle doit s'ouvrir sans avertissement de certificat.

À la maison ou au club (A2), compare d'abord le code d'installation de 16 caractères et touche **Connecter**. Suis ensuite les étapes de l'application : **Enregistrer le certificat**, **Ouvrir les paramètres** pour l'installer comme certificat d'autorité, puis **Scanner la carte de connexion** pour te connecter dans l'application. Aucun code du navigateur n'est nécessaire. Pour une communauté en ligne, touche l'icône de personne et **Se connecter** ; l'approbation se fait dans le navigateur.

### Se repérer

Le haut de l'application affiche le logo (retour à l'accueil), la **pastille de communauté** avec le nom de la communauté que tu
utilises, la cloche et ton nom. Ton nom ouvre **Toi** : ton Joueur avec **Changer de joueur**, et les onglets
**Mes temps**, **Records** et **Rivaux**, avec une ligne **Paramètres** en dessous.

- **Plusieurs communautés** : touche la pastille de communauté pour ouvrir **Communautés**. La communauté active est en vert ; **Changer de communauté**
  passe à une autre en une touche, **Retirer de ce téléphone** en oublie une (seulement quand plus rien n'attend d'être envoyé), et
  **Ajouter une communauté** rouvre l'écran du premier démarrage. Chaque communauté garde sa propre connexion, ses propres runs non
  envoyés et, à la maison ou au club, sa propre confiance ; rien ne passe de l'une à l'autre tout seul. Quand l'administrateur
  a donné un nom à la communauté, l'application affiche ce nom au lieu de l'adresse.
- **Mes temps** est une seule liste : tes chiffres de carrière, puis une ligne par circuit et par cylindrée avec ton record personnel ; touche une
  ligne pour voir les runs plus anciens et utilise **⋯** sur un run pour **Détails**, **Modifier**, **Retirer** ou
  **Emporter vers une autre communauté…**.
- **Sans internet** : l'application garde une copie de tes propres temps et des meilleurs temps de tes rivaux pour chaque communauté et
  l'affiche avec « Hors ligne — dernière mise à jour … ».
- **En attente d'envoi** : les runs qui ne sont encore que sur le téléphone apparaissent sous forme de bandeau orange sur l'accueil et sur Toi ; touche-le,
  ou utilise Paramètres › **Enregistré sur ce téléphone**, pour les voir.
- **Paramètres** est regroupé en **Joueur**, **Appli**, **Communauté** et **À propos**, et enregistre chaque modification tout seul.
  La langue se trouve sous Appli ; **Obtenir l'appli** et **Enregistré sur ce téléphone** se trouvent sous Communauté ; **Lancer un scan de test**
  se trouve sous À propos.

### Emporter des temps vers une autre communauté

Si tu fais partie de plusieurs communautés, un temps peut aussi compter dans une autre : **Emporter vers une autre communauté…**
sur un run, ou **Emporter mes meilleurs temps** sous tes chiffres de carrière dans Mes temps (les circuits où l'autre communauté
a déjà un meilleur temps à toi sont ignorés). La copie attend que tu y sois connecté. C'est la communauté **qui reçoit**
qui décide : par défaut, elle n'accepte pas les temps venus d'ailleurs ; elle peut laisser un administrateur approuver chacun d'eux
d'abord, ou les accepter comme n'importe quel autre temps. Un temps apporté indique toujours sa provenance (« Apporté de … ·
à l'origine le … »). Le même original n'est accepté qu'une seule fois ; un temps égal ne fait que compléter ce qui manquait
au run existant.

### Notifications

Les notifications de l'application sont récupérées depuis la boîte de réception de ta communauté ; l'autorisation de notification d'Android et
l'interrupteur propre à l'application doivent tous deux être activés.

## Problèmes

- Pas d'e-mail de connexion : vérifie les spams, l'adresse exacte et demande un nouveau lien. Sur une installation d'essai locale,
  l'e-mail arrive dans la boîte de réception de test locale, pas dans ta boîte aux lettres.
- Une revendication est refusée avec *Trop d’actions de revendication pour le moment…* : attends le délai indiqué et
  réessaie. Un compte peut avoir au plus 5 revendications en attente de décision à la fois (un joueur au plus 5, tous
  comptes confondus). À cette limite, attends qu’une revendication en attente soit traitée, ou retires-en une avec
  **Retirer cette demande**, puis réessaie.
- Quelque chose semble anormal sur le site de ta communauté : demande d'abord aux personnes qui le gèrent. Les bugs du logiciel lui-même
  peuvent être signalés dans les tickets du projet ; voir [SUPPORT.md](../../../../.github/SUPPORT.md). Ne publie jamais de liens de connexion ni les noms
  d'autres personnes.
