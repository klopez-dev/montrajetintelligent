# Adresses et marche — V0.1

Évolution suivante : [Performances et couverture](PERFORMANCES-COUVERTURE.md). Le moteur actuel accepte deux correspondances, conserve tous les accès piétons confirmés dans ses budgets et n’applique plus le plafond de quatre quais décrit dans l’historique ci-dessous. Les mesures anciennes restent conservées comme références.

## Périmètre opérationnel

Recherche mixte d’arrêts TCL et d’adresses françaises, avec priorité géographique lyonnaise et sélection explicite. Les suggestions indiquent « Adresse · BAN via IGN » ou le quai GTFS et ses lignes ; les homonymes restent distincts. Seules les adresses avec numéro sont utilisables pour un départ domicile : une rue sans numéro ne permet pas de déterminer ce départ de manière suffisamment précise.

Les recherches contenant une adresse utilisent l’API serveur `/api/mobility/search`. Les accès initiaux et finaux viennent exclusivement du profil **pedestrian** IGN, calculé sur un réseau réel BD TOPO. Les horaires de transport restent ceux du GTFS importé, sans temps réel. La case « Examiner aussi des correspondances à pied » autorise en plus quelques nouveaux liens entre quais de surface. Elle est décochée par défaut : les recherches historiques entre quais restent sur leur moteur validé et n’appellent pas le routeur piéton.

L’affichage distingue départ recommandé du domicile, marche initiale, marge avant embarquement, étapes TCL, correspondances et marche finale. Les dates sont exprimées à Lyon avec leur décalage UTC. La marche est une **estimation du routeur**, pas une mesure sur le terrain. Les filtres de proximité ne sont jamais convertis en temps de marche.

## Audit Lacassagne : pourquoi Cordeliers ?

L’ancien moteur n’utilisait que les liens orientés de `transfers.txt` et les changements sur un même quai. L’archive importée fournit notamment un lien T3 → bus à Dauphiné (`35660` → `10129`, minimum 180 s), sans autoriser implicitement le sens inverse. Le quai bus C9 utile à l’aller est un autre quai, **50149**. Les noms similaires ne rendent pas leurs transferts équivalents. Aucun bus → T3 absent ne devait être inventé.

Autre différence déterminante : **36394** à La Soie est un quai métro, **35668** est un quai T3 vers Meyzieu. Une recherche sur 36394 demande une arrivée sur ce quai précis, et non sur tous les quais du pôle. C13 + A via Cordeliers était donc une réponse cohérente dans le périmètre précédent. Le nouveau parcours C9 + T3 arrive sur 35668 : les heures aux deux quais sont comparables comme exemples, mais ne prouvent pas une meilleure arrivée à une même adresse ou sur un même quai.

Une fois le lien piéton calculé indépendamment par IGN, le moteur peut examiner **50149 → 35660**, tout en conservant les interdictions et les règles GTFS les plus spécifiques. Le premier contrôle réel a renvoyé environ **166,6 m / 175 s** estimées, réseau IGN du **7 novembre 2026**, raccordements de 1,2 et 8,9 m environ. Le lien n’est pas obtenu par inversion du GTFS.

Pour le **9 novembre 2026, recherche à 11 h Europe/Paris**, marge de 120 s :

| Départ exact | Ancien périmètre, arrivée métro 36394 | Avec marche, arrivée T3 35668 |
| --- | --- | --- |
| Place Henri 2397 | C13 + A, 11:09 → 11:53:19 | C9 + T3, 11:08 → 11:31:02 |
| Domrémy-Lacassagne 12230 | C13 + A, 11:01 → 11:43:43 | C9 + T3, 11:10 → 11:31:02 |
| Dauphiné-Lacassagne 35660 | Destination T3 déjà disponible | T3 direct, 11:07:01 → 11:15:32 |

