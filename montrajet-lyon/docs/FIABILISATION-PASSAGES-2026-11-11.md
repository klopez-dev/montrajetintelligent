# Fiabilisation des passages TCL — 11 novembre 2026

## Collecte directe

Le coffre DPAPI existant a servi à des requêtes HTTPS authentifiées, sans impression ni export des identifiants. Les huit appels `ligne__eq` ont été espacés d’au moins 65 secondes, limités à 20 enregistrements chacun. Le filtre `id__eq` a aussi été testé sur un quai C13/C9 : HTTP 200, sept passages (quatre `E`, trois `T`). Le [service REST officiel](https://rdata-grandlyon.readthedocs.io/fr/latest/services.html) documente ces opérateurs. Les essais ont eu lieu entre 09 h 16 et 09 h 25, heure de Paris. Le GTFS actif couvre le 8 novembre 2026 au 8 mars 2027.

| Ligne | Reçus | `E` | `T` | Course + ligne + quai GTFS exacts | Destination ultérieure dans cette course |
| --- | ---: | ---: | ---: | ---: | ---: |
| C13 | 20 | 20 | 0 | 20 | 20 |
| C9 | 20 | 18 | 2 | 20 | 18 |
| C16 | 20 | 14 | 6 | 20 | 19 |
| 125 | 20 | 6 | 14 | 20 | 19 |
| T3 | 20 | 16 | 4 | 20 | 18 |
| T1 | 20 | 20 | 0 | 20 | 18 |
| T2 | 20 | 20 | 0 | 20 | 19 |
| T4 | 20 | 20 | 0 | 20 | 19 |
| **Échantillon** | **160** | **134** | **26** | **160** | **150** |

Ce sont les **20 premiers éléments** de chaque réponse filtrée, et non un échantillon aléatoire ou une couverture complète. Le taux 160/160 (100 %) concerne seulement ces éléments. Le contrôleur de calendrier ajouté à l’audit après les premières collectes a confirmé 60/60 courses examinées sur T1, T2 et T4, près de l’heure annoncée ; les 100 autres n’ont pas reçu cette vérification de calendrier dans le rapport de collecte. Les résultats détaillés sont les rapports locaux `.data/realtime-official-audit-1794385*.json`, ignorés par Git.

Pour 125, T3, T1, T2 et T4, `idtarretdestination` correspondait au dernier arrêt GTFS des 100 enregistrements vérifiés, même lorsque l’arrêt observé était lui-même ce terminus et ne pouvait donc pas être « ultérieur ». La direction textuelle correspondait au nom de cette destination et au `headsign` sur ces 100 lignes. Cette observation ne vaut pas contrat général : l’échantillon nocturne précédent présentait 0/7 destinations ultérieures et 0/5 directions `E` égales au `headsign`. Exemple anonymisé : une course GTFS identifiée exactement à son quai annonçait une destination commerciale différente de son dernier arrêt GTFS. Une mission partielle est possible, mais son parcours n’est pas prouvé. Aucun segment ni terminus n’est déduit de cette seule annonce.

La [fiche nationale](https://www.data.gouv.fr/datasets/prochains-passages-du-reseau-transports-en-commun-lyonnais-et-rhonexpress-disponibilites-temps-reel) distingue `E` estimé et `T` théorique ; les deux types restent distincts dans l’interface. La [note du réseau unifié](https://data.grandlyon.com/portail/fr/actualites/reseau-tcl-unifie) relie `coursetheorique` au `trip_id`, ce que les 160 lignes vérifiées confirment pour ce lot, sans démontrer une égalité universelle.

## Deux niveaux indépendants

**Niveau 1 — passage au quai.** Le serveur exige l’égalité exacte de la ligne, du quai, de la course et de l’arrêt de montée GTFS, un service actif à une date compatible (exceptions comprises), une heure future et une actualisation de moins de deux minutes. Le passage doit être au plus à six heures de l’heure GTFS de la course ; c’est une borne prudente, qui peut exclure une très forte perturbation. `idtarretdestination` n’est pas exigé : le passage concerne le quai, et une direction divergente est affichée comme **non confirmée**. Le type `T` est toujours affiché « Horaire théorique · Data Grand Lyon », jamais comme estimation. Le GTFS reste visible en repli.

**Niveau 2 — itinéraires et correspondances.** Désactivé indépendamment. Une identité course/quai ne prouve pas le parcours réellement suivi, ses arrêts intermédiaires, le terminus commercial ni les arrivées aux correspondances. Aucun ajustement de course ou de correspondance n’est fait. Le statut API l’indique explicitement.

Les verrous serveur `GRANDLYON_STOP_PASSAGES_CONFIRMED` et `GRANDLYON_MAPPING_CONFIRMED` sont distincts. **Le niveau 1 reste désactivé par défaut** tant que les conditions exactes de réutilisation et de fréquence de cette couche ne sont pas établies (`GRANDLYON_POLICY_CONFIRMED=false`). La [Licence Mobilités](https://data.grandlyon.com/portail/fr/assets/licences/Licence_mobilit%C3%A9s_V_02_2021.pdf) subordonne la réutilisation à la licence et aux CGU de la plateforme ; les audits ciblés ne constituent pas une autorisation de collecte continue. Aucune variable d’activation n’a été changée dans le projet.

## Validation et limites

Les tests unitaires couvrent les deux niveaux, `E`/`T`, homonymes, données expirées, calendriers, exceptions et passage après minuit. Le navigateur local a confirmé le fonctionnement d’Horaires et du repli GTFS à 320, 390 et 768 px, ainsi que l’absence d’appel direct à Grand Lyon. Il **n’a pas affiché de passage `E` en production locale**, le verrou de politique étant fermé. Les taux précédents ne prouvent donc pas encore le fonctionnement de bout en bout du niveau 1 avec le fournisseur réel.

Les huit pages de 20 résultats ne permettent pas de conclure sur toutes les directions, sur les autres jours ou sur les missions écourtées. La durée des appels n’a pas été instrumentée dans cet audit. Le quota gratuit et la cadence autorisée propres à cette ressource restent à obtenir auprès du fournisseur avant activation continue. Aucun déploiement ni changement de version publique V0.1.
