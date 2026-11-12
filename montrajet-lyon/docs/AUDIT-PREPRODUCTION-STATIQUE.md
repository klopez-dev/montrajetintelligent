# Audit de la préproduction statique — V0.1

Validation locale du **10 novembre 2026**, étape 1/4. **PRÉPRODUCTION PARTIELLEMENT VALIDÉE.** L’autonomie du calcul GTFS est démontrée dans le périmètre testé ; ce verdict ne valide ni une publication distante ni la disponibilité future des fournisseurs.

## Architecture observée

Le dossier de référence `.data/preproduction-1794338634073` existe. Aucun écouteur n’était présent sur le port 53430 ; il n’a pas été repris. Les ports de référence 5173, 4173 et 8787 étaient également sans écouteur lors du contrôle. Aucun service utilisateur n’a été arrêté ou reconfiguré. Chaque essai a utilisé un port libre sur 127.0.0.1.

Le build final est **`.data/preproduction-1794344387115`**. Son serveur `serve-preproduction.mjs` ne fait que servir des fichiers : aucune ouverture SQLite, aucun middleware Vite, aucun relais IGN et aucun endpoint métier. Les chemins HTTP `/api/*` y sont refusés. L’adaptateur de préproduction intercepte ces chemins **dans le navigateur** et échange avec un Web Worker. Les noms `/api/…` dans le code ne désignent donc pas ici une API HTTP distante.

Le Worker utilise `StaticDatabase` et les algorithmes existants compilés pour le navigateur. Les requêtes internes nommées « SQL » sont des opérations sur des index et tableaux en mémoire ; **SQLite n’est pas embarqué ni interrogé pour calculer les résultats affichés**. Dans le script de matrice uniquement, SQLite est ouvert en lecture seule comme oracle de contrôle indépendant, après réception des résultats du navigateur. Il ne participe pas au serveur HTTP.

Les diagnostics bornés à 256 événements attestent l’exécution dans le Worker, les fichiers chargés, les durées de lecture/décompression/indexation et les journées résidentes. Ils ne contiennent ni adresse saisie, ni coordonnées, ni arguments des recherches. Le rapport réseau brut reste local dans `.data` ; la synthèse publiée omet les valeurs des paramètres sensibles.

## Matrice des dépendances

La matrice de douze recherches capture **177 requêtes : 24 locales et 153 IGN**, dont 2 géocodages et 151 calculs piétons. Zéro appel HTTP à une API métier, TCL, fournisseur de tuiles ou autre domaine externe dans cette matrice. Aucun en-tête d’authentification détecté. Les URL de chaque groupe, méthodes, origine page/Worker, statuts, cache et paramètres sont conservés dans [la preuve structurée](evidence/preproduction-step1-controle-final-2026-11-10.json).

