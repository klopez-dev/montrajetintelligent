# Carte interactive — MonTrajet Lyon V0.1

## 1. Architecture et audit

La carte complète le moteur existant, sans modifier les horaires ni les calculs. `JourneyResults` et `MobilityResults` proposent une sélection explicite de proposition. `JourneyMapSlot` charge le composant à la demande ; `JourneyMap` charge ensuite MapLibre. Aucun téléchargement de bibliothèque ni de tuiles n'est déclenché avant cette action.

L'API `POST /api/maps` ne reçoit que les références des courses sélectionnées, les identifiants exacts des quais et leurs séquences, ainsi que l'empreinte du GTFS utilisé par le calcul. Elle retourne les arrêts ordonnés de trois courses au maximum, pas la base entière. L'empreinte doit correspondre au GTFS actif ; les références invalides sont refusées. Les requêtes sont limitées à 12 Ko, les portions à 400 arrêts et les requêtes SQL utilisent la clé `(trip_id, sequence)` existante.

Le complément `.data/map-catalog.json`, créé à partir de l'archive locale officielle, conserve les couleurs. Sa SHA-256 est comparée à celle de SQLite. Aucune archive ni base active n'est remplacée. Le script refuse de remplacer un complément différent. L'absence du complément n'empêche pas la carte : elle utilise alors une couleur de remplacement signalée. Le gestionnaire d'API dépend de `QueryDatabase`, compatible avec l'abstraction D1 existante ; le raccordement livré concerne le backend local, sans déploiement Cloudflare.

## 2. Bibliothèque cartographique

MapLibre GL JS **6.17.0**, installé depuis npm, est chargé dynamiquement et utilise WebGL. Zoom, déplacement, clavier, commandes de navigation et attribution sont conservés. L'instance et ses marqueurs sont supprimés au démontage. Les gestes coopératifs évitent de capturer le défilement mobile à un doigt. Le recentrage n'anime pas le déplacement, y compris avec la préférence de réduction des animations.

## 3. Fond de carte

