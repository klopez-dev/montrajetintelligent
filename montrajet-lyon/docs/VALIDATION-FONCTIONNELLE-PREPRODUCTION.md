# Validation fonctionnelle de la préproduction — V0.1

Essais du **10 novembre 2026**. Verdict : **PRÉPRODUCTION PARTIELLEMENT VALIDÉE**. Les résultats ci-dessous sont issus des exécutions locales, pas d’une déduction à partir d’une capture précédente.

## Matrice des trajets réels

Les sept catégories sont calculées dans Edge, avec seulement le serveur HTTP statique. Départ demandé : **10 novembre 2026 à 08:00 Europe/Paris**, soit `07:00:00Z`. Deux correspondances autorisées, classement par arrivée ; les liens piétons supplémentaires de correspondance sont désactivés dans cette matrice. Les marches d’accès et de sortie sont bien calculées par IGN.

| Catégorie | Points / réglage | Résultat | Temps navigateur observé |
|---|---|---|---:|
| Arrêt → arrêt | Quais GTFS 35660 → 35668 | 6 propositions T3 et alternatives contrôlées | 275 ms |
| Adresse → adresse | 135 Avenue Lacassagne → 10 Rue Olympe de Gouges | 6 propositions | 13 045 ms |
| Adresse → arrêt | Même départ → quai 35668 | 6 propositions | 9 779 ms |
| Arrêt → adresse | Quai 35660 → même destination | 6 propositions | 7 636 ms |
| Domicile → travail | Lieux enregistrés dans le modèle de favoris, marge 180 s | 6 propositions | 410 ms |
| Travail → domicile | Sens inverse, marge 180 s, nouveau calcul | 6 propositions | 13 119 ms |
| Favori personnalisé | Domicile → quai 35668, marge 180 s | 6 propositions | 251 ms |

Ces temps successifs partagent les caches lorsqu’ils s’appliquent ; **ils ne sont pas sept mesures à froid comparables**. Les actions de favoris dans cette matrice utilisent les véritables fonctions `savePlace`, `saveTrip`, `resolveEndpoint`. Un scénario distinct couvre l’interface React et le stockage réel du navigateur.

Chaque proposition retournée est contrôlée par un oracle SQLite en lecture seule indépendant du calculateur : existence des courses, quais, séquences, montée/descente autorisées, ligne, direction, calendrier et exceptions, conversion Europe/Paris, durées et règles orientées de correspondance. Les heures porte-à-porte sont recalculées : marche initiale + marge avant le premier transport ; marche finale après le dernier transport. Les géométries doivent provenir d’IGN, être piétonnes et conserver des raccordements au réseau de 25 m maximum. L’ordre arrivée/durée/correspondances est contrôlé pour le classement par arrivée.

La matrice étendue contrôle **60 propositions au total**, y compris répétition avec cache, « Arriver avant » et changement de date. Les six propositions après minuit du scénario T1 complémentaire sont également vérifiées par l’oracle.

## Trajet demandé : les cinq propositions précédentes ne sont pas reprises comme preuve

Pour **135 Avenue Lacassagne, Lyon → 10 Rue Olympe de Gouges, Villeurbanne**, la recherche fixée au 10 novembre à 08:00 retourne ici **six** propositions. Toutes passent les contrôles GTFS et l’arithmétique porte-à-porte.

| Rang | Lignes | Départ domicile | Arrivée destination | Durée | Marche estimée |
|---|---|---|---|---|---|
| 1 | T3 | 08:05:21 | 08:36:58 | 31 min 37 s | 23 min 22 s |
| 2 | T3 | 08:04:19 | 08:36:58 | 32 min 39 s | 21 min 49 s |
| 3 | T3 + T3 | 08:01:59 | 08:47:40 | 45 min 41 s | 21 min 9 s connues |
| 4 | C26 | 08:07:09 | 08:48:49 | 41 min 40 s | 24 min 40 s |
| 5 | C26 | 08:06:34 | 08:48:49 | 42 min 15 s | 23 min 15 s |
| 6 | C8 | 08:09:25 | 08:50:48 | 41 min 23 s | 15 min 23 s |

Heures locales Europe/Paris, horaires de transport **théoriques**. Le rang 1 marche vers Reconnaissance–Balzac, emprunte le T3 direction Meyzieu les Panettes à 08:24:11, arrive à La Soie à 08:30:26, puis marche 392 s jusqu’à destination. Accès IGN 1 010 s, marge 120 s : durée totale 1 897 s. Ces marches sont des estimations de routage sur réseau réel, pas une mesure du pas de l’utilisateur.

