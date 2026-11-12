# Parité du périmètre hybride étendu — V0.1

Mission du **10 novembre 2026**. « Complète » désigne la matrice fonctionnelle demandée et la période compilée ; ce n'est pas une preuve sur chaque couple d'arrêts du réseau ni sur tous les appareils.

## Périmètre réellement exécuté

Le runtime utilise désormais **`createJourneyPlanner`**, pas seulement le moteur réseau : l'option historique à une correspondance est conservée. Son adaptateur exécute les jointures de paires d'arrêts, restrictions de montée/descente, séquences, heures, tri et limite de 20 001 résultats du chemin SQL historique. Le moteur actif lui-même n'est pas modifié.

Le planificateur porte-à-porte **`createMobilityPlanner` existant s'exécute dans le Worker** avec le même fournisseur géographique. Un petit protocole HTTP transmet uniquement ses demandes à l'instance serveur de `createIgnProvider`. Il ne géocode pas et ne calcule pas un autre chemin piéton. Les étapes `addresses`, `stops`, `walking`, `connections`, `ranking` et `reuse` sont remontées lorsqu'elles surviennent réellement, sans pourcentage inventé.

Les modèles de favoris existants sont réutilisés (`savePlace`, `saveTrip`, `resolveEndpoint`, `favoriteDraft`, `favoriteSchedule`). Les lieux de référence QA et le favori mixte sont construits dans un magasin séparé en mémoire : **aucun favori de l'utilisateur n'est lu ou écrasé**.

| Parcours navigateur | Résultat |
|---|---|
| Arrêt → arrêt : Dauphiné-Lacassagne → Soie | Propositions et parité |
| Adresse → adresse : secteur Lacassagne → secteur La Soie | Propositions et parité |
| Adresse → arrêt | Propositions et parité |
| Arrêt → adresse | Propositions et parité, exclusions IGN conservées |
| Domicile → travail | Propositions et parité avec marge favorite |
| Travail → domicile | Propositions et parité |
| Favori personnalisé domicile → quai de La Soie | Propositions et parité avec préférences sauvegardées |

Les adresses de référence viennent des réponses BAN via IGN enregistrées : 100 avenue Lacassagne à Lyon et 5 avenue des Canuts à Vaulx-en-Velin. Les noms ne servent pas à associer approximativement des quais. Les identifiants sélectionnés restent explicites.

## Source IGN et déterminisme

La collecte de complément utilise le fournisseur existant, sa limite de deux appels simultanés et sa file de 260 ms. **54 nouvelles demandes de méthode fournisseur**, sous un plafond QA de 80, ont complété les 131 observations antérieures : **185 entrées enregistrées**. Les dates `fetchedAt` et versions des chemins sont conservées. Deux demandes de marche sont refusées par le contrôle d'éloignement du raccordement piéton ; elles ne deviennent pas des liens approximatifs.

Ces 54 demandes ne sont pas un compteur universel de paquets HTTP ni une campagne de charge. Les réponses anciennes ne sont pas présentées comme actualisées. Le collecteur avait aussi testé un favori travail → quai de Dauphiné qui n'a pas fourni de proposition : cette observation reste dans son rapport, et aucune correspondance n'a été ajoutée pour la forcer. Le favori personnalisé du laboratoire final est un autre trajet explicite, domicile → quai de La Soie, qui fournit des propositions.

Les comparaisons navigateur utilisent un **rejeu explicite et visible de réponses officielles**, identiques pour SQLite et le Worker. Une clé manquante échoue ; elle ne déclenche ni interpolation, ni appel source caché. Les campagnes finales ont **zéro clé manquante et zéro appel IGN amont**. L'accès fournisseur et le protocole Worker/relais ont donc été validés, mais pas un parcours navigateur complet en réseau IGN vivant au moment du benchmark. Cette distinction interdit de présenter les délais de rejeu comme des délais IGN actuels.

Le serveur de laboratoire sans option de rejeu emploie le fournisseur en ligne existant. Ce chemin est disponible pour un essai explicite, sans être utilisé pour multiplier les appels pendant les répétitions.

## Comparaisons structurées

La comparaison porte sur tous les champs fonctionnels, y compris les heures, lignes, courses, séquences d'arrêts, directions, durées, marches, attentes, marges, avertissements, états et ordre des propositions. Les métriques de temps sont exclues. Pour la matrice entre arrêts, un oracle indépendant relit en outre les événements, calendriers et transferts SQLite de chaque proposition.

