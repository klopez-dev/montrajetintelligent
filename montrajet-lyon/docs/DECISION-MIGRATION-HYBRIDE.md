# Décision de migration hybride — V0.1

Date : **10 novembre 2026**.

**MOTEUR HYBRIDE PARTIELLEMENT VALIDÉ**

Le calcul GTFS réseau peut fonctionner dans un Web Worker depuis un build statique, avec des résultats identiques à SQLite sur les cas comparés, une mémoire réduite et des caches bornés. Cela justifie de poursuivre le prototype, **pas de remplacer le moteur des utilisateurs**.

## Évaluation des critères

| Critère | Décision et preuve |
|---|---|
| Aucune divergence inexpliquée | Validé sur les scénarios exécutés : 63 comparaisons principales, adresses/favoris en rejeu et comparaisons Edge/Firefox ; pas une preuve exhaustive du réseau |
| Pas de téléchargement complet GTFS | Validé : 3,45 Mo de catalogue/courses/événements utiles, sans ZIP ni base SQLite dans le navigateur |
| Thread principal réactif | Validé pour le laboratoire : heartbeat maximal observé 25,2 ms ; interface React complète avec carte non qualifiée |
| Mémoire bornée et mesurée | Partiel : trois journées et cache résultats bornés, mémoire récupérable après libération, mais pas de pic RSS navigateur fiable ni de téléphone physique |
| Chargement/invalidation fiables | Validé sur tests : SHA, tailles, schéma, promesses partagées, manifeste revalidé et remise à zéro complète au changement de version |
| Changement de date cohérent | Validé sur cinq journées compilées, jour férié et traversée de minuit ; manque le pipeline couvrant toute la validité |
| Échec contrôlé | Validé pour les erreurs testées, annulation et repli explicite si SQLite est joignable ; OOM système réel non testé |
| Hébergement statique gratuit | Build local vérifié sans API de calcul ; taille/nombre de fichiers compatibles avec les limites documentées ; hébergement distant, droits de redistribution et relais IGN/Trafic non validés |
| Aucun coût obligatoire | Respecté : aucune dépendance payante, souscription, carte bancaire ou publication introduite |

## Ce qui bloque une migration complète

1. **Parité de périmètre incomplète.** Les résultats réseau et la couche mobilité ont été comparés, mais le parcours adresses/favoris complet n'est pas exécuté dans le Worker et les API Horaires/recherche/carte ne sont pas toutes remplacées. Le chemin SQL historique appelé par `createJourneyPlanner` avec `maxTransfers=1` ne fait pas partie des requêtes émulées ; les cas « une correspondance » testent le moteur réseau courant avec une limite de deux, pas une émulation de chaque ancienne API.
2. **Mobile réel absent.** Le poste testé possède environ 32 Go de RAM. Les vues 320/390 px et le ralentissement du thread principal ne simulent pas un téléphone à faible mémoire. Les échantillons du Worker atteignent 53,8 Mo de tas utilisé et 83,9 Mo de backing storage, à des instants potentiellement différents. Le maximum physique réel est inconnu.
3. **Réseau lent coûteux.** La première recherche demande encore environ 10 secondes au débit local simulé de 375 ko/s. Les caches sont en mémoire ; recharger la page les perd. Le partitionnement supplémentaire doit démontrer qu'aucune correspondance utile n'est coupée.
4. **Renouvellement partiel.** Cinq dates seulement sont compilées. La préparation et le rollback locaux sont vérifiés, mais l'authentification GTFS technique reste en attente et aucune nouvelle archive n'a été téléchargée. Les autorisations de redistribution restent à confirmer avant publication.
5. **Services non statiques.** La stratégie gratuite du relais IGN, de coordination des quotas et de collecte Trafic reste à valider. Le navigateur ne reçoit aucun identifiant technique GTFS. La disponibilité actuelle du temps réel n'est pas modifiée.
6. **Publication distante non éprouvée.** Le build statique et le pointeur local vérifié ne prouvent pas la bascule atomique d'un hébergeur réel, sa configuration de cache ou un rollback distant. Aucun déploiement n'est effectué.

