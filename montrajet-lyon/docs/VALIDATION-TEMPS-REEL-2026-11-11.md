> Mise a jour du meme jour : voir [Fiabilisation des passages](FIABILISATION-PASSAGES-2026-11-11.md) pour les essais diurnes et les deux niveaux distincts. Ce document conserve les observations nocturnes.

# Validation après initialisation DPAPI — 11 novembre 2026

## Accès et observations directes

Le coffre Windows `.data/realtime-credential.clixml` existait et a été lu sans nouvelle saisie dans le processus autorisé. Le mot de passe et l’en-tête Basic n’ont été ni imprimés ni enregistrés dans les rapports. La requête HTTPS officielle `all.json?field=ligne&value=T3&maxfeatures=20` a répondu **HTTP 200**, `application/json`, `nb_results=0` vers 00h42 (Europe/Paris). Cela prouve l’authentification, pas l’absence de service T3 à d’autres heures. Rapport local : `.data/realtime-official-audit-1794354130766.json`.

Après plus de 60 secondes, deux pages non filtrées de 20 lignes maximum ont chacune renvoyé **7 enregistrements** sur T1, T2 et T4. L’horodatage source le plus récent était `2026-11-11 00:43:00` Europe/Paris ; les heures annoncées étaient comprises entre 00h40 et 00h43 dans la seconde page. Celle-ci était déjà périmée lors de sa réception à 00h44. Rapports : `.data/realtime-official-audit-1794354199969.json` et `.data/realtime-official-audit-1794354270388.json`. Aucune collecte complète du réseau n’a été faite.

Un essai filtré supplémentaire `ligne=T2&maxfeatures=20` vers 00h53 a aussi répondu HTTP 200 mais avec zéro enregistrement (`.data/realtime-official-audit-1794354812958.json`). Une nouvelle page **non filtrée** vers 00h54 était également vide (`.data/realtime-official-audit-1794354882556.json`). La disparition nocturne des passages est ainsi observée dans les deux formes de requête. La récupération **filtrée avec passages** n’a pas pu être validée pendant cette fenêtre ; le comportement du filtre lorsque la couche contient des passages reste à vérifier.

| Vérification sur les 7 enregistrements de la seconde page | Résultat |
| --- | ---: |
| Ligne reçue avec les champs stricts nécessaires | 7/7 |
| Arrêt `id` égal à un quai GTFS | 7/7 |
| Code `ligne` égal à un identifiant de ligne GTFS | 7/7 |
| `coursetheorique` égal à un `trip_id` GTFS | 7/7 |
| Couple course/quai exact dans `stop_times` | 7/7 |
| `idtarretdestination` arrêté plus tard par la même course | **0/7** |
| Code `E` / `T` | 5 / 2 |
| Direction des cinq `E` égale au `headsign` de leur course | **0/5** |

Le dernier arrêt de certaines courses GTFS ne coïncide pas avec la direction annoncée par la source, tandis que `idtarretdestination` désigne un autre arrêt existant dont le nom correspond à cette direction. **Inférence :** le flux peut décrire des missions écourtées ou modifiées ; l’échantillon ne permet pas de prouver leur parcours. Les identités de quai et course sont exactes dans cette page, mais la direction et la destination empêchent un ajustement fiable des itinéraires. Le rapprochement strict garde donc ces passages hors des résultats « actualisés » et ne modifie aucune correspondance.

La [fiche nationale du jeu de données](https://www.data.gouv.fr/datasets/prochains-passages-du-reseau-transports-en-commun-lyonnais-et-rhonexpress-disponibilites-temps-reel) définit `E` comme estimé et `T` comme théorique. Le [communiqué officiel du réseau unifié](https://data.grandlyon.com/portail/fr/actualites/reseau-tcl-unifie) confirme `coursethéorique = trip_id`. La [Licence Mobilités](https://data.grandlyon.com/portail/fr/assets/licences/Licence_mobilit%C3%A9s_V_02_2021.pdf) subordonne la réutilisation à ses conditions ; le seuil précis de consultation gratuite de cette couche n’a pas été établi. Le verrou `GRANDLYON_POLICY_CONFIRMED` reste donc faux.

## Backend, navigateur et sécurité

Le backend local a été lancé avec accès au profil Windows nécessaire à DPAPI. `/api/realtime/status` a répondu `disabled/policy_unconfirmed`, et `/api/realtime/passages?lineId=T3&stopId=35668` a répondu `unavailable/policy_unconfirmed`, sans appeler le fournisseur depuis le navigateur. Sous le bac à sable de test dépourvu d’accès au profil DPAPI, le même backend répond `authentication_required` : il s’agit d’une limite d’exécution locale, pas d’un retour 401 de Data Grand Lyon.

Le parcours Horaires Edge sur le build local a réussi : `.data/validation-1794354624338/report.json`. Firefox a confirmé l’écran et l’état de repli : `.data/realtime-firefox-1794354662107/report.json`. Les parcours Itinéraires, Carte et Favoris de la préproduction théorique ont réussi dans Edge et Firefox : `.data/preproduction-test-edge-1794354671784/report.json` et `.data/preproduction-test-firefox-1794354689471/report.json`. Ils **ne valident pas** un recalcul temps réel, car aucune donnée de passage n’a franchi les contrôles de rapprochement.

L’audit du build final a inspecté 6 fichiers distribués (1 495 720 octets) et 131 journaux locaux, en comparant la valeur réelle du mot de passe et son encodage Basic, sans les afficher : aucun secret détecté. `npm test` : **266 réussis, 0 échec** ; linter : réussi ; `npm run build` : réussi (avertissement de taille du bloc MapLibre déjà présent). La version publique V0.1 et la base GTFS active sont inchangées ; aucun déploiement.

## Décision

**INTÉGRATION TEMPS RÉEL PARTIELLEMENT VALIDÉE.** L’authentification et la réception de JSON officiel fonctionnent. Les estimations ne sont pas activées pour Horaires, itinéraires, carte ou favoris tant que la correspondance direction/destination et les conditions de consultation n’ont pas été établies. Aucune heure théorique n’est présentée comme une estimation et aucune correspondance n’est déclarée impossible sur cette base.
