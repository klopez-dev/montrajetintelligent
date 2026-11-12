# Stabilisation des parcours essentiels V0.1

Date : 11 novembre 2026. Validation locale uniquement, base GTFS active inchangée, aucun déploiement ni changement des secrets ou des deux niveaux temps réel.

## Défauts reproduits et corrections

| Constat | Preuve | Correction |
|---|---|---|
| Retour navigateur ne restaure pas l'onglet | Avant modification, clic Accueil → Horaires : URL et longueur d'historique inchangées | `src/App.tsx` : état initial lu de `?page=`, `pushState` au changement, `popstate` pour Retour/Suivant ; les ouvertures depuis Favoris passent par la même navigation |
| Recherche et horaires perdus lors d'un changement d'onglet | Les composants étaient démontés par le rendu conditionnel | `src/App.tsx` : formulaires Itinéraires et Horaires conservés montés, masqués hors onglet ; les requêtes de trajet sont annulées lorsqu'Itinéraires devient inactif. Aucune persistance promise après fermeture du navigateur pour les recherches non enregistrées |
| Géocodage 503 dans le premier essai | Backend de test lancé sans accès réseau externe ; une requête unique à `data.geopf.fr` avec accès autorisé a répondu HTTP 200 | Aucun changement de code : validation reprise sur `vite preview` local avec accès HTTPS. Ce 503 décrit l'environnement de test, pas une panne démontrée d'IGN |
| Vite développement : page HTML servie sans application montée pendant le test isolé | `validate-navigation.mjs` sur le serveur de développement : corps vide et attente DOM expirée ; le même test passe avec le build `vite preview` | Pas de correction dans ce périmètre ; analyser séparément Vite dev. Les résultats navigateur ci-dessous portent sur le build local |

Le mécanisme de navigation utilise des URL telles que `/?page=horaires`. Les URL inconnues ouvrent Accueil. Les paramètres d'URL déjà présents sont conservés. `scripts/qa/validate-navigation.mjs` teste Retour, Suivant, actualisation, lien direct et conservation des saisies Itinéraires/Horaires entre onglets.

## Adresse et marche : appels réels

Sources inspectées : `server/mobility/provider.ts` utilise `https://data.geopf.fr/geocodage/search` avec `indexes=address`, puis `https://data.geopf.fr/navigation/itineraire` avec `resource=bdtopo-osrm` et `profile=pedestrian`. Les résultats exigent des coordonnées valides, les unités et une géométrie piétonne, une distance positive et un raccordement de 25 m maximum à chaque extrémité. Pas de distance à vol d'oiseau affichée comme marche. Cache géocodage 5 min, marche 1 h, au plus deux requêtes simultanées et départs espacés de 260 ms. Les requêtes du navigateur passent par le backend local.

Exécutions réelles :

| Cas | Résultat observé |
|---|---|
| `100 avenue Lacassagne Lyon` | BAN via IGN : `100 Avenue Lacassagne 69003 Lyon`, ID `address:69383_4080_00100`, précision numéro. Sélection explicite dans Edge, puis recherche réelle |
| Adresse Lyon → quai La Soie `35668`, partir à `2026-11-09T10:00:00Z` | HTTP 200, six propositions, état `limited`. Première : départ domicile 10:00:39Z, T3, arrivée 10:23:17Z ; accès IGN BD TOPO **875,5 m / 877 s**. 42 quais confirmés ; 46 requêtes externes, 23,1 s HTTP à froid |
| Même trajet, arriver avant `2026-11-09T11:00:00Z` | HTTP 200, six propositions ; première 10:31:39Z → 10:54:17Z, accès IGN 875,5 m / 877 s. 7,0 s HTTP, 1 requête externe et 48 réponses de cache |
| Adresse Lyon → `5 Avenue des Canuts 69120 Vaulx-en-Velin` | Deux sélections BAN réelles. Première : T3, départ 10:00:39Z, arrivée porte à porte 10:26:02Z ; accès **875,5 m / 877 s**, sortie **166,8 m / 165 s**, tous deux IGN BD TOPO. 11,9 s HTTP, 31 requêtes externes |
| Arrivée à une adresse | Tests quai La Soie `35668`/`35669` → adresse lyonnaise, mode Arriver avant ; marche finale incluse dans l'échéance. Le sens de la première course a été contrôlé |
| `10 rue de la République Villeurbanne` | Le fournisseur a proposé **`10 Cours de la République 69100 Villeurbanne`**, ID `address:69266_3505_00010`, précision numéro, coordonnées 4.87361 / 45.770463. Le libellé différent impose une sélection consciente : aucune assimilation silencieuse de « rue » et « cours » |
| Adresse Villeurbanne sélectionnée → La Soie `36394`, même date | HTTP 200, six propositions, état `limited`. Première : bus 37 puis métro A, 10:06:17Z → 10:38:55Z ; accès IGN BD TOPO **751,6 m / 763 s**. 36,0 s HTTP, 42 requêtes externes, budget de marche atteint |
| `zzzznotarealstreet 99999 Lyon` | HTTP 200, zéro suggestion, sans adresse inventée |

