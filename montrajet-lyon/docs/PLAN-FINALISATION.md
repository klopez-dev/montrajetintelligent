# Plan de finalisation à coût zéro — MonTrajet Lyon V0.1

Établi le **9 novembre 2026**. Ce plan se fonde sur les mesures de [l'audit](AUDIT-GRATUITE.md) et compare les options dans [l'architecture cible](ARCHITECTURE-CIBLE-GRATUITE.md). Il ne déclenche aucun déploiement ou automatisme distant. **Verdict actuel : ARCHITECTURE À REVOIR.**

## 1. Ce qui a été fait pendant cette mission

- Lecture des modules frontend, serveur, import, adaptateurs, tests et documentation ; contrôle des dépendances Node/fs/processus et caches.
- Consultation des documentations officielles et tests d'accès limités aux fournisseurs : ZIP HEAD 401, temps réel GET 401, robots/mentions TCL et politique OSM 200 ; marches/géocodage IGN réels pendant les mesures.
- Ajout de scripts d'audit isolés : taille/index GTFS, représentation binaire, copie SQLite compacte réversible, CPU/SQL/réseau/mémoire/sérialisation, protections HTTP et accès fournisseurs.
- Exécution des tests : **228 réussis**, linter et build réussis ; npm audit sans vulnérabilité connue signalée. Les preuves et limites méthodologiques sont dans l'audit.
- Aucun module métier, adaptateur de production, paramètre de routage, favori personnel, archive ou base active n'a été changé. Seuls les outils d'audit, leurs trois tests, les rapports et leur lien README sont ajoutés.

## 2. Étapes proposées et portes de décision

| Priorité / étape | Travail Codex suivant | Critère de sortie | Gratuité / décision |
| --- | --- | --- | --- |
| **P0 — Accès et droits** | Identifier le jeu GTFS courant exact, ses conditions, le chemin d'accès autorisé et le renouvellement ; documenter Licence Mobilité/CGU et redistribution des dérivés | Preuve datée du producteur, téléchargement légal testable sans offre payante ; aucun contournement du 401 | **NON VÉRIFIÉ** jusqu'à obtention des droits/conditions nécessaires ; ne pas publier des partitions sur une hypothèse ODbL |
| **P0 — Prototype local C** | Compilateur versionné avec manifeste, décodeur typé et index ; chargement d'une journée et des jours adjacents utiles ; portage contrôlé de la couche de calcul vers un worker navigateur | Reconstruction des données, comparaison avec SQLite, mêmes contrôles métier et périmètre ; compteurs réels de taille, CPU et mémoire | **COMPATIBLE SOUS CONDITIONS** ; étape recommandée après clarification des droits, aucune publication |
| **P0 — Comparaison finale C / A / D** | Tester le prototype et, seulement si nécessaire, un chemin alternatif de données compactes sur runtime Cloudflare local | Décision documentée sur les mesures ; pas de sélection sur la seule taille de base | Le fichier compact actuel est une preuve de réduction, pas un serveur prêt |
| **P0 — Quotas et sécurité** | Limites de lecture des corps en flux, caches TTL/LRU en octets, contrôles de concurrence et quotas globaux IGN/TCL, logs sans adresses, traitement des erreurs | Tests d'abus, remplissage des caches, pertes de coordinateur et redémarrages ; aucun trafic amont incontrôlé | Produit Free uniquement ; refuser l'usage en cas de limite, pas d'activation payante |
| **P1 — En-têtes et packaging** | Routage statique/API, CSP compatible MapLibre, anti-injection/clickjacking, Referrer-Policy compatible OSM, HTTPS, licences et mentions | Vérifications sur serveur candidat local ; packaging sans ZIP/SQLite/secrets ; pas de requête dynamique inutile pour assets | **COMPATIBLE SOUS CONDITIONS**, aucun besoin de domaine acheté |
| **P1 — Renouvellement des données** | Pipeline staging, validations et manifeste atomique, sauvegarde du jeu précédent, simulation d'échec et rollback | Nouveau jeu réellement testé et vérifié, retour arrière reproductible sans écraser l'actif | Local par défaut ; CI éventuelle seulement après validation des accès et quotas |
| **P1 — Validation complète** | Horaires, itinéraires, favoris, trafic, carte, adresse/marche ; cache froid/chaud ; vrais mobiles ; runtime candidat | Parité et performances admissibles sur cas courts/longs, DST/minuit, erreurs et annulations | Aucune promesse de capacité non mesurée |
| **P2 — Préparation publication** | Dossier de release, configuration Free, sous-domaine disponible, budget technique, page de statut/dégradations, rollback | Tous les points P0/P1 fermés, preuves présentées pour revue | **Aucun déploiement avant autorisation explicite** ; V0.1 conservée sauf instruction distincte |