- **121 dates** contrôlées indépendamment pour la couverture et le nombre d'événements.
- **47 recherches entre arrêts**, incluant moteur historique/réseau, sept dates de novembre à mars, jour férié, Noël, jour de l'an, minuit, sens inverse, marge de 600 s et hors validité : **zéro divergence**. États : 20 `ok`, 9 `limited`, 17 `no_journey`, 1 `outside_validity`.
- **Edge : sept catégories × trois répétitions**, comparaison SQLite/Worker explicite : **21 parités**, plus une recherche adresse → adresse « Arriver avant ».
- **Firefox : même matrice**, **21 parités**, plus « Arriver avant ».
- Dates rapides et changement d'heure de départ testés séparément dans Edge, avec résultats comparés à SQLite et cache de trois journées au maximum.
- Tests déterministes sur fixtures identifiées : homonymes, directions, transferts orientés, boucles, heures nulles, restrictions, calendriers et exceptions, après 24 h, changements d'heure Europe/Paris, annulations, concurrence et versions incompatibles.

Les états `limited` et les exclusions de marche restent affichés. Aucun résultat n'est présenté comme optimal à l'échelle du réseau ou comme une estimation temps réel. Les 17 recherches sans trajet, notamment en fin de validité de certaines lignes, correspondent aussi à SQLite : aucune prolongation de service n'est inventée.

## Performances entre arrêts

Poste Windows x64, Ryzen 7 3700X, environ 32 Go de RAM. Cinq Workers neufs par cas, chacun suivi d'une répétition chaude. HTTP local, fichiers complets disponibles ; le cache disque du système n'est pas vidé. Le nombre d'observations est faible : le p95 empirique de cinq valeurs est leur maximum.

| Cas | Aller-retour froid médian | Min / p95 / max | Aller-retour chaud médian | Initialisation médiane séparée |
|---|---:|---:|---:|---:|
| Direct | 224,4 ms | 217,4 / 267,7 / 267,7 ms | 3,9 ms | 21,3 ms |
| Une correspondance | 745,3 ms | 738,1 / 771,0 / 771,0 ms | 3,4 ms | 19,6 ms |
| Deux correspondances | 186,7 ms | 180,4 / 189,1 / 189,1 ms | 4,1 ms | 19,3 ms |

L'aller-retour inclut le protocole de test DevTools ; il ne mesure pas le rendu React complet. Les phases réelles sont instrumentées : sur les 15 calculs froids, catalogue lecture/décompression/JSON médian **25,8 ms**, lectures d'assets **14,0 ms**, digest/décompression **28,3 ms**, index journaliers **7,8 ms**. Les phases se recouvrent et **ne s'additionnent pas**. Les temps de sérialisation et de calcul par cas sont conservés dans les rapports bruts.

## Performances porte-à-porte

Les recherches s'enchaînent sur le même Worker : une première recherche de chaque scénario puis deux répétitions. Les données GTFS et certains services sont donc déjà chauds après le premier cas. Ce n'est pas une série de sept démarrages totalement à froid.

| Cas Edge | Premier Worker du scénario | Médiane Worker des trois essais | p95/max Worker |
|---|---:|---:|---:|
| Arrêt → arrêt | 257,5 ms | 3,9 ms | 257,5 ms |
| Adresse → adresse | 494,2 ms | 34,4 ms | 494,2 ms |
| Adresse → arrêt | 300,9 ms | 42,2 ms | 300,9 ms |
| Arrêt → adresse | 342,0 ms | 41,7 ms | 342,0 ms |
| Domicile → travail | 447,0 ms | 36,1 ms | 447,0 ms |
| Travail → domicile | 561,7 ms | 33,5 ms | 561,7 ms |
| Favori personnalisé | 301,7 ms | 38,6 ms | 301,7 ms |

Le mode **Comparer** attend ensuite le moteur SQLite : ses premiers temps affichés sont donc environ 0,31 à 2,21 s selon le cas. Ce délai additionné est volontairement celui d'un outil de développement, pas le délai normal d'une recherche hybride seule. La sélection SQLite par défaut ne construit aucun Worker ; une sélection hybride seule ne calcule pas aussi une référence SQLite.