La suite `npm run test:mobility` a réussi **18 contrôles** sur le build local avec accès IGN, y compris la sélection dans Edge, plus de quatre accès confirmés, la comparaison des horaires à SQLite, la marche initiale et finale, plusieurs propositions, une date hors GTFS, et l'affichage d'une erreur IGN simulée dans le navigateur. Les erreurs HTTP, réponses invalides, délais, cache expiré, ambiguïtés et limites de concurrence sont couverts par les tests unitaires avec fournisseur contrôlé ; un véritable timeout IGN n'a pas été provoqué auprès du service public. En cas d'indisponibilité du géocodeur, l'API renvoie 503 et l'interface explique la panne. Aucun itinéraire piéton fictif n'est fabriqué ; le repli vers un trajet entre arrêts reste possible en sélectionnant des arrêts.

**Limite de consommation :** la suite réelle a demandé plusieurs dizaines de parcours piétons par recherche à froid (46 pour Lyon, 42 pour Villeurbanne). La file bornée respecte les plafonds configurés, mais une validation de la politique et du quota public sous usage régulier reste nécessaire. Les états `limited` indiquent explicitement que le budget est atteint ; l'optimalité globale n'est pas prouvée. Aucun préchargement ou collecte continue n'a été activé.

## Navigation et non-régression

- Retour Horaires ← Favoris, retour jusqu'à Accueil, Suivant jusqu'à Favoris : réussis dans Edge via l'historique réel.
- Actualisation de `/?page=favoris` et ouverture directe de `/?page=trafic` : onglets restaurés.
- Saisie Itinéraires « Place Henri » et saisie Horaires « C13 » : conservées pendant les changements d'onglet. Les favoris restent dans leur stockage local existant.
- Largeurs 320, 390, 768 et 1440 px : pas de débordement horizontal dans le scénario de navigation, et contrôles dédiés des résultats aux largeurs couvertes par les suites.
- `npm.cmd test` : **277/277** réussis ; `npm.cmd run lint` : réussi sans avertissement ; `npm.cmd run build` : réussi. Avertissement connu sur le bloc MapLibre de 1 078,23 kB.
- Suites navigateur sur le build : `test:browser` (Horaires), `test:journeys` (arrêts, favoris, directs, correspondances), `test:network` (deux correspondances), `validate-map.mjs` avec `MAP_ERROR_ONLY=true` (marqueurs, fournisseur cartographique en erreur) : réussies. La suite mobilité inclut la carte mobile d'un trajet entre deux adresses. La navigation a été relancée après le dernier changement de rendu.

Rapports bruts : `.data/mobility-validation-1794389528037`, `.data/validation-1794389651498`, `.data/routing-validation-1794389651683`, `.data/network-validation-1794389650217`, `.data/map-validation-1794389648219`. Les rapports des essais échoués sont `.data/mobility-validation-1794389297572` (backend de développement sans accès réseau) et `.data/mobility-validation-1794389467502` (preview sans accès réseau). Ils ne doivent pas être confondus avec un échec fonctionnel du fournisseur.

## Anomalies et limites restantes

1. **Latence et quotas IGN :** 23 s à froid pour l'adresse lyonnaise et 36 s pour Villeurbanne dans les mesures ci-dessus ; le budget de marche atteint dans les deux cas limite la couverture. Pas de correction de performance dans cette mission.
2. **État `limited` :** aucun classement global optimal garanti. Les parcours retenus sont vérifiés, mais des alternatives peuvent manquer.
3. **Vite développement :** montage React non observé dans le test isolé ; `vite preview` fonctionne. Diagnostic distinct requis avant d'utiliser `npm run dev` comme preuve navigateur.
4. **Actualisation de la page :** restaure l'onglet depuis l'URL, mais les saisies non enregistrées des formulaires reviennent à l'état initial. La mission demandait la conservation de l'onglet et la non-perte lors des changements d'onglet, pas une persistance permanente des brouillons.
5. **Carte :** les arrêts officiels sont marqués ; les tracés de véhicules restent absents du GTFS importé. Temps réel niveau 2 toujours désactivé.

Version publique **V0.1** inchangée. Aucun GTFS téléchargé, aucun secret consulté ou modifié, aucun déploiement.
