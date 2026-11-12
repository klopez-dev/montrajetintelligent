# MonTrajet Lyon · V0.1

L'[audit de préparation à coût zéro](docs/AUDIT-GRATUITE.md), l'[architecture cible proposée](docs/ARCHITECTURE-CIBLE-GRATUITE.md) et le [plan de finalisation](docs/PLAN-FINALISATION.md) concluent au 9 novembre 2026 : **ARCHITECTURE À REVOIR** avant une migration complète gratuite. Les mesures CPU/mémoire et les quotas D1 ne permettent pas un portage direct ; aucun déploiement n'est activé. La version publique reste V0.1.

Application locale React, TypeScript et Vite, gratuite, sans publicité ni compte. Le numéro de version public V0.1 et le numéro du package existant sont conservés.

## Démarrage

Node 24+ recommandé. Depuis le dossier ouvert dans VS Code :

```powershell
cd montrajet-lyon
npm.cmd run dev
```

Ouvrir l’adresse locale indiquée par Vite. Les dépendances existantes suffisent ; aucun paquet n’a été ajouté pour le GTFS.

## Fonctionnement

- Navigation Accueil, Itinéraires, Horaires, Trafic et Favoris ; interface française responsive.
- Itinéraires GTFS entre quais sélectionnés : directs, une ou deux correspondances, partir à/arriver avant, plusieurs propositions, tri et marge configurable. Recherche d’adresses BAN et accès piétons estimés sur réseau IGN ; nouveaux liens piétons de correspondance en option.
- Favoris locaux : ajout, identifiants de quais, détection des doublons, réutilisation et suppression. Les anciens favoris restent conservés ; les erreurs de stockage sont signalées.
- Horaires : recherche indexée de lignes et d’arrêts, sélection explicite des homonymes, prochains passages théoriques issus du GTFS local. Affichage de la période de validité, des directions fournies et du caractère théorique.
- Trafic et temps réel non connectés. Aucun horaire inventé et aucun calcul théorique présenté comme du temps réel.

## GTFS TCL

L’archive fournie `GTFS_TCL.ZIP` a été importée. La base active se trouve dans `.data/gtfs.sqlite`, hors du front-end et ignorée par Git. Les données couvrent les jours de service du 8 novembre 2026 au 8 mars 2027. Le navigateur ne reçoit que des résultats bornés de l’API locale.

```powershell
npm.cmd run gtfs:import
```

Cette commande prépare un nouvel import avec rapport sans remplacer une base active existante. Elle recherche d’abord `data/gtfs/GTFS_TCL.ZIP`, puis le ZIP à la racine du projet. Aucun téléchargement ni déploiement automatique.

Lire [docs/GTFS.md](docs/GTFS.md) pour les fichiers réellement présents, l’empreinte, les limites du format, le rapport d’import, les règles de calendrier, le contrat HTTP, l’actualisation sans écrasement et la préparation Cloudflare D1 gratuite. Le schéma et l’adaptateur D1 sont prêts à être étudiés pour un futur hébergement ; le chargement distant et ses quotas restent à planifier.

## Calcul d’itinéraires théoriques

Le calculateur prend en charge jusqu’à deux correspondances en six heures, transferts orientés vérifiés et marge de sécurité explicite. Le mode historique à une correspondance reste disponible. Voir [docs/PERFORMANCES-COUVERTURE.md](docs/PERFORMANCES-COUVERTURE.md) pour le moteur par tours, les accès sans plafond de quatre quais, les budgets, l’instrumentation et les mesures avant/après. Les gains sont surtout visibles avec cache ; l’exploration accrue à froid peut prendre plus de temps. [docs/ITINERAIRES.md](docs/ITINERAIRES.md) conserve l’historique du premier périmètre.

La [nouvelle passe d’audit et de validation](docs/VALIDATION-PERFORMANCES.md) mesure le moteur existant avant modification, puis optimise les index mémoire et les candidats piétons sans changer le périmètre. Elle distingue les gains avec cache des variations IGN à froid.

L’extension [adresses et marche](docs/ADRESSES-MARCHE.md) ajoute le géocodage officiel BAN via IGN et des accès piétons sur BD TOPO, avec sélection explicite, calcul porte-à-porte, erreurs et limites visibles. Les durées de marche sont estimées et les nouveaux accès métro/funiculaire sans entrées décrites sont exclus. Les favoris entre quais et le module Horaires restent préservés. Les API officielles IGN sont requises pour les adresses, sans compte ni clé ; aucun horaire ou chemin n’est inventé en cas de panne.

