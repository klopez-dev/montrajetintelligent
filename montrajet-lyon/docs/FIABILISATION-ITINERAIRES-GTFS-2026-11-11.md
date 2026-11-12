# Fiabilisation du moteur d'itinéraires GTFS — 11 novembre 2026

## Audit

Le projet conserve deux chemins : recherche directe/une correspondance par tronçons SQL ciblés (`server/journeys/planner.ts`) et jusqu'à deux correspondances par tours de courses GTFS (`server/journeys/network.ts`). Les deux lisent les jours de service et les exceptions depuis SQLite. Les tronçons exigent une montée et une descente autorisées, le bon ordre des `stop_sequence` et des heures absolues cohérentes, y compris après minuit et au changement d'heure. Les transferts sont orientés : même quai (hypothèse de déplacement interarrêt nul), règle GTFS de type 2 avec durée minimale, ou parcours piéton IGN vérifié. Une règle d'interdiction ou une règle contradictoire empêche le transfert. La marge configurable s'ajoute au minimum retenu.

**Anomalie corrigée :** lorsqu'un même transfert avait une règle GTFS de 180 s et un parcours IGN vérifié de 240 s, le moteur retenait 180 s. Il pouvait donc proposer un départ 300 s après l'arrivée avec une marge de 120 s, alors que 360 s étaient nécessaires. Le minimum est désormais `max(minimum GTFS, marche IGN vérifiée) + marge`. Le minimum officiel et la durée de marche restent affichés séparément, avec le parcours IGN lorsqu'il existe. Sans parcours IGN, le GTFS garde son minimum officiel ; sa part de marche n'est pas inventée.

Les résultats affichent départ, arrivée, durée, lignes, directions, quais de montée et de descente, intervalle disponible, minimum de correspondance, marche connue et source « Horaire théorique ». Le classement existant (arrivée, durée, transferts ou départ selon la demande) est conservé après les vérifications de faisabilité. La sélection reste bornée et n'est pas une preuve d'optimalité globale.

## Règles vérifiées

- Première course : arrêt de descente exact et séquence après la montée ; seconde course : arrêt de montée exact et séquence avant la descente.
- Service de chaque course actif à son jour GTFS, exceptions prioritaires ; conversion des heures `> 24 h` en instants absolus.
- Transfert seulement avec lien orienté applicable et durée vérifiable. Le temps de disponibilité vaut arrivée de la première course + `max(minimum GTFS, marche IGN vérifiée)` + marge configurable.
- Une règle GTFS spécifique à une course ou ligne peut interdire un lien général. Aucun changement de quai homonyme n'est déduit du nom ou de la proximité seule.
- Une marche IGN estimée est présentée comme telle. Le temps GTFS seul n'est pas présenté comme une mesure piétonne.

## Exemples sur la base TCL importée

Consultation théorique du 9 novembre 2026 à partir de 11 h, heure de Lyon. Chaque tronçon et transfert a été contrôlé dans SQLite par un oracle de test distinct du moteur.

| Trajet | Première proposition | Correspondance | Disponibilité |
| --- | --- | --- | --- |
| Place Henri → Vaulx-en-Velin La Soie | C13 → métro A, 11 h 09 → 11 h 53 min 19 s | Cordeliers, quais 48353 → 46050, règle GTFS 180 s + marge 120 s | 494 s entre véhicules |
| Domrémy-Lacassagne → La Soie | C13 → métro A, 11 h 01 → 11 h 43 min 43 s | Cordeliers, quais 48353 → 46050, règle GTFS 180 s + marge 120 s | 518 s |
| Dauphiné-Lacassagne → La Soie | T3 direct, 11 h 07 min 01 s → 11 h 15 min 32 s | Aucune | — |
| Harmonie Campus Pro → La Soie | C16 → TB11 → métro A, 11 h → 11 h 48 min 31 s | Charmettes : 180/360 s ; Cordeliers : 300/386 s | Deux transferts vérifiés ; **exploration partielle**, classement non exhaustif |

Les minutes ci-dessus sont issues des horaires GTFS du jeu importé, pas d'observations de circulation. La première proposition peut changer selon l'heure, le mode de recherche et les critères de classement.

## Tests et performances

Les nouveaux tests isolés couvrent bus → tramway, bus → métro, marche IGN plus longue que le minimum GTFS, deux quais, plusieurs lignes au même quai, départ trop proche d'une seconde, calendriers et courses proches. Les tests existants couvrent les exceptions, l'après-minuit, les changements d'heure, les transferts interdits, l'absence de solution et les deux sens « Partir à » / « Arriver avant ».

Le parcours navigateur du build local a réussi pour les trois trajets du secteur Lacassagne, le trajet à deux correspondances, le classement, la carte, les favoris, les erreurs serveur et les largeurs 390/320 px. Rapports locaux : `.data/routing-validation-1794387639990/report.json` et `.data/network-validation-1794387690193/report.json`.

Validation finale : **277 tests automatisés réussis, zéro échec**, linter sans avertissement et compilation réussie. Vite signale seulement la taille du bloc MapLibre déjà présent. Le premier lancement du script navigateur sur le serveur Vite de test a expiré pendant `Page.navigate` ; le même script a ensuite réussi entièrement sur `vite preview` local. Aucun fournisseur externe n'a été sollicité pour ces calculs GTFS.

Médianes HTTP de cinq recherches chaudes de la validation actuelle : Place Henri 156 ms, Domrémy 152 ms, Dauphiné 469 ms. Le rapport historique comparable indiquait 110/104/375 ms ; les exécutions n'ont pas été faites dans des conditions contrôlées identiques, donc l'écart ne mesure pas le coût de la correction. Les recherches sans marche IGN ne changent pas leur nombre de requêtes fournisseur.

## Limites

Les règles GTFS peuvent fournir un minimum entre quais sans décomposer le temps de marche. Les transferts recommandés sans durée vérifiable entre quais restent exclus. L'IGN estime le parcours extérieur et ne garantit pas l'accessibilité, les entrées souterraines ou l'état du terrain. Le moteur borne la fenêtre à six heures et le nombre de correspondances à deux ; un budget atteint produit un état « exploration partielle ». Il ne garantit pas l'itinéraire optimal sur tout le réseau. Les données temps réel niveau 2 restent désactivées ; aucune course GTFS n'a été ajustée à partir des annonces Data Grand Lyon. Version publique V0.1 inchangée, aucun déploiement.
