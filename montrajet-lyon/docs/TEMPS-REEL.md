# Prochains passages Grand Lyon — préparation V0.1, accès bloqué

## 1. Résultat réel de l’accès

Le **8 novembre 2026 à 13 h 57 Europe/Paris**, une requête GET depuis Node.js, le même runtime que le backend local, a atteint l’URL demandée :

`https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json`

Réponse : **HTTP 401**, challenge `Basic realm="Access to data-ws"`, corps `Informations d'authentification non fournies.` Aucun identifiant technique n’est configuré. La première tentative en réseau restreint avait été bloquée par `EACCES` ; le test avec réseau autorisé a établi que le véritable blocage fournisseur est l’authentification. Voir [la preuve enregistrée](evidence/grandlyon-access-2026-11-08.json).

**Aucun enregistrement de passage officiel temps réel n’a été reçu. Le temps réel n’est pas opérationnel.** Aucun autre endpoint de données n’a été essayé pour contourner le refus ; les URLs CSV/SIRI publiées ne servent pas de moyen de contournement.

La [documentation d’authentification officielle](https://rdata-grandlyon.readthedocs.io/en/latest/authentification.html) distingue GrandLyon Connect du compte technique de la plateforme de données et documente HTTP Basic. Une connexion réussie au portail ne fournit donc pas automatiquement l’accès API. Aucun compte ni mot de passe n’a été créé ou modifié.

## 2. Documentation, conditions et fréquence

La [fiche publiée par la Métropole sur data.gouv.fr](https://www.data.gouv.fr/datasets/prochains-passages-du-reseau-transports-en-commun-lyonnais-et-rhonexpress-disponibilites-temps-reel) confirme **E = estimé**, **T = théorique** et le lien des horaires aux identifiants de l’offre théorique. Ses métadonnées publiques ont répondu HTTP 200 : dataset `62e4599505438a3d82d9feb7`, ressource JSON `17bb1ead-890f-458a-9b0b-d8d48e3fd006`.

Les [bonnes pratiques officielles](https://rdata-grandlyon.readthedocs.io/en/latest/bonne_pratique.html) demandent un intermédiaire serveur pour protéger les identifiants et recommandent de récupérer les données selon leur fréquence de mise à jour. La [documentation JSON](https://rdata-grandlyon.readthedocs.io/en/latest/services.html#rest-services-json) décrit le filtre `field`/`value`, la pagination et une limite par défaut de 1000 enregistrements.

**Aucun quota chiffré de requêtes ni intervalle d’actualisation autorisé propre à cette ressource n’a pu être confirmé.** La classification de licence du catalogue est `other-pd` ; elle ne remplace pas la vérification du texte de réutilisation applicable. Le lien de fiche GeoNetwork indiqué par les métadonnées ne fournit pas de dictionnaire exploitable lors de cette vérification (format XML : HTTP 404). Ces points doivent être clarifiés auprès du fournisseur avant activation.

La recherche Orbit n’a retourné aucun contrat TCL pertinent. La documentation du producteur et le test direct font donc foi. Postman CLI n’est pas installé : les scénarios de défaillance utilisent un vrai serveur HTTP local de test avec Node, sans installation globale ni publication d’une simulation.

## 3. Correspondance : non mesurable, contrat non confirmé

**Taux réel de correspondance : N/D**, et non 0 %. Dénominateur : aucun enregistrement reçu. Aucune ligne/quai ne peut être annoncé comme couvert en temps réel.

| Champ | Ce qui est établi / limite |
| --- | --- |
| `type` | E et T sont confirmés par la fiche du producteur. Seul E peut produire une estimation. |
| `coursetheorique` | Décrit officiellement comme référence à l’offre théorique. Égalité avec `trip_id` non vérifiée sur le flux actuel. |
| `id` | Candidat pour le point d’arrêt ; son égalité exacte à `stops.stop_id` et sa granularité quai restent à vérifier. |
| `idtarretdestination` | Son rôle précis et son référentiel ne sont pas confirmés par un dictionnaire accessible. Jamais assimilé automatiquement au quai demandé. |
| `gid` | Sémantique technique non confirmée. Jamais utilisé comme identifiant d’arrêt ou de direction. |
| `ligne` | Égalité avec `routes.route_id` non vérifiée ; aucun suffixe n’est supprimé pour forcer une correspondance. |

Un validateur strict est préparé, **désactivé par défaut** : égalité exacte arrêt, ligne et course, puis vérification que l’identifiant de destination existe plus loin dans la même course. Un quai homonyme, une course inconnue, une boucle ambiguë ou une direction incohérente est rejeté. Les libellés peuvent seulement invalider une jointure déjà établie par les identifiants, jamais créer une correspondance. Aucune recherche approximative par nom, proximité ou temps d’attente n’est utilisée.

Une fois l’accès autorisé obtenu, il faudra vérifier le dictionnaire actuel, les formats de dates, la relation à la version GTFS/calendriers, les variantes commerciales et le périmètre de chaque ligne sur un échantillon officiel. Les drapeaux de configuration ne constituent pas cette preuve. Si les identifiants diffèrent, il faudra une table de correspondance officielle et versionnée ; aucune heuristique n’est ajoutée.

## 4. Lignes et arrêts réellement couverts

| Ligne demandée | Repli GTFS testé sur la base réelle | Couverture temps réel |
| --- | --- | --- |
| C13 | Oui | Non déterminable : accès 401 |
| C9 | Oui | Non déterminable : accès 401 |
| C16 | Oui | Non déterminable : accès 401 |
| 125 | Oui | Non déterminable : accès 401 |
| T3 | Oui | Non déterminable : accès 401 |

La validation navigateur GTFS reste basée sur Place Henri, Domrémy-Lacassagne, Dauphiné-Lacassagne et Vaulx-en-Velin La Soie : 27 couples ligne/quai, 315 horaires. Ces chiffres sont **théoriques GTFS**, pas une couverture du temps réel.

## 5. Fonctionnalités ajoutées

- Client HTTP **côté serveur uniquement**, URL fournisseur fixe, aucune URL de proxy arbitraire ni authentification dans le JavaScript livré au navigateur.
- Endpoint applicatif `GET /api/realtime/passages?lineId=…&stopId=…`. Il vérifie d’abord que le quai appartient à la ligne GTFS. Le GTFS existant reste séparé et inchangé.
- Cache mémoire borné à 128 quais, coalescence des demandes simultanées, espacement global des tentatives dans le client, pas de polling automatique ni de relance cachée après 401/403. Respect de `Retry-After` sur 429/503.
- Timeout réseau, taille de réponse bornée, contrôle UTF-8/JSON, refus des réponses tronquées/paginées ou des lignes incomplètes. Les redirections ne sont pas suivies avec les identifiants.
- Protection contre les régressions temporelles : une réponse plus ancienne ou invalide ne remplace pas un cache encore frais. L’expiration d’origine n’est jamais prolongée. La page conserve elle aussi ses dernières estimations fraîches en cas d’échec du backend, puis les retire à expiration.
- Horodatages explicites préférés ; pour les heures locales Europe/Paris, refus des heures ambiguës ou inexistantes aux changements d’heure. Aucune transformation de `delaipassage` textuel en horaire inventé.
- Affichage séparé « Temps réel estimé » / « Horaire théorique », heure d’actualisation de la source et de réception, état explicite d’indisponibilité et bouton d’actualisation soumis au cache serveur. En consultation datée, aucune requête temps réel n’est envoyée.
- Adaptateur Pages Functions/D1 et cache serveur Cloudflare préparés, sans module Node côté Function ni produit payant. Le cache Cloudflare est local au centre de données ; l’espacement mémoire ne coordonne pas tous les isolates. Une coordination et un budget de requêtes globaux restent nécessaires avant un éventuel déploiement. **Aucun déploiement effectué.**

Avec l’état actuel, l’interface dit que l’authentification serveur n’est pas configurée, affiche « Dernière actualisation de la source : indisponible » et conserve les horaires théoriques. Aucune estimation officielle n’est annoncée ou affichée.

## 6. Configuration préparée, non activée

Les noms suivants sont exclusivement serveur, chargés par Vite ou par les bindings Cloudflare. Aucun secret réel n’est écrit dans un fichier, log ou rapport ; `.env*` est ignoré par Git et refusé par Vite. Ne pas utiliser de préfixe `VITE_` pour des identifiants.

| Variable | Rôle / défaut technique |
| --- | --- |
| `GRANDLYON_USERNAME`, `GRANDLYON_PASSWORD` | Identifiants techniques autorisés ; absents actuellement. |
| `GRANDLYON_POLICY_CONFIRMED` | Doit valoir `true` seulement après validation licence/fréquence ; faux actuellement. |
| `GRANDLYON_MAPPING_CONFIRMED` | Doit valoir `true` après vérification du contrat actuel ; faux actuellement. |
| `GRANDLYON_STOP_PASSAGES_CONFIRMED` | Verrou serveur distinct pour la ligne, le quai, la course et le calendrier exacts ; faux par défaut. N’active jamais l’ajustement des itinéraires. |
| `GRANDLYON_MIN_INTERVAL_MS` | 60 000 ms entre tentatives du client, réglage technique, pas un quota officiel. |
| `GRANDLYON_CACHE_TTL_MS` | 60 000 ms, au moins l’intervalle configuré. |
| `GRANDLYON_MAX_AGE_MS` | 120 000 ms au maximum pour une donnée source affichable, réglage de prudence. |
| `GRANDLYON_TIMEOUT_MS` | 5 000 ms. |

**Ces valeurs ne constituent pas une autorisation de requêter à cette fréquence.** En l’absence d’identifiants ou d’une confirmation, le client ne fait aucun appel fournisseur. Aucune intervention manuelle dans les fichiers n’est demandée pour cette livraison. Le déblocage dépend d’un accès technique autorisé et des informations manquantes du fournisseur, pas d’un abonnement ajouté à l’application.

## 7. Tests et limites des preuves

```powershell
cd montrajet-lyon
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser
```

Les tests couvrent identifiants, quais homonymes, destinations/directions, E/T, dates invalides et DST, départs passés, vieillissement, cache/coalescence, 401/403/429/503, redirections, timeout, HTML/JSON invalide, réponses incomplètes, régressions et conservation des données fraîches. Les scénarios HTTP positifs sont des **fixtures `TEST_`**, confinées aux tests ; aucun faux horaire TCL n’est chargé dans SQLite ni montré comme réel dans l’application.

Les cinq lignes réelles sont testées sans appel fournisseur : estimation absente et taux N/D, avec repli GTFS opérationnel. Le scénario Edge vérifie l’état non configuré, l’absence d’étiquette estimée, le repli visible et l’absence de requête directe du navigateur à Grand Lyon. Les captures et résultats complets sont conservés dans `.data/validation-<date>/`.

Ce qui n’est pas démontré : accès authentifié 200, schéma réel actuel, taux de jointure, couverture des lignes/quais, fraîcheur réelle et affichage de véritables estimations Grand Lyon. Ces éléments restent bloqués ; les tests locaux ne les remplacent pas. La version publique reste **V0.1**.

## Résultats finaux enregistrés

- `npm.cmd test` : **90 tests réussis**, aucun échec ni test ignoré.
- `npm.cmd run lint` : réussite sans avertissement.
- `npm.cmd run build` : TypeScript et Vite réussis.
- `npm.cmd run test:browser` : **32 contrôles fonctionnels réussis**, aucune exception JavaScript, aucun appel direct à Grand Lyon, six captures desktop/mobile conservées.
- Rapport de cette exécution : `.data/validation-1794143793795/report.json` ; capture du repli réel : `.data/validation-1794143793795/temps-reel-indisponible-repli-gtfs.png`.
- Vérification du build : aucun nom de variable d’identifiants Grand Lyon, en-tête Basic ou URL du fournisseur dans les fichiers livrés au navigateur.

## Fichiers livrés

- `server/realtime/` : configuration, client HTTP/cache, horodatages, validation des jointures, endpoint et adaptateur de cache Edge.
- `server/gtfs/local.ts` : raccordement de l’endpoint temps réel au même Vite, avec isolation des erreurs de configuration ; requêtes et calculs GTFS conservés.
- `functions/api/realtime/passages.ts` : adaptateur Cloudflare non déployé.
- `src/types/realtime.ts`, `src/services/realtime.ts`, `src/components/RealtimePassages.tsx` : contrat, client applicatif, conservation des données fraîches et affichage distinct.
- `src/components/Timetable.tsx`, `src/App.tsx`, `src/App.css` : raccordement et textes adaptés, palette V0.1 préservée.
- `tests/realtime-*.test.mjs`, `tests/helpers/realtime.mjs`, `scripts/qa/validate-horaires.mjs` : tests de contrat, HTTP local, base réelle, UI et repli.
- `.gitignore`, `README.md`, ce rapport et `docs/evidence/grandlyon-access-2026-11-08.json` : protection des fichiers d’environnement et documentation des preuves/blocages.

Aucune dépendance ajoutée, aucune donnée GTFS réimportée ou modifiée, aucun identifiant écrit, aucun service payant, aucun déploiement et aucun changement de version publique.
