# Audit complet de gratuité — MonTrajet Lyon V0.1

Vérifié le **9 novembre 2026**. Verdict : **ARCHITECTURE À REVOIR** pour publier l'application complète avec un coût obligatoire de 0 €. L'application locale reste utilisable ; aucun déploiement, compte, achat, abonnement, changement de version ou remplacement de base n'a été effectué. Le diagnostic ne constitue pas une certification d'un environnement Cloudflare.

Voir aussi [l'architecture proposée](ARCHITECTURE-CIBLE-GRATUITE.md) et le [plan de finalisation](PLAN-FINALISATION.md).

## 1. Inventaire technique et dépendances

Le projet effectif est **`montrajet-lyon/`**, sous le dossier actuellement ouvert. Le dossier parent conserve un ancien `src/` et un package limité à lucide-react : ils ne constituent pas l'application exécutée et n'ont pas été supprimés.

| Composant | Réalité du code | Verdict pour la cible gratuite |
| --- | --- | --- |
| React 19.3.1, TypeScript, Vite 8.3.6, lucide-react | Frontend statique, interface française, responsive ; version affichée V0.1, package 0.0.0 | **COMPATIBLE GRATUITEMENT** pour les fichiers statiques |
| Backend local | Plugin Vite `server/gtfs/local.ts`, Node 24, `node:http`, `node:sqlite`, fs/path/url, lecture SQLite persistante | **INCOMPATIBLE AVEC L'OFFRE GRATUITE** en portage direct de ce serveur local vers Workers ; pas de serveur de production autonome fourni |
| SQLite GTFS | Fichier local en lecture seule ; tables horaires, calendriers, exceptions, transferts et index | **COMPATIBLE SOUS CONDITIONS** de transformation/import/quota ; pas un fichier à embarquer tel quel dans un Worker |
| Itinéraires | Tours inspirés de RAPTOR, profils multiples, SQL filtré, jusqu'à deux correspondances, six heures ; ancien périmètre à une correspondance conservé | **INCOMPATIBLE AVEC L'OFFRE GRATUITE** pour une transposition directe dans une requête Workers Free ordinaire ; CPU et mémoire à revoir |
| Horaires | SQL théorique, calendriers/exceptions, après-minuit, dates et fuseau Europe/Paris | **COMPATIBLE SOUS CONDITIONS**, mesures du runtime cible et données adaptées nécessaires |
| BAN / IGN | `fetch` serveur, URLs fixes, sélection explicite, deux requêtes actives, espacement 260 ms par processus | **COMPATIBLE SOUS CONDITIONS**, quotas globaux et cache distribué absents |
| Marche IGN | GeoJSON WGS84, distance/durée réelles estimées, budget 48 parcours, raccordement contrôlé | **COMPATIBLE SOUS CONDITIONS**, mêmes réserves ; une recherche peut mobiliser presque tout le budget externe d'une invocation |
| Trafic TCL | Lecture HTML non commerciale, contrôle robots/mentions, extraction conservatrice, couverture partielle | **COMPATIBLE SOUS CONDITIONS**, pas d'autorisation de collecte massive ni de contrat HTML stable |
| Temps réel Grand Lyon | Préparé, désactivé ; configuration exige droits et correspondance confirmés | **NON VÉRIFIÉ** pour un accès utilisable ; GET sans authentification revérifié HTTP 401 |
| Favoris | Une clé localStorage, migration, validation, domicile/travail et références exactes, aucun résultat mémorisé comme courant | **COMPATIBLE GRATUITEMENT**, stockage local au profil, non chiffré et sans sauvegarde garantie |
| MapLibre 6.17.0 | Chargement différé, marches IGN et arrêts seulement ; pas de shapes officielles | **COMPATIBLE GRATUITEMENT** pour la bibliothèque et le mode sans fond distant |
| Fond OSM | Tuiles publiques, attribution, consultation interactive, pas de prélecture | **COMPATIBLE SOUS CONDITIONS**, pas de disponibilité ni de quota chiffré garantis |
| Adaptateurs Cloudflare | Cinq familles Pages Functions : GTFS, itinéraires, mobilité, trafic, temps réel ; interface minimale D1 | **NON VÉRIFIÉ** dans le runtime cible ; **adaptateur `/api/maps` absent** |
| Import/export | Node fs/zlib/crypto/SQLite, CSV en flux, ZIP CRC, index ; sorties neuves et préservation de l'actif | **COMPATIBLE GRATUITEMENT** sur la machine locale existante ; pas dans un Cron Workers ordinaire |
| Tests/documentation | node:test, contrôles SQLite réels, pilotes Edge/CDP locaux | **COMPATIBLE GRATUITEMENT** localement ; CI et compte distant **NON VÉRIFIÉS** |

Le serveur de développement et `vite preview` ne sont pas une offre d'hébergement de production. Les caches `Map`, `WeakMap`, promesses partagées, formatteurs Intl et files d'attente ont une portée processus/isolate. Leur persistance et leur partage mondial ne sont pas acquis. Le trafic possède en local un cache disque atomique ; la Function Trafic ne reprend pas cette persistance. Seul le client temps réel prévoit déjà un adaptateur Cache API, mais il reste désactivé.

Les caches IGN sont bornés à 256 entrées, les résultats du moteur à 24 entrées/60 secondes ; les recherches identiques sont regroupées et les travaux concurrents bornés. En revanche, les `neighborhoods` et `transferCandidates` du planificateur mobilité ne possèdent pas de plafond d'entrées : une date/heure nouvelle peut créer une nouvelle clé. Leur nettoyage dépend surtout du changement de GTFS. C'est un risque mémoire avant publication.

## 2. Limites Cloudflare Free vérifiées

Les chiffres suivants proviennent des pages officielles consultées le 09/11/2026, pas d'une configuration réellement provisionnée. Ne pas les remplacer par des limites historiques de forfaits anciens.

| Produit / dimension | Limite ou comportement Free vérifié | Source |
| --- | --- | --- |
| Workers HTTP | 100 000 requêtes/jour, 10 ms CPU/invocation, 128 MB mémoire/isolate | [Limites Workers](https://developers.cloudflare.com/workers/platform/limits/) |
| Réseau Workers | 50 sous-requêtes externes ; 6 connexions simultanées en attente des en-têtes ; services internes comptés séparément selon produit | [Limites Workers](https://developers.cloudflare.com/workers/platform/limits/#subrequests) |
| Code Worker | 64 MiB **non compressés**, démarrage global 1 seconde ; absence de limite compressée dans la documentation actuelle | [Taille et démarrage](https://developers.cloudflare.com/workers/platform/limits/#worker-size) |
| Cron Free | 5 déclencheurs/compte ; budget CPU 10 ms ; durée murale maximale 15 minutes, qui ne remplace pas le budget CPU | [Limites Workers](https://developers.cloudflare.com/workers/platform/limits/) |
| Dépassement | CPU/mémoire : erreur 1102 ; limite quotidienne : erreur 1027 selon routage ; pas un passage automatique au forfait payant | [Erreurs et limites](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers Static Assets | Requêtes statiques gratuites, sans coût de stockage additionnel ; 20 000 fichiers, 25 MiB/fichier ; `run_worker_first` consomme le quota dynamique et peut retourner 429 | [Facturation des assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) et [limites assets](https://developers.cloudflare.com/workers/platform/limits/#static-assets) |
| Pages Free | 500 builds/mois, un build à la fois, arrêt après 20 minutes ; 20 000 fichiers, 25 MiB/fichier | [Limites Pages](https://developers.cloudflare.com/pages/platform/limits/) |
| Pages Functions | Même enveloppe quotidienne dynamique que Workers, pas un second quota indépendant | [Tarification Functions](https://developers.cloudflare.com/pages/functions/pricing/) |
| D1 stockage | 10 bases, 500 MB/base, 5 GB au total, Time Travel 7 jours | [Limites D1](https://developers.cloudflare.com/d1/platform/limits/) |
| D1 usage | 5 millions de lignes lues/jour ; 100 000 écrites/jour ; index compris dans le coût et le stockage ; dépassement : requêtes refusées | [Tarification D1](https://developers.cloudflare.com/d1/platform/pricing/) |
| D1 requêtes | 50 appels par invocation Free ; 100 paramètres ; SQL 100 KB ; cellule/ligne 2 MB ; résultat 50 MB ; durée requête 30 s | [Limites D1](https://developers.cloudflare.com/d1/platform/limits/) |

Les attentes réseau/D1 ne sont pas du CPU Worker. Inversement, une promesse ou un flux NDJSON ne rend pas gratuit le calcul JavaScript. Les appels D1 ne doivent pas être additionnés aveuglément aux 50 appels externes : le produit a ses propres limites. `batch()` peut réduire le nombre d'appels, pas les lignes lues/écrites.

Cloudflare annonce le démarrage gratuit [sans carte bancaire](https://www.cloudflare.com/products/workers/). Aucun compte n'a été créé/inspecté : l'éligibilité et le plan effectif du futur compte restent à vérifier. Utiliser un sous-domaine fourni `pages.dev`/`workers.dev`, sans en acheter un. Ne pas activer Workers Paid, R2 ou autre offre facturable sous prétexte qu'une franchise est gratuite : [R2 est facturé au-delà de ses allocations](https://developers.cloudflare.com/r2/pricing/).

La compatibilité Node actuelle inclut un VFS et plusieurs modules/stubs, mais pas le disque Windows du projet : [compatibilité Node](https://developers.cloudflare.com/workers/runtime-apis/nodejs/), [VFS](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/). `/tmp` n'est pas un disque persistant partagé. La présence d'un import `node:sqlite` dans la compatibilité ne prouve pas l'exécution de ce backend ni l'accès à 417 Mo de base locale.

Il n'y a ni configuration Wrangler, ni test workerd/D1 local, ni preuve de déploiement dans le projet. Le build Vite compile les types des adaptateurs, **pas leur viabilité opérationnelle sur Cloudflare**. La carte ne dispose pas d'adaptateur. Il faut contrôler explicitement les routes d'invocation des assets ; [Pages peut générer `_routes.json`](https://developers.cloudflare.com/pages/functions/routing/#functions-invocation-routes), mais cette sortie n'a pas été produite/validée ici. Le Cache API est [local à un centre de données](https://developers.cloudflare.com/workers/reference/how-the-cache-works/), pas un verrou mondial pour IGN/TCL.

## 3. GTFS mesuré et alternatives de stockage

Empreinte archive : `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`. Validité des jours de service : **08/11/2026–08/03/2027**, 121 dates inclusives, avec prolongements après minuit selon les courses. La page historique PAN ne doit pas remplacer les dates des fichiers.

| Mesure réelle | Résultat |
| --- | ---: |
| ZIP local | 22 003 525 octets, environ 21 MiB |
| SQLite active | 416 698 368 octets, **397,39 MiB** |
| Index, mesure `dbstat` | **256 966 656 octets**, 61,67 % de la base |
| Table stop_times | 145 244 160 octets |
| Index départs | 134 008 832 octets |
| Index primaire stop_times | 108 306 432 octets |
| Lignes commerciales / courses / horaires | **807 / 140 442 / 2 927 249** |
| Arrêts / services / exceptions / transferts | 14 026 / 3 356 / 22 435 / 5 457 |
| Associations ligne–arrêt / jetons de recherche | 21 401 / 44 438 |
| Toutes lignes des tables applicatives | **3 179 614** |
| Ouverture SQLite, sans lecture complète | 0,92 ms lors de la mesure GTFS |
| Chargement topologique, trois reconstructions | 83,40 / 71,67 / 72,30 ms ; 41 691 lignes ; environ 23–33 Mo de delta heap observé |

Deux parents d'arrêts manquent dans la source, avertissement préservé. Aucun `shapes.txt`, aucun `shape_id` renseigné ; 807 couleurs dans le complément cartographique lié à la SHA. Pas de tracé réel des transports à promettre.

### D1 : la taille ne suffit pas

La base actuelle laisse environ **83,3 MB** sous un plafond conservateur de 500 000 000 octets, avant évolution de l'import. Copier le SQLite n'est pas l'import SQL D1 fourni. Le script `export-sql.mjs` émet les INSERT et index ; les opérations Wrangler/import ne sont pas supposées exemptées des métriques d'usage : [facturation des opérations D1](https://developers.cloudflare.com/d1/platform/pricing/).

À raison d'une écriture par ligne et sans autre usage, l'import relationnel complet représente **au minimum 32 jours** d'allocation quotidienne. Les deux index de stop_times aggravent fortement ce coût ; l'ordre de grandeur peut atteindre plus de 90 jours si leurs écritures sont comptées ligne par ligne. Ce dernier nombre est une estimation, pas une facture D1 mesurée. Aucun import distant ni `rows_written` distant n'a été exécuté ; aucune exemption d'import n'est présumée. Découper en fichiers SQL ou en plusieurs bases ne multiplie pas le quota du compte.

Les recherches froides renvoient 43 524 à 122 372 lignes SQL dans l'échantillon, dont des tables topologiques entières. Les lignes **retournées** ne sont pas une mesure des lignes **scannées/facturées** par D1. Les adaptateurs jettent actuellement les métadonnées D1. Impossible de promettre un nombre d'utilisateurs/jour sans `meta.rows_read`, durée et taille des résultats sur le vrai runtime cible.

### Deux prototypes de taille réellement exécutés, sans activation

1. **SQLite compacte séparée : 167 653 376 octets**, réduction de **59,77 %**. Toutes les tables hors stop_times sont conservées ; les horaires sont réencodés avec identifiants numériques réversibles et clé primaire `WITHOUT ROWID`. Les **2 927 249 lignes sont reconstruites et leur SHA-256 intégrale comparée**, avec succès. Durée locale 30,93 s. Cette base n'utilise pas le schéma SQL du moteur actif : elle n'est ni branchée, ni prête pour D1, et ne résout pas le quota des millions d'INSERT.
2. **Sonde binaire**, sans fichier de production : 28 octets par horaire, tous champs horaires utiles conservés par dictionnaires. Ensemble du feed : 81 962 972 octets bruts, 17 564 432 gzip. Pour le jour de service du 09/11/2026 : 21 844 courses, **464 182 horaires**, 12 997 096 octets bruts, **2 766 883 gzip**. Dictionnaires globaux : 13 611 255 bruts / 1 073 267 gzip. Compression/sonde complète : 18,51 s, pic RSS du processus environ 547 MiB, **hors contraintes serveur** puisque travail local. Il existe 3 356 groupes route/service ; leur découpage n'est pas encore compilé.

La seconde sonde mesure seulement un encodage/compression, pas un moteur fonctionnel sur navigateur. Elle justifie l'étude d'un jeu journalier partitionné ; elle ne justifie pas l'envoi des 2,9 millions d'horaires au navigateur. Les jours adjacents, le catalogue, les index, la mémoire de décodage et le routage restent à prototyper.

## 4. Benchmarks CPU, réseau et sérialisation

Instrumentation **dans les scripts d'audit uniquement**, sans modifier le moteur : chaque cas possède un processus Node neuf puis deux répétitions chaudes identiques. SQLite en lecture seule ; horaires des propositions contrôlés contre la base. Les lieux de test sont des adresses publiques sélectionnées dans la BAN, jamais le domicile réel de l'utilisateur.

| Cas froid | Total mural ms | CPU processus ms | CPU SQL ms | CPU hors SQL estimé ms | SQL mural ms | Lignes renvoyées |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| T3 direct | 368,49 | 656 | 234 | 422 | 127,66 | 45 342 |
| Place Henri → Soie, une correspondance | 1 283,54 | 1 500 | 313 | 1 187 | 318,82 | 53 429 |
| Harmonie Campus Pro → Soie, deux correspondances | 286,25 | 483 | 109 | 374 | 90,39 | 43 524 |
| Adresse → adresse | 15 768,63 | 2 499 | 871 | 1 628 | 807,08 | 122 372 |
| Adresse → arrêt | 25 542,90 | 2 328 | 827 | 1 501 | 768,45 | 116 305 |
| Favoris domicile → travail, marge 180 s | 15 338,25 | 2 671 | 857 | 1 814 | 798,60 | 122 224 |
| Horaires T3, 12 vrais passages | 26,47 | 47 | 15 | 32 | 5,66 | 13 |

Les valeurs exactes SQL des trois premiers cas sont dans le rapport hors ligne récent ; les autres proviennent de la passe réseau initiale. Les cas d'itinéraires signalent une **exploration partielle** : profils/budgets atteints. Les trajets retournés sont audités, sans garantie d'optimalité ; les budgets n'ont pas été abaissés ou désactivés pour améliorer ces chiffres.

Le CPU processus inclut JIT, GC, travail natif et threads Node ; il peut dépasser le temps mural. Le CPU hors SQL soustrait le CPU des appels SQLite synchrones. Ce n'est **pas** le CPU facturé par un Worker. La granularité des compteurs Windows conduit parfois à 0 sur les recherches très brèves : cela signifie « sous la résolution observée », pas « gratuit ou certainement sous 10 ms ». Aucun chiffre local ne remplace un profil workerd/Cloudflare.

Les deux répétitions identiques pleinement chaudes prennent environ **0,17–0,24 ms** pour les trajets entre quais et **1,99–3,09 ms** pour domicile/travail. Exception importante : la première répétition chaude adresse→arrêt prend **1 337,20 ms**, avec un nouvel appel IGN et un recalcul (un accès précédemment échoué n'est pas mis en cache). La suivante prend 2,38 ms. Ne pas annoncer que tout calcul chaud est instantané.

| Réseau froid, union des intervalles fetch + lecture du corps | Adresse→adresse | Adresse→arrêt | Domicile→travail |
| --- | ---: | ---: | ---: |
| Sélection BAN, temps mural avec file | 730,0 ms | 394,6 ms | 696,4 ms |
| Intervalles géocodage | 206,2 ms | 132,3 ms | 173,5 ms |
| Intervalles marche | 3 394,9 ms | 12 847,7 ms | 3 089,0 ms |
| Requêtes amont, sélection incluse | 50 | 49 | 50 |

Les marches ont une file volontairement limitée : l'attente perçue n'est pas seulement du réseau lent. Les intervalles concurrents sont fusionnés, pas additionnés ; les métriques internes `queueMs`/`walkingMs` additionnent parfois des travaux parallèles et **ne doivent pas être additionnées au total**. La résolution BAN à l'intérieur du calcul utilise le cache réchauffé par la sélection explicite, comme le formulaire.

La sérialisation JSON séparée prend environ **0,02–0,331 ms** sur les réponses valides retenues, de 4 034 octets pour Horaires à environ 37 Ko pour la mobilité. Le coût CPU est sous la résolution du compteur local. Les grands objets intermédiaires, pas ce petit JSON final, dominent le problème CPU/mémoire.

Le pic heap JavaScript échantillonné atteint environ **155,5 MiB** pour adresse→adresse et **238,4 MiB** pour adresse→arrêt ; le RSS inclut Node/SQLite et dépasse ces valeurs. Les échantillons peuvent manquer un pic et incluent le banc de vérification : ce ne sont pas des mesures d'isolate Cloudflare. Leur ordre de grandeur impose néanmoins un travail mémoire avant migration, pas une simple confiance dans le cache.

## 5. Fournisseurs externes et conditions

| Fournisseur | Vérification / gratuité / droits | Cache, attribution et blocage |
| --- | --- | --- |
| GTFS TCL / SYTRAL / Grand Lyon | HEAD officiel sans authentification **401**, pas de ZIP téléchargé. Le [PAN courant](https://transport.data.gouv.fr/datasets/horaires-theoriques-du-reseau-transports-en-commun-lyonnais) indique authentification et **Licence Mobilité**. La ressource historique [65812](https://transport.data.gouv.fr/resources/65812) conserve des données anciennes : pas une preuve des termes du feed local courant. | Vérifier auprès du producteur le jeu exact, ses conditions et les droits de redistribution des dérivés. La SHA locale et l'URL déclarée ne certifient pas l'origine des octets. **Pas de permission ODbL générale supposée.** |
| Temps réel Grand Lyon | GET backend sans authentification **401**, accès gratuit utilisable et quotas spécifiques **NON VÉRIFIÉS**. | Ne pas activer, contourner l'authentification ou considérer l'intervalle technique de 60 s comme un quota autorisé. La [Licence Mobilités](https://wiki.lafabriquedesmobilites.fr/wiki/Licence_Mobilités) prévoit un cadre et des CGU complémentaires, pas une garantie universelle d'accès illimité. |
| Site TCL public | Robots et mentions : HTTP **200** ; permission non commerciale retrouvée dans les [mentions officielles](https://www.tcl.fr/mentions-legales). Pas de fréquence chiffrée de collecte autorisée identifiée. | Conserver source, date et texte officiel intact ; droits des images/designs distincts. TTL 10 min et espacement 1 s sont des choix prudents du projet, **pas une licence de collecte massive**. Ne pas multiplier la collecte par isolate. |
| Géocodage IGN BAN | Succès réels pendant les benchmarks, sans clé/carte/compte de service payant. [Documentation](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) et [limites](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/limites-d-usage/) : 50 req/s/IP pour ce service ; API d'autocomplétion distincte 10 req/s. | Le code emploie `/geocodage/search` avec option autocomplete, pas l'API distincte. Cache de recherche 5 min, minimal et en mémoire ; les [CGU IGN](https://cartes.gouv.fr/cgu/) et licences de données s'appliquent, usage commercial pas assimilé à celui des pages TCL. |
| Marche IGN BD TOPO | Succès réels, 10 req/s/IP selon la même documentation de limites ; pas de contrat payant ajouté. | Cache directionnel 1 h ; TTL technique, pas une fréquence imposée par le producteur. Source/version/date et limites terrain doivent rester visibles. Conserver la licence exacte des données/services lors de la préparation publique ; pas d'affirmation de disponibilité garantie. |
| OSM raster | Politique officielle relue depuis le backend : **200**, [règles tuiles](https://operations.osmfoundation.org/policies/tiles/), sans clé ni paiement. | Attribution, Referer, cache HTTP, pas de préchargement/téléchargement massif, pas de SLA. Un trafic élevé peut être bloqué. Le mode sans fond reste utilisable. |
| Bibliothèques npm | `npm audit --json` : **0 vulnérabilité connue signalée** sur les versions installées, à cette date. | Ce n'est pas une garantie d'absence de faille. MapLibre, React, lucide, parse5 et outils restent soumis à leurs licences ; licence MapLibre distribuée dans public/dist. Aucune CDN de code distant ajoutée. |

Le test HEAD 401 constate cette méthode à cette URL ; un téléchargement authentifié n'a pas été essayé et aucun compte fournisseur n'a été créé. Le renouvellement automatique du GTFS est donc **bloqué/non validé**, même si l'archive locale reste exploitable. L'audit n'a ni relancé une collecte exhaustive TCL, ni revendiqué une couverture exhaustive.

## 6. Sécurité et confidentialité

Points favorables : SQL paramétré ; types/date/mode/coordonnées contrôlés ; hôtes officiels fixes, redirections refusées pour IGN/TCL ; pas d'URL arbitraire passée au fetch fournisseur ; rendu React textuel plutôt que HTML injecté ; messages dégradés explicites ; base locale en lecture seule ; `.env` ignoré ; secrets Grand Lyon uniquement côté serveur. Dans ce checkout, seul `.env.example` est présent. Aucun secret n'a été affiché ou exporté. Pas d'audit d'un historique Git distant, absent du périmètre.

Contrôles HTTP locaux : frontend et statut GTFS 200 ; date invalide 400 ; coordonnées invalides 400 ; empreinte cartographique divergente 409 ; accès brut ZIP et SQLite **403**. CSP, X-Content-Type-Options, X-Frame-Options, Referrer-Policy et HSTS absents sur le serveur Vite local. Ce constat n'est pas une analyse de futurs en-têtes Cloudflare/HTTPS.

Priorités avant publication :

1. Corps POST bornés **pendant leur lecture** sur les Functions ; `request.text()` suivi d'une vérification de longueur alloue déjà le corps. Les limites du middleware Node ne protègent pas ces Functions.
2. Limites globales de dépenses de ressources : la capacité partagée par processus n'est ni un quota par utilisateur ni une protection mondiale contre les abus. Une restriction Origin/CORS seule ne bloque pas un client scripté.
3. Caches TTL/LRU en octets, plafonds de mémoire, de travaux simultanés et de durée. L'invalidation SHA des données GTFS doit rester obligatoire.
4. En-têtes statiques **et API** ; `_headers` seul ne protège pas nécessairement les réponses Functions. CSP à tester avec le worker `blob:` de MapLibre et ses styles ; ne pas couper Referer vers OSM. HSTS uniquement sur HTTPS ; pas de politique de production copiée aveuglément dans Vite.
5. Notice éditeur/confidentialité : adresses envoyées uniquement aux services nécessaires ; favoris en clair dans le profil ; OSM reçoit IP et zone de tuiles. Les logs d'infrastructure peuvent contenir les URL `q=` d'autocomplétion même sans télémétrie applicative : les réduire/masquer, ne pas journaliser les corps ni les secrets.

## 7. Fonctionnement dégradé attendu

| Incident | Comportement fiable |
| --- | --- |
| IGN indisponible/429 | Erreur d'origine IGN ; pas d'accès piéton inventé ; conserver le résultat valide précédent et ses libellés, proposer des quais explicitement sélectionnés ; respecter Retry-After |
| TCL HTML indisponible ou structure inconnue | Couverture indisponible/périmée, dates originales conservées, jamais « trafic normal » ; avertissements sans supprimer un trajet |
| Tuiles/WebGL indisponibles | Texte et horaires utilisables ; avertissement ; mode sans fond disponible, aucun tracé TCL reconstitué artificiellement |
| GTFS périmé | Refuser les services non couverts, garder la prise en charge officielle après minuit ; afficher un bandeau d'expiration à finaliser, jamais décaler les dates d'un ancien résultat |
| Quota Cloudflare atteint | Assets à servir sans passage serveur ; API explicitement indisponible/limite atteinte ; délai de nouvelle tentative, pas de boucle automatique ni de bascule facturable |
| Backend saturé/erreur | Annulation et résultats précédents identifiés ; aucun trajet de remplacement inventé ; classement partiel explicitement signalé |

Ces comportements sont en grande partie couverts par les tests locaux existants. Les erreurs de quota Cloudflare réelles, les en-têtes publics et l'expiration globale de l'interface ne sont pas validés en production.

## 8. Coûts obligatoires et périmètre du zéro euro

| Poste retenu pour l'étude | Coût obligatoire de service | Condition |
| --- | ---: | --- |
| Outils locaux et import | 0 € de licence/service | Machine déjà disponible ; temps humain, électricité et connexion ne sont pas déclarés gratuits |
| Hébergement fichiers frontend | 0 € | Offre Free, sous-domaine fourni, limites et droits d'usage respectés |
| Domaine acheté | 0 € | Aucun achat ; sous-domaine gratuit uniquement, nom non réservé ici |
| API IGN actuelles | 0 € dans l'usage public testé | Débit, conditions et disponibilité ; pas de passage à une offre payante |
| TCL/GTFS/Grand Lyon | Pas de coût payé par cet audit | Conditions et accès authentifié exacts non finalisés ; ne pas engager une offre facturée |
| Fond et bibliothèques | 0 € | OSM usage modéré autorisé ou mode sans fond ; licences conservées |
| D1/Workers optionnels | 0 € seulement dans Free | Pas de renouvellement/import ou de calcul excédant les enveloppes ; la transposition actuelle échoue à cette condition |
| CI facultative | 0 € sous allocations et runners adaptés | Aucun workflow activé ; voir le plan pour arrêt au quota, sans moyen de paiement |
| R2, Workers Paid, VPS/domaines/offres à l'usage | **Exclus** | Une franchise n'est pas une garantie de facture nulle |

**Pas de capacité illimitée promise pour l'application.** Une erreur ou un refus d'usage est préférable à une facture ou à un résultat inventé.

## 9. Tests et preuves reproductibles

Exécutés pendant cet audit : **228 tests node:test réussis**, dont trois nouveaux tests des métriques ; `npm.cmd run lint` sans avertissement après correction du script HTTP ; `npm.cmd run build` réussi, avertissement de taille MapLibre conservé ; npm audit sans vulnérabilité connue. Les règles métier et les fichiers de production n'ont pas été changés.

Sept cas de benchmark avec trois répétitions chacun ; quatre cas hors réseau revalidés séparément, avec correction d'un argument de direction vide dans le **banc de test Horaires**, et vérification des 12 passages réels. La première mesure vide Horaires est exclue du verdict de fonctionnalité, conservée comme preuve de l'erreur du banc. La passe réseau a pu chevaucher une mesure hors ligne de taille : les temps muraux ne sont pas un essai sur une machine dédiée, le CPU reste celui du processus mesuré. Aucune extrapolation de capacité à partir d'un seul cache chaud.

Preuves locales, non déployées :

- `.data/cost-audit-gtfs-1794251134658.json` : taille, tables/index, sonde binaire.
- `.data/cost-audit-compact-1794251552460/report.json` : base candidate et empreinte de reconstruction.
- `.data/cost-audit-topology-1794251397313.json` : trois chargements topologiques.
- `.data/cost-audit-routing-1794251023263/report.json` : cas avec IGN réels et CPU.
- `.data/cost-audit-routing-1794251223939/report.json` : cas hors réseau réexécutés, Horaires corrigé.
- `.data/cost-audit-providers-1794251313294.json` : HTTP officiels, SHA des politiques sans contenu personnel.
- `.data/cost-audit-http-1794251441884.json` : validation et exposition locales.
- `.data/cost-audit-npm.json`, `.data/cost-audit-tests-final.log` : dépendances et suite complète.
- `.data/cost-audit-traffic-parse-1794252045349.json` : six analyses de l'extrait TCL autorisé, sans nouvelle collecte.
- [Synthèse d'évidence conservée avec les rapports](evidence/cost-audit-2026-11-09.json) : données et mesures agrégées, sans adresses personnelles ni secrets.

Les validations Edge de la mission carte sont référencées dans [CARTE-INTERACTIVE.md](CARTE-INTERACTIVE.md) : 19 contrôles carte, deux suites ciblées de neuf et 124 contrôles de non-régression. Elles précèdent cet audit ; elles ne sont pas présentées comme de nouvelles exécutions navigateur. Aucun runtime Cloudflare, compte, quota distant ou concurrence publique n'a été testé ici.

Commandes d'audit :

```powershell
node scripts/audit/gtfs.mjs
node scripts/audit/compact-sqlite.mjs
node scripts/audit/routing.mjs
# Seulement pour une validation réseau explicite :
$env:AUDIT_LIVE='true'; node scripts/audit/routing.mjs
node scripts/audit/providers.mjs
node scripts/audit/http.mjs
npm.cmd test
npm.cmd run lint
npm.cmd run build
```

Les scripts créent leurs propres artefacts sous `.data`, sans écrasement de base existante. Ne pas répéter les passes IGN sans raison. Le petit programme de mesure topologique a été exécuté séparément ; sa preuve JSON est conservée.

## 10. Décision

Le frontend, les favoris et la visualisation sont réutilisables gratuitement. L'application complète ne doit pas être publiée en supposant que « SQLite < 500 MB » et « adaptateurs présents » suffisent. Les obstacles sont le CPU/mémoire, le renouvellement des millions de lignes, les caches/quotas distribués, les droits et l'accès officiel du GTFS, ainsi que les protections HTTP manquantes.

**Verdict final : ARCHITECTURE À REVOIR.** La prochaine étape recommandée est un prototype local de données précompilées et de calcul isolé, avec critères de parité et de ressources ; ni une migration automatique ni un déploiement ne sont autorisés par ce rapport.