## Préparation temps réel Grand Lyon

L’accès fournisseur testé le 8 novembre 2026 renvoie **HTTP 401** sans identifiants techniques. Le temps réel n’est donc **pas opérationnel**. Un client serveur avec cache, validation stricte et repli GTFS est préparé ; les estimations restent désactivées tant que l’accès, les conditions de fréquence et le contrat d’identifiants ne sont pas confirmés. Aucun appel direct du navigateur à Grand Lyon.

Voir [docs/TEMPS-REEL.md](docs/TEMPS-REEL.md) pour les preuves d’accès, les taux N/D, les limites, l’architecture et les tests. Aucun secret ni donnée fictive de transport n’a été ajouté.

## Architecture

- `src/components/` : formulaires et états d’interface, recherche du catalogue et affichage des horaires.
- `src/services/` : favoris locaux, client HTTP GTFS, services de transport.
- `src/types/` : contrats de transport et modèles GTFS.
- `scripts/gtfs/` : ZIP/CSV en flux, import validé et export SQL hors ligne.
- `server/gtfs/` : schéma SQLite, index/requêtes, calendriers/fuseaux, API et raccordement Vite.
- `server/journeys/`, `functions/api/journeys/` : calcul et API d’itinéraires SQLite/D1.
- `server/mobility/`, `functions/api/mobility/` : géocodage, routage piéton IGN et composition porte-à-porte côté serveur.
- `functions/api/gtfs/[[path]].ts` : adaptateur Cloudflare Pages/D1 inactif.
- `tests/` : tests Node sans nouvelle dépendance.

## Vérifications

```powershell
npm.cmd run build
npm.cmd run lint
npm.cmd test
npm.cmd run test:browser
npm.cmd run test:journeys
npm.cmd run test:mobility
npm.cmd run test:network
```

Les tests vérifient les favoris, l’import ZIP/CSV, les calendriers, les exceptions, les passages après minuit et les changements d’heure, la recherche des homonymes, le contrat API, l’export SQL et les calculs contre la base locale lorsqu’elle existe. `test:browser` lance Edge installé localement, sans nouvelle dépendance, puis contrôle l’interface et ses vraies requêtes API. Les captures et preuves sont enregistrées dans `.data/validation-<date>/`.

Le compte rendu des recherches C13, C9, C16, 125 et T3, des arrêts demandés, des directions, des erreurs et de l’affichage mobile se trouve dans [docs/VALIDATION-HORAIRES.md](docs/VALIDATION-HORAIRES.md). Une consultation « maintenant » retire les passages devenus passés ; une consultation datée est explicitement présentée comme un instantané. Les vérifications ne couvrent pas les appareils physiques ni un compte Cloudflare.

L’ébauche `../src/` et les ressources initiales sont conservées ; le projet Vite exécutable est ce sous-dossier. Aucun outil de suivi, police distante, paiement ou déploiement.

Les valeurs par défaut des budgets serveur fonctionnent sans configuration. `.env.example` expose les paramètres `ROUTING_*` facultatifs. Les adaptateurs Cloudflare sont préparés, mais le moteur étendu n’est pas certifié pour les limites CPU et sous-requêtes de Workers Free ; aucun déploiement n’est activé.

## Suivi du calcul et annulation — V0.1

Le calcul transmet ses étapes réelles, permet l’annulation et conserve les résultats précédents en cas d’échec. Les recherches simultanées identiques et leurs appels IGN sont partagés ; aucun préchargement piéton automatique n’est activé. Le [rapport de chargement progressif](docs/CHARGEMENT-PROGRESSIF.md) décrit les fichiers, caches, mesures avant/après, quotas et limites.

```powershell
node scripts/qa/validate-experience.mjs
node scripts/qa/benchmark-experience.mjs after
```

Ces vérifications démarrent leur serveur local et Edge sur des ports libres ; les calculs de succès interrogent le GTFS importé et les services officiels IGN. Les pannes contrôlées sont exclusivement des tests, jamais des itinéraires fictifs.

## Trafic TCL — couverture partielle, V0.1

L’onglet Trafic lit des annonces réelles sur les fiches publiques TCL, dans les conditions de reproduction non commerciale du site. Il affiche les périodes, sources, âge des données et limites de couverture. Les itinéraires reçoivent une vérification séparée, sans être supprimés sur la base d’une annonce générale. L’API d’alertes Grand Lyon reste inaccessible sans authentification ; aucun contournement n’est utilisé.