L'étape suivante n'est pas une importation du SQLite actif sur D1 ni la mise en ligne du dossier `dist` avec ses APIs supposées fonctionnelles. La mise en ligne d'un simple frontend casserait les calculs et la carte nécessitant encore les APIs locales.

## 3. Optimisations à expérimenter, sans changer les règles métier

| Levier | Constat mesuré / code actuel | Expérience et garde-fou |
| --- | --- | --- |
| Représentation des horaires | 61,67 % de la base sont des index ; copie numérique réversible réduite de 59,77 % | Tester IDs numériques, index adaptés et tableaux typés ; préserver toutes les séquences, types pickup/dropoff, headsigns et valeurs nulles ; comparer les résultats avant de remplacer quoi que ce soit |
| Topologie | 41 691 lignes chargées ; reconstructions autour de 72–83 ms | Précompiler des index immuables liés à la SHA, formats compacts ; ne pas conserver plusieurs copies d'objets pour chaque planificateur |
| Profils du moteur | Les recherches échantillonnées atteignent des budgets et signalent `limited` | Index de routes/patterns et dominance à prouver sur petites fixtures exhaustives ; ne pas abaisser les budgets ou cacher le statut partiel pour annoncer un gain |
| IGN | 48 parcours peuvent être demandés ; file volontairement lente, un échec peut être retenté lors d'un calcul chaud | Réutiliser les marches valides et regroupements identiques ; cache des accès lié aux paramètres et à la validité, TTL/poids bornés ; ne jamais transformer un échec en parcours positif |
| Caches géographiques | Des clés varient avec chaque heure ; certaines Maps sans plafond | LRU en octets + TTL, budget global et nettoyage actif ; tests de plusieurs milliers de clés sans requêtes réelles aux fournisseurs |
| Sérialisation | Petit coût sur les réponses finales mesurées | Priorité inférieure aux gros objets et à l'exploration ; conserver la géométrie IGN nécessaire à la carte, pas de marche supplémentaire pour afficher |
| Fournisseurs lents | 25,5 s observées sur une recherche adresse→arrêt ; première répétition chaude encore 1,34 s après un échec non caché | Conserver phases réelles, Annuler, origine de l'erreur et résultats précédents ; pas de progression fictive ni de retries en boucle |

Chaque essai devra être mesuré avant/après sur les mêmes entrées et environnements, avec plusieurs processus froids et plusieurs répétitions chaudes. Une moyenne sur des requêtes identiques entièrement en cache ne décrit pas les nouveaux trajets.

## 4. Mise à jour gratuite et vérifiable du GTFS

### Processus cible, non activé

