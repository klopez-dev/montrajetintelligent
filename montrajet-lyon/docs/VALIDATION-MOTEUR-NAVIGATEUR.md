# Validation du moteur navigateur — 10 novembre 2026

**V0.1 conservée.** Laboratoire isolé, données GTFS locales officielles déjà importées. Aucun résultat de test synthétique n'est affiché comme un trajet TCL réel.

## Parité des résultats

La comparaison porte sur les objets `state`, `itineraries`, `scope` et `warnings`, notamment courses, lignes, identifiants d'arrêts/quais, directions, séquences, heures, durées, correspondances et ordre des propositions. Seules les métriques instrumentales sont exclues. Les itinéraires des comparaisons principales sont en outre audités contre les lignes SQLite d'origine, calendriers et durées minimales compris.

| Campagne exécutée | Résultat |
|---|---|
| Sept cas × SQLite actif / SQLite compacte / statique × trois passages | 63 exécutions, zéro divergence |
| Direct T3, Place Henri → Soie, Harmonie Campus Pro → Soie | Parité, dont trajet à deux correspondances |
| Arriver avant, après minuit, dimanche, date hors validité | Parité des résultats et de leur état |
| Adresse → adresse, adresse → quai, favori aller au travail, favori retour | Quatre cas, huit exécutions, zéro divergence, zéro clé IGN manquante |
| Edge Worker, cinq répétitions froid/chaud de trois cas + successions | Résultats structurés identiques au moteur SQLite |
| Firefox sur build statique : direct, une/deux correspondances, arriver avant, minuit | Cinq comparaisons structurées identiques à SQLite |

Les adresses/favoris réutilisent les **131 réponses officielles IGN enregistrées lors de la mission précédente**, succès et erreurs inclus. Les deux implémentations reçoivent les mêmes marches. Aucun nouveau parcours piéton n'est fabriqué ou demandé à IGN ; leurs temps de rejeu ne représentent pas le délai d'une requête IGN actuelle. Cette validation reste côté services Node, pas une interface complète d'adresses/favoris transférée dans le Worker.

Les tests déterministes couvrent les calendriers/exceptions, l'absence de service, les arrêts homonymes, les boucles, les restrictions de montée, les transferts orientés et les secondes après 24 h. Les changements d'heure des 29 mars et 25 octobre sont testés avec des fixtures explicitement réservées aux tests, comparées à SQLite et à l'oracle des événements. Le GTFS local commence le 8 novembre 2026 : ces dates de changement d'heure ne sont donc pas présentées comme des observations du flux TCL courant. Le 11 novembre est également comparé sur le GTFS réel via la campagne navigateur ; aucune catégorie « scolaire » n'est déduite d'un identifiant de service. Les tests modélisent explicitement activation/suppression par exception.

## Latences reproductibles

Poste Windows/Ryzen 7/32 Go, Node 24, données HTTP locales. Cinq répétitions à froid par type, nouveau Worker à chaque fois ; cinq répétitions chaudes associées. Les fichiers transitent réellement par HTTP local, mais ce n'est pas un essai Internet.

`Worker` mesure du début de la requête à la préparation du résultat, chargement inclus. `Aller-retour` ajoute la communication et le harnais DevTools, pas le rendu complet de l'application React. La naissance du Worker est mesurée séparément. L'attente de fermeture du sondeur mémoire a été exclue du chronométrage final ; les anciennes campagnes conservées ne servent pas à annoncer un gain sur cette attente.

| Cas | Worker froid médian | Aller-retour médian | Min / p95 / max aller-retour | Worker chaud médian |
|---|---:|---:|---:|---:|
| Direct | 224,7 ms | 226,5 ms | 214,9 / 274,7 / 274,7 ms | 2,9 ms |
| Une correspondance | 914,6 ms | 917,0 ms | 747,0 / 985,9 / 985,9 ms | 3,0 ms |
| Deux correspondances | 218,4 ms | 221,0 ms | 198,3 / 247,7 / 247,7 ms | 3,0 ms |

Avec seulement cinq observations, le p95 empirique correspond au maximum. Ce n'est pas un p95 de production. La difficulté dépend des courses explorées, pas seulement du nombre de correspondances de la proposition retenue.

Initialisation médiane du Worker : 14,3 / 17,5 / 15,6 ms selon le cas ; cette valeur n'est pas incluse dans la colonne de requête. Le premier chargement de code Vite peut bénéficier de la transformation déjà chaude du serveur. Les résultats chauds supposent une requête identique encore dans le cache de 60 secondes ; ils ne promettent pas 3 ms pour une nouvelle destination.

### Phases instrumentées, médianes à froid

| Phase | Direct | Une correspondance | Deux correspondances |
|---|---:|---:|---:|
| Catalogue : lecture + décompression + JSON | 25,6 ms | 29,1 ms | 26,5 ms |
| Lectures HTTP des assets, catalogue compris | 23,5 ms | 15,5 ms | 13,7 ms |
| Digest et décompression des assets | 27,3 ms | 30,8 ms | 27,7 ms |
| Construction des index journaliers | 7,9 ms | 9,8 ms | 8,6 ms |
| Recherche moteur, chargements journaliers inclus | 192,6 ms | 877,1 ms | 171,6 ms |
| Sérialisation JSON diagnostique | 2,9 ms | 2,2 ms | 3,0 ms |

Ces phases **se recouvrent** : ne pas les additionner. La sérialisation JSON diagnostique ne mesure pas à elle seule le structured clone de `postMessage`. Les millisecondes sont des durées murales, pas des compteurs CPU navigateur. Les ressources Node sont mesurées séparément.

### Comparaison répétée avec SQLite actuel