Voir [l’audit des sources](docs/SOURCES-TRAFIC.md) et le [rapport complet Trafic](docs/TRAFIC-TCL.md) : neuf annonces obtenues pour C16, T3 et D lors de l’audit, rapprochement de lignes partiel et aucun quai rapproché par son nom. Le cache serveur dure dix minutes ; un cache disque local conserve les dates originales entre redémarrages. Les données périmées ne sont jamais présentées comme actuelles.

```powershell
node scripts/qa/validate-traffic.mjs
```

Cette commande valide Trafic puis les quatre suites existantes sur un serveur partagé pour limiter les requêtes fournisseurs. Aucun déploiement n’est activé ; la version publique reste V0.1.

La [fiabilisation Trafic du 9 novembre 2026](docs/FIABILISATION-TRAFIC.md) ajoute le statut de chaque ligne du catalogue, les erreurs isolées par fiche, les plages nocturnes explicitement récurrentes et une extension de deux fiches maximum par cycle. Cinq lignes ont alors été vérifiées et treize annonces reçues ; les 802 autres lignes restent non consultées dans cette photographie. Aucun trafic normal n’en est déduit. Les tests couvrent 199 cas automatisés et les validations Edge/mobile existantes.

## Carte interactive — V0.1

La [carte interactive des itinéraires](docs/CARTE-INTERACTIVE.md) affiche les arrêts GTFS exacts et les marches IGN disponibles, au clic sur une proposition. L'archive ne contient aucune shape : aucun tracé de transport n'est inventé. Le fond OSM est configurable et soumis à sa politique d'usage ; les résultats textuels restent utilisables en cas d'échec de la carte.

## Favoris intelligents — V0.1

Domicile, travail, autres lieux, quais exacts et trajets mixtes sont sauvegardés localement. Les actions Aller au travail et Rentrer chez moi recalculent un trajet avec les services existants. Voir le [rapport des fonctionnalités, tests et limites](docs/FAVORIS-INTELLIGENTS.md). Aucun compte ni synchronisation ; le stockage du navigateur ne constitue pas une sauvegarde garantie.

## Source GTFS et prototype hybride local — V0.1

Voir la [procédure officielle de renouvellement GTFS](docs/SOURCE-GTFS-DURABLE.md) et les [mesures du prototype hybride](docs/PROTOTYPE-ARCHITECTURE-HYBRIDE.md). L'accès au téléchargement reste conditionné à une authentification autorisée ; aucun renouvellement authentifié n'est annoncé comme réussi. Le laboratoire expérimental utilise des partitions issues des données locales, sans remplacer la base active. Il ne constitue pas une migration ni une validation Cloudflare Free.

La mission du 10 novembre ajoute le [format compact journalier et les mesures mémoire](docs/OPTIMISATION-HYBRIDE.md), la [validation Edge/Firefox et les tests d'erreur](docs/VALIDATION-MOTEUR-NAVIGATEUR.md) et la [décision de migration](docs/DECISION-MIGRATION-HYBRIDE.md). Le build statique local fonctionne pour le périmètre testé ; le moteur hybride reste **partiellement validé**, sans bascule de l'application active.

La validation étendue couvre maintenant les [121 journées du GTFS local](docs/COUVERTURE-GTFS-HYBRIDE.md), les [parcours adresses/favoris exécutés dans le Worker](docs/PARITE-HYBRIDE-COMPLETE.md) et la [préparation d'un sélecteur de moteur isolé](docs/PREPARATION-MIGRATION-HYBRIDE.md). SQLite reste le moteur des utilisateurs ; le choix expérimental n'existe que dans le laboratoire. Aucun déploiement n'est activé.

La [préproduction statique React séparée](docs/PREPRODUCTION-STATIQUE.md) réutilise maintenant l'interface, les horaires, favoris et la carte avec calcul navigateur et accès IGN direct testé. Voir les [dépendances restantes](docs/DEPENDANCES-SERVEUR.md) et la [faisabilité gratuite](docs/FAISABILITE-HEBERGEMENT-GRATUIT.md). Son trafic reste non connecté et elle ne remplace pas l'application active.

Validation technique - etape 1/4 : [audit](docs/AUDIT-PREPRODUCTION-STATIQUE.md), [tests fonctionnels](docs/VALIDATION-FONCTIONNELLE-PREPRODUCTION.md), [performances](docs/PERFORMANCES-PREPRODUCTION.md). Version V0.1 conservee ; aucune migration ni publication activee.