Le fournisseur actuel est OpenStreetMap raster : `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Aucune clé, carte bancaire ou abonnement. `VITE_MAP_PROVIDER=none` permet une vue sans fond distant ; le défaut est `osm`. La configuration est centralisée dans `src/services/mapProvider.ts`. Une URL arbitraire ou une clé secrète n'est pas acceptée.

L'utilisation retenue est interactive et modérée : uniquement après ouverture de la carte, aucune collecte massive, cache hors ligne ou prélecture. Le cache HTTP du navigateur est laissé intact, sans `no-cache`. Le navigateur envoie ses en-têtes habituels, dont Referer ; ne pas ajouter une politique qui le supprime pour ce fournisseur. L'attribution est visible et un lien de signalement est proposé. Zoom maximal 18 et navigation bornée à la région du réseau.

Les serveurs publics OSM ne fournissent ni quota numérique garanti ni SLA. Ils peuvent limiter/bloquer un usage excessif. Avant diffusion à grande échelle, réévaluer le fournisseur et la politique ; cette intégration locale ne constitue pas une autorisation d'usage massif. Le fond transmet nécessairement au fournisseur l'IP et les coordonnées des tuiles visibles, pas le texte des adresses sauvegardées.

## 4. Licences et conditions

Sources officielles consultées le 9 novembre 2026 :

- [MapLibre : licence BSD et mentions des composants](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt). La licence complète du paquet installé est copiée sans modification dans `public/licenses/maplibre-gl.txt`, donc également dans `dist/licenses/maplibre-gl.txt` après compilation. Ces mentions doivent accompagner toute redistribution.
- [Politique d'utilisation des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/) : attribution, cache, identification, absence de téléchargement massif et disponibilité sans garantie.
- [Données OSM et attribution, ODbL](https://www.openstreetmap.org/copyright).
- [CGU IGN](https://cartes.gouv.fr/cgu/) et [limites d'usage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/) : la marche utilise les services existants, sans appel supplémentaire pour la carte. La documentation indique 10 requêtes/s/IP pour le calcul d'itinéraire ; les contrôles existants ne sont pas désactivés.

Les conditions des données TCL sont celles du GTFS officiel déjà importé et documenté par le projet. Aucun jeu tiers de lignes TCL n'a été ajouté.

## 5. Géométries TCL : limite vérifiée

Archive examinée : `GTFS_TCL.ZIP`, empreinte `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`.

- **Pas de `shapes.txt`.**
- La colonne `shape_id` existe dans `trips.txt`, mais **aucune des 140 442 courses n'a de shape renseignée**.
- **807 couleurs de lignes** valides présentes dans `routes.txt`, récupérées dans le complément serveur.
- SQLite conserve les coordonnées des quais et les séquences des horaires, mais ni shapes ni couleurs dans son schéma actuel.

La carte représente donc les **arrêts officiels ordonnés uniquement**, sans lignes de transport dessinées. Aucun segment droit n'est présenté comme tracé réel. Le sens vient de la course et des séquences, jamais d'un rapprochement des noms ou d'une inversion de géométrie. Les arrêts répétés restent distincts par leur séquence. Les quais sans coordonnées valides sont omis de la carte et restent dans le texte du résultat.

`sliceMeasuredShape` prépare une extraction prudente pour une extension future : distances explicites strictement ordonnées, bornes exactes, refus des ambiguïtés. Elle est testée sur boucle et point répété mais **n'active aucune shape dans cette version**. Un futur import de shapes demandera une adaptation du schéma et une preuve de l'association aux arrêts ; aucune garantie actuelle sur ce futur traitement.

## 6. Géométries piétonnes

Les `WalkPath` existants contiennent déjà un GeoJSON `LineString`, fourni par IGN BD TOPO via `bdtopo-osrm`, en `EPSG:4326`, ordre longitude/latitude. Le fournisseur existant valide CRS, unités, profil, coordonnées et raccordements au réseau. La carte revalide le GeoJSON et réutilise ces points sans conversion ni appel IGN.

Accès, sorties et correspondances IGN apparaissent en pointillés, avec distance et durée estimée conservées. Une correspondance GTFS sans détail piéton est affichée comme étape textuelle sans trait. Les raccordements IGN au point demandé, pouvant atteindre les seuils admis par le moteur, ne sont pas inventés ou dessinés ; les marqueurs de marche représentent les extrémités du réseau IGN disponible, pas une porte d'immeuble certifiée.

## 7. Couverture réellement cartographiable

Toute proposition du moteur possédant des références de courses/quais encore valides peut afficher ses arrêts disponibles. Tous les modes utilisent les mêmes règles ; la carte nomme le mode et la ligne, sans dépendre uniquement de la couleur. **Couverture des tracés de transport : 0 % sur cette archive.** La disponibilité d'une marche dessinable dépend d'une géométrie IGN déjà validée dans la réponse. Aucune exhaustivité géométrique du réseau n'est revendiquée.

## 8. Fonctionnalités et robustesse

Chaque proposition a un bouton « Voir sur la carte ». La proposition choisie est encadrée ; une autre sélection remplace les arrêts et les étapes. La liste textuelle cartographique et les marqueurs partagent la sélection d'étape. Les informations contextuelles donnent ligne, mode, direction, quais, heures, durée et limites géométriques. Départ/arrivée représentés et correspondances sont identifiés ; les résultats textuels détaillés préexistants restent disponibles.

L'API cartographique est différée et les réponses sont réutilisées dans une petite mémoire locale au composant, limitée à 20 sélections et liée à l'empreinte GTFS. Une sélection suivante annule la récupération précédente, efface immédiatement ses marqueurs et vérifie un numéro de génération avant affichage. La fermeture de la carte démonte l'instance. Une recherche en cours conserve les résultats valides selon le comportement existant ; la carte reste celle du résultat encore affiché, jamais celle d'une réponse annulée.

Une erreur de tuiles est signalée sans supprimer le texte. L'absence de WebGL ou l'échec de chargement de la bibliothèque laisse également les résultats textuels disponibles. Les boutons d'étapes restent accessibles au clavier et la carte n'est jamais nécessaire à la compréhension du trajet.

## 9. Tests automatisés

La référence avant modification était de **216 tests réussis**. La suite contient désormais **225 tests réussis**, dont neuf nouveaux : coordonnées invalides, GeoJSON piéton, portion mesurée orientée, boucle et arrêts répétés, absence de shapes, géométrie piétonne absente, conservation des distances/durées, distinction des courses/quais, remplacement des étapes, configuration du fournisseur et API contre la vraie base SQLite. Les fixtures artificielles sont exclusivement dans les tests, jamais dans les résultats de l'application.

## 10. Tests navigateur

Le script `scripts/qa/validate-map.mjs` utilise Edge et un profil QA isolé, les vrais calculs GTFS et les services IGN pour les succès. Seule une panne de tuiles est injectée pour vérifier l'erreur. Il couvre T3 direct, une correspondance, deux correspondances, quatre combinaisons adresse/arrêt, changement de proposition, sélection d'étape/marqueur, zoom, recentrage et largeurs 1440/768/390/320 px. Il compte les requêtes pour vérifier qu'ouvrir la carte ne déclenche aucun nouvel appel de géocodage ou de marche.

Les résultats et mesures définitifs des exécutions figurent dans la section de validation ci-dessous. Les suites Horaires, Itinéraires, Favoris, Trafic et Mobilité restent les bancs de non-régression.

Non-régressions réexécutées après intégration, **toutes réussies** :

| Suite | Contrôles | Rapport sous .data |
| --- | ---: | --- |
| Favoris intelligents | 17 scénarios + 6 suites intégrées | favorites-validation-1794249896396/report.json |
| Réseau | 12 | network-validation-1794250000169/report.json |
| Itinéraires | 27 | routing-validation-1794250013653/report.json |
| Horaires | 32 | validation-1794250033618/report.json |
| Mobilité IGN | 18 | mobility-validation-1794250060535/report.json |
| Trafic | 9 | traffic-validation-1794250094091/report.json |
| Expérience à froid | 9 | experience-validation-1794250107663/report.json |

Total : **124 contrôles API/navigateur de non-régression**, en comptant les 17 scénarios Favoris et les contrôles des suites filles, sans recompter les six marqueurs de réussite de leur orchestration. Sont notamment revérifiés l'annulation pendant une vraie marche IGN, la conservation des résultats, les réponses obsolètes, les changements d'heure, les horaires GTFS, le stockage après fermeture/réouverture et les erreurs fournisseurs. Les 225 tests automatisés restent réussis ; linter et compilation finale également. L'avertissement Vite de taille du chunk MapLibre est conservé.

## 11. Performances

Le calcul d'itinéraire est inchangé : l'API carte intervient seulement après calcul et clic explicite. Aucun travail cartographique n'est ajouté au chemin critique IGN/GTFS. Les mesures affichent séparément récupération des arrêts, initialisation et premier rendu après mise à jour. L'initialisation comprend la bibliothèque et le chargement initial du fond, et peut varier selon le réseau ; ce n'est pas une mesure CPU seule. La taille et les mesures finales sont indiquées ci-dessous, sans promesse de résultat instantané.

## 12. Taille du bundle

Avant : application JS 311,40 Ko, 94,67 Ko gzip ; CSS 18,34 Ko, 4,85 Ko gzip.

Compilation finale : application JS **314,82 Ko, 96,05 Ko gzip** ; CSS 19,65 Ko, 5,15 Ko gzip. Chargés uniquement à l'ouverture : composant carte 10,58 Ko / 4,49 Ko gzip, CSS MapLibre 71,33 Ko / 10,25 Ko gzip, MapLibre **1 078,23 Ko / 292,64 Ko gzip**. L'ajout initial est donc de 1,38 Ko gzip en JS et 0,30 Ko gzip en CSS ; le reste est différé. Vite signale ce gros chunk différé ; l'avertissement n'est pas masqué. Aucun changement de version publique.

### Mesures et preuve de validation

Rapport Edge complet : `.data/map-validation-1794249690083/report.json`, **19 contrôles réussis**, aucune exception JavaScript, captures des quatre largeurs. Le contrôle ciblé après traduction des commandes et amélioration des marqueurs est également réussi dans `.data/map-validation-1794249845311/report.json` (9 contrôles). Il comprend sélection rapide avec récupération précédente annulée et trajet favori recalculé. Les assertions attendent le rendu de la bonne proposition, pas seulement la présence d'une ancienne carte.

L'alternative `VITE_MAP_PROVIDER=none` est vérifiée dans Edge : `.data/map-validation-1794250135628/report.json`, **9 contrôles réussis**, zéro demande de tuile, marqueurs et étapes conservés, sélection de proposition, annulation de récupération obsolète, favori, zoom, recentrage et quatre largeurs. Elle fournit une vue géographique sans rues ni repères de fond ; elle ne prétend pas remplacer un fond cartographique complet.

L'exécution initiale `.data/map-validation-1794249350747` conserve un statut d'échec du banc de test : ses quinze contrôles de parcours avaient réussi, mais l'assertion finale tentait de sérialiser un élément DOM au lieu d'un booléen. Cette assertion a été corrigée puis la suite entière a réussi ; le premier rapport n'a pas été réécrit.

Mesures navigateur de l'exécution complète, après sélection des lieux. Le temps de calcul commence au clic Rechercher et exclut la saisie/autocomplétion préalable. Ce sont des observations, pas une comparaison statistique avant/après optimisation du moteur :

| Cas | Recherche jusqu'aux résultats | Arrêts/API carte | Premier rendu après mise à jour | Ouverture carte, contrôle navigateur |
| --- | ---: | ---: | ---: | ---: |
| Place Henri → Soie, une correspondance | 1 460,9 ms | 25,3 ms | 23,0 ms | 55,9 ms |
| Harmonie Campus Pro → Soie, deux correspondances | 382,9 ms | 34,5 ms | 14,7 ms | 60,4 ms |
| Adresse Lacassagne → adresse Canuts | 14 865,1 ms | 22,4 ms | 23,3 ms | 142,4 ms |
| Adresse Lacassagne → quai Soie | 9 727,7 ms | 1,8 ms, réutilisation | 22,6 ms | 61,9 ms |
| Quai Dauphiné → adresse Lacassagne | 22 859,4 ms | 34,2 ms | 11,4 ms | 53,3 ms |

Les initialisations des instances directes et porte-à-porte ont été mesurées à 79,9 et 69,4 ms dans cette exécution après première utilisation. Une première ouverture observée lors de la validation initiale prenait 725,1 ms au navigateur, dont 368,2 ms d'initialisation. Ce ne sont pas des bornes garanties. La carte n'est ouverte qu'après les résultats : le calcul à 22,9 secondes ci-dessus était déjà terminé avant son initialisation.

Un microbenchmark local séparé, sans aucun appel réseau, mesure le gestionnaire API + SQLite sur six lectures successives pour chacune des lignes T3, C13, C9, C16 et 125 : `.data/map-api-benchmark.json`. Assemblage SQL : 0,40 à 0,93 ms sur ces portions ; gestionnaire avec construction/sérialisation de la réponse : 0,55 à 1,34 ms après le premier démarrage. La toute première exécution prend 25,77 ms, initialisation des objets HTTP comprise. Les réponses échantillonnées représentent 1,1 à 4,3 Ko, de 6 à 36 arrêts. Ce test ne mesure pas une API distante ni la totalité des courses de ces lignes.

Aucun appel supplémentaire de géocodage ou de marche au clic carte, vérifié par le compteur réseau pour chaque ouverture. Le rapport complet compte 12 requêtes locales carte, 90 demandes de tuiles au cours des ouvertures/zooms, y compris les demandes volontairement mises en échec, et 15 requêtes frontend au service de mobilité dues aux recherches explicites. Les appels amont internes du moteur restent ceux des recherches existantes ; ces compteurs ne doivent pas être confondus.

## 13. Limites restantes

Il s'agit d'une carte des arrêts et des marches disponibles, **pas d'une carte complète des tracés TCL**. Sans shapes officielles, aucun tracé bus/métro/tram/funiculaire ne peut être vérifié. La sélection ne fournit pas de nouveau moteur, géocodage, itinéraire piéton, accessibilité terrain ou temps réel. Les tuiles publiques restent un service sans garantie et exigent une réévaluation avant montée en charge. WebGL est nécessaire au rendu interactif ; le texte reste le repli.

Le cache géographique ne persiste pas les adresses et est limité à la durée de vie du composant. Les résultats de mobilité existants contiennent déjà les marches de leurs propositions ; aucune refonte de ce volume n'est introduite. Le complément des couleurs doit correspondre à l'archive active après un prochain import ; sinon les couleurs de remplacement sont indiquées. Aucun branchement ou déploiement Cloudflare n'a été validé.

## 14. Fichiers créés ou modifiés

- `src/types/journeyMap.ts` : contrat cartographique.
- `src/services/mapGeometry.ts`, `src/services/mapProvider.ts` : validations et configuration.
- `src/components/JourneyMap.tsx`, `src/components/JourneyMapSlot.tsx` : carte et chargement différé.
- `src/components/JourneyResults.tsx`, `src/components/MobilityResults.tsx`, `src/App.css` : intégration et responsive.
- `server/maps/api.ts`, `server/gtfs/local.ts` : API locale bornée.
- `scripts/gtfs/map-catalog.mjs` : extraction contrôlée des couleurs et audit de l'archive.
- `tests/journey-map.test.mjs`, `scripts/qa/validate-map.mjs`, `scripts/qa/benchmark-map.mjs` : tests et mesures reproductibles.
- `package.json`, `package-lock.json` : dépendance libre MapLibre.
- `public/licenses/maplibre-gl.txt` : licence complète redistribuée avec les fichiers compilés.
- `.data/map-catalog.json` : complément serveur local, non exposé au navigateur en entier.
- `README.md`, `.env.example`, `docs/CARTE-INTERACTIVE.md` : documentation.

Commandes : `npm.cmd run dev` pour lancer l'application, `node scripts/qa/validate-map.mjs` pour la validation explicite. Pour une archive déjà importée et vérifiée : `node scripts/gtfs/map-catalog.mjs` prépare les couleurs sans remplacer la base ; cette opération a déjà été exécutée pour l'archive active.
