# Intégration GTFS TCL — interface V0.1

## Archive importée

L’archive fournie à la racine du projet `montrajet-lyon/GTFS_TCL.ZIP` a été lue localement, sans téléchargement ni modification. SHA-256 : `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`.

| Fichier présent | Enregistrements importés |
| --- | ---: |
| agency.txt | 2 |
| routes.txt | 807 |
| stops.txt | 14 026 |
| trips.txt | 140 442 |
| stop_times.txt | 2 927 249 |
| calendar.txt | 3 089 |
| calendar_dates.txt | 22 435 |
| transfers.txt | 5 457 |
| feed_info.txt | 1 |

`stops.txt` contient les quais et les stations ; la recherche porte sur les arrêts/quais de type 0, sans fusion par nom. Validité déclarée par `feed_info.txt`, recoupée avec les calendriers : **8 novembre 2026 au 8 mars 2027**, bornes incluses pour les jours de service. Les dernières courses peuvent se poursuivre après minuit.

Deux arrêts référencent une station parente absente : leurs identifiants et horaires sont conservés. Aucun regroupement en station n’est inventé. L’avertissement est consultable dans l’interface et dans le rapport d’import.

Le point d’accès national référence [le GTFS TCL et son lien Grand Lyon](https://transport.data.gouv.fr/resources/65812). La page historique du catalogue n’est pas utilisée pour fixer la validité de l’archive : ses propres fichiers font foi. Le script ne prouve pas l’authenticité des octets d’une archive locale ; il conserve son empreinte et une URL de provenance associée, à vérifier lors de chaque actualisation. Il n’effectue aucun appel réseau.

## Utilisation locale

Node **24+** est recommandé : SQLite, décompression ZIP et tests sont fournis par Node, sans nouvelle dépendance.

```powershell
cd montrajet-lyon
npm.cmd run dev
```

Dans Horaires : saisir une ligne et la sélectionner, puis saisir un arrêt et sélectionner le quai correspondant. Les homonymes sont distingués par identifiant, code, quai et station parente lorsque ces champs sont fournis. Une saisie libre ne sélectionne jamais implicitement un arrêt.

Le champ de date/heure utilise le fuseau de l’appareil ; vide, il demande les passages à partir de l’instant présent. Les heures de résultat sont toujours affichées en Europe/Paris, avec la mention **Horaire théorique** et la période de validité du flux. Les listes couvrent les **24 heures suivantes**, au maximum **12 passages**, par ligne et quai. Aucun passage disponible ne signifie pas absence de perturbation ni confirmation de circulation.

## Import et actualisation sans écrasement

Emplacements reconnus par défaut, dans cet ordre :

1. `data/gtfs/GTFS_TCL.ZIP` (emplacement recommandé pour les prochains fichiers).
2. `GTFS_TCL.ZIP` à la racine de `montrajet-lyon/` (archive actuellement fournie).

```powershell
npm.cmd run gtfs:import
# Ou indiquer explicitement une autre archive locale vérifiée :
npm.cmd run gtfs:import -- "C:\chemin\GTFS_TCL.ZIP"
```

Chaque import crée un nouveau dossier `.data/import-<empreinte>-<date>/` contenant :

- `gtfs.sqlite`, base indexée préparée dans un espace isolé ;
- `report.json`, inventaire, empreinte, validité, avertissements et taille ;
- `error.txt` si la validation échoue. Une sortie en échec n’est jamais activée.

Au premier succès seulement, la base est copiée vers `.data/gtfs.sqlite` avec refus d’écrasement. Les imports suivants préservent cette base active. Pour consulter une nouvelle sortie après examen de son rapport, définir `GTFS_DB` avec son chemin puis relancer Vite :

```powershell
$env:GTFS_DB = (Resolve-Path '.data/import-…/gtfs.sqlite').Path
npm.cmd run dev
```

Il n’y a ni suppression automatique de l’archive, ni remplacement d’un import, ni téléversement. Les anciennes sorties, y compris les rapports d’échec, restent disponibles. Le calcul ne télécharge jamais le GTFS dans le navigateur. Vite refuse aussi l’accès HTTP direct à l’archive et à `.data/` ; le build `dist/` ne contient que le front-end.

## Validation et limites de format

- Lecture ZIP en flux (stocké/Deflate) et contrôle de taille/CRC, UTF-8 strict ; CSV avec BOM, CRLF, champs cités, guillemets doublés et retours à la ligne.
- Validation des colonnes requises, identifiants uniques, références SQL, dates réelles, heures, séquences, premier/dernier arrêt, fuseau et calendriers.
- `agency`, `routes`, `stops`, `trips` et `stop_times` sont indispensables à ce module. Au moins l’un de `calendar`/`calendar_dates` doit être présent ; les services définis seulement par des exceptions sont acceptés.
- `transfers` et `feed_info` sont facultatifs. S’ils existent, ils sont lus et validés. Les correspondances sont stockées pour une intégration ultérieure, sans calcul d’itinéraire.
- Pas d’interpolation locale des heures absentes : ces passages sont exclus avec avertissement. Un horaire marqué `timepoint=0` par la source conserve un libellé d’interpolation de la source, toujours théorique.
- Les départs avec montée interdite sont exclus ; ceux sur demande sont signalés.
- ZIP64, ZIP chiffré/multivolume, services à la fréquence (`frequencies.txt`) et fenêtres de transport à la demande ne sont pas pris en charge et provoquent un refus explicite d’import. L’archive actuelle n’utilise pas ces extensions. Les autres fichiers non nécessaires sont inventoriés comme ignorés.

## Règles de calcul

Le modèle suit la [référence officielle GTFS](https://gtfs.org/documentation/schedule/reference/). Les heures ne sont pas ramenées modulo 24 : `25:00:00` appartient au jour de service précédent et `49:00:00` à celui d’avant-veille. La recherche remonte suffisamment de jours selon la plus grande heure de l’archive.

Pour chaque jour candidat, les exceptions `calendar_dates` priment sur les jours de semaine et sur la plage `start_date`/`end_date`. Les conversions suivent l’origine GTFS **midi local moins 12 heures réelles**, ce qui traite correctement les journées de changement d’heure. Une course de la veille reste liée au calendrier de la veille. La validité du flux borne les jours de service, sans tronquer leurs dernières courses après minuit. Un flux expiré ne fournit jamais de nouveaux horaires par répétition artificielle.

## Contrat HTTP local et Cloudflare

Préfixe `/api/gtfs`, uniquement `GET`. Succès : `{ status: 'connected', data: … }`. Absence de base : HTTP 503 avec `{ status: 'disconnected', message: … }`. Paramètre invalide : 400 ; route inconnue : 404 ; autre méthode : 405.

| Route | Paramètres | Résultat |
| --- | --- | --- |
| `/status` | aucun | métadonnées et validité |
| `/lines` | `q` | jusqu’à 20 lignes |
| `/stops` | `q`, `lineId` facultatif | jusqu’à 20 quais distincts |
| `/directions` | `lineId`, `stopId` | directions/libellés GTFS distincts |
| `/passages` | `lineId`, `stopId`, `at` facultatif (ISO avec fuseau), `direction` facultatif (`0`, `1` ou vide) | jusqu’à 12 passages théoriques et métadonnées |

`q` est normalisé (accents, ligatures, ponctuation) puis recherché par préfixe de mot dans un index SQL. Les entrées sont bornées, les requêtes SQL paramétrées et les réponses limitées. Les résultats ne chargent ni le fichier `stop_times` complet ni l’archive côté client. Les résultats sont recalculés par requête, sans cache d’horaires périmé. Le module Itinéraires et le temps réel restent déconnectés.

## Préparation Cloudflare gratuite, sans activation

`functions/api/gtfs/[[path]].ts` est un adaptateur Pages Functions vers un binding D1 nommé `GTFS_DB`. Le même dépôt SQL et les mêmes calculs fonctionnent sous Vite/SQLite et sous ce binding. Aucun module Node ni archive n’est importé par la Function. Le binding est testé par contrat local, pas sur un compte Cloudflare.

La base complète actuelle fait **416 698 368 octets**, sous la limite de **500 MB par base D1 Free**. Cela ne suffit pas à garantir un import intégral gratuit en une journée : les millions d’écritures et les index doivent respecter les quotas Free de **100 000 lignes écrites/jour** et **5 millions lues/jour**. Ces limites sont celles de la [documentation Cloudflare D1](https://developers.cloudflare.com/d1/platform/pricing/) et des [limites de plateforme](https://developers.cloudflare.com/d1/platform/limits/). Toute future publication devra prévoir un chargement par lots conforme aux quotas, ou une représentation plus compacte/périmètre réduit, puis mesurer les lectures. Il ne faut pas activer un plan payant pour contourner ces limites.

Un export SQL **hors ligne** est préparé pour une future base D1 vide :

```powershell
node scripts/gtfs/export-sql.mjs .data/gtfs.sqlite .data/nouvel-export-sql
```

L’export produit des fichiers numérotés, dans l’ordre de dépendance, sans `DROP`, sans transaction explicite et sans écraser de dossier existant. Les statements sont courts ; un fichier de 10 000 statements ne constitue **pas** un budget d’écritures garanti (les index comptent aussi). Avant tout import distant, planifier ce budget et vérifier les limites. Aucune commande distante, configuration de compte, installation de Wrangler ou publication n’est exécutée ici.

Un hébergement statique seul de `dist/` ne fournit pas l’API : il faudra aussi déployer la Function et préparer le binding/base. Cette étape reste volontairement inactive.

## Vérifications

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
```

Les tests couvrent le calendrier, les exceptions seules, les heures à 25/49 h, le changement de date/année, les deux changements d’heure, les homonymes, les limites de fenêtre, l’interdiction de montée, les erreurs CSV/ZIP, l’import sans fichiers facultatifs, le refus d’écrasement, l’export SQL/relecture et le contrat Cloudflare. Les jeux unitaires sont artificiels et confinés aux tests ; aucun n’est enregistré comme donnée TCL dans l’application. Le test de la base locale compare les résultats aux horaires et calendriers réellement importés ; il est ignoré uniquement si aucune base n’existe.
