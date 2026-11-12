# Chargement progressif et annulation — V0.1

## Résultat et périmètre

Les calculs conservent le moteur GTFS existant, jusqu’à deux correspondances, les minima orientés, calendriers, contrôles de marche IGN et budgets de ressources. Aucun déploiement, changement de version, nouveau fournisseur ou dépendance payante. Le temps réel Grand Lyon reste désactivé.

Le navigateur reçoit désormais les étapes **réellement atteintes** par le backend, par un flux HTTP NDJSON. Les utilisateurs peuvent annuler, modifier les critères puis relancer. Les résultats valides antérieurs restent consultables, explicitement identifiés avec leurs lieux et date, pendant une nouvelle recherche ou après un échec. Une vraie recherche sans trajet remplace les résultats ; une absence de propositions accompagnée d’erreurs IGN conserve les précédents et affiche l’origine de l’échec.

## Audit et mesures

Scénario identique avant/après dans Edge : **100 Avenue Lacassagne 69003 Lyon → La Soie, quai T3 35668, le 9 novembre 2026 à 11 h Europe/Paris**, deux correspondances maximum, marge 120 s. La sélection BAN explicite précède le calcul ; aucun appel piéton n’est anticipé. Trois processus Vite et profils Edge neufs par version, chacun suivi d’une relance avec cache. Les caches disque système ne sont pas vidés. Les succès utilisent les sources réelles.

Mesures navigateur, du déclenchement du clic au DOM observé ; elles incluent le coût du pilote CDP et du rendu. Ce ne sont pas des percentiles de production.

| Mesure, trois répétitions | Avant | Après |
|---|---:|---:|
| Retour du bouton à froid, médiane | 8,9 ms | 12,4 ms |
| Première étape serveur visible à froid | Absente jusqu’au résultat | **134 ms** médiane, 130–158 ms |
| Résultat complet à froid, médiane | 20,006 s | 15,494 s |
| Résultat complet à froid, étendue | 14,959–20,348 s | 15,307–18,347 s |
| Résultat complet avec cache, médiane | 51,3 ms | 85,8 ms |
| Résultat complet avec cache, étendue | 48,0–53,9 ms | 85,0–90,9 ms |

Les étapes rapides avec cache sont transmises mais peuvent être regroupées par React et terminées avant une image navigateur : aucune temporisation artificielle ne force leur affichage. L’ajout du flux, de son décodage et du rendu augmente ici le temps chaud d’environ 35 ms ; il reste inférieur à 100 ms. **Aucune accélération garantie du calcul froid n’est démontrée** : les distributions se chevauchent et les temps IGN varient. Le gain établi concerne l’information pendant l’attente et la maîtrise des requêtes devenues inutiles.

Après instrumentation, les trois requêtes froides du navigateur donnent :

| Phase backend | Essai 1 | Essai 2 | Essai 3 |
|---|---:|---:|---:|
| Total du planificateur | 15,442 s | 18,285 s | 15,253 s |
| Résolution adresse déjà suggérée, murale | 0,25 ms | 0,25 ms | 0,21 ms |
| Phase piétonne avec file et cache, murale | 13,555 s | 16,458 s | 13,333 s |
| SQLite cumulée | 941 ms | 920 ms | 983 ms |
| Moteur transport | 847 ms | 770 ms | 831 ms |
| Appels IGN pendant le calcul | 48 | 48 | 48 |

La phase piétonne domine. Chaque recherche examine 68 candidats et confirme 48 accès dans cet échantillon ; le budget est atteint, donc les propositions restent signalées **partielles**. Les résultats T3 ne sont ni fictifs ni garantis globalement optimaux. La réponse HTTP complète prend 15,449–18,300 s environ, détails exacts dans le JSON de preuve.

Avec cache : backend **15,35–18,35 ms**, deux requêtes SQLite (0,45–0,88 ms), phase piétonne 1,95–5,08 ms, moteur transport environ 0,22 ms et **zéro nouvel appel IGN**, 49 consultations satisfaites par cache. Les durées réseau et de file cumulées peuvent se chevaucher ; ne pas les additionner comme des durées murales.