| Ressource et domaine | Appel / rôle | Backend métier | Cache / CORS / échec |
|---|---|---|---|
| Même origine : `/experiments/preproduction/index.html` | GET, page | Non | HTML statique ; absence réseau à froid empêche l’ouverture |
| Même origine : `/assets/*.js`, `*.css`, `/favicon.svg` | GET, page ou démarrage Worker | Non | Assets nommés par hash, `immutable` un an ; échec Worker explicite |
| Même origine : `/prototype-data/manifest.json`, `version.json` | GET, Worker | Non | `no-cache` et lectures `no-store` ; vérification de version, pas de résultat inventé en cas d’incompatibilité |
| Même origine : `*.catalog.gz`, `*.events.gz`, `*.trips.gz` | GET, Worker | Non | Taille et SHA-256 contrôlés, décompression bornée ; cache mémoire des journées, pas de copie de toutes les données dans le navigateur |
| Même origine : `/preproduction.json`, `*.consultation.gz` | GET, Worker ; directions et carte à la demande | Non | Configuration `no-store`, annexe vérifiée ; échec de consultation signalé |
| `https://data.geopf.fr/geocodage/search` | GET, Worker ; adresse explicitement recherchée ou revérifiée | Non, appel direct | Réponses CORS réelles, `Access-Control-Allow-Origin: *` observé ; cache applicatif 5 min ; erreur IGN explicite |
| `https://data.geopf.fr/navigation/itineraire` | GET, Worker ; marche sur réseau BD TOPO | Non, appel direct | CORS réel ; cache applicatif 1 h ; cache HTTP privé observé ; timeout, annulation et `Retry-After` respectés |
| `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Aucun dans le build normal ; fond distant désactivé | Non | Variante QA séparée : 22 tentatives bloquées localement, zéro tuile téléchargée ; erreur visible et marqueurs conservés |
| TCL / Grand Lyon | Aucun appel ; lien TCL consultable manuellement | Non pour le périmètre actuel | Trafic et temps réel explicitement indisponibles, aucune annonce périmée recyclée |
| Chemins virtuels `/api/gtfs/*`, `/api/journeys/*`, `/api/mobility/*`, `/api/maps` | Adaptateur local fetch → Worker | Non | Aucun de ces chemins n’a atteint le serveur statique ; erreurs retournées à l’interface |
| Autres services, polices, analytics | Aucun observé | Non | Pas de dépendance supplémentaire identifiée dans les parcours testés |

La première capture a aussi révélé `/favicon.ico` en 404. Le HTML expérimental référence maintenant le favicon SVG existant ; Edge et Firefox finaux demandent `/favicon.svg` et ne demandent plus `/favicon.ico`.

## Sources, gratuité et restrictions

IGN : géocodage officiel BAN via Géoplateforme et routage `bdtopo-osrm`, profil piéton. Les [CGU officielles](https://cartes.gouv.fr/cgu/?lang=fr) décrivent le cadre gratuit des géoservices sous réserve des licences spécifiques. Les documentations [géocodage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) et [itinéraire](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/) indiquent respectivement **50 requêtes/s/IP** et **5 requêtes/s/IP**. Aucun secret, abonnement ou relais n’a été ajouté. Les réponses 200 et CORS sont vérifiées en direct dans les deux navigateurs ; cela ne constitue pas un engagement de disponibilité futur.

La file existante limite à deux requêtes IGN simultanées et espace les démarrages de 260 ms, soit environ 3,85/s **par instance**. Les essais de répétition ont été exécutés en série. Plusieurs onglets ou utilisateurs derrière une même IP pourraient dépasser la limite globale : aucune coordination inter-onglets/IP n’est validée. Aucun quota réel n’a été épuisé pour tester un 429.

Le [règlement des tuiles OSM](https://operations.osmfoundation.org/policies/tiles/) exige notamment attribution et cache et restreint les usages massifs/préchargements. Le build normal les désactive ; la variante de panne QA bloque les URL avant tout téléchargement. Cette mission ne valide pas un usage public illimité du service communautaire.

Les partitions viennent de l’archive locale déjà importée. Aucun renouvellement protégé n’a été tenté. Les conditions de renouvellement et de redistribution restent celles documentées dans [SOURCE-GTFS-DURABLE.md](SOURCE-GTFS-DURABLE.md), sans nouvelle autorisation déduite de cette validation.

## Versionnement : défaut reproduit et corrigé

L’ancien build continuait de déclarer son catalogue connecté après réception d’un pointeur `schema: 99`, à cause de la réutilisation de `StaticConsultation`. Le script `audit-version-consultation.mjs` a reproduit ce défaut puis constaté son refus après correction.

Le Worker revalide désormais un pointeur strict avant les consultations **et les recherches**, contrôle les empreintes du manifeste et du feed, partage une vérification simultanée et libère catalogue, moteurs et annexe en cas de changement cohérent. Une version incompatible, incohérente ou absente échoue explicitement. Le format historique permissif du laboratoire n’autorise plus cette préproduction à ignorer un pointeur absent. Des tests unitaires et navigateur couvrent les refus. Un renouvellement réel vers un nouveau GTFS complet et un rollback distant ne sont pas testés.

Ce durcissement ajoute une lecture de version dans le parcours de recherche, également contrôlé par le runtime. Ce coût mesuré est conservé ; aucun contrôle de fiabilité n’a été supprimé pour accélérer un benchmark.

## Intégrité, périmètre et fichiers

Les SHA-256 finaux de `.data/gtfs.sqlite` et `GTFS_TCL.ZIP` sont identiques aux empreintes de référence, vérifiées par lecture complète. La version publique reste **V0.1**. Aucun fichier de `src/` ni du moteur actif `server/` n’a été modifié. Le build actif a seulement été recompilé pour validation. Aucun déploiement ni service distant créé.

Fichiers modifiés/créés pour cette étape :

- `experiments/preproduction/main.ts`, `worker.ts`, `version.ts`, `index.html` : diagnostics, version stricte et favicon.
- `scripts/prototype/serve-preproduction.mjs` : transformation de réponses contrôlée par le harnais local ; aucun endpoint ajouté.
- `scripts/prototype/build-preproduction.mjs` : option QA explicite `--qa-tile-provider` ; fond toujours désactivé par défaut.
- `scripts/prototype/test-preproduction.mjs`, `bench-preproduction.mjs` : scénarios UI successifs et mesures par phase.
- `scripts/prototype/audit-version-consultation.mjs`, `step1-matrix.mjs`, `step1-resilience.mjs`, `step1-favorites.mjs`, `step1-tile-failure.mjs`, `step1-address-bench.mjs`, `step1-summarize.mjs` : preuves reproductibles.
- `tests/preproduction.test.mjs` : non-régression du pointeur strict.
- Les trois rapports demandés, les synthèses `docs/evidence/preproduction-step1*.json` et leurs entrées, ainsi que les liens README/rapport précédent.

## Démarrage local

Depuis le dossier `montrajet-lyon` :

```powershell
node scripts/prototype/serve-preproduction.mjs .data/preproduction-1794344387115
```

Ouvrir l’URL imprimée par la commande : le port est choisi librement, aucun port d’une autre application n’est modifié. Ce processus est un serveur de fichiers, pas une API d’itinéraires. Les outils de compilation et de contrôle utilisent Node localement, sans en faire une dépendance métier à héberger.

Voir les [résultats fonctionnels](VALIDATION-FONCTIONNELLE-PREPRODUCTION.md) et les [mesures détaillées](PERFORMANCES-PREPRODUCTION.md). Avant publication : téléphone physique, déploiement cohérent/rollback, droits GTFS, coordination des quotas et mémoire sur appareils modestes restent à qualifier. Le trafic non connecté et l’absence d’autonomie hors ligne doivent rester visibles.
