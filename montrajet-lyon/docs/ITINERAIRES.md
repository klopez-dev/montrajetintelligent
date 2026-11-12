# Calculateur théorique GTFS — V0.1

Évolution actuelle : [Performances et couverture](PERFORMANCES-COUVERTURE.md), avec deux correspondances et accès piétons élargis. Le présent document conserve le périmètre historique à une correspondance et ses preuves de validation.

## Périmètre opérationnel

Le moteur calcule, côté serveur, des trajets **directs ou avec une correspondance**, entre **deux quais GTFS sélectionnés explicitement**. Il recherche dans une fenêtre de **six heures** : après l’instant demandé pour « Partir à », avant cet instant pour « Arriver avant ». Il sélectionne jusqu’à six propositions diversifiées, classées selon le critère choisi.

Les trajets utilisent exclusivement `.data/gtfs.sqlite`, issu de l’archive TCL déjà importée. Aucun horaire n’est fabriqué, aucune donnée de transport n’est téléchargée pour le calcul, aucun service externe n’est appelé et le temps réel Grand Lyon reste désactivé.

Les modes bus/trolleybus, métro, tramway et funiculaire utilisent les mêmes règles de parcours des courses GTFS ; le type du véhicule et le libellé de ligne viennent de `routes`. Les adresses, la marche d’accès/sortie, les trajets entièrement à pied, les parcours à deux correspondances ou plus et l’accessibilité PMR ne sont pas calculés.

## Utilisation

```powershell
cd montrajet-lyon
npm.cmd run dev -- --host 127.0.0.1 --port 0
```

Le même Vite lance le frontend et les API GTFS, temps réel préparé et itinéraires. Le port 0 demande un port libre sans modifier les ports d’autres applications. Ouvrir l’adresse locale affichée.

Dans Accueil ou Itinéraires : sélectionner un départ et une destination dans les suggestions, vérifier les identifiants et lignes des quais, choisir la date, le mode, le classement et la marge, puis rechercher. Les champs ne font pas de géocodage d’adresse. Les quais homonymes restent distincts ; une saisie de nom seule n’est pas acceptée comme sélection.

L’interface affiche départ, arrivée, durée, lignes, directions, nombre de correspondances et attente avant le premier véhicule. Les étapes et les détails de correspondance sont dépliables par proposition. Les heures des résultats sont à Lyon, avec leur décalage UTC. La date saisie utilise le fuseau de l’appareil ; une heure locale inexistante est refusée et une heure répétée permet de choisir son occurrence.

Les nouveaux favoris enregistrent également les identifiants des quais et les résolvent à nouveau lors de leur réutilisation. Les anciens favoris sans identifiants restent conservés et affichés ; ils préremplissent les noms, mais demandent une sélection explicite des quais. La clé localStorage reste `montrajet-lyon:favorites:v1`. Un enregistrement illisible est signalé, sans effacer le stockage.

## Correspondances et marche

L’import contient **5 457 liens**, tous `transfer_type=2`, avec des minima entre **60 et 900 secondes**. Ils sont traités dans le sens déclaré. Aucun lien inverse, aucune proximité géographique et aucun temps de marche fondé sur un nom de station ne sont déduits.

