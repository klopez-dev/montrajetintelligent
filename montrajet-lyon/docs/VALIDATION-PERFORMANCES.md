# Nouvelle passe d’audit, optimisation et validation — V0.1

## Ordre des opérations et état initial

Cette passe du 8 novembre 2026 a commencé par la lecture du code et une **nouvelle mesure avant toute modification de source**. Le rapport de référence est `.data/benchmark-before-1794163410503/report.json`, écrit avant le premier correctif. La création des rapports dans `.data/` est la seule écriture nécessaire à cette phase de mesure.

Le projet possédait déjà un moteur par tours à deux correspondances, un calcul commun aux accès, des caches IGN et SQL/logiques, une file réseau limitée et une sélection de quais sans plafond fixe de quatre. Ces fonctionnalités ont été auditées et revalidées ; elles n’ont pas été supprimées ou remplacées pour améliorer les chiffres. Le [rapport de la précédente extension](PERFORMANCES-COUVERTURE.md) conserve son historique avant/après, distinct de la présente référence.

L’audit a identifié deux calculs répétés après réchauffement des caches :

- construction de la table d’identifiants des 14 026 arrêts et classification des quais de surface à chaque requête ;
- filtrage, calcul des distances et tri des couples de quais des nouvelles correspondances piétonnes, alors que graphe, lignes et extrémités étaient identiques.

À chaud, les appels IGN étaient déjà absents et SQLite prenait environ une demi-milliseconde. Ajouter un index SQL ou réduire les requêtes fournisseur n’aurait pas supprimé ces 12 à 38 ms de travail principalement géométrique. Aucun changement de la base active n’était justifié pour cette optimisation.

## Implémentation réalisée

`server/mobility/planner.ts` réutilise maintenant :

1. la table des quais par identifiant et leur classification de surface, pour le même SHA-256 GTFS ;
2. les couples de correspondance géométriques dans un cache borné à 64 entrées par instance.

La clé des couples comprend le SHA-256, les identifiants de départ/destination et les deux ensembles triés de lignes concernées. Elle couvre les dépendances de cette opération statique. Le sens n’est pas inversé et une adresse voisine n’est pas assimilée à une autre adresse. Le calcul initial conserve les mêmes distances, ordre, filtres et six paires candidates ; les chemins réels sont toujours demandés au client IGN, qui applique sa propre validité.

**Ce cache ne contient ni horaires, ni chemins fictifs, ni erreurs du fournisseur.** Un changement d’empreinte GTFS vide les caches de couples et les index des quais, en plus des caches préexistants. Il ne dispense jamais le moteur de vérifier les calendriers, les séquences, les interdictions et les minima des transferts.

Deux métriques ont été ajoutées au contrat TypeScript : `transferCandidatesMs` et `transferCandidatesCacheHit`. Elles permettent de distinguer ce travail des appels réseau. Les mesures SQL, géocodage, marche, file IGN et moteur restent disponibles. L’instrumentation n’est pas affichée dans le parcours utilisateur.

La file IGN existante reste à deux appels simultanés maximum, avec départs espacés d’au moins 260 ms. La coalescence des requêtes identiques, le cache des adresses et chemins, les délais d’attente, les unités/profils validés et Retry-After sont conservés. Aucun accroissement de débit ou relâchement des contrôles n’a été utilisé pour obtenir le gain.

## Comparaison sur le même périmètre

Les deux séries utilisent les mêmes quatre requêtes, instants, archive et limites. **Contrairement à la comparaison historique de l’extension initiale, le périmètre est ici identique avant et après** : deux correspondances, exploration élargie et mêmes budgets. Les premiers trajets retournés sont identiques pour les quatre scénarios. Les nombres de quais confirmés sont également identiques dans ces séries : 2, 43, 35 et 2 au total.

Méthode : nouveaux caches applicatifs pour chaque scénario, puis deux répétitions immédiates. « Froid » ne signifie pas vidage du cache disque Windows/SQLite. Ce sont des temps du backend appelés directement, pas des temps HTTP ni un test de charge.

| Trajet | Avant froid | Après froid | Avant chaud¹ | Après chaud¹ |
| --- | ---: | ---: | ---: | ---: |
| Place Henri → Soie, nouveaux liens IGN | 3 132 ms | 2 822 ms | 16,23 ms | 1,71 ms |
| Adresse Lacassagne → quai Soie | 18 418 ms | 16 296 ms | 22,45 ms | 3,33 ms |
| Deux adresses | 15 419 ms | 16 328 ms | 38,15 ms | 2,96 ms |
| T3 long, Dauphiné → Meyzieu | 478 ms | 496 ms | 4,94 ms | 3,50 ms |

¹ Moyenne arithmétique des deux répétitions. Les échantillons complets sont conservés, sans sélection d’un meilleur passage.

Pour les deux adresses, la phase de marche à chaud passe de 30,71–37,66 ms à 0,98–1,13 ms, avec **zéro appel HTTPS** dans les répétitions avant comme après. Le choix des couples prend environ 0,03–0,04 ms lorsqu’il est réutilisé, contre 34,35 ms lors de sa première construction dans la série après. Ce n’est pas une accélération du fournisseur IGN : c’est la suppression d’un calcul local répété.

### Décomposition des phases à froid

| Poste | Adresse → Soie avant / après | Deux adresses avant / après |
| --- | ---: | ---: |
| Géocodage, phase mur | 294 / 427 ms | 560 / 559 ms |
| Marche et file, phase mur | 16 717 / 14 409 ms | 13 171 / 14 041 ms |
| SQLite | 755 / 812 ms | 809 / 823 ms |
| Moteur hors attente SQL | 609 / 593 ms | 827 / 856 ms |
| Appels HTTPS fournisseur | 49 / 49 | 50 / 50 |
| Quais confirmés au total | 43 / 43 | 35 / 35 |