Les métriques internes distinguent lecture des partitions, géocodage/marche via relais, requêtes de l'adaptateur et calcul. Pour le rejeu, `upstreamRequests=0` ; les millisecondes de marche sont celles du relais/rejeu, pas celles d'une nouvelle réponse IGN. Les min, max, médianes et p95 par scénario, ainsi que ces métriques internes, sont dans [la preuve JSON](evidence/hybrid-complete-2026-11-10.json).

## Volumes, mémoire et réseau lent

- Recherche GTFS simple froide : **3 515 094 octets** lus, quatre requêtes de données. Les requêtes du relais IGN s'y ajoutent pour les adresses.
- Même date/version résidente : une vérification de **227 octets**, sans nouveau catalogue ni nouveaux événements. Changer de date peut charger deux nouveaux assets, et évincer une ancienne journée.
- Pendant 383 échantillons/points de fin du benchmark entre arrêts : maximum observé de **50,31 Mo de tas Worker**, **93,24 Mo de backing storage**, **1,80 Mo de tas principal**. Les maxima ne sont pas nécessairement simultanés : ne pas les additionner comme un pic physique.
- Après les calculs successifs : 16,31 Mo de tas Worker et 37,00 Mo de backing storage. Après libération et GC forcé de diagnostic : environ 7,80 Mo et 0,337 Mo. Le GC forcé n'est pas une stratégie de production.
- Sur les 21 points de fin porte-à-porte Edge : maximum observé de **51,31 Mo de tas Worker**, **31,54 Mo de backing storage**, **3,70 Mo de tas principal**. Ce ne sont pas des pics transitoires de décompression.
- Aucun accès à la RSS exacte du Worker ni mesure sur téléphone. Les buffers natifs et les pics entre échantillons peuvent échapper à CDP ; aucune absence de fuite à long terme n'est prouvée.
- Trois essais du build statique bridé à **375 000 octets/s + 100 ms par réponse de données** : min **10 202,7 ms**, médiane **10 219,1 ms**, p95/max **10 220,8 ms**. C'est une simulation locale, pas une mesure sur Internet.
- Ralentissement CPU ×4 accepté pour le thread principal. Le ciblage du Worker répond « Operation is only supported for pages, not workers » ; le CPU Worker n'est donc pas annoncé comme ralenti. L'émulation réseau CDP Worker est aussi indisponible ; le bridage du serveur de fichiers est réellement utilisé.

## Navigateurs et robustesse

**Edge 157.0.4341.42 et Firefox 159.0.1**, profils de test isolés. Les vues **1440, 768, 390 et 320 px** sont contrôlées sans débordement horizontal, avec captures. Firefox emploie des clics DOM automatisés ; Edge des clics natifs DevTools. Aucun smartphone physique n'a été testé. Chrome/Chromium distinct n'a pas été trouvé dans les emplacements/PATH contrôlés ; Edge ne compte pas comme un second Chrome indépendant.

Pendant les requêtes porte-à-porte, le heartbeat principal atteint au maximum **27,9 ms dans Edge** et **21 ms dans Firefox** dans les campagnes finales. Un intervalle proche de **80 ms** apparaît dans la séquence Edge comprenant les changements de viewport et captures : il n'est pas masqué ni attribué sans preuve au moteur GTFS. Le diagnostic complet reste accessible à la demande ; son affichage automatique évite les copies répétées des mêmes résultats de référence.

Tests exécutés : HTTP 503 de catalogue/manifeste/partition, partition corrompue, checksum, expansion trop grande, schéma incompatible, pointeur de version incohérent, échec d'un paquet partagé puis reprise, Worker interrompu, annulation, dernier résultat gagnant et concurrence refusée côté runtime. La mémoire insuffisante est simulée par un constructeur Worker levant `QuotaExceededError` ; aucune saturation réelle du système n'a été provoquée.

Les parcours adresses/favoris conservent le résultat précédent en cas d'échec et montrent l'origine du relais. Les données théoriques ne sont jamais rebaptisées temps réel. Le repli SQLite explicite du premier laboratoire reste disponible quand le serveur existe ; le build statique isolé ne peut pas inventer ce backend.

**257 tests automatisés réussis, aucun échec**, comprenant les suites Horaires, Itinéraires, Favoris, Trafic et cartographie existantes. Lint, TypeScript, build actif et build du laboratoire réussis. Le gros chunk MapLibre conserve son avertissement existant. Cette non-régression automatisée ne remplace pas une validation visuelle exhaustive de tous les écrans de l'application active.