La mesure détaillée backend antérieure est conservée pour contexte dans les preuves : 16,296 s à froid et environ 3,3 ms à chaud en appel direct. Elle utilisait un autre point d’entrée sans suivi, et les liens piétons optionnels activés : **elle n’est pas une comparaison stricte** avec les requêtes navigateur instrumentées. Les trois mesures avant/après strictement comparables sont celles du tableau navigateur.

Preuves réutilisables : [experience-comparison.json](evidence/experience-comparison.json). Rapports bruts locaux : `.data/experience-before-1794165641458/report.json` et `.data/experience-after-1794166279647/report.json`. Le script `node scripts/qa/benchmark-experience.mjs after` reproduit trois séries ; `EXPERIENCE_REPEATS` accepte 2 à 5.

## Étapes et transport

Événements horodatés : recherche des adresses, identification des arrêts accessibles, calcul des parcours piétons, recherche des correspondances, classement. Les recherches entre quais sans marche n’annoncent que les phases transport exécutées ; une réutilisation de résultat transport peut émettre une étape de cache. Les dates hors validité GTFS ne déclenchent plus de résolution IGN.

Le client demande `Accept: application/x-ndjson` ; chaque ligne contient un événement `stage`, puis un unique `result` ou `error`. Un résultat final conserve exactement le contrat JSON historique ; les clients qui demandent du JSON continuent à le recevoir. Une erreur dans un flux déjà ouvert est un événement, même si le statut HTTP initial est 200. Le client contrôle la fin du flux, UTF-8 fragmenté, taille maximale, événements connus et absence de résultat tronqué.

Le middleware Vite transmet immédiatement les morceaux du flux et respecte la contre-pression. Les adaptateurs Web Response des fonctions Cloudflare peuvent retourner ce même flux ; **aucun hébergement Cloudflare réel ni quota CPU gratuit n’a été certifié**. Un proxy qui bufferise peut retarder les étapes malgré les en-têtes `no-transform` et `X-Accel-Buffering: no`.

## Réutilisation, annulation et quotas

- Caches IGN existants conservés : géocodage et identifiants BAN 5 min ; chemins piétons orientés exacts 1 h ; capacité bornée à 256 éléments. Un chemin expiré n’est jamais utilisé comme repli en cas de panne.
- Voisinages tenant compte des services actifs : 60 s, bornés à 64 ; candidats statiques et résultats transport restent liés au SHA du GTFS. Le cache transport inclut les critères et la fraîcheur des chemins. Changer de GTFS invalide les structures concernées ; redémarrer le serveur après remplacement de la base liée à SQLite.
- Nouveau partage des calculs simultanés identiques, borné à **8 recherches distinctes par adaptateur de base**. La clé utilise les références de lieux, instant, mode, classement, marge, marche optionnelle et nombre de correspondances. Pas de journalisation des adresses.
- Partage des appels IGN identiques en vol, borné à 64 clés : un consommateur annulé se détache ; le dernier interrompt le `fetch`. Les appels encore en file vérifient l’annulation avant de démarrer. Les résultats annulés ne sont pas ajoutés au cache.
- Le navigateur empêche la double soumission avec une référence synchrone, et ignore les étapes/réponses d’une recherche abandonnée. Modifier les critères annule la recherche active. Un bouton d’annulation de 44 px minimum est disponible sur mobile.
- Autocomplétion du trajet temporisée à **350 ms** ; les Horaires conservent leur comportement existant. Arrêts SQLite et suggestions BAN sont interrogés en parallèle ; la résolution des deux adresses et les parcours restent parallélisés de façon contrôlée.
- Aucun préchargement piéton automatique, aucune requête de marche par frappe, aucun rafraîchissement en arrière-plan. Un accès complet peut coûter 48 appels : précharger des suggestions non choisies consommerait ce budget inutilement. La sélection BAN déjà obtenue est réutilisée au calcul.