1. **Obtenir l'accès officiel autorisé.** L'URL historique répond 401 en HEAD ; pas de téléchargement authentifié validé ici. Un compte fournisseur gratuit éventuel reste distinct d'un compte utilisateur dans MonTrajet. Conserver les secrets hors navigateur, dépôt, arguments de commande et logs ; aucune création de compte ou message au producteur automatique.
2. **Vérifier une fois par jour au départ**, sans supposer que le contenu change quotidiennement : méthode et fréquence à aligner sur les conditions du producteur. ETag/Last-Modified si disponibles, délais, Retry-After et arrêt au 401/403/429. Une absence d'en-tête ne doit pas entraîner une collecte massive. Aucun téléchargement depuis un miroir non vérifié.
3. **Télécharger dans un fichier staging neuf**, taille et expansion bornées, protocole/hôte autorisés, pas de redirection vers un hôte non validé. Refuser une page de connexion renommée ZIP ; conserver URL, date, statut et SHA-256. L'empreinte assure l'intégrité/répétabilité, pas une signature d'authenticité du producteur.
4. **Importer dans un nouveau répertoire.** Réutiliser l'import transactionnel, validation CSV/CRC, clés, horaires >24 h, calendriers et exceptions. Les `frequencies.txt` non pris en charge restent bloquants, pas transformés en départs exacts. Ne pas recopier par-dessus `.data/gtfs.sqlite`.
5. **Vérifier validité et différences** : schéma, nombres, lignes/quais, transferts, dates couvertes et jours sans service. Les horaires après minuit dépendent du jour de service ; une comparaison naïve à minuit civil serait incorrecte. Alerter provisoirement à J−14 puis J−7 de la fin des jours de service, en distinguant ces seuils opérationnels de la fréquence officielle de publication, inconnue.
6. **Tester réellement la candidate.** Les tests locaux de données et scripts Edge contiennent encore des chemins `.data/gtfs.sqlite` et des dates de novembre 2026. Les rendre injectables pour la candidate et dériver des jours valides ; garder séparément les fixtures calendaires/DST déterministes. Le fait de définir `GTFS_DB` dans Vite ne redirige pas magiquement tous les tests vers la candidate.
7. **Préparer les assets de production** uniquement après décision de format : manifeste par empreinte, checksums, catalogue, groupes horaires, attribution/licence, bilan de taille/mémoire et contrôle d'exposition. Le catalogue de couleurs actuel refuse une source différente : prévoir aussi une sortie versionnée plutôt que son écrasement.
8. **Revue puis activation atomique autorisée.** Avant autorisation, rester en staging local. Conserver au moins le manifeste et les fichiers du jeu actif et précédent ; ne pas publier un nouveau manifeste avant ses partitions. N'accepter aucun mélange de versions dans une même recherche.
9. **Rollback.** Pointer vers l'ancien manifeste/dataset déjà validé ; contrôler les favoris par IDs, invalider les caches dépendants de la SHA et revalider une recherche. L'ancienne version n'est pas une solution si sa validité est déjà dépassée : afficher l'indisponibilité au lieu de réutiliser ses dates.

Le pipeline existant ne fournit pas encore un téléchargement authentifié, une activation/rollback orchestrés, un format statique routable ou un test complet de nouvelle candidate. Le rapport d'import actuel constitue un bon point de départ, pas une chaîne de production automatisée.

### Automatisations à coût nul

L'exécution locale reste le choix initial : Node 24 et machine existante, sans service supplémentaire. Le temps humain, le courant et la connexion ne sont pas déclarés nuls. Un planificateur local peut être étudié ultérieurement ; rien n'est installé ou lancé de façon récurrente par cette mission.

