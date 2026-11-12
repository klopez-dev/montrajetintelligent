# Rapprochement des passages et du GTFS

Le modèle actuel distingue `RealtimeEstimate` des horaires théoriques GTFS. Les tests synthétiques prouvent que le rapprochement strict rejette les quais homonymes, suffixes de courses, directions opposées, destinations en amont, dates périmées et heures locales ambiguës. Ils ne prouvent **pas** que les identifiants du flux officiel correspondent aujourd’hui à ceux de la base importée.

Le communiqué officiel du réseau unifié confirme `coursethéorique = trip_id`. La fiche nationale du jeu de données confirme `E = estimé` et `T = théorique`. L’audit authentifié du 11 novembre 2026 a trouvé 7/7 égalités exactes pour `id = stop_id`, `ligne = route_id`, `coursetheorique = trip_id` et le couple course/quai, mais 0/7 destination ultérieure dans la même course. Les cinq lignes `E` ont une direction différente du `headsign` de leur course GTFS. Cet échantillon est trop petit et nocturne pour valider le contrat général ; `GRANDLYON_MAPPING_CONFIRMED` reste faux. La base GTFS active n’a pas été modifiée.

Les itinéraires et la carte n’utilisent donc aucune heure actualisée. Il manque en particulier des heures fiables d’arrivée au quai de descente pour propager un retard et revalider une correspondance. Un retard calculé uniquement depuis l’heure à l’embarquement serait une extrapolation non vérifiée. « Arriver avant » reste calculé sur le GTFS théorique.

Avant activation : conserver un échantillon autorisé et daté, comparer plusieurs lignes et quais exacts (dont C13, C9, C16, 125, T3, A et D), documenter les taux de correspondance par mode et vérifier les calendriers/fuseaux. Si le contrat change, le rapprochement doit rester bloqué plutôt que devenir approximatif.
