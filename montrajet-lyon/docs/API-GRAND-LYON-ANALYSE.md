# API des prochains passages Data Grand Lyon — état au 11 novembre 2026

## Preuves et accès

L’URL examinée est `https://data.grandlyon.com/fr/datapusher/ws/rdata/tcl_sytral.tclpassagearret/all.json`. Un essai HTTPS depuis le backend local avec `maxfeatures=1`, sans identifiants, a renvoyé **HTTP 401** et `application/json`. Aucun identifiant réel ni échantillon autorisé de la couche n’était disponible dans cet environnement. La réponse de 1 011 résultats évoquée dans la mission n’était pas jointe comme fichier exploitable ; elle n’a pas été traitée comme un relevé vérifié.

La [documentation officielle d’authentification](https://rdata-grandlyon.readthedocs.io/fr/latest/authentification.html) décrit HTTP Basic sur HTTPS avec un compte technique distinct du compte GrandLyon Connect. La [documentation des services](https://rdata-grandlyon.readthedocs.io/fr/latest/services.html) décrit `field`, `value`, `maxfeatures` et `start` pour filtrer et paginer `all.json` ; la limite par défaut est 1 000 enregistrements. La page de [documentation du portail](https://data.grandlyon.com/portail/en/documentation) rappelle que l’accès et la réutilisation dépendent des conditions du jeu de données. Le [communiqué du réseau unifié](https://data.grandlyon.com/portail/fr/actualites/reseau-tcl-unifie) précise qu’à partir de septembre 2025 `coursethéorique` contient le `trip_id` GTFS exact, sans établir l’égalité des autres identifiants.

La licence exacte et les quotas de **cette couche** n’ont pas été confirmés depuis sa fiche de métadonnées authentifiée. L’application garde `GRANDLYON_POLICY_CONFIRMED=false` par défaut et n’envoie aucune requête authentifiée tant que les droits, la fréquence autorisée et la correspondance des identifiants ne sont pas vérifiés.

## Contrat de travail, sans affirmation non prouvée

| Champ | Lecture prudente | Usage actuel |
| --- | --- | --- |
| `id` | Identifiant lié au passage, égalité avec un `stop_id` GTFS **à vérifier** | Exigé identique au quai sélectionné dans le contrat strict préparé |
| `ligne` | Code de ligne ; relation avec `route_id` **à vérifier** | Égalité exacte seulement, si activation explicite |
| `direction` | Libellé de destination ou sens ; sémantique **à vérifier** | Comparaison stricte avec la direction GTFS, sans nom proche |
| `delaipassage` | Texte de délai, dont `Proche` | Non utilisé pour calculer une heure ou un retard |
| `type` | La [fiche du jeu de données sur data.gouv.fr](https://www.data.gouv.fr/datasets/prochains-passages-du-reseau-transports-en-commun-lyonnais-et-rhonexpress-disponibilites-temps-reel) précise **E = estimé, T = théorique** | `T` jamais promu en estimation ; `E` exploitable uniquement avec identité et fraîcheur vérifiées |
| `heurepassage` | Heure annoncée, fuseau **à confirmer sur échantillon** | Parseur Europe/Paris strict ; heures ambiguës refusées |
| `idtarretdestination` | Identifiant de destination, relation GTFS **à vérifier** | Exige un arrêt ultérieur de la même course |
| `coursetheorique` | `trip_id` GTFS selon le communiqué officiel du réseau unifié | Égalité exacte avec `trips.id` si même version de réseau |
| `gid` | Identifiant technique d’enregistrement | Jamais utilisé comme identifiant d’arrêt |
| `last_update_fme` | Date de mise à jour de l’enregistrement | Fraîcheur contrôlée, pas une preuve de position véhicule |

L’accès authentifié a été vérifié le 11 novembre 2026, après initialisation du coffre DPAPI : `ligne=T3&maxfeatures=20` a renvoyé HTTP 200 avec zéro ligne à 00h42 heure locale. Une petite page non filtrée a renvoyé sept lignes T1/T2/T4, mises à jour à 00h43. Sur ces sept lignes, les identifiants de quai, ligne, course et couple course/quai correspondent exactement à la base GTFS importée ; aucun `idtarretdestination` n’est un arrêt ultérieur de la même course. Cinq lignes portent `E` et deux `T`. Les cinq libellés de direction `E` ne correspondent pas à la destination de la course GTFS ; ils correspondent au nom de l’arrêt indiqué par `idtarretdestination`. Cela interdit d’ajuster une course GTFS sur la seule base de cet échantillon.

La couverture C13, C9, C16, 125, T3 et métro A/D **n’a pas été mesurée** : l’échantillon était nocturne et limité à sept lignes de passage, non à sept lignes commerciales. Une absence de passage n’est jamais présentée comme trafic normal. La couche de passages n’est pas utilisée comme source de perturbations. Voir `docs/VALIDATION-TEMPS-REEL-2026-11-11.md` pour les rapports d’audit locaux.