Les phases comprennent des traitements et attentes différents ; les métriques réseau cumulées peuvent dépasser le temps mur en cas de concurrence. Elles ne doivent pas être additionnées comme un profil CPU. Le temps du moteur ne comprend pas tout le traitement du module mobilité.

**Aucun gain général à froid n’est démontré.** Les variations réseau et l’attente nécessaire au respect du débit IGN dominent encore. Les deux adresses sont même un peu plus lentes à froid dans cette série. Réduire artificiellement les quais ou ignorer des parcours aurait changé le service rendu et n’a pas été fait.

Rapports bruts :

- référence actuelle : `.data/benchmark-before-1794163410503/report.json` ;
- après : `.data/benchmark-after-1794163609348/report.json`.

## Algorithme et sélection revalidés

Le moteur existant conserve trois tours maximum, donc **deux correspondances réellement prises en charge**. La reconstruction comporte chaque course, direction, séquence et transfert. Le parcours inverse « Arriver avant » respecte les mêmes liens orientés. Les tests vérifient les dépassements de minuit, les jours de service précédents, les exceptions et les changements d’heure.

L’exemple réel Harmonie Campus Pro → La Soie comporte C16 → TB11 → A et deux correspondances officielles. Le mode historique à une correspondance reste disponible. Cette passe n’augmente pas le plafond à trois changements et ne prétend pas apporter une preuve d’optimalité globale.

La sélection des accès reste fondée sur les lignes utiles et la proximité pour l’ordre d’examen, puis sur les durées/distances réellement retournées par IGN. Tous les accès confirmés dans les limites sont conservés : pas de retour à quatre quais. Les budgets restent configurables ; les recherches partielles restent marquées partielles. Le test où seul le cinquième quai permet de prendre le bus est conservé.

## Tests et fichiers concernés

Deux nouveaux tests vérifient :

- la réutilisation des candidats, avec les mêmes trajets, quais confirmés et demandes piétonnes ; puis l’invalidation après changement du SHA-256 et des coordonnées GTFS ;
- l’absence de réutilisation abusive dans le sens inverse.

La compilation TypeScript/Vite, le linter et les **167 tests Node** ont réussi. Les suites existantes couvrent notamment l’authentification temps réel non activée, les erreurs IGN, les contrôles de débit, le cache expiré, les calendriers et les deux correspondances.

Modifications de code de cette passe :

- `server/mobility/planner.ts` : index mémoire réutilisés et cache des couples ;
- `src/types/mobility.ts` : deux métriques supplémentaires ;
- `tests/mobility.test.mjs` : deux tests de cache et d’invalidation ;
- ce rapport, sa preuve synthétique et les liens de documentation.

Le moteur à deux correspondances, les optimisations SQLite et la sélection élargie étaient déjà implémentés au début de cette passe et restent présents dans les fichiers du projet. Aucun fichier de transport ou fonctionnalité n’a été supprimé, aucun schéma/index de la base active changé, aucune dépendance ajoutée.

## Limites restantes

- À froid, examiner plusieurs dizaines de chemins IGN reste lent ; aucune accélération générale n’est revendiquée.
- Deux correspondances maximum, fenêtre de six heures et budgets de ressources explicites. Les recherches peuvent rester partielles et manquer une variante.
- Les temps de marche sont des estimations réseau, pas une vérification physique/PMR. Les accès métro/funiculaire inconnus restent exclus.
- Les caches sont locaux au processus et invalidés avec le GTFS ; ils ne remplacent pas une coordination de débit entre plusieurs serveurs.
- Le moteur étendu reste non certifié pour les quotas Cloudflare Free ; aucune option payante ni déploiement n’a été activé.
- Les mesures ne constituent pas un test de charge, et l’affichage navigateur ne valide pas des téléphones physiques.

Version publique **V0.1** conservée.

## Résultats finaux dans le navigateur

Toutes les suites suivantes ont été exécutées après les modifications, avec profils Edge isolés et services locaux sur ports libres :

| Commande | Résultat | Rapport |
| --- | --- | --- |
| `npm.cmd run test:network` | 12 contrôles réussis, deux correspondances et mobiles 390/320 px | `.data/network-validation-1794163797785/report.json` |
| `npm.cmd run test:journeys` | 27 contrôles réussis, horaires réels et favoris | `.data/routing-validation-1794163859323/report.json` |
| `npm.cmd run test:browser` | 32 contrôles réussis, régression Horaires, erreurs et mobile | `.data/validation-1794163950304/report.json` |
| `npm.cmd run test:mobility` | 18 contrôles réussis, IGN réel, adresses, marche, conservation du T3 et erreur fournisseur | `.data/mobility-validation-1794164036847/report.json` |

Les 167 tests Node passent sans échec ni test ignoré ; linter sans avertissement ; compilation réussie. Aucune exception JavaScript n’a été signalée par les parcours validés. Les captures sont conservées avec les rapports. Les noms d’adresses des scénarios sont des adresses publiques de démonstration.

La [preuve synthétique](evidence/performance-revalidation.json) conserve les échantillons et vérifie automatiquement l’égalité du premier trajet et du nombre de quais confirmés avant/après sur chaque scénario. L’invariance complète des trajets et l’invalidation du nouveau cache sont également vérifiées en base de test isolée.

Pour lancer l’application depuis le dossier ouvert dans VS Code :

```powershell
cd montrajet-lyon
npm.cmd run dev -- --host 127.0.0.1 --port 0
```

Le frontend et l’API locale sont servis ensemble. Aucun déploiement ni fichier utilisateur à recopier.