Le limiteur IGN existant reste **deux appels simultanés, départs espacés de 260 ms**, au plus quatre départs dans une fenêtre d’une seconde, sous la limite routage documentée de 5 requêtes/s/IP. Le délai fournisseur est 8 s ; `Retry-After` continue de bloquer de nouveaux appels après 429/503. Le délai global reste configurable, 45 s par défaut, avec les budgets `ROUTING_*` existants. Aucun contrôle de fiabilité n’a été retiré.

**Limites** : le cache et le limiteur sont en mémoire par processus. Plusieurs instances derrière une même IP doivent partager leur limiteur avant mise en production ; ce travail n’installe pas de coordination distribuée. Les requêtes annulées déjà envoyées peuvent néanmoins être comptées par le fournisseur. Une annulation navigateur est immédiate, mais une instruction SQLite synchrone ou un bloc CPU déjà commencé ne peut pas être interrompu au milieu par AbortSignal ; les phases et appels suivants vérifient le signal. Aucun journal d’itinéraire privé ni persistance d’adresse nouvelle n’est ajouté.

## Fichiers

Nouveaux : `server/search/{progress,shared,stream}.ts`, `src/types/searchProgress.ts`, `src/services/searchStream.ts`, `src/components/JourneyProgress.tsx`, `tests/search-progress.test.mjs`, scripts QA `benchmark-experience.mjs` et `validate-experience.mjs`, ce rapport et ses preuves.

Modifiés : `server/mobility/{provider,planner,api}.ts`, `server/journeys/{network,planner,api}.ts`, `server/gtfs/local.ts`, `src/services/{mobility,journeys}.ts`, `src/types/mobility.ts`, `src/components/{JourneyForm,GtfsSearchField,MobilityResults}.tsx`, `src/App.css`, scripts QA `validate-journeys.mjs`, `validate-horaires.mjs`, `validate-mobility.mjs`, README. Les scripts existants tiennent compte du flux, des résultats conservés et du délai de démarrage du navigateur. Ni la base importée, ni l’archive, ni la version publique n’ont été modifiées.

## Validation et lancement

`npm test` : **176 tests réussis**, dont 9 tests nouveaux sur le partage, l’annulation, les flux, les étapes réellement exécutées et l’absence d’appels IGN hors validité. Les fixtures de test restent exclusivement en mémoire, jamais dans la base TCL. `npm run lint` et `npm run build` passent.

La validation navigateur spécifique couvre : double soumission synchrone, étapes réelles, absence de fausse étape avant serveur, annulation d’un transport bloqué puis d’un calcul IGN réel, relance, erreurs HTTP/réseau, réponses successives, conservation des propositions, et mobile 320/390 px. Le retour visuel de l’annulation a été mesuré à **21,8 ms** dans la dernière série. Seuls les délais et échecs sont injectés par DevTools ; les propositions de succès viennent réellement du backend et du GTFS. Les captures sont conservées sous `.data/experience-validation-*`. Il s’agit d’émulation Edge, pas de tests sur appareils physiques.

Les suites existantes vérifient les trajets Lacassagne/Place Henri/Domrémy vers La Soie, les deux correspondances, le mode Arriver avant, heures répétées/inexistantes, Horaires et Favoris. Les horaires sont audités contre la base importée, aucun passage fictif ou temps réel ajouté.

**98 contrôles API/navigateur réussis** : réseau 12 (`.data/network-validation-1794166629605`), itinéraires/Favoris 27 (`.data/routing-validation-1794166746140`), Horaires 32 (`.data/validation-1794166851368`), mobilité IGN 18 (`.data/mobility-validation-1794166900488`), expérience 9 (`.data/experience-validation-1794167013753`). [Synthèse conservée](evidence/experience-validation.json). Les échecs intermédiaires du harnais (assertion qui sérialisait un nœud DOM, attente d’anciens résultats devenus persistants et démarrage navigateur trop court) ont été corrigés dans les scripts ; les séries citées passent intégralement.

Depuis `montrajet-lyon` : `npm run dev`. Vite lance également les API locales SQLite/IGN ; aucun deuxième service à démarrer. Pour les vérifications : `npm test`, `npm run lint`, `npm run build`, `npm run test:network`, `npm run test:journeys`, `npm run test:browser`, `npm run test:mobility`, `node scripts/qa/validate-experience.mjs`.