Le rang 3 possède une correspondance GTFS réalisable, mais une décomposition piétonne inconnue : le temps d’attente est **inconnu**, pas remplacé par zéro. La marche affichée reste la partie connue. Le classement est par arrivée, ce qui explique qu’un parcours plus long puisse précéder un parcours partant plus tard. L’exploration atteint un budget : les propositions sont contrôlées, **l’optimalité globale n’est pas garantie**.

Le C8 observé ici est direct mais dure environ **41 min**, et non les 36 min de l’observation précédente, dont l’heure et les réglages ne sont pas établis. Aucune durée antérieure n’a été forcée pour retrouver un résultat attendu.

## Dates, calendriers et limites de périmètre

- « Arriver avant » le 10 novembre à 10:00 locales : six propositions, aucune arrivée au-delà de l’instant demandé.
- 11 novembre : six propositions vérifiées avec leurs propres services et exceptions, sans réutiliser les horaires de la veille.
- Après minuit, cas initial T3 à 00:05 : aucune proposition dans le périmètre ; ce résultat ne prouve pas l’absence de service sur tout le réseau.
- Contrôle positif T1 : quais **32137 → 32135**, course **520_T1A-080AM_00901062**, service du **2026-11-10**, départ GTFS **24:00:36**, arrivée **24:02:11**. Le navigateur restitue le **11 novembre à 00:00:36 → 00:02:11 Europe/Paris**, et non la veille ni un passage expiré. Six propositions du résultat sont vérifiées.
- Date 2028 hors validité : aucune proposition inventée.
- Le feed compilé couvre **2026-11-08 → 2027-03-08**, 121 journées. Il ne contient pas de transition d’heure saisonnière : les changements d’heure sont validés par les tests automatisés dédiés sur fixtures isolées, **pas par une course TCL réelle à une date de transition de ce feed**.
- Les tests automatisés couvrent aussi trajets directs, une et deux correspondances, horaires, transferts orientés et temps minimaux. La matrice réelle ci-dessus ne démontre pas à elle seule tous les trajets à deux correspondances du réseau.

## IGN : direct, cache et simulation distingués

Géocodage et marche : HTTP **200**, réponse **CORS**, contenu exploitable dans Edge et Firefox. Aucun relais n’est nécessaire pour les deux points testés à cette date. La matrice et les trois répétitions chronométrées utilisent le fournisseur réel, éventuellement son cache ; **aucun rejeu positif IGN** n’est utilisé pour valider la disponibilité en direct.

Les pannes sont volontairement **simulées** dans un Worker enveloppé par le harnais QA, sans fabriquer de trajet positif : 429 avec `Retry-After`, 500, JSON invalide, JSON incomplet, timeout et échec réseau. Chacune provoque une réponse d’indisponibilité qui nomme IGN ; un calcul entre arrêts reste possible. Le deuxième essai après 429 n’émet pas une nouvelle requête fournisseur. Le scénario d’annulation et le test unitaire du fournisseur contrôlent l’interruption et les consommateurs partagés. Les tests ne déclenchent pas un vrai dépassement de quota ni une panne réelle chez IGN.

## Favoris dans React et le stockage local

Scénario réussi dans un profil Edge jetable :

1. Recherche manuelle et sélection explicite des adresses domicile et travail ; aucune suggestion ni requête de géocodage avant le bouton de recherche du lieu.
2. Création d’un trajet lié à ces lieux, renommage, inversion puis retour au sens initial.
3. Rechargement de la page ; fermeture complète du navigateur de test et réouverture du **même profil** sur la même origine : lieux et trajet conservés à l’identique.
4. Ouverture des favoris sans appel IGN ; recalcul effectif du trajet enregistré, puis consultation de sa carte.
5. Suppression confirmée d’un trajet et d’un lieu.
6. Injection uniquement dans le profil QA d’une référence à `QA_MISSING_STOP` : erreur explicite, favori conservé, aucun résultat fictif. Ce cas négatif ne modifie pas le GTFS.

Le stockage reste `localStorage`, sans compte, synchronisation ou envoi de la liste des favoris. Les adresses et coordonnées nécessaires sont néanmoins transmises à IGN quand l’utilisateur recherche un lieu ou demande un calcul ; « local » ne signifie pas absence de transmission lors d’un calcul. Les noms personnalisés ne sont pas nécessaires au fournisseur. Un autre profil, un changement d’origine/port ou un nettoyage du navigateur peut rendre les favoris indisponibles.

## Carte

Edge et Firefox affichent un véritable canvas MapLibre et cinq marqueurs sur le trajet entre arrêts. Le scénario adresse→adresse montre huit marqueurs et les étapes de marche initiale, T3 et marche finale. Les informations d’étapes, sélection d’une étape, cadrage, commandes de zoom, recentrage et changement vers la deuxième proposition fonctionnent. La géométrie de marche est celle retournée par IGN ; **aucun trait de transport n’est inventé**, `shapes.txt` étant absent et `geometry: null` étant vérifié.

