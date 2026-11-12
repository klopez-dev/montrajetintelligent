# Résultats d’itinéraires : préproduction expérimentale

## Périmètre

Cette refonte concerne uniquement `experiments/preproduction/results/`. Le montage Vite dans `scripts/prototype/build-preproduction.mjs` remplace trois composants de résultats lors de la compilation expérimentale. Les composants actifs, le moteur, le Worker, le GTFS, la base SQLite, les favoris, la carte et la version publique V0.1 restent inchangés. Aucun déploiement n’a été effectué.

## Lecture des propositions

Chaque carte présente, dans cet ordre, la durée porte à porte ou entre arrêts, le départ, l’arrivée, la succession réelle des lignes et modes, le nombre de correspondances, la marche et l’état du trafic. Les heures visibles sont en Europe/Paris au format `08h05`. Les secondes, décalages horaires et instants exacts restent accessibles dans « Données et hypothèses ». La date apparaît avec les heures lorsqu’un trajet franchit minuit ; un changement d’heure est signalé.

« Voir les étapes » déroule une chronologie avec les quais et directions fournis par le GTFS, les segments de marche IGN disponibles, les minima et marges de correspondance. La marche et l’attente ne sont pas déduites lorsqu’une donnée manque : les limites sont indiquées. Les pastilles de mode utilisent une palette de l’application, sans prétendre reprendre les couleurs officielles TCL.

Le trafic indisponible reste marqué « Trafic non vérifié ». Les détails du fournisseur, la source et la fraîcheur sont consultables sans masquer les résultats. La recherche partielle est signalée près du titre. La carte existante et l’enregistrement local des favoris restent accessibles sur chaque carte.

## Limites de la refonte

- Le bouton favori de carte déclenche l’action existante du formulaire : il mémorise les points de départ et d’arrivée et les préférences, pas une course GTFS déterminée. Cette liaison DOM est propre au prototype et devra être remplacée par une propriété React avant intégration dans l’application active.
- Les alertes de trafic ne sont pas une confirmation de circulation. Le snapshot expérimental indique actuellement une source indisponible.
- Le fond distant de la carte est désactivé par défaut. Un avertissement de rendu peut apparaître dans Firefox sans fond de carte ; les marqueurs et le détail textuel restent accessibles. Il faudra distinguer cette erreur de rendu d’une erreur de tuiles avant une promotion.
- Aucun test avec lecteur d’écran ni appareil physique n’a été réalisé ; les tests automatisés couvrent clavier Edge, tailles de vue et absence de débordement.

La promotion dans `src/` demande une revue UX et une validation séparée. La compilation expérimentale ne change pas l’application active.