GitHub Actions est facultatif : [runners standards gratuits en dépôt public](https://docs.github.com/en/actions/concepts/billing-and-usage), et [allocations GitHub Free en privé](https://docs.github.com/en/billing/concepts/product-billing/github-actions) de 2 000 minutes/mois et 500 MB d'artefacts. Sans moyen de paiement, dépassement = blocage, pas achat de minutes. Les gros runners sont exclus. Une seule SQLite actuelle approche déjà l'allocation d'artefacts ; archiver plusieurs copies avec ZIP/profils Edge la dépasserait. Réduire la rétention et ne pas conserver les profils navigateur ni données personnelles.

Un dépôt public ne doit pas être créé/ouvert automatiquement pour obtenir des minutes : cela nécessite une décision sur le code et les droits des données. Les [tâches GitHub planifiées](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) peuvent être retardées/supprimées et désactivées après 60 jours sans activité en public. Ce n'est pas un service garanti de mise à jour du GTFS. Le Cron Workers ordinaire ne convient pas à un import lourd ; sa durée murale disponible ne remplace pas son budget CPU.

## 5. Tests de validation avant toute publication

- Source et licence exactes archivées, accès renouvelable autorisé, absence de carte bancaire et d'offre payante dans les ressources retenues.
- Mise à jour candidate, interruption à chaque étape, checksums incorrects, fichiers manquants et rollback ; aucun écrasement de l'actif.
- Parité de trajets directs, une/deux correspondances, modes Partir à/Arriver avant, transferts orientés et minima, calendriers, exceptions, après-minuit et changements d'heure.
- Favoris : migration, fermeture/réouverture, recalcul indépendant aller/retour, adresses/quais périmés, stockage saturé ou corrompu.
- IGN : absence d'appels passifs, coalescence, cache directionnel/expiration, 429/503/timeout, échec du coordinateur et charge de plusieurs clients simulée hors fournisseur réel.
- Trafic : données périmées ou non consultées jamais présentées comme normales, textes/dates/sources conservés, aucune collecte massive.
- Carte : proposition et étapes correctes, annulation d'ancienne récupération, absence de nouveau calcul IGN, perte tuiles/WebGL et mode sans fond ; pas de tracé TCL inventé.
- Desktop/tablette/mobile 320/390 px, clavier et lecteur d'écran ; appareils mobiles réels pour mémoire/CPU/consommation réseau, pas uniquement émulation.
- Runtime cible local : bundle et démarrage réels, mesures CPU/mémoire, métadonnées SQL si D1 retenu, quota dépassé, API rejetée proprement, assets encore accessibles, aucune bascule payante.
- HTTPS/en-têtes/publication : pas de dataset privé/secrets/profils QA exposés, politique de logs et confidentialité, licences et mentions complètes ; contrôles actifs sur réponses API et assets.
- Revue finale de la release et **autorisation explicite de déploiement**, distincte de la réussite des tests. Aucune modification du numéro public sans instruction.

## 6. Fichiers de cette mission et reproduction

Créés :

- `scripts/audit/metrics.mjs` : métriques CPU, union des intervalles et calcul de budget minimal.
- `scripts/audit/routing.mjs`, `scripts/audit/routing-job.mjs` : scénarios isolés et mesures à froid/chaud.
- `scripts/audit/gtfs.mjs` : inventaire SQLite/dbstat et sonde de taille binaire.
- `scripts/audit/compact-sqlite.mjs` : copie candidate indépendante et contrôle intégral de reconstruction.
- `scripts/audit/providers.mjs` : accès officiels et politiques, sans authentification ni archive téléchargée.
- `scripts/audit/http.mjs` : validations et exposition du serveur local.
- `tests/cost-audit.test.mjs` : trois tests de calcul des métriques.
- `docs/AUDIT-GRATUITE.md`, `docs/ARCHITECTURE-CIBLE-GRATUITE.md`, `docs/PLAN-FINALISATION.md` et synthèse d'évidence : résultats et décisions.

Modifié : `README.md`, lien vers ces rapports. Les scripts créent uniquement leurs propres dossiers/fichiers `.data`. Le protocole, les chemins des preuves et les commandes sont dans l'audit. Aucune dépendance ajoutée ni fonctionnalité existante supprimée.

## 7. Choix de prochaine étape

Recommandation : **clarifier l'accès/licence du GTFS puis réaliser le prototype local C et sa parité avec SQLite**, avant tout travail de publication. Une alternative A ou D demeure possible à étudier avec des mesures spécifiques ; elle n'est pas validée parce qu'elle figure dans ce plan.

La publication complète n'est pas prête aujourd'hui. **ARCHITECTURE À REVOIR**, avec des pistes gratuites mesurées et des étapes vérifiables ; aucune migration ni déploiement distant lancé.
