# Directeurs de tournoi : diriger une soirée

*Ceci est une traduction automatique du [guide anglais](../../TOURNAMENT_DIRECTORS.md) ; la version anglaise fait foi. Les corrections sont les bienvenues via le formulaire de ticket « Translation correction ».*

[Tous les guides](../../../../README.md#get-started) · [Référence des Tournament Tools](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md)

Un directeur de tournoi dirige une soirée tournoi sur le site de la communauté : participants, consoles, groupes,
scores, finales et rapport publié. Les **Tournament Tools** pour Windows peuvent lire les résultats des courses à
partir d'enregistrements ou d'une capture en direct, pour que tu n'aies pas à saisir chaque place à la main. Ils sont
facultatifs : les scores peuvent aussi être saisis à la main ou importés depuis Excel/CSV.

**Sans site web :** les Tournament Tools pour Windows de la [section 3](#3-les-tournament-tools-pour-windows) (Processor,
Analysis et Live) fonctionnent tout seuls. Ils écrivent des fichiers Excel, CSV et JSON sur ton PC ; Connect est facultatif.

La reconnaissance ne rend jamais un résultat officiel. Tu vérifies chaque course avant qu'elle compte, et c'est toi qui
décides de la publication.

## 1. Obtenir les droits de directeur sur le site de ta communauté

1. Connecte-toi sur le site (voir [Joueurs](PLAYERS.md)).
2. Sur la page **Tournois**, choisis **Demander à organiser**. Un administrateur accepte ou refuse la demande.
   Les administrateurs, et les directeurs une fois approuvés, ne voient pas ce bouton : ils voient **Créer un nouveau
   tournoi** sur la même page (dans la barre **Direction de course**) et lancent la soirée depuis là.
3. Pour envoyer au site des courses reconnues par les outils Windows, un administrateur accorde aussi à ton Joueur
   connecté l'accès sous **Administration → Tournois → Directeurs**. Cela donne accès aux tournois,
   pas à l'administration générale.

## 2. Diriger la soirée sur le site

Ouvre le tournoi depuis **Tournois** (les administrateurs y accèdent aussi sous **Administration → Tournois**).
La soirée est une suite d'étapes ; la page indique où tu en es :

| Étape | Ce que tu fais |
| --- | --- |
| 0 | Choisir le directeur |
| 1 | Démarrer le tournoi |
| 2 | Sélectionner les participants, indiquer qui est présent et quelles Switch chacun apporte (les cases **NS1**/**NS2** à côté de chaque nom) |
| 3-4 | Créer et exporter la disposition des qualifications (groupes et places) |
| 5 | Saisir les scores des qualifications : à la main, depuis un fichier Excel/CSV, ou depuis **Résultats entrants** |
| 6 | Exporter les résultats des qualifications |
| 7-8 | Vérifier et exporter les groupes finaux |
| 9 | Saisir les scores des groupes finaux ; un import fonctionne par groupe et refuse un groupe tant qu'un nom n'est pas encore associé |
| 10 | Finaliser et partager : tableau final, rapport et export WordPress |

L'étape 2 ne continue que s'il y a assez de Switch : chaque Switch accueille deux Joueurs, donc la soirée a besoin
d'au moins la moitié des participants **Présent**, arrondie au supérieur, en Switch cochées (9 Joueurs présents
demandent 5 Switch). Le cadre de préparation sous la liste indique combien il en manque ; coche les Switch que les gens
apportent, ou déplace des participants vers **Liste d'attente** ou **Absent**.

Pour les courses venues des Tournament Tools : ouvre **Résultats entrants** pour le groupe, associe chaque nom reconnu
au bon Joueur, vérifie le circuit et les places d'arrivée, puis choisis **Confirmer**. Un classement provisoire en
direct n'est pas un résultat officiel. Tu peux aussi importer directement un fichier de résultats avec **Solution hors
ligne : importer un fichier de résultats Live / Processor enregistré** dans un groupe, ou avec **Administration → Tournois → Importer les résultats de course canoniques**.

La publication et la cote de la communauté sont des décisions distinctes de l'étape finale.

## 3. Les Tournament Tools pour Windows

### Configuration requise

- Windows sur x86-64 (testé sous Windows 11) et plusieurs Go d'espace libre. Le ZIP fait environ 160 Mo et environ 1 Go une fois extrait ;
  l'installateur a besoin d'internet une fois, pour télécharger Python 3.12 et des paquets publics (davantage avec GPU/CUDA) ; les modèles
  de détection et d'OCR pour l'alphabet latin sont inclus, et la première exécution de l'OCR anglais télécharge un modèle de plus
  (english_g2.pth, environ 15 Mo) une fois. Ensuite, le traitement fonctionne hors ligne. Une carte
  NVIDIA n'accélère que l'étape OCR ; le premier scan d'un enregistrement tourne toujours sur le CPU (voir
  [quelles étapes utilisent la carte graphique](../../../product/USING_MK8DX_TOURNAMENT_TOOLS.md#which-steps-use-the-graphics-card)).
- Pour la capture en direct : une carte d'acquisition avec un pilote Windows (DirectShow) fonctionnel. Pour les
  enregistrements : rien de plus.
- Facultatif, pour envoyer des résultats : l'adresse du site et un accès d'opérateur de tournoi (étape 1).

### Installation

1. Sur la page [GitHub Releases](https://github.com/fromthelake/MK8DX-Ecosystem/releases) du projet (les paquets
   sont joints à chaque release), télécharge `tournament-tools-….zip` et `SHA256SUMS.txt`. Avec un clone, tu peux
   aussi le compiler toi-même ([Compiler les outils soi-même](#compiler-les-outils-soi-même)). Dans PowerShell :
   `Get-FileHash '.\tournament-tools-<version>.zip' -Algorithm SHA256`, et compare la valeur entière.
2. Extrais le ZIP complet dans un dossier accessible en écriture (pas `Program Files`). Garde `runtime-assets\` à côté
   des lanceurs.
3. Double-clique sur `Install-MK8DX-TournamentTools.cmd` et attends `SUCCESS`. Il choisit tout seul PyTorch NVIDIA CUDA
   ou CPU pour cet ordinateur. En cas d'échec, lis `install.log` dans le dossier du paquet.

L'installateur crée ces lanceurs :

| Lanceur | Utilisation |
| --- | --- |
| `TournamentProcessor.cmd` | Fais glisser un enregistrement `.mp4` ou `.mkv` dessus. Il écrit un dossier de session à côté de la vidéo (`<name>_TournamentSession\Output_Results\`) avec Excel, CSV et `<name>_TournamentRaceResultsV1.json`. |
| `TournamentAnalysis.cmd` | Une fenêtre pour la même analyse de vidéos enregistrées, avec plusieurs vidéos ou un dossier par tournoi ([ci-dessous](#analyser-des-enregistrements-après-coup)). |
| `TournamentLive.cmd` | Capture en direct pendant la soirée, ou relecture d'une vidéo : **Ajouter un fichier vidéo** (ou ajoute un périphérique de capture), **Tout démarrer**, vérifie **Classement confirmé**, puis **Ouvrir les exports**. Pour livrer le run, voir [Tournament Live vers le site](#tournament-live-vers-le-site). |
| `TournamentConnect.cmd` | Connexion facultative au site (ci-dessous). |
| `TournamentLiveCli.cmd` | Diagnostic : découverte des périphériques, commandes de relecture et de résultats. Ne remplace pas la fenêtre Live. |

`TournamentTools.config.cmd` contient les chemins locaux et les préférences de langue. Garde-le, ainsi que le dossier de
session `TournamentLive\` et tes dossiers de sortie, quand tu installes un paquet plus récent.

### Analyser des enregistrements après coup

Utilise Tournament Live quand tu captures la soirée en direct. Si la soirée s'est déroulée sans lui et que tu n'as que
des enregistrements, analyse-les après coup avec la fenêtre **Tournament Analysis** :

1. Double-clique sur `TournamentAnalysis.cmd` dans le dossier du paquet.
2. **① Choisir les enregistrements** : **Ajouter des vidéos...** sélectionne un ou
   plusieurs enregistrements (`.mp4`, `.mkv`, `.mov`, `.avi`, `.ts`) ; **Ajouter un dossier...** ajoute un
   dossier qui contient les enregistrements d'un tournoi.
3. **② Choisir les vidéos** : tout ce que tu as ajouté est coché ; décoche ce qui ne doit pas être
   analysé (**Tout**, **Aucun**, **Effacer**).
4. **③ Lancer l'analyse** : vérifie le **ID de session** (rempli à partir du
   premier nom et de la date ; il est stocké avec chaque course) et le **Dossier de résultats** (par
   défaut `<first name>_TournamentSession` à côté du premier enregistrement), puis choisis **DÉMARRER L'ANALYSE**. La fenêtre exécute le même traitement que `TournamentProcessor.cmd` ; le journal d'activité affiche sa
   sortie en couleur, le voyant de départ passe à l'orange et **Annuler** l'arrête. Les enregistrements sont
   liés dans `Input_Videos\` du dossier des résultats, ou copiés lorsqu'ils sont sur un autre disque.
5. **🏁 Résultats** : quand il indique **Terminé**, **Ouvrir le dernier Excel**
   ou **Ouvrir le dossier de résultats** : `Output_Results\` contient le classeur Excel, le CSV et
   `*_TournamentRaceResultsV1.json`. Vérifie les courses, puis importe le JSON sur le site comme décrit plus haut.

Les textes suivent la langue de Windows (anglais ou néerlandais) ; `MK8DX_TOURNAMENT_LANGUAGE` dans
`TournamentTools.config.cmd` la remplace. Pour afficher une autre image dans la bannière, règle `MK8DX_ANALYSIS_BACKGROUND`
dans `TournamentTools.config.cmd` sur ce fichier. Depuis un clone, `python -m tournament_processor.gui` ouvre la même fenêtre quand
le Tournament Processor et ses ressources de reconnaissance sont installés ; il a besoin de PySide6 (l'extra `gui` du processor) et,
sinon, ou avec `--classic-gui`, ouvre une fenêtre Tkinter plus simple.

### Se connecter au site (facultatif)

Dans PowerShell, dans le dossier du paquet :

```powershell
.\TournamentConnect.cmd sign-in                           # asks for the website address once, then browser sign-in
.\TournamentConnect.cmd server                            # shows the address
.\TournamentConnect.cmd server https://www.example.org    # changes it (asks for confirmation)
.\TournamentConnect.cmd tournaments                       # lists the nights you may deliver to
.\TournamentConnect.cmd target                            # night and group for Tournament Live's live feed (clear-target)
.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json   # asks which night, then uploads
.\TournamentConnect.cmd sign-out
```

(Dans l'ordre : `sign-in` demande une fois l'adresse du site, puis la connexion dans le navigateur ; `server` affiche
l'adresse ou la change après confirmation ; `tournaments` liste les soirées auxquelles tu peux livrer ; `target` choisit
la soirée et le groupe pour le flux en direct de Tournament Live (`clear-target` l'efface) ; `send` demande quelle
soirée, puis envoie le fichier ; `sign-out` te déconnecte.)

Utilise `http://127.0.0.1:<port>` (ou `http://localhost:<port>`) uniquement quand le site tourne sur le même ordinateur
Windows, comme le font A1 et A3 : le HTTP simple est accepté pour ces adresses sur ce PC et pour rien d'autre ; toute
autre adresse nécessite son adresse HTTPS de confiance. Sans terminal (par exemple depuis un script), `sign-in` ne pose
pas de question : règle d'abord l'adresse avec `TournamentConnect.cmd server <address>`. Les envois en attente pour un
serveur restent avec ce serveur. Une course livrée arrive dans **Résultats entrants** ; elle n'est jamais publiée
automatiquement.

### Tournament Live vers le site

1. Dans Tournament Live, choisis **Se connecter à Tournament Manager** (plus tard **Changer de tournoi**), termine la
   connexion dans le navigateur et choisis la soirée dans **Choisir un tournoi**. Ce choix n'est
   qu'une suggestion ; tu peux le faire avant ou après le run.
2. Lance les flux (**Ajouter un fichier vidéo** ou une carte d'acquisition, puis **Tout démarrer**). Tournament Live
   peut ajouter tout seul une carte d'acquisition qu'il a mémorisée, comme source supplémentaire sur le Groupe 1. S'il
   y a aussi une vidéo sur le Groupe 1, **Tout démarrer** s'arrête avec *Assign every feed to exactly one different
   group* (attribue chaque flux à exactement un groupe différent) : sélectionne la source supplémentaire et choisis
   **Retirer la sélection**, ou donne-lui son propre groupe, et redémarre.
3. Sur le site, ouvre la soirée, va à l'étape 5 (l'étape 9 pour les groupes finaux) et trouve le run sous **Enregistrements Tournament Live disponibles**.
   Choisis son groupe dans **Lier au groupe**, puis **Lier l'enregistrement vérifié**. Les courses attendent comme
   preuves en attente jusqu'à ce que tu les acceptes.

### Se connecter plus tard

Une soirée traitée sans connexion est complète sur ton PC : `Output_Results\` contient le classeur Excel, le CSV
et `*_TournamentRaceResultsV1.json`. Tournament Live sans connexion écrit aussi son classeur Excel : quand tu arrêtes
les flux, quand l'analyse se termine, ou quand tu fermes la fenêtre alors que des flux tournent encore (il les arrête
d'abord). Les fichiers restent dans `Live_Output\exports` (**Ouvrir les exports**) après la fermeture. Si Live est tué
avant l'arrêt des flux, ce classeur final manque ; les enregistrements restent, et Tournament Analysis ou le Processor
en refait le même classeur. Rien n'est envoyé tout seul ensuite ; apporte-le sur le site de l'une de ces
façons :

- Dans le groupe sur le site : **Solution hors ligne : importer un fichier de résultats Live / Processor enregistré**
  avec le JSON, ou l'import Excel du groupe. Chaque nom reconnu doit d'abord être associé à un Joueur ; un import refuse
  un groupe tant qu'un nom n'est pas associé.
- Un administrateur : **Administration → Tournois → Importer les résultats de course canoniques**. Les courses importées
  restent privées jusqu'à leur publication.
- Avec TournamentConnect : `.\TournamentConnect.cmd sign-in`, puis
  `.\TournamentConnect.cmd send <name>_TournamentRaceResultsV1.json`. Il demande la soirée, le groupe et le numéro
  de la première course ; les courses arrivent dans **Résultats entrants**. Si le site est injoignable, le fichier reste
  où il est ; renvoie-le plus tard.
- Dans Tournament Live : choisir la soirée avec **Se connecter à Tournament Manager** après la fin d'une session propose
  cette session terminée à la soirée. Les envois qui ont échoué pendant que Live était connecté sont conservés et
  renvoyés, automatiquement ou avec **Réessayer l'envoi**, uniquement pour le même compte connecté. Une session lancée
  avec **Travailler hors ligne** n'est pas conservée pour l'envoi ; utilise l'une des voies ci-dessus pour son fichier.

Se connecter ajoute deux choses : la liste des soirées auxquelles tu peux livrer, et le flux en direct pendant la soirée
(`target`), qui envoie chaque course au groupe choisi à mesure que Tournament Live la reconnaît. Dans tous les cas, une
course ne compte qu'après que tu l'as confirmée dans **Résultats entrants**.

### Vérifier ce qui a été lu

L'OCR peut mal lire un nom, une place ou un score cumulé. Compare chaque course avec l'écran ou l'enregistrement avant
de la confirmer. Une limite connue : Tournament Live peut exporter un résultat de course correct avec un total cumulé
mal lu, et la vérification sur le site ne permet pas de modifier le nom ou le total observé (voir
[Tournament Live sur un ordinateur portable local](../../../product/README_TOURNAMENT_LIVE_LAPTOP.md)).

Les outils lisent le jeu dans ses 15 langues de console. Tournament Live a réussi un test d'acceptation physique à 1×
avec le paquet v0.2.2 : trois PC sources ont lu des vidéos de qualification enregistrées dans leurs propres cartes
d'acquisition ([issue #137](https://github.com/fromthelake/MK8DX-Ecosystem/issues/137)). Une relecture vidéo sans carte
d'acquisition ne teste pas le chemin de capture.

## Compiler les outils soi-même

`python tooling/tournament/build_windows_package.py --output <new folder> --version local` depuis un clone compile
le même paquet ; voir [Client builds](../../../CLIENT_BUILDS.md).