Pour les deux premiers parcours C9, arrivée bus à Dauphiné à 11:12:00, départ T3 à 11:22:31, intervalle 631 s ; marche estimée 175 + marge 120 = 295 s, reste 336 s. Les courses, séquences, interdictions de montée/descente, directions, dates de service et exceptions sont relues dans SQLite par un auditeur indépendant. Une correspondance sur un autre créneau doit être recalculée ; ces exemples ne sont pas réutilisés comme horaires constants.

À La Soie, le retour direct vers Lyon utilise le quai **35669**, et non le quai 35668 vers Meyzieu. Le test live contrôle explicitement qu’aucun premier tronçon vers Lyon n’est inventé depuis le mauvais quai. Un détour avec changement de sens sur un autre arrêt peut néanmoins être réalisable : s’il est retenu, ses deux courses et son transfert doivent aussi être audités.

## Sources et conditions vérifiées le 8 novembre 2026

- [Géocodage officiel IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) : `https://data.geopf.fr/geocodage/search`, index d’adresses BAN, autocomplétion intégrée, limite annoncée de 50 requêtes/s/IP. Paramètres de priorité autour de Lyon, sans exclusion des autres adresses françaises.
- [Routage officiel IGN](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/) : `https://data.geopf.fr/navigation/itineraire`, ressource `bdtopo-osrm`, profil `pedestrian`, unités mètres/secondes, géométrie GeoJSON. Limite annoncée de 5 requêtes/s/IP. Les vitesses et coûts sont ceux du fournisseur, aucune vitesse à vol d’oiseau n’est appliquée localement.
- [CGU Géoplateforme](https://cartes.gouv.fr/cgu/) : utilisation des géodonnées et services gratuite, sous réserve des licences propres et des limites de service. Les requêtes unitaires testées répondent **HTTP 200 sans clé, compte ni carte bancaire**.
- [CGU BAN](https://adresse.data.gouv.fr/cgu) : données en licence ouverte. [BD TOPO, publication officielle IGN](https://www.data.gouv.fr/datasets/bd-topo-r) : Licence Ouverte 2.0. Les sources sont attribuées dans l’interface ; version réseau et date de consultation figurent dans les réponses. La date exacte de mise à jour de chaque adresse n’est pas fournie par cette réponse BAN et n’est pas inventée.

Les textes de saisie et coordonnées nécessaires sont transmis au service IGN par le backend. Les adresses ne sont pas inscrites dans les journaux applicatifs et sont seulement mises en cache en mémoire pour cinq minutes (capacité globale bornée). Les rapports QA utilisent une adresse publique de démonstration, **100 avenue Lacassagne, Lyon**, pas une adresse personnelle fournie par l’utilisateur. L’utilisateur est informé de cette transmission avant sa saisie. Le fournisseur garde ses propres conditions de traitement.

Le cache n’est pas une base persistante : cinq minutes est sa durée de validité ; une entrée expirée peut rester en mémoire jusqu’à son remplacement ou l’arrêt du processus. Les tests entre deux adresses utilisent aussi **5 avenue des Canuts, Vaulx-en-Velin**, adresse publique de démonstration confirmée par la BAN.

## Architecture et garanties

- `server/mobility/provider.ts` : URLs officielles fixes, pas de proxy arbitraire ; pas de clé ; validation du profil, des unités, de la géométrie et des nombres ; refus des redirections ; timeout réseau 8 s ; cache borné 256 entrées, cinq minutes pour les suggestions et une heure pour les parcours ; coalescence des requêtes identiques ; file commune bornée 24, départs espacés de 260 ms au minimum ; respect de Retry-After sur 429/503. Aucun repli voiture ou distance géométrique. Une réponse invalide n’est pas mise en cache.
- `server/mobility/planner.ts` : coordonnées d’adresse confirmées côté serveur en retrouvant l’identifiant BAN sélectionné ; coordonnées de quai issues de SQLite ; candidats piétons de surface à 1 200 m maximum pour les adresses, quatre quais examinés par extrémité. Deux places privilégient une ligne commune avec l’autre quai ou les lignes présentes dans le secteur de l’autre adresse, d’abord les tramways compatibles ; à défaut, des quais tram proches. Les places restantes sont prises parmi les quais les plus proches. Cela évite que deux quais d’une autre ligne de tram masquent le T3 utile à La Soie. Ce choix explicite peut omettre un trajet intéressant.
- Avant cette sélection, les événements réels de montée/descente dans la plage temporelle sont filtrés par calendriers et exceptions. Une simple présence dans `route_stops` ne prouve pas un service ce jour : à La Soie, le quai nominal 47685 pouvait masquer le quai T3 35668 utilisable et produire un détour au lieu du direct. Les lignes actives par quai sont désormais utilisées, pas seulement leurs rattachements nominaux. La présélection utilise une plage élargie d’une heure pour les accès ; le calcul final conserve sa fenêtre de six heures et ses contrôles exacts. Les deux requêtes de présélection portent sur les quais voisins, jamais sur un graphe d’horaires envoyé au navigateur.
- Nouveaux transferts : filtrage géométrique de 15 à 350 m, six paires orientées proches au maximum, durée réseau maximale de quinze minutes, entre quais sans ligne commune. Les changements de sens sur une même ligne restent limités aux liens GTFS existants ; cela évite de saturer le budget de liens avec des demi-tours tram plutôt qu’un changement bus → tram utile. L’absence d’un transfert dans le GTFS n’interdit pas à elle seule un chemin piéton calculé ; une interdiction GTFS applicable continue, elle, de l’exclure. Un minimum officiel déjà présent reste prioritaire et n’est jamais raccourci par IGN.
- Jusqu’à seize recherches GTFS bornées, réutilisant le moteur précédent. Aucun horaire complet n’est envoyé au navigateur. Le budget serveur est de 45 s, contrôlé entre opérations ; un appel réseau en cours et une requête SQLite synchrone ne sont pas interrompus instantanément. L’annulation de la requête locale arrête les opérations suivantes. Le cache partagé peut terminer un appel déjà lancé.
- Composition temporelle : départ domicile = premier départ TCL − marche initiale − marge ; arrivée destination = dernière arrivée TCL + marche finale. « Partir à » décale le seuil de montée après la marche et la marge ; « Arriver avant » recule l’échéance transport de la marche finale. Les calculs reposent sur les instants absolus, puis sur la couche GTFS existante pour les calendriers et changements d’heure.
- Classement par arrivée, départ, durée totale, correspondances, marche connue ou attente connue. Les temps inconnus ne sont pas assimilés à zéro pour le classement : un minimum GTFS peut mélanger marche et attente, ce qui reste affiché. Les parcours dominés par un départ plus tardif, une arrivée plus tôt, moins de durée, de changements et de marche connue sont retirés. La marche connue d’un parcours partiellement inconnu est utilisée uniquement comme borne inférieure pour ce retrait. Une attente inconnue bloque ce retrait lorsque le classement demandé est l’attente. Une sélection diversifiée privilégie ensuite les différents parcours de lignes avant de compléter avec d’autres départs. L’attente avant le départ recommandé du domicile est hors durée porte-à-porte ; marges et attentes en correspondance sont incluses.
- `functions/api/mobility/[[path]].ts` : adaptateur D1 sans dépendance Node pour les handlers et services ; aucun déploiement. La limitation actuelle est par processus/isolate, **pas un quota global Cloudflare** : il faudra une coordination et vérifier les quotas D1 et sous-requêtes gratuites avant une publication. Aucune promesse d’hébergement gratuit en charge n’est déduite des tests locaux.

## Contrat HTTP

`GET /api/mobility/addresses?q=...` retourne des résultats BAN distincts ou une erreur explicite. Le frontend combine ces suggestions avec les arrêts du service existant ; une panne IGN ne supprime pas les résultats TCL.

`POST /api/mobility/search` reçoit `from` et `to` : `{kind:'stop',id}` ou `{kind:'address',id,name}`, ainsi que `at` (ISO avec fuseau), `mode`, `order`, `marginSeconds` (30 à 1 800) et `walkingTransfers` (booléen). Les éventuelles coordonnées envoyées par le client ne sont pas utilisées. Le corps est borné à 4 Ko. La réponse contient les propositions porte-à-porte, leur provenance, les parcours réseau, le résultat transport et les limites. Cache HTTP désactivé.

Les erreurs réseau ne fabriquent pas d’accès : le quai concerné est exclu avec explication. Si aucun accès ne reste, l’interface ne présente aucun trajet confirmé. Un quai GTFS choisi explicitement reste utilisable dans le module historique sans IGN. Les favoris entre quais sont conservés ; les favoris d’adresses ne sont pas encore enregistrés pour éviter de réduire une adresse à un nom ou de stocker un identifiant de quai incorrect.

## Limites à conserver visibles

Un itinéraire IGN est un calcul sur réseau, **pas une vérification physique** des trottoirs, traversées, travaux, accès privés ou accès aux quais. Les raccordements géométriques de plus de 25 m sont refusés ; ceux de 0 à 25 m ne sont pas décrits par le réseau et sont signalés. Les nouveaux transferts entre quais différents distants de moins de 15 m (ou dont le routeur renvoie moins de 15 m) sont exclus : des coordonnées pratiquement confondues peuvent produire un faux trajet de quelques centimètres alors que la traversée réelle de voies n’est pas décrite. Ce seuil conservateur n’affecte pas les liens officiels GTFS. La marge est une hypothèse, pas une certification de sécurité. Aucun accès nouveau aux quais métro/funiculaire n’est construit sans données d’entrées ; les transports métro/funiculaire restent disponibles dans les parties GTFS confirmées.

Pas de marche seule, de guidage rue par rue, de temps réel, de plusieurs correspondances ou de garantie d’optimalité globale. Les limites de sélection de quais et de transferts peuvent produire « aucun trajet confirmé » alors qu’un parcours existe ailleurs. Aucun autre service gratuit public n’est appelé en cascade en cas de panne IGN. Alternatives possibles pour une étape ultérieure : graphe piéton local BD TOPO/OSM avec moteur auto-hébergé et données d’entrées vérifiées ; coût d’exploitation, ressources mémoire et compatibilité avec l’hébergement gratuit à étudier avant intégration. L’OSRM automobile public ne constitue pas un repli piéton.

## Validation et lancement

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:journeys
npm.cmd run test:browser
npm.cmd run test:mobility
```

`test:mobility` nécessite l’accès HTTPS aux services officiels IGN et Edge installé. Il écrit uniquement dans `.data/mobility-validation-<date>/`, démarre Vite sur un port libre, utilise un profil navigateur isolé et ferme ses propres processus. Il ne contourne aucune authentification, ne publie rien et ne touche pas à la base importée. Les tests automatisés classiques utilisent des fournisseurs simulés explicitement marqués TEST et des bases en mémoire.

Lancement habituel, frontend et API locale dans le même processus :

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 0
```

Version publique **V0.1** inchangée, temps réel désactivé, aucune dépendance ajoutée, aucun déploiement.

## Fichiers créés ou modifiés

Créés : `src/types/mobility.ts`, `src/services/mobility.ts`, `src/components/MobilityResults.tsx`, `server/mobility/provider.ts`, `server/mobility/planner.ts`, `server/mobility/api.ts`, `functions/api/mobility/[[path]].ts`, `tests/mobility.test.mjs`, `scripts/qa/validate-mobility.mjs`, ce rapport et sa preuve synthétique dans `docs/evidence/mobility-validation.json`.

Modifiés : `src/components/JourneyForm.tsx` (choix mixtes), `JourneyResults.tsx` (transferts IGN et présentation intégrée), `GtfsSearchField.tsx` (avertissement d’une source indisponible), `src/types/journey.ts` et `transport.ts` (modèles compatibles), `src/App.css` (présentation responsive), `server/journeys/planner.ts` et `topology.ts` (liens piétons optionnels sans mutation du graphe GTFS), `server/gtfs/local.ts` (API locale et corps JSON UTF-8 borné), `package.json` (script QA uniquement), les README et l’index de documentation des itinéraires.

## Résultats finaux enregistrés

- **155 tests automatisés réussis**, zéro échec et zéro test ignoré : régression GTFS, favoris, calendriers, changements d’heure, après minuit, profil piéton, unités/géométries invalides, panne fournisseur, cache expiré, Retry-After, transferts interdits, quais confondus, sélection des lignes et quais temporaires, marche initiale/finale et deux adresses.
- **17 contrôles live API/navigateur réussis**, Edge 157 : les trois trajets du secteur, adresses BAN réelles, deux modes, retour avec quai/direction exacts, marche finale, deux adresses sur mobile, absence de débordement à 390 px, propositions dépliables, panne géocodage explicite et aucune requête IGN directe du navigateur. Aucune exception JavaScript. Une panne IGN du test est simulée explicitement, les succès et parcours géographiques proviennent du vrai service.
- **27 contrôles navigateur itinéraires historiques** et **32 contrôles Horaires** réussis ; favoris entre quais toujours persistants et temps réel toujours désactivé.
- `npm.cmd run lint` sans avertissement ; `npm.cmd run build` réussi. Aucune nouvelle dépendance.
- Dernier rapport complet adresses : `.data/mobility-validation-1794148960461/report.json`, captures desktop/mobile et résultat mobile focalisé dans le même dossier. Rapports de régression : `.data/routing-validation-1794148324089/report.json` et `.data/validation-1794148324104/report.json`.
- [Preuve synthétique](evidence/mobility-validation.json), avec requêtes, identifiants de courses/quais, dates de service, horaires et mesures.

Exemple porte-à-porte contrôlé le **9 novembre 2026**, recherche à **11:00 Europe/Paris**, marge 120 s, 100 avenue Lacassagne → 5 avenue des Canuts : départ recommandé **11:00:39**, marche initiale **877 s / 875,5 m** vers Reconnaissance-Balzac **35662**, embarquement T3 **11:17:16** direction Meyzieu les Panettes, arrivée à La Soie **35668 à 11:23:17**, marche finale **165 s / 166,8 m**, arrivée destination **11:26:02**. Durée totale **25 min 23 s**, aucune correspondance. Les durées piétonnes restent des estimations IGN et incluent les limites de raccordement indiquées plus haut.

Depuis la même adresse vers le quai T3 de La Soie, l’autre proposition **C9 + T3** demande moins de marche connue (environ **4 min 17 s** contre **14 min 37 s** pour l’accès au tram à pied) mais arrive plus tard sur le créneau testé. La sélection garde cette alternative et ne suppose pas qu’une réduction de marche signifie une meilleure heure d’arrivée.

### Temps de réponse observés

Mesures HTTP locales unitaires du dernier parcours de validation, **pas des médianes ni un test de charge**. Le cache se remplit au fil des cas ; ces chiffres ne sont pas directement comparables comme un benchmark de trajets :

| Requête | Serveur | HTTP |
| --- | ---: | ---: |
| Place Henri → Soie, premiers nouveaux liens piétons | 14 439 ms | 14 495 ms |
| Domrémy → Soie, liens réutilisables | 111 ms | 129 ms |
| Dauphiné → Soie | 368 ms | 377 ms |
| Adresse Lacassagne → quai Soie, départ | 2 509 ms | 2 520 ms |
| Même adresse, arrivée avant | 911 ms | 925 ms |
| Retour quai 35669 → adresse | 1 009 ms | 1 025 ms |
| Deux adresses | 5 042 ms | 5 058 ms |

La première recherche réseau peut donc prendre **près de quinze secondes** dans ces mesures. Les essais précédents conservent également leurs rapports, avec des latences variables ; aucune moyenne favorable n’est sélectionnée pour masquer ce coût. L’interface signale le chargement, et la recherche historique sans marche ne subit pas cette phase de routage. `walkingCalls` compte les demandes de parcours, y compris les accès au cache, et non les seuls appels HTTPS sortants. La charge simultanée, les quotas gratuits réels Cloudflare, Firefox/Safari et les téléphones physiques restent non validés.