Les [limites Cloudflare documentées](https://developers.cloudflare.com/workers/platform/limits/) distinguent les assets statiques du code serveur : déplacer ce calcul dans une invocation Workers Free ne résout pas les budgets CPU/mémoire. La piste testée exécute le calcul dans le navigateur. Les [assets statiques sont annoncés gratuits](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), sans démontrer par là que toute l'application avec ses fournisseurs devient autonome.

## Seuils de suivi proposés

Ce sont des seuils d'alerte pour **ce poste et ce harnais**, pas des garanties produit :

- Régression à investiguer si le p95 empirique local froid dépasse **350 ms en direct**, **1 200 ms avec une correspondance** ou **350 ms pour le cas à deux correspondances**. Mesures actuelles d'aller-retour : 275 / 986 / 248 ms. Refaire au moins cinq répétitions et conserver min/max ; les cas ne représentent pas tout le réseau.
- Cache de résultat chaud : alerte au-delà de **20 ms d'aller-retour** local ; valeurs observées environ 4–7 ms. Cette règle ne s'applique pas à une destination/date différente.
- Thread principal : relever tout intervalle de heartbeat supérieur à **50 ms**, puis confirmer par une trace de tâches longues dans l'application complète.
- Mémoire : surveiller séparément tas Worker **60 Mo** et backing storage **90 Mo**, à partir des maxima échantillonnés de 53,8 et 83,9 Mo. Ce sont des seuils de diagnostic proches des observations, pas un budget mobile validé. Exiger au plus trois journées résidentes et vérifier la récupérabilité après libération ; ne pas confondre récupération logique et baisse RSS immédiate.
- Données simples : conserver la référence actuelle **3 449 979 octets**, déclencher une revue si une évolution dépasse **4 Mo** pour le même cas. Une variation légitime du GTFS peut nécessiter d'adapter cette référence.

Aucun seuil mobile universel n'est proposé sans appareil réel. Un budget produit devra être fixé sur le matériel cible et en incluant React, MapLibre et les autres modules.

## Prochaines étapes recommandées

1. Éprouver le chargement et la mémoire sur au moins un téléphone à faible mémoire, avec plusieurs heures d'usage et traces du rendu React complet.
2. Définir une API Worker pour adresses/favoris et comparer les parcours porte-à-porte complets, sans introduire de nouveaux appels IGN à chaque frappe.
3. Couvrir les API et chemins manquants avant de parler d'absence de perte fonctionnelle ; conserver des oracles SQLite indépendants.
4. Générer toute la période de validité et automatiser la validation de chaque nouvelle version, uniquement avec un accès GTFS autorisé.
5. Évaluer un cache persistant borné et un partitionnement plus fin avec preuve de conservation des chemins ; mesurer le risque de retéléchargements.
6. Valider séparément la distribution gratuite et les quotas des services auxiliaires. Une migration active demanderait une nouvelle décision explicite après ces preuves.

## Préservation de l'existant

SHA-256 inchangés après les développements et tests :

- `.data/gtfs.sqlite` : `a2f71d7792bdc04df2be9e92aad97d3905a26fec2e00397b9546b15fca7b386a`.
- `GTFS_TCL.ZIP` : `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`.

Le build actif garde les mêmes noms d'assets et V0.1. Aucun module métier actif n'a été modifié pour rendre les benchmarks favorables. Les 248 tests automatisés, le lint, TypeScript et les deux builds passent ; seul l'avertissement MapLibre existant subsiste.

Rapports associés : [optimisation et fichiers](OPTIMISATION-HYBRIDE.md), [validation détaillée](VALIDATION-MOTEUR-NAVIGATEUR.md), [mesures et empreintes](evidence/hybrid-2026-11-10.json).