Cinq processus neufs par cas/implémentation, puis deux appels chauds par processus. Temps de recherche à froid ; le chargement initial du catalogue statique est en supplément et figure dans les mesures totales de la preuve JSON. « Froid » désigne ici les caches applicatifs/processus : le cache disque du système d'exploitation n'a pas été vidé.

| Cas | SQLite médiane (min–max ; p95) | Statique médiane (min–max ; p95) |
|---|---|---|
| Direct | 366,8 ms (354,6–380,5 ; 380,5) | 310,9 ms (293,7–326,0 ; 326,0) |
| Une correspondance | 1 355,2 ms (1 321,8–1 537,8 ; 1 537,8) | 882,1 ms (872,4–1 007,5 ; 1 007,5) |
| Deux correspondances | 285,9 ms (278,8–292,2 ; 292,2) | 245,3 ms (241,2–250,4 ; 250,4) |

CPU médian du processus sur le premier calcul : SQLite / statique **593 / 548 ms** en direct, **1 547 / 1 250 ms** avec une correspondance, **376 / 422 ms** avec deux. Il inclut les threads du processus, le JIT et les opérations natives ; il peut dépasser la durée murale et n'est pas un compteur CPU de navigateur ou Cloudflare.

En incluant l'initialisation et les trois appels du processus (un froid, deux chauds), les durées médianes SQLite / statique sont **368 / 377 ms**, **1 357 / 947 ms**, **287 / 311 ms**. Le statique n'est donc pas systématiquement plus rapide au premier usage, même lorsque sa recherche seule est plus courte.

La campagne avant modification mesure respectivement 281 / 937 / 240 ms de recherche statique à froid ; après, 288 / 858 / 238 ms sur la campagne comparable unique. Il n'y a pas d'accélération uniforme démontrée. L'objectif le mieux établi est la baisse des données et de la mémoire. Une campagne v1 avec le nouveau runtime isole l'effet du format : ses temps Worker, distincts de l'ancien code, sont archivés dans la synthèse. Les écarts et l'environnement partagé interdisent de vendre un pourcentage universel de gain.

## Navigateur, erreurs et fonctionnement dégradé

- **Edge 157.0.4341.42**, DevTools, profil isolé. Firefox **159.0.1**, WebDriver BiDi, profil isolé. Firefox utilise des clics DOM programmatiques ; ce n'est pas un test tactile physique. Aucun Chrome/Chromium distinct n'a été trouvé aux emplacements usuels vérifiés ; Edge est fondé sur Chromium, mais ce n'est pas un second navigateur indépendant.
- Build réellement statique servi par un serveur de fichiers QA sans SQLite ni route API : calcul réussi, et aucune requête `/prototype/reference` dans le journal du test statique.
- Vues 390 et 320 px sans débordement horizontal, captures Edge conservées. Rechargement de page réinitialisant le laboratoire vérifié. Le laboratoire n'a pas les sections React de l'application active : la navigation entre ces sections n'est pas une fonctionnalité migrée/testée ici.
- Heartbeat du thread principal final : médiane 16,1 ms, p95 17 ms, maximum observé 25,2 ms. Aucun long blocage n'est observé dans ce harnais léger. Ce n'est pas une preuve sur l'interface React complète avec carte ouverte.
- Ralentissement CPU ×4 accepté pour le thread principal ; aucune preuve de ralentissement équivalent du Worker. L'émulation réseau CDP dans le Worker répond « Not supported » : elle n'est pas annoncée comme réussie.
- Alternative réellement exécutée : serveur local limité à **375 000 octets/s**, délai de **100 ms par réponse de données**, trois chargements froids du build final. Temps perçu par le harnais UI : environ **10,17–10,21 s**, médiane **10,18 s**. Ce test contrôlé ne reproduit ni les pertes réseau ni un réseau mobile réel.
- Erreurs HTTP 503 du manifeste, catalogue et journée vérifiées ; partition altérée refusée par SHA. Worker absent simulé et panne d'exécution réelle d'un Worker de test vérifiés.
- Annulation après confirmation que la requête du manifeste est réellement en cours, puis attente de sa réponse tardive : l'état reste annulé. Une génération ancienne ne peut pas publier ses résultats.
- Si le serveur existant est disponible : un bouton explicite affiche la référence SQLite comme **repli SQLite**, sans la faire passer pour un résultat navigateur. Ce chemin a été testé après HTTP 503. Sur le build purement statique sans backend, seul le message explicite d'indisponibilité est disponible.
- Une saturation physique mémoire n'est pas provoquée : contrôle des volumes et chemin général d'erreur Worker sont testés, pas tous les comportements OOM du système d'exploitation.

## Tests automatisés exécutés

**248 tests réussis, aucun échec**, dont dix nouveaux tests de chargement/versionnement. Les suites existantes couvrent Horaires, Itinéraires, Favoris, Trafic et fonctions cartographiques. Leur exécution ne signifie pas que chaque module de l'application a été retesté visuellement dans tous les navigateurs.

Contrôles également exécutés : `npm.cmd run lint`, TypeScript du laboratoire, `npm.cmd run build`, build statique Vite. Tous réussis. L'avertissement existant sur le gros chunk MapLibre est conservé. Les profils et traces de tests échoués pendant la construction du harnais sont conservés ; les résultats finaux sont ceux référencés par [la synthèse vérifiable](evidence/hybrid-2026-11-10.json).

```powershell
npm.cmd test
npm.cmd run lint
node node_modules/typescript/bin/tsc -p tsconfig.hybrid.json
npm.cmd run build
```

Pas de divergence fonctionnelle inexpliquée dans les scénarios comparés. Cela ne prouve ni l'équivalence sur tous les couples d'arrêts/dates, ni l'optimalité globale du moteur, ni la migration des chemins non couverts.