- Entre deux quais différents, il faut un lien GTFS applicable avec un minimum explicite. Les règles de station s’appliquent aux quais enfants selon les identifiants.
- Les restrictions de lignes et de courses sont vérifiées. Les règles les plus spécifiques priment selon la [référence GTFS transfers.txt](https://gtfs.org/documentation/schedule/reference/#transferstxt). Une interdiction est respectée ; une ambiguïté de même spécificité est exclue.
- Les transferts de type 0/1 sans durée entre quais distincts et les liaisons de courses 4/5 sont hors périmètre. Ils ne sont pas convertis en durée inventée.
- Au **même quai exact**, en l’absence de restriction applicable, le déplacement entre arrêts est retenu à zéro comme **hypothèse explicite**, avec une marge positive. Cette hypothèse ne contourne jamais une interdiction GTFS.
- Une marge supplémentaire configurable de **30 à 1 800 secondes**, **120 secondes par défaut**, est ajoutée au minimum officiel. C’est un choix de sécurité de l’application, pas une donnée publiée par TCL.
- Le second véhicule doit partir après l’arrivée du premier **plus le minimum officiel et cette marge**. Les montées/descentes interdites ou sur demande/réservation sont exclues.

Le minimum GTFS inclut le déplacement et une réserve ; il n’isole pas la marche. Le résultat expose donc `walkingSeconds: null` entre quais distincts, jamais une fausse durée de marche. L’interface affiche le minimum officiel, la marge ajoutée, l’intervalle réel entre véhicules et le reste après ces réserves. La durée totale va du départ du premier véhicule à l’arrivée du dernier ; l’attente avant le premier départ est indiquée séparément.

## Résultats sur les trajets prioritaires

Exemples vérifiés pour **« Partir à » le 9 novembre 2026 à 11 h Europe/Paris**, marge ajoutée de deux minutes. Les secondes affichées sont celles du GTFS, pas une estimation de temps réel.

| Départ sélectionné | Arrivée sélectionnée | Première proposition contrôlée |
| --- | --- | --- |
| Place Henri, quai **2397** | La Soie, quai métro **36394** | **C13 → A**, via Cordeliers : **11:09:00 → 11:53:19**, 44 min 19 s |
| Domrémy-Lacassagne, quai **12230** | La Soie, quai métro **36394** | **C13 → A**, via Cordeliers : **11:01:00 → 11:43:43**, 42 min 43 s |
| Dauphiné-Lacassagne, quai tram **35660** | La Soie, quai tram **35668** | **T3 direct** : **11:07:01 → 11:15:32**, 8 min 31 s |

Pour C13 → A, le lien contrôlé est `48353 → 46050` à Cordeliers : minimum officiel de **180 s**, plus marge de **120 s**. Les propositions respectent ces cinq minutes réservées. Plusieurs départs réellement disponibles sont proposés pour chacun des trois trajets. Le mode « Arriver avant » est également contrôlé sur ces mêmes couples de quais.

### Limite importante du fichier fourni

L’archive contient notamment le transfert orienté tram → bus `35660 → 10129` à Dauphiné-Lacassagne, mais pas son inverse `10129 → 35660`. Le moteur **ne propose donc pas artificiellement un bus → T3 via ce lien inversé**. Place Henri `2397 → 35668` n’obtient pas de trajet avec une seule correspondance vérifiable dans la fenêtre testée. Cela ne signifie pas qu’aucun trajet n’existe dans la ville : la recherche est bornée et les données piétonnes sont limitées.

Les tronçons et directions de **C13, C9, C16, 125 et T3** ont été testés dans les données réelles autour des arrêts demandés. Cela ne signifie pas que chaque ligne doit apparaître dans une proposition vers La Soie. C16 ne dessert pas Place Henri dans le GTFS ; C9, C16 et 125 ne sont pas forcées dans une correspondance absente ou temporellement incompatible.

## Algorithme et performances

Ce moteur est une **énumération temporelle bornée avec élagage topologique et jointures indexées**. Il n’est pas présenté comme un RAPTOR ou un calculateur exhaustif de tout le réseau.

1. Charger et conserver côté serveur la topologie légère : arrêts/stations, lignes, appartenances arrêt/ligne et transferts. Aucun million d’horaires n’entre dans ce cache.
2. Retenir les lignes directes et les liens de correspondance reliant une ligne du départ à une ligne de l’arrivée.
3. Construire les jours de service potentiels, y compris ceux de la veille/avant-veille lorsque les heures GTFS dépassent 24 h.
4. Rechercher dans SQLite uniquement les tronçons utiles, dans le bon ordre de `stop_sequence`, avec montée/descente autorisées et heures de début/fin présentes.
5. Appliquer calendriers et exceptions pour chaque jour de service, puis comparer les instants absolus des deux tronçons et le minimum de transfert.
6. Éliminer des choix dominés identifiés et sélectionner des alternatives diversifiées. Un changement superflu de tram n’est pas proposé lorsqu’un direct part au moins aussi tard et arrive au moins aussi tôt.

Le classement par défaut privilégie l’arrivée la plus tôt en mode départ, et le départ le plus tardif en mode arrivée. Les critères durée et nombre de correspondances sont également disponibles. La sélection de six alternatives n’est pas une promesse d’énumération exhaustive de toutes les possibilités.

Le plan SQLite mesuré utilise `departures_lookup`, `trips_route`, la clé `(trip_id,sequence)` de `stop_times` et `exceptions_date`. Voir [le plan de requête enregistré](evidence/journey-indexes.json). Une première recherche emploie six requêtes SQL ; les suivantes utilisent deux requêtes, grâce au cache topologique. Les dates, les exceptions et les horaires restent recalculés à chaque demande.

Les garde-fous sont de 256 liens candidats, 20 000 tronçons et 200 000 comparaisons par recherche. En cas de dépassement, le résultat porte `limited`, sans classement partiel annoncé comme complet. Le navigateur ne reçoit que les propositions et les suggestions d’arrêts, jamais le GTFS complet.

## Calendriers, minuit et changement d’heure

Les services récurrents et les exceptions d’ajout/suppression sont joints côté SQL. Les heures ne sont pas réduites modulo 24. Les conversions réutilisent l’origine GTFS « midi local moins douze heures réelles », puis les secondes du jour de service. Une correspondance peut relier une course de la veille à une course du jour suivant ; leurs instants absolus doivent rester compatibles.

Les jours de service sont bornés par la validité de l’import, mais les dernières courses après minuit restent possibles. Aucune répétition de calendrier périmé n’est inventée. La saisie et les résultats distinguent les décalages UTC lors de l’heure répétée d’automne ; une durée positive reste correcte même si les deux heures murales semblent identiques.

## Contrat API

`GET /api/journeys/stops?q=…` : recherche de quais, avec leurs lignes. `id=…` permet de résoudre un identifiant exact de favori. Réponse limitée à vingt suggestions ; aucun arrêt n’est choisi implicitement.

`GET /api/journeys/search` :

| Paramètre | Valeur |
| --- | --- |
| `fromStopId`, `toStopId` | Deux identifiants de quais distincts existants |
| `at` | Instant ISO complet avec fuseau, par exemple `2026-11-09T10:00:00Z` |
| `mode` | `departure` ou `arrival` |
| `marginSeconds` | Entier de 30 à 1 800, défaut 120 |
| `order` | `arrival`, `departure`, `duration`, `transfers` |

Succès HTTP 200 : `{status:'connected',data:RoutingResult}`. `state` vaut `ok`, `no_journey`, `outside_validity` ou `limited`. Les propositions ont `kind:'theoretical'`, les courses/jours/quais source, les heures GTFS et les détails des correspondances. Les métadonnées donnent la validité et l’empreinte de l’import ; les métriques techniques restent disponibles dans l’API et les rapports de validation.

Erreurs : HTTP 400 pour une saisie invalide, 405 pour une méthode autre que GET, 503 si la base ou le calcul ne sont pas disponibles. Aucune erreur ne déclenche de trajet fictif de remplacement.

## Architecture et extensions

- `server/journeys/topology.ts` : graphe et règles de correspondance.
- `server/journeys/schedules.ts` : récupération des tronçons datés, isolée pour une future source d’horaires enrichie.
- `server/journeys/planner.ts` : périmètre, compatibilité temporelle et classement.
- `server/journeys/api.ts` : validation et contrat HTTP.
- `src/types/journey.ts`, `src/services/journeys.ts` : modèles et client applicatif.
- `src/components/JourneyForm.tsx`, `JourneyResults.tsx` : sélection, date, favoris, calcul et présentation.
- `functions/api/journeys/[[path]].ts` : adaptateur Pages Functions avec binding D1 `GTFS_DB`, sans import Node côté Function.

L’API Cloudflare est préparée sans déploiement. Les performances et quotas de D1 Free doivent être mesurés avant publication : deux appels SQL ne signifient pas deux lignes lues. Les limites d’import D1 et de gratuité déjà documentées restent applicables. Le backend SQLite local est synchrone ; ces mesures ne sont ni un test de charge ni une validation d’hébergement Cloudflare.

Une extension aux adresses devra fournir des accès piétons vérifiables entre géocodage et quais ; elle ne reposera pas sur une correspondance de nom. Une extension au temps réel devra remplacer/enrichir la couche d’horaires avec provenance et fraîcheur explicites, après résolution du blocage Grand Lyon. Une recherche à plusieurs correspondances nécessitera un algorithme multi-tours et une nouvelle validation, sans contourner les restrictions actuelles.

## Vérification reproductible

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:journeys
npm.cmd run test:browser
```

Les tests unitaires utilisent des fixtures artificielles uniquement dans des bases en mémoire. Les tests GTFS réels vérifient les trois trajets prioritaires dans les deux modes, les lignes demandées et l’absence du transfert inverse. L’auditeur indépendant relit courses, horaires, séquences, calendriers, exceptions et transferts dans SQLite sans réutiliser l’algorithme de recherche.

Le scénario Edge contrôle les requêtes réellement reçues par React, les heures rendues, la sélection explicite, l’inversion, le tri, les favoris après rechargement, les détails dépliables, les erreurs, le chargement et les formats mobiles 390/320 px. Les temps HTTP sont mesurés sur cinq requêtes chaudes par trajet. Chaque exécution sauvegarde son rapport, ses exemples et ses captures dans `.data/routing-validation-<date>/`. L’ancien parcours Horaires reste contrôlé par `test:browser`.

Aucune modification de l’archive ni de la base importée, aucune activation du temps réel, aucune dépendance ajoutée et aucun changement du numéro public **V0.1**.

## Bilan de validation enregistré

Extension suivante : [Adresses et marche](ADRESSES-MARCHE.md). Les recherches historiques entre quais conservent ce périmètre ; le calcul porte-à-porte et les liens IGN supplémentaires sont séparés et explicitement estimés.

Nouvelle vérification du 8 novembre 2026 : les 135 tests, le linter et la compilation passent à nouveau. Les parcours Edge itinéraires et Horaires passent intégralement ; rapports conservés dans `.data/routing-validation-1794147002831/report.json` et `.data/validation-1794147022077/report.json`. Cette vérification ne modifie ni le moteur, ni les données importées, ni la version publique.

- **135 tests automatisés réussis**, aucun échec ni test ignoré. Les funiculaires **F1 et F2** ont aussi été calculés et audités sur la base réelle, en complément des tests multimodaux en mémoire.
- **27 contrôles de calcul d’itinéraires dans Edge réussis**, y compris ajout/réutilisation/suppression de favori et choix de l’heure répétée. Trois captures desktop/mobile conservées, aucune exception JavaScript.
- **32 contrôles de régression Horaires réussis** : les cinq lignes, quatre arrêts, calendriers, erreurs, mobile et repli GTFS restent validés ; aucune activation du temps réel.
- Compilation TypeScript/Vite réussie et linter sans avertissement.
- Preuve synthétique versionnée : [journey-validation.json](evidence/journey-validation.json).
- Rapport complet itinéraires : `.data/routing-validation-1794146515568/report.json`.
- Rapport de régression Horaires : `.data/validation-1794146138568/report.json`.

Mesure locale sur **cinq requêtes HTTP chaudes par trajet**, sans test de charge. Les chiffres incluent les pointes observées, et ne constituent pas une garantie d’hébergement ou de latence :

| Trajet vers La Soie | Médiane calcul serveur | Médiane HTTP | Maximum HTTP observé |
| --- | ---: | ---: | ---: |
| Place Henri | 124,3 ms | 127,7 ms | 145,9 ms |
| Domrémy-Lacassagne | 122,0 ms | 165,9 ms | 1 683,0 ms |
| Dauphiné-Lacassagne | 452,3 ms | 495,8 ms | 2 465,7 ms |

Les maxima HTTP sont sensiblement supérieurs au calcul serveur dans certaines mesures ; le rapport conserve les deux séries, sans attribuer ces écarts à une cause non mesurée. Les performances Cloudflare, la charge simultanée, Safari/Firefox et les téléphones physiques ne sont pas validés ici.