Un build QA distinct `.data/preproduction-1794344089182`, option `--qa-tile-provider`, active uniquement pour cet essai la configuration OSM. DevTools bloque toutes les URL avant envoi : **22 tentatives, zéro téléchargement de tuile**, message de fond indisponible, cinq marqueurs et étapes GTFS toujours accessibles. Ce test valide le repli, pas la disponibilité en direct d’OSM. Le build final normal conserve le fond distant désactivé.

Quatre largeurs contrôlées dans Edge et Firefox : **1440, 768, 390 et 320 px**, sans débordement horizontal détecté. Le scénario avec marches et carte passe aussi à ces quatre largeurs dans Edge ; captures conservées dans les répertoires de preuve. Il ne s’agit pas de tests sur smartphone physique.

## Trafic et temps réel

Aucune collecte TCL réalisée. État `unavailable`, aucune annonce, aucune couverture confirmée et **aucune récupération valide** affichée. La date de vérification locale du module ne constitue pas une date de collecte de données TCL. Aucune annonce ancienne n’est présentée comme actuelle. Le lien officiel est disponible, et aucune conclusion « trafic normal » n’est déduite de l’absence d’annonces. Les avertissements d’itinéraires gardent cette incertitude. Temps réel Grand Lyon toujours désactivé ; aucun passage théorique n’est requalifié en temps réel.

## Résilience et navigateurs

| Scénario | Résultat observé |
|---|---|
| Accès aux données coupé à froid dans le Worker | Erreur, aucun itinéraire de remplacement |
| Partition GTFS absente / corrompue | Refus explicite ; SHA-256 contrôlé |
| Version incompatible avec catalogue déjà en mémoire | Consultation refusée après correction |
| Recherche annulée / interruption du Worker | Ancien résultat non émis ; nouveau calcul possible |
| Deux recherches rapides, date modifiée pendant la première | Ancienne recherche annulée ; seule la nouvelle date gagne dans React, Edge et Firefox |
| Bouton Annuler | Fonctionnel, résultats précédents identifiés comme tels |
| Nouvelle recherche échouée | Derniers résultats valides conservés avec leur date et l’étiquette « recherche précédente » |
| Rechargement | Pas de propositions périmées restaurées comme nouvelles |

Navigateurs réellement testés : **Edge 157.0.4341.42** et **Firefox 159.0.1**, sans exception console non gérée relevée dans les parcours réussis. Chrome n’a pas été trouvé aux emplacements usuels ni dans le PATH lors de l’audit ; il n’a pas été installé. Aucun smartphone physique disponible. La panne complète avant chargement initial des fichiers n’est pas résolue : aucune PWA hors ligne n’est livrée.

## Commandes et preuves

```powershell
npm.cmd test
npm.cmd run lint
npx.cmd tsc -p tsconfig.preproduction.json
npm.cmd run build
node scripts/prototype/build-preproduction.mjs
node scripts/prototype/test-preproduction.mjs .data/preproduction-1794344387115 edge
node scripts/prototype/test-preproduction.mjs .data/preproduction-1794344387115 firefox
node scripts/prototype/step1-resilience.mjs .data/preproduction-1794344387115
node scripts/prototype/step1-matrix.mjs .data/preproduction-1794344387115
node scripts/prototype/step1-favorites.mjs .data/preproduction-1794344387115
```

**261 tests automatisés réussis, zéro échec ni test ignoré.** Lint, TypeScript de préproduction, compilation active et build statique réussis. Vite conserve son avertissement de taille du chunk MapLibre ; il n’est pas masqué.

Les scripts de matrice/favoris contactent IGN : ne pas les exécuter en parallèle ni les boucler inutilement. Les scénarios de panne n’utilisent pas de données fournisseur positives fictives. Les chemins et SHA-256 des rapports bruts sont indexés dans [la synthèse finale](evidence/preproduction-step1-controle-final-2026-11-10.json).

Provenance : matrice et favoris exécutés sur le build instrumenté `1794343279966` ; tests négatifs et mesures sur `1794343892737` après durcissement de version ; Edge/Firefox rejoués sur le build final `1794344387115`. Les fichiers JS/CSS du build mesuré et du build final sont vérifiés identiques par SHA-256 : seule l’entrée HTML ajoute le favicon. Les anciens essais échoués du harnais sont conservés localement ; leurs erreurs de sérialisation/initialisation ont été corrigées puis les scénarios relancés, sans les compter comme succès.

Limites avant publication : renouvellement et droits GTFS, téléphone physique, CPU et mémoire réels sur appareil modeste, coordination des quotas IGN, publication atomique/rollback et disponibilité distante. **Aucune migration de l’application active ni publication n’est validée par cette étape.**
