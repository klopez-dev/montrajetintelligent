# Trafic TCL — V0.1

> État de la première intégration du 8 novembre 2026. La [fiabilisation du 9 novembre](FIABILISATION-TRAFIC.md) décrit la couverture individuelle, l’extension bornée, les récurrences, les 13 annonces réellement obtenues et les dernières validations. Les chiffres ci-dessous restent les preuves historiques de l’intégration initiale.

## Verdict et source réellement utilisée

**PARTIELLEMENT OPÉRATIONNEL.** Des annonces officielles réelles ont été récupérées depuis les fiches publiques TCL et sont affichées dans Trafic. La couverture est limitée et les rapprochements GTFS restent partiels ; aucune certification de disponibilité de chaque course ou quai n’est annoncée.

L’API officielle Grand Lyon `tcl_sytral.tclalertetrafic_2/all.json` est bien référencée par SYTRAL mais répond **HTTP 401**. Elle n’est pas activée, aucun identifiant n’a été inventé et aucun autre hôte ou format n’a servi de contournement. Les passages temps réel Grand Lyon restent désactivés également.

Le fournisseur actif lit exclusivement [la page publique Infos trafic](https://www.tcl.fr/infos-trafic) et les fiches de lignes qu’elle publie réellement. Il n’invente aucune URL pour une ligne absente, n’utilise aucune clé de widget, API interne, carte, image ni événement routier général. Les annonces sont restituées intégralement en texte, avec leur source et leurs liens TCL.

## Sources, accès et conditions

L’inventaire détaillé, les URLs, licences, preuves HTTP, fréquence inconnue et décision préalable se trouvent dans [SOURCES-TRAFIC.md](SOURCES-TRAFIC.md).

Les [mentions légales TCL](https://www.tcl.fr/mentions-legales) autorisent la reproduction d’informations pour un usage non commercial et sans publicité, avec attribution, date et intégrité des éléments reproduits. Les chemins concernés ne sont pas interdits par le `robots.txt` consulté. L’application correspond à ce périmètre gratuit. Les textes intégraux sont préservés, avec la mention de source et l’indication **date de mise à jour non fournie**, suivie de la date réelle de récupération ; aucune date de publication n’est inventée.

Le fournisseur revérifie robots et permission publique au premier cycle réseau puis au plus toutes les 24 heures. Un refus HTTP, une restriction robots, une permission non reconnue ou une structure HTML modifiée suspend la collecte. Les conditions devront être revérifiées avant un éventuel déploiement, qui n’est pas effectué.

Le PAN annonce SIRI Lite pour Lyon mais exige l’authentification producteur ; aucun flux lyonnais Service Alerts GTFS-RT/SIRI-SX anonyme documenté n’a été établi. La découverte Orbit n’a pas fourni de candidat TCL pertinent ; ses résultats d’autres villes sont exclus. Aucun compte ou espace Postman n’a été créé ; les vérifications utilisent les outils Node et Edge locaux.

## Données réelles et couverture observée

Première collecte réelle depuis le backend Node : **8 novembre 2026 à 21:04:36 Europe/Paris**, **9 annonces distinctes**, après déduplication exacte du contenu et de la période.

| Ligne demandée | Annonces récupérées | Correspondance GTFS | Limite |
|---|---:|---|---|
| C13 | Non déterminable | Ligne GTFS présente | Aucun lien de fiche d’annonce retenu dans la page publique consultée |
| C9 | Non déterminable | Ligne GTFS présente | Même limite ; ne signifie pas trafic normal |
| C16 | 3 | Partielle : code commercial et mode bus | Quais, courses et directions non identifiés structurellement |
| 125 | Non déterminable | Ligne GTFS présente | Aucun lien de fiche d’annonce retenu |
| T3 | 2 | Partielle : code commercial et mode tramway | Texte officiel détaillé disponible, sans correspondance automatique de quai |
| Métro A | Non déterminable | Ligne GTFS présente | Aucun lien de fiche d’annonce retenu |
| Métro D | 4 | Partielle : code commercial et mode métro | Courses et quais non identifiés structurellement |

À cet instant, le classement prudent donne **3 annonces en cours, 3 à venir et 3 de période indéterminée**. Ce comptage est daté ; le statut est recalculé selon l’heure de consultation. Un temps de récupération récent n’est pas présenté comme une preuve de date de publication récente.

Taux sur le seul échantillon reçu : **9/9 annonces associables partiellement à une ligne GTFS (100 %)** ; **0/9 par identifiant exact vérifié (0 %)** ; 3 lignes distinctes couvertes sur les 7 prioritaires. **Rapprochement des arrêts : non mesurable**, car aucun identifiant de quai n’est fourni de façon structurée par ces fiches. Aucun faux taux 0 % sur un dénominateur vide.

La page ne publiant pas de lien exploitable pour certaines lignes, le module ne crée pas de lien par extrapolation et n’affirme jamais que ces lignes fonctionnent normalement. Les travaux complémentaires restent accessibles par lien vers la page officielle, sans exploration récursive du site.

## Fonctionnalités opérationnelles

- Onglet Trafic : annonces, filtre par ligne, mode et date, groupes En cours / À venir / Période à vérifier / Terminées, détails, texte intégral, période originale, liens officiels, attribution et date de récupération.
- États distincts : chargement, aucune annonce connue pour le filtre, fournisseur indisponible, cache ancien, erreur HTTP ou structure inconnue. L’absence d’annonces n’est jamais assimilée à l’absence de perturbation.
- Filtres : les annonces aux périodes non interprétables restent visibles par prudence, avec un avertissement. « En cours » se rapporte à maintenant, pas à une date future sélectionnée.
- Vigilance asynchrone sur les itinéraires : les résultats GTFS sont affichés sans attendre la collecte Trafic. Chaque avertissement nomme la proposition et le tronçon concernés et fournit le lien officiel.
- Trois niveaux préparés : impact confirmé, possible, information générale. Dans le flux HTML actuel, **aucun impact précis de quai/course n’est déclaré confirmé**. Un code de ligne partagé ne suffit pas à affirmer qu’une course est supprimée.
- Les dates réelles des tronçons sont **reconstruites côté serveur depuis SQLite** avec trip, jour de service et séquences ; les horaires éventuellement envoyés par le navigateur ne font pas autorité. Les arrêts intermédiaires, calendriers et exceptions sont contrôlés.
- Aucune suppression automatique d’itinéraire, aucune déviation ou marche inventée, aucun horaire alternatif généré.
- L’expiration est contrôlée aussi dans le navigateur, sans nouvelle requête automatique. Les avertissements de trajet issus d’un cache périmé ne sont plus présentés comme vérifiés.

## Normalisation et exactitude

Le modèle TypeScript prévoit producteur, source, dates de collecte/publication/mise à jour, type, gravité officielle, lignes, directions, arrêts, suppressions et reports, remplacements, périodes multiples, précision temporelle et précision GTFS. Les champs non confirmés restent absents. Le type demeure `other` quand la source ne fournit pas une classification structurée ; aucune analyse approximative de texte ne fabrique des arrêts ou directions.

Les noms de quais ne servent **jamais** de correspondance automatique. Un identifiant officiellement déclaré dans l’espace GTFS et existant dans la base peut être exact dans le contrat d’un futur fournisseur ; `line:SYTNEX:T3` n’est pas arbitrairement déclaré identique à la route GTFS `T3`. Le rapprochement actuel code commercial + mode est explicitement partiel et recalculé contre la base courante à chaque réponse.

Une période complète `Du JJ/MM/AAAA à HH:mm au JJ/MM/AAAA à HH:mm` est convertie en Europe/Paris. Une heure locale ambiguë ou inexistante n’est pas devinée. Les intervalles sont traités avec fin exclusive. Les horaires GTFS dépassant 24 h utilisent l’origine du jour de service déjà validée du moteur.

Les phrases mêlant liste de jours, fourchette de dates et horaires nocturnes sont conservées intégralement. Exemple dans les annonces réellement reçues : une plage globale et des soirées sélectionnées ne sont pas transformées en interruption continue. Une date de début civile certaine peut permettre le classement « À venir » ; à l’intérieur d’une période complexe non interprétée, le statut reste indéterminé et l’avertissement général.

Les fiches n’offrent pas toujours d’identifiant d’incident. L’identité locale est donc une empreinte SHA-256 du contenu et de sa période, marquée `content-derived`, stable pour un contenu inchangé. Une modification de contenu peut changer cet identifiant ; la photographie complète remplace atomiquement la précédente, sans accumuler les incidents disparus. Ce n’est pas un identifiant officiel pérenne à travers toutes les mises à jour.

## Collecte, cache et consommation

Un cycle consulte la page d’index puis **uniquement les liens des sept lignes prioritaires réellement présents** : au plus 8 pages de données. Deux pages supplémentaires (robots et mentions) sont vérifiées au premier cycle réseau et au renouvellement de la vérification des droits. Dans la collecte observée : **6 requêtes** (2 politiques + index + 3 fiches).

Limites techniques conservatrices, non assimilées à des quotas publiés par TCL : un cycle au plus toutes les **10 minutes par processus**, séquentiel, **1 seconde entre départs**, délai par page **8 s**, délai global **45 s**, corps UTF-8 strict borné à **1,5 Mo par page**, au plus 100 annonces par fiche. Les demandes simultanées partagent la même collecte. Aucun polling fournisseur par navigateur, aucun rechargement réseau à chaque filtre. `Retry-After` sur 429/503 est respecté sans relance immédiate ; les redirections ne sont pas suivies.

Le cache mémoire ne conserve qu’une photographie bornée par ces plafonds. L’adaptateur Node conserve aussi `.data/traffic-official-cache-v1.json`, hors du bundle navigateur, avec empreinte d’intégrité et contrôle de format. Un cache inconnu ou corrompu est ignoré et n’est pas écrasé ; les instantanés officiels validés sont remplacés atomiquement. Le redémarrage ne modifie ni `fetchedAt` ni `validUntil`. Aucun fichier GTFS source n’est modifié. Le cache persistant initial a été restauré depuis la **première collecte réelle enregistrée**, avec ses dates originales, jamais depuis une fixture synthétique.

Si le fournisseur échoue, la dernière photographie est conservée **avec son âge réel** ; elle devient périmée à expiration. Une tentative supplémentaire de cet audit a rencontré un timeout : ce blocage intermittent est réel et documenté, pas caché par une fausse réussite. Un fichier de cache public n’est ni une preuve cryptographique d’authenticité de l’éditeur ni un contrat de disponibilité.

Mesures de la première collecte (une mesure froide, pas un percentile de production) : **28,17 s HTTP**, dont **28,09 s de fournisseur**, 6 appels. Les sept consultations suivantes avec cache : **3,42 à 9,38 ms HTTP**, médiane environ **5,04 ms**, **0 appel fournisseur supplémentaire**. Les recherches d’itinéraires ne sont pas bloquées pendant ces 28 secondes ; la vérification trafic est séparée.

## API et architecture

- `GET /api/traffic?line=T3&mode=tram&date=2026-11-09` : photographie officielle filtrée, état et âge, couverture, métriques, précision GTFS. Les filtres sont validés ; une date impossible donne HTTP 400.
- `POST /api/traffic/journeys` : `{ journeys: [[{ tripId, serviceDate, from: { id, sequence }, to: { id, sequence } }]] }`. Maximum 6 propositions de 3 tronçons, corps de 32 ko. Identifiants, séquences, jours actifs et plages des tronçons sont reconstruits dans SQLite. Retour : même état fournisseur et listes `notices`, sans modification des itinéraires.
- Les erreurs de transport API sont HTTP 4xx/5xx ; une source TCL indisponible reste un résultat métier explicitement `unavailable` ou `stale`, jamais un faux tableau « réseau normal ».
- Fournisseur et API Web sans modules Node ; le cache disque est séparé dans un adaptateur local. Un adaptateur Pages Functions/D1 est fourni, inactif. parse5 8.1.1, libre sous licence MIT, est la seule dépendance ajoutée ; il n’exécute aucun script du site. Aucun secret n’est envoyé au navigateur.

Le cache et le limiteur mémoire sont propres à chaque processus/isolate. **La coordination de plusieurs instances, le cache partagé Cloudflare et les limites CPU de l’offre gratuite ne sont pas certifiés.** Ne pas multiplier les instances avant coordination. Aucun déploiement ni service payant n’est activé.

## Fichiers créés ou modifiés

Créés : `src/types/traffic.ts`, `src/services/{traffic,trafficTime}.ts`, `src/hooks/useTrafficClock.ts`, `src/components/{Traffic,JourneyTraffic}.tsx`, `server/traffic/{html,time,provider,localCache,matching,api}.ts`, `functions/api/traffic/[[path]].ts`, `tests/traffic.test.mjs`, `scripts/qa/{audit-traffic-sources,validate-traffic}.mjs`, les deux rapports Trafic et leurs preuves.

Modifiés : `src/App.tsx`, `src/App.css`, `src/components/JourneyForm.tsx`, `server/gtfs/local.ts`, `package.json` et `package-lock.json` (dépendance uniquement), README, scripts QA `validate-network.mjs` (annulations réseau attendues distinctes des erreurs) et `validate-journeys.mjs` (attendre la nouvelle réponse, même avec anciens résultats conservés et cache très rapide). Les algorithmes et horaires GTFS, Favoris et la version publique V0.1 sont conservés.

## Tests et limites

Les **14 tests Trafic** utilisent des fixtures synthétiques exclusivement isolées dans les tests et des bases SQLite en mémoire. Ils couvrent actif/futur/terminé, fin ouverte, plages disjointes, minuit, changements d’heure, directions, déviation, interruption générale, arrêts intermédiaires et homonymes, identifiants incompatibles, correspondance partielle/exacte, panne HTTP/réseau, réponse vide explicitement normale distincte d’une absence de données, réponse malformée/surdimensionnée, restrictions robots/droits modifiés, cache partagé et persistant, contenu modifié ou retiré, non-écrasement des fichiers inconnus et calendrier GTFS réel du contrat.

La vérification Edge utilise les **annonces réelles** du serveur local. Seuls les états d’erreur et de péremption sont injectés dans le navigateur de test, explicitement identifiés. Les contrôles visuels utilisent l’émulation 320 et 390 px, pas des téléphones physiques. Les suites existantes contrôlent les deux correspondances, les trajets Lacassagne → La Soie, Horaires C13/C9/C16/125/T3 et Favoris.

Pour reproduire : `npm test`, `npm run lint`, `npm run build`, `node scripts/qa/validate-traffic.mjs`. Le dernier script partage un seul serveur entre Trafic et les quatre suites de non-régression, afin de réutiliser le cache fournisseur. Les preuves brutes restent dans `.data/traffic-validation-*`, la synthèse dans `docs/evidence/traffic-validation.json`.

Résultats finaux : **190 tests automatisés réussis**, linter sans avertissement, compilation réussie, **98 contrôles API/navigateur** (9 Trafic, 12 moteur étendu, 27 itinéraires/Favoris, 32 Horaires, 18 mobilité). Série complète réussie : `.data/traffic-validation-1794168768031/`. La dernière série ciblée `.data/traffic-validation-1794169128002/` vérifie en plus les filtres mode/date et le rendu réel des avertissements T3 ; les quatre suites déjà passées n’y sont pas répétées. Aucune exception JavaScript dans cette série.

Le renouvellement réel suivant a récupéré les mêmes neuf annonces à **21:15:38 Europe/Paris**. La dernière série ciblée utilise ce cache encore valide et confirme **zéro appel TCL sur tout son processus**, compteur cumulatif à l’appui ; aucune date n’est repoussée lors des lectures. Les scripts de non-régression ont nécessité deux corrections du harnais : distinguer une requête annulée d’une erreur réseau et attendre la nouvelle réponse réseau lorsque l’ancien résultat reste présent. Les assertions d’horaires et de cohérence SQLite sont conservées.

Limites principales : couverture partielle des lignes ; absence de dictionnaire d’identifiants commun ; aucune cartographie structurée de quais, direction ou report dans le flux HTML ; récurrences complexes non interprétées ; publication/mise à jour non renseignée ; dépendance à une structure HTML et à une source intermittente. L’extraction d’un texte n’autorise pas à affirmer qu’un trajet précis est impossible.

Pour la suite : obtenir un accès légitime et les conditions exactes du flux officiel Grand Lyon, son dictionnaire d’identifiants et sa fréquence autorisée ; préférer ensuite un contrat structuré Service Alerts/SIRI-SX vérifié. Déployer un cache/limiteur global seulement après validation de l’architecture gratuite. Ne pas ajouter de correspondances de quais par similarité de noms.
