# Performances et couverture — V0.1

Une [passe de validation ultérieure](VALIDATION-PERFORMANCES.md) reprend l’audit et les mesures avant toute nouvelle modification, puis réduit le travail géométrique répété à périmètre identique. Le présent rapport conserve les preuves de l’extension initiale.

## Résultat et périmètre

Le moteur utilisateur accepte **une ou deux correspondances**, soit jusqu’à trois véhicules. Le sélecteur est dans le formulaire ; deux est la valeur par défaut des API et de l’interface. Les anciens calculs à une correspondance entre quais restent disponibles pour régression. Les adresses utilisent un calcul commun à tous les accès confirmés, au lieu d’une recherche indépendante pour chaque couple départ/arrivée.

Il n’existe plus de plafond de **quatre quais retenus** par adresse. Tous les quais candidats dans le rayon et les calendriers sont considérés, puis leurs accès sont demandés à IGN dans un budget explicite. Les accès réellement calculés et assez courts sont tous conservés ; ils sont ordonnés par durée et distance réseau. Si le budget empêche d’examiner le reste, la réponse et l’interface affichent **Exploration partielle**. Ce n’est ni une couverture exhaustive ni une garantie d’optimalité globale.

Version publique V0.1 conservée, base et archive non modifiées, aucun paquet ajouté, aucun service payant, aucun déploiement. Le temps réel reste désactivé.

## Audit avant modification

Mesures réalisées sur la base officielle déjà importée, pour le 9 novembre 2026 à 11 h Europe/Paris. L’ancienne implémentation :

1. sérialisait l’ensemble des appels IGN, en ajoutant 260 ms avant chaque appel ;
2. conservait quatre quais par adresse et lançait jusqu’à seize recherches GTFS indépendantes ;
3. relisait les coordonnées et les événements de voisinage à chaque recherche ;
4. n’avait pas de cache des résultats de calcul, seulement du graphe et des réponses IGN ;
5. pouvait géocoder à nouveau le libellé sélectionné, même si son identifiant BAN venait d’être suggéré.

Sur deux adresses, le temps avec cache restait autour de **2,24 s**, dont environ **2,10 s dans SQLite**. Le réseau était déjà en cache, donc une simple accélération d’IGN ne pouvait pas supprimer cette latence.

Rapport initial, conservé sans réécriture : `.data/benchmark-before-1794160060128/report.json`. Chaque cas dispose d’une première exécution avec nouveaux caches applicatifs et de deux répétitions avec les mêmes paramètres. Le cache disque Windows/SQLite n’est pas vidé : « froid » signifie ici **cache applicatif neuf**, pas disque froid.

## Optimisations effectuées

### Réseau et caches

- Une file IGN partagée par processus accepte **deux requêtes simultanées maximum**, avec au moins **260 ms entre les départs**. La concurrence permet de recouvrir les attentes lentes, sans augmenter le débit au-delà de quatre départs par seconde.
- Les [limites officielles](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/) annoncent cinq requêtes/s/IP pour le routage. La file est volontairement plus conservatrice et commune au géocodage et au routage. Elle ne coordonne pas plusieurs processus ou isolates partageant une IP.
- Le géocodage reste valide cinq minutes, les chemins piétons une heure. Deux demandes identiques en vol partagent la même promesse. Les coordonnées ne sont ni arrondies ni rapprochées pour fabriquer un cache commun.
- Une adresse déjà suggérée peut être retrouvée par son identifiant BAN et son libellé officiel en cache : pas de second géocodage inutile. Le client ne peut pas fournir des coordonnées faisant autorité.
- Graphe et coordonnées des quais sont réutilisés ; voisinages temporels et résultats de calcul sont mis en cache pendant **60 s**. Les caches ont des capacités bornées par instance : 256 URL IGN, 256 adresses par identifiant, 64 voisinages et 24 résultats de calcul.
- Le cache du moteur dépend du SHA-256 du GTFS, de l’instant, du mode, de la marge, du nombre de correspondances, des quais et offsets, et des chemins piétons avec leurs dates/versions. Les réponses partielles restent marquées partielles lors de leur réutilisation. Les erreurs IGN ne deviennent pas des chemins en cache.
- Les contextes de résultats envoyés à l’interface contiennent seulement leur proposition concernée, sans recopier les 48 candidats internes dans chaque carte.

### SQL et calcul

Le nouveau moteur traite les accès de départ et de sortie comme des **graines temporelles** d’une seule recherche. La marche initiale et la marge décalent le seuil de montée ; la marche finale recule l’échéance de transport en recherche d’arrivée. Il n’y a plus de produit cartésien de recherches SQL par couple de quais.

Les requêtes chargent par lot les courses réellement embarquables/débarquables aux quais marqués, avec calendriers et exceptions. Les candidats sont matérialisés avant de charger leurs événements. La jointure sur `trips.id` utilise explicitement sa clé primaire existante : l’index par ligne pouvait provoquer des recherches supplémentaires pour chaque ligne de la liste. Les index existants `departures_lookup`, la clé `(trip_id,sequence)` et `exceptions_date` sont réutilisés. **Aucun nouvel index ni changement de schéma n’a été imposé à la base active.**

Le [plan SQL capturé](evidence/routing-query-plan.json) conserve les index réellement choisis. Sur l’exemple Harmonie → Soie, seuls 1 832 événements utiles sont matérialisés sur les trois tours, avec les budgets par quai toujours signalés.

Seuls les événements utiles sont matérialisés : quais de montée marqués, destinations et quais pouvant rejoindre une ligne encore pertinente par un transfert. Retirer les événements intermédiaires non utilisés n’invente pas de trajet : chaque tronçon conserve ses deux séquences et heures réelles de la même course.

Les politiques de correspondance sont mémorisées dans la recherche. Si le GTFS contient des restrictions par course, la clé conserve les identifiants de courses ; sinon elle peut réutiliser la politique par couple de lignes et de quais. Les interdictions, règles les plus spécifiques et ambiguïtés ne sont pas ignorées.

## Choix d’algorithme

L’étude s’appuie sur [RAPTOR — recherche originale](https://www.microsoft.com/en-us/research/publication/round-based-public-transit-routing/) et [CSA — publication KIT](https://publikationen.bibliothek.kit.edu/1000088435).

CSA nécessite une liste de connexions temporelles ordonnées adaptée aux services actifs. Pour ce premier moteur SQLite/D1, charger systématiquement le réseau complet ou produire une grande structure quotidienne augmenterait la mémoire et les lectures. RAPTOR suggère des tours associés au nombre de véhicules ; cependant un `route_id` GTFS ne constitue pas à lui seul un motif de ligne sans branches ni dépassements.

L’implémentation choisie est donc un **parcours de courses par tours, multi-profils, inspiré de RAPTOR**, et non une implémentation annoncée comme RAPTOR canonique ou globalement optimale. Trois tours autorisent deux changements. Chaque tour charge seulement les courses utiles aux quais marqués. Les profils conservent les courses et séquences nécessaires à la reconstruction et aux restrictions de transfert. Le mode « Arriver avant » balaie les courses dans l’ordre inverse des séquences et applique les liens GTFS dans leur sens réel, pas dans le sens du balayage.

Les variantes par chaînes de lignes, profils par quai et ressources sont bornées. Les plafonds peuvent supprimer des alternatives, ce qui est signalé. La sélection finale retire notamment les changements supplémentaires dominés à mêmes quais, départ et arrivée, puis conserve des variantes. Cela ne prouve pas un optimum pour l’ensemble des critères de marche, attente, durée et correspondances.

## Sélection des quais

1. Rayon configurable, **1 200 m par défaut**, utilisé comme filtre géographique de proximité, jamais comme durée de marche.
2. Vérification des événements de montée/descente dans les calendriers et exceptions ; une appartenance nominale à une ligne ne suffit pas. Les nouveaux accès restent limités aux quais de surface actuellement reconnus par la politique du module. Aucun accès métro/funiculaire sans entrée vérifiable n’est créé.
3. Ordre d’examen : corridors tram communs aux deux secteurs, autres lignes communes, puis autres quais proches ; à l’intérieur de chaque groupe, distance géographique. C’est une priorité d’exploration, pas un plafond de deux ou quatre quais. Elle conserve notamment le T3 utile au lieu d’épuiser le budget dans les nombreux arrêts de bus immédiatement voisins.
4. Les demandes initiales/finales sont intercalées de manière déterministe entre les deux adresses. Si les nouveaux transferts piétons sont demandés, une partie du budget est réservée à ces liens. Aucun sens inverse n’est déduit d’un chemin existant.
5. IGN calcule chaque chemin ; seuls les chemins valides, avec profil piéton, unités attendues et durée **≤ 1 200 s par défaut**, sont retenus. Tous ces quais confirmés sont transmis au moteur, ordonnés selon leurs durée/distance réseau.

Les seuils de fiabilité antérieurs restent en place : raccordements au réseau de 25 m maximum, nouveaux liens entre quais distincts de moins de 15 m exclus, pas de distance géométrique présentée comme marche vérifiée. Les nouvelles correspondances IGN restent limitées à six paires orientées candidates dans le budget ; le graphe GTFS officiel n’a pas ce plafond.

Le test automatisé du cinquième quai fait manquer les quatre premiers bus à cause du temps de marche ; seul le cinquième accès permet de monter. Le moteur le trouve. Un budget volontairement réduit produit « limité » et ne remplace pas le chemin absent par une estimation géométrique.

## Instrumentation

Les réponses de mobilité exposent des mesures techniques dans `metrics`, sans les afficher dans le parcours produit :

- `durationMs` : temps mur de l’ensemble de la recherche ;
- `geocodingWallMs`, `walkingWallMs` : phases géographiques, files et attentes comprises ;
- `geocodingMs`, `walkingMs` : sommes des durées des appels fournisseur réellement lancés, incluant lecture et validation ;
- `queueMs` : somme des attentes en file ; les opérations concurrentes peuvent se recouvrir ;
- `sqlMs`, `sqlQueries` : durées/requêtes SQL, y compris la préparation des accès et le moteur ;
- `routingMs` : temps du moteur hors attentes SQL ; ce n’est pas un profil CPU système ;
- `upstreamRequests`, `cacheHits`, `engineCacheHit`, `candidatePlatforms`, `confirmedPlatforms` et `walkBudgetReached` : coûts et couverture observés.

Il ne faut pas additionner les sommes réseau/file pour retrouver le temps mur : des appels se recouvrent. Le script de benchmark ajoute des enveloppes de méthodes identiques avant/après. Son résidu `nonSqlNonProviderMs` n’est exploitable comme décomposition séquentielle que pour l’ancien moteur ; avec concurrence, ce résidu peut être nul et **n’est pas une mesure CPU**. Le rapport préfère alors les phases mur et `routingMs`.

## Mesures avant/après finales

Fichiers complets :

- avant : `.data/benchmark-before-1794160060128/report.json` ;
- après final : `.data/benchmark-after-1794161670477/report.json` ;
- mesure intermédiaire conservée : `.data/benchmark-after-1794160915580/report.json`.

Même archive, mêmes instants et mêmes adresses/quais. **Le travail n’est pas identique** : avant, une correspondance et quatre accès maximum par adresse ; après, deux correspondances et beaucoup plus d’accès dans un budget. Les mesures sont locales, avec un passage froid et deux répétitions chaudes, pas un test de charge ni une garantie de latence.

| Trajet | Avant froid | Après froid | Avant avec cache¹ | Après avec cache¹ |
| --- | ---: | ---: | ---: | ---: |
| Place Henri → Soie, liens IGN | 2 369 ms | 9 735 ms | 105 ms | 19 ms |
| Adresse Lacassagne → quai Soie | 4 570 ms | 16 061 ms | 829 ms | 23 ms |
| Deux adresses | 7 348 ms | 15 218 ms | 2 240 ms | 37 ms |
| T3 long, Dauphiné → Meyzieu | 655 ms | 480 ms | 359 ms | 6 ms |

¹ Moyenne arithmétique des deux répétitions, arrondie. Aucun nouvel appel IGN dans ces répétitions finales. Un essai intermédiaire a eu un appel IGN supplémentaire après une réponse initialement inutilisable : son coût reste dans son rapport, sans être caché.

**Le gain est net avec cache, mais le calcul élargi à froid des adresses est plus lent.** Il serait incorrect de présenter un gain général à froid. La nouvelle couverture nécessite davantage de chemins réels ; la limite du fournisseur impose un temps minimal. La première mesure Place Henri consacre environ 8,65 s à la phase de marche, contre environ 2,09 s avant ; ces attentes ne sont pas attribuées à tort au CPU du moteur.

Pour les deux adresses :

| Poste, passage froid | Avant | Après |
| --- | ---: | ---: |
| Géocodage, phase mur | environ 596 ms | 554 ms |
| Marche IGN et attente en file, phase mur | environ 4 378 ms | 12 911 ms |
| SQLite | 2 136 ms | 874 ms |
| Demandes HTTPS fournisseur | 16 | 50 |
| Quais confirmés au total | au plus 8 | 35 |

Le calcul après atteint environ 825 ms hors SQL pour le moteur dans ce cas, auquel s’ajoutent les traitements de mobilité ; les deux correspondances et la couverture accrue ont un coût. À chaud, SQLite descend à environ 0,5 ms pour cette même recherche grâce au résultat et au voisinage en cache. Pour une adresse → quai, **43 quais au total** sont confirmés, dont le quai destination, au lieu d’un maximum de cinq.

Le trajet T3 déjà validé entre **100 avenue Lacassagne** et **5 avenue des Canuts** reste présent : départ recommandé **11:00:39**, T3 à **11:17:16** depuis Reconnaissance-Balzac 35662, arrivée quai 35668 **11:23:17**, arrivée à l’adresse **11:26:02**, pour la recherche du 9 novembre 2026 à 11 h avec marge 120 s.

## Deux correspondances vérifiées sur le GTFS réel

Harmonie Campus Pro **1138** → La Soie métro **36394**, le 9 novembre 2026, départ demandé 11 h :

| Étape | Heure à Lyon |
| --- | --- |
| C16 direction Charpennes, Harmonie → Charmettes 51 | 11:00 → 11:10 |
| Transfert vers 47030 | minimum GTFS 60 s + marge 120 s ; intervalle 360 s |
| TB11 direction Gare Saint-Paul → Cordeliers 48353 | 11:16 → 11:27 |
| Transfert vers métro 46050 | minimum GTFS 180 s + marge 120 s ; intervalle 386 s |
| Métro A vers La Soie 36394 | 11:33:26 → 11:48:31 |

Les identifiants de courses, séquences, dates de service et règles de transfert sont enregistrés dans le rapport API et contrôlés par l’auditeur SQLite indépendant. TB11 est de type étendu GTFS **702**, affiché comme bus express conformément à la [référence HVT](https://developers.google.com/transit/gtfs/reference/extended-route-types). Aucune correspondance n’est ajoutée pour forcer cet exemple. Le même trajet exact ne donne pas de proposition avec une seule correspondance. Le moteur peut néanmoins signaler une exploration partielle à deux correspondances si son budget de profils est atteint.

## Budgets configurables

Les valeurs par défaut s’appliquent sans configuration manuelle. `.env.example` décrit les paramètres serveur ; ils sont pris en compte par Vite et préparés pour les adaptateurs D1 :

| Paramètre | Défaut | Rôle |
| --- | ---: | --- |
| `ROUTING_MAX_EVENTS` | 240 000 | événements horaires matérialisés, total des tours |
| `ROUTING_MAX_LABELS` | 50 000 | profils intermédiaires |
| `ROUTING_MAX_LABELS_PER_STOP` | 64 | profils conservés par quai/tour |
| `ROUTING_MAX_BOARD_STOPS` | 1 600 | quais marqués par tour |
| `ROUTING_MAX_WALK_REQUESTS` | 48 | demandes logiques piétonnes, cache compris |
| `ROUTING_MAX_ACCESS_SECONDS` | 1 200 | durée maximale d’un accès réseau confirmé |
| `ROUTING_RADIUS_METERS` | 1 200 | rayon du filtre géographique |
| `ROUTING_DEADLINE_MS` | 45 000 | budget de temps mur, contrôlé entre opérations |

Une valeur invalide n’est pas ignorée silencieusement : le calcul retourne une erreur de configuration, les modules Horaires et Favoris restent accessibles. Les plafonds restent bornés par validation. Un lot SQL tronqué est refusé ; seuls les trajets issus des lots complets précédents peuvent être conservés avec l’état limité. Les correspondances continuent d’appliquer leurs minima et marges, même en exploration partielle.

## Cloudflare et gratuité

Les services du moteur n’importent pas Node ; les handlers D1 et les paramètres sont préparés. Cela **ne certifie pas le moteur étendu pour Workers Free**. La [documentation Workers](https://developers.cloudflare.com/workers/platform/limits/) indique notamment 10 ms de CPU, 128 Mo et 50 sous-requêtes pour Free ; les [limites D1](https://developers.cloudflare.com/d1/platform/limits/) doivent aussi être prises en compte. Les paramètres locaux de 48 chemins, le géocodage et les requêtes D1 peuvent dépasser le budget de sous-requêtes, et le calcul local observé dépasse largement 10 ms.

Aucun déploiement ni activation payante n’a été fait. Une publication gratuite nécessitera une autre découpe du travail, des prétraitements/résultats réutilisables et des budgets edge plus stricts, puis de vraies mesures de CPU et de lignes lues. Augmenter un forfait payant n’est pas la solution activée par ce travail. La limitation IGN reste par processus : aucune coordination mondiale par IP n’est prétendue.

## Validation, fichiers et limites restantes

`npm.cmd test`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run test:network`, `npm.cmd run test:journeys`, `npm.cmd run test:browser` et `npm.cmd run test:mobility` constituent les vérifications reproductibles. Le benchmark est `node scripts/qa/benchmark-routing.mjs after`, avec accès HTTPS aux seuls services IGN officiels. L’option `before` est un libellé d’archive ; elle ne restaure pas l’ancien code : la mesure initiale ci-dessus a été prise avant modification.

Les tests couvrent trois véhicules, deux minima exacts, marge trop courte, sens inverse, interdiction spécifique, service absent sur un véhicule intermédiaire, exceptions, dépassement de minuit, changements d’heure, recherche d’arrivée, annulation, caches, cache expiré, erreurs IGN, concurrence/débit, cinquième quai utile et budgets réduits.

Nouveaux fichiers : `server/journeys/network.ts`, `server/journeys/limits.ts`, `tests/network-routing.test.mjs`, `scripts/qa/benchmark-routing.mjs`, `scripts/qa/validate-network.mjs`, `.env.example`, ce rapport et `docs/evidence/performance-coverage.json`.

Modifiés : adaptateurs et API d’itinéraires/mobilité, `server/mobility/provider.ts` et `planner.ts`, types partagés, formulaire et affichage des correspondances, client d’itinéraires, auditeur SQLite et scénarios QA, scripts npm et documentation. Aucun changement du module Horaires, du stockage des favoris, de l’archive, du schéma actif ou du numéro public.

Restent exclus : trois correspondances ou plus, marche seule, nouveaux accès métro/funiculaire sans entrées décrites, garantie terrain/PMR, garantie d’optimalité globale, données temps réel, déploiement gratuit certifié et tests sur téléphones physiques. La fenêtre reste de six heures ; les profils bornés peuvent manquer des variantes. Les caches sont locaux au processus, bornés et temporaires ; ils ne survivent pas au redémarrage. Les suggestions d’adresses utilisent toujours le fournisseur officiel et une panne ne produit aucun chemin approximatif de substitution.

## Bilan final des vérifications

- **165 tests Node réussis**, aucun échec ni test ignoré ; linter sans avertissement ; compilation TypeScript/Vite réussie.
- **12 contrôles réseau/API/navigateur** réussis pour les deux correspondances, la reconstruction de trois véhicules, les deux transferts visibles, les heures rendues, les états partiels et les formats 390/320 px. Rapport : `.data/network-validation-1794162173554/report.json`.
- **18 contrôles live adresses/marche** réussis : plus de quatre accès confirmés, deux modes, deux adresses, conservation de l’arrivée T3 validée, panne IGN explicite, rendu mobile et aucun appel direct au fournisseur depuis le navigateur. Rapport : `.data/mobility-validation-1794161747078/report.json`.
- **27 contrôles de régression du moteur historique** et des favoris réussis : `.data/routing-validation-1794161416401/report.json`.
- **32 contrôles Horaires** réussis : `.data/validation-1794161907145/report.json`. Les captures et l’empreinte de l’archive sont conservées avec ce rapport.
- [Preuve synthétique avant/après et exemple à deux correspondances](evidence/performance-coverage.json).

Les tests navigateur utilisent Edge installé et des profils isolés ; aucune donnée personnelle du navigateur habituel n’est modifiée. Les scripts QA ont été adaptés au champ « Correspondances maximum » et aux résultats partiels ; les heures et règles restent vérifiées indépendamment dans SQLite. Les fichiers d’échec intermédiaires sont conservés, et seuls les derniers rapports explicitement réussis sont cités comme validation finale.
