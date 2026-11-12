# Favoris intelligents — MonTrajet Lyon V0.1

Validation du 9 novembre 2026. Aucun déploiement ni service payant ajouté.

## 1. Architecture retenue

Le système existant évolue dans la même clé localStorage. La validation, la migration et les modifications sont centralisées dans `src/services/favorites.ts`. `FavoritesPanel` et `FavoriteFields` réutilisent les recherches existantes. App conserve les réglages pendant la navigation ; JourneyForm reste le seul parcours de calcul.

## 2. Modèle de données

Le magasin version 2 contient `places`, `trips`, `preferences` et `revision`. Les lieux possèdent identifiant stable, nom, rôle domicile/travail/autre, localisation et dates de création/modification. Les adresses gardent leurs champs normalisés nécessaires et coordonnées ; les arrêts gardent l'identifiant exact de quai GTFS et leurs coordonnées si disponibles.

Un trajet conserve un nom, un identifiant, des dates, deux extrémités et ses préférences. Une extrémité référence un lieu enregistré ou conserve sa propre localisation. Seules des associations exactes sont utilisées ; modifier un lieu référencé met à jour les trajets concernés. Préférences facultatives : mode, heures habituelles, marge, maximum de correspondances, correspondances piétonnes et classement. Aucun résultat calculé n'est sauvegardé.

## 3. Stockage et migration

La clé reste `montrajet-lyon:favorites:v1`, avec un contenu versionné 2. Les anciens tableaux sont migrés en mémoire sans écriture à la lecture. Le premier enregistrement explicite réussi persiste la migration. Les identifiants existants sont conservés. Un ancien favori sans identifiant de quai reste à corriger, sans rapprochement par nom. Les dates absentes de l'ancien format prennent la date de migration, sans prétendre retrouver la création historique.

La validation limite le magasin à 200 lieux et 200 trajets et la représentation lue à 2 Mo. Elle contrôle identifiants, références, doublons, coordonnées et préférences. Les données corrompues ou d'une version future ne sont pas écrasées. Un conflit de révision entre onglets refuse l'écriture et invite à recharger. Un quota dépassé ou stockage indisponible laisse l'état précédent intact et affiche un échec. La suppression globale confirmée retire exclusivement cette clé.

## 4. Fonctionnalités implémentées

Mes lieux propose domicile, travail et autres lieux ; Mes arrêts regroupe les quais ; Mes trajets rassemble les actions rapides et trajets personnalisés. Les lieux sont créables, modifiables, renommables, remplaçables et supprimables. Domicile et travail restent facultatifs, avec au plus un de chaque. Les doublons involontaires sont refusés.

Les actions rapides calculent indépendamment domicile → travail et travail → domicile. Les quatre combinaisons adresse/arrêt sont prises en charge. Les trajets peuvent être enregistrés depuis le formulaire ou les résultats, nommés, modifiés, inversés, utilisés sans calcul ou recalculés explicitement. Une suppression requiert confirmation. Supprimer un lieu conserve une copie dans les trajets qui le référencent : le dialogue l'explique ; ces trajets doivent également être supprimés pour retirer leurs copies.

## 5. Intégration avec JourneyForm

Les sélecteurs préremplissent une localisation validée, jamais un simple texte. Le jour sélectionné est conservé pendant la navigation ; une heure habituelle facultative s'applique à ce même jour selon Partir à/Arriver avant. Les heures utilisent le fuseau de l'appareil, comme le formulaire existant. Le choix d'occurrence lors d'un changement d'heure est conservé si l'heure ne change pas. Aucun basculement automatique au lendemain.

La date du voyage n'est pas persistée : après rechargement complet, le formulaire reprend sa date courante. Enregistrer depuis les résultats utilise les extrémités et préférences du calcul réussi, même si les champs ont été modifiés depuis. Une commande de lancement est consommée une seule fois. Les protections de recherches successives et l'annulation sont conservées.

## 6. Intégration avec le moteur

Chaque action Recalculer déclenche une nouvelle requête vers l'API existante. Aucun ancien résultat du favori n'est présenté comme actuel. Les caches valides du moteur sont conservés, notamment les marches IGN ; cela ne signifie pas une nouvelle consultation du fournisseur à chaque clic. Horaires, calendriers, marges, marches, deux correspondances maximum et avertissements Trafic restent ceux du moteur existant.

Les coordonnées sauvegardées servent au contrôle de cohérence, pas comme coordonnées de routage de confiance. Le serveur résout l'identifiant officiel BAN, réutilise son cache valide et compare les coordonnées avant de marcher. Une localisation modifiée impose une nouvelle sélection. La clé des recherches partagées distingue aussi les coordonnées attendues.

## 7. Références invalides

Les quais sont contrôlés par identifiant exact avec l'API locale avant calcul. Un quai absent est signalé ; le favori reste corrigeable et aucun quai homonyme ni recherche IGN ne lui est substitué. Une adresse doit être sélectionnée dans les résultats officiels au niveau adresse, avec coordonnées valides. Les résultats de niveau rue et localisations incohérentes sont refusés. Une indisponibilité du fournisseur ne déclenche aucun remplacement approximatif.

## 8. Données personnelles

Les favoris sont en clair dans le profil du navigateur, sans chiffrement ni sauvegarde garantie. D'autres personnes utilisant ce profil peuvent y accéder. Aucun compte, secret, synchronisation ou télémétrie contenant les adresses n'est ajouté. Aucun calcul, géocodage ou préchargement n'est déclenché à l'ouverture de Favoris, à la lecture du stockage ou au renommage.

Dans les éditeurs Favoris, saisir du texte ne suffit pas à interroger IGN : le bouton Rechercher ce lieu est nécessaire. Cette recherche explicite transmet nécessairement le texte au géocodeur officiel pour permettre la sélection. Le formulaire d'itinéraire conserve son autocomplétion existante lors d'une saisie volontaire. Les calculs explicites transmettent les références nécessaires aux services existants. Effacer les favoris n'efface pas les autres données du navigateur ni les caches techniques du serveur.

## 9. Tests automatisés

`npm.cmd test` : **216 tests réussis**, dont 17 nouveaux dans `tests/favorites-smart.test.mjs`. Couverture : rôles, identifiants stables, modification/remplacement, quatre combinaisons, inversions, références et copies à la suppression, doublons et préférences implicites, migration sans écriture, corruption et version future, quota et stockage indisponible, conflits entre onglets, minimisation des données, horaires habituels, absence de fetch passif et cohérence BAN avant marche.

`npm.cmd run lint` : réussi sans avertissement. `npm.cmd run build` : TypeScript et Vite réussis. Version publique V0.1 et version package 0.0.0 inchangées.

## 10. Tests navigateur

Microsoft Edge utilise uniquement des profils QA isolés. **17 scénarios Favoris réussis**, avec véritables API de succès et contrôle des horaires contre SQLite. Domicile et travail sont configurés avec des adresses publiques de test sélectionnées dans IGN ; Edge est entièrement fermé puis rouvert avec le même profil. Les deux trajets sont recalculés sans ressaisie et aucun géocodage n'est émis à la réouverture.

Autres scénarios : trajet personnalisé, doublon, renommage sans géocodage, Arriver avant, quatre combinaisons, quai exact, référence GTFS manquante sans substitution, confirmation et annulation au clavier, quota sans écrasement, migration, annulation et nouvelle recherche. Les erreurs contrôlées et anciens formats sont injectés uniquement dans le profil QA ; aucun résultat positif fictif n'est créé. Largeurs 1440, 768, 390 et 320 px vérifiées sans débordement, avec captures et dialogues accessibles au clavier.

Preuve principale : `.data/favorites-validation-1794247843829/report.json`. Les 17 scénarios Favoris ont réussi ; le statut global de ce premier rapport reste néanmoins `failed`, une suite suivante ayant rencontré une course de rechargement dans le pilote de test. Le pilote attend maintenant la navigation effectivement terminée et la suite Itinéraires a été relancée avec succès. Les échecs initiaux sont conservés, sans transformation en succès.

Non-régressions réussies, rapports séparés :

| Suite | Contrôles | Dossier sous .data |
| --- | ---: | --- |
| Réseau | 12 | network-validation-1794247955928 |
| Itinéraires | 27 | routing-validation-1794248108195 |
| Horaires | 32 | validation-1794248174086 |
| Mobilité | 18 | mobility-validation-1794248201070 |
| Trafic | 9 | traffic-validation-1794248273822 |
| Expérience, serveur froid | 9 | experience-validation-1794248598598 |

**Bilan : 124 contrôles API/navigateur réussis**, dont les 17 scénarios Favoris, répartis sur ces exécutions. La suite Expérience vérifie l'annulation pendant les vraies marches IGN, la relance, les erreurs et les réponses obsolètes. Le retour visuel d'annulation y a été mesuré à 22,6 ms.

Cette suite exige un serveur froid pour observer réellement la phase IGN : le serveur partagé déjà chaud la terminait avant son observation dans le DOM. L'orchestration lui réserve désormais son serveur. Une première navigation Edge vide est réessayée uniquement si le document est effectivement vide.

Commandes reproductibles :

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
node scripts/qa/validate-favorites.mjs
```

Le dernier script lance Edge et les non-régressions, avec serveur local sur port libre. Il contacte les fournisseurs officiels lors des actions explicites : ne pas le répéter inutilement. Profils et rapports restent sous `.data`, sans publication.

## 11. Performances mesurées

Durées backend des huit recherches réussies du scénario Favoris, sur cette machine et cette session. Elles ne constituent ni une garantie ni un benchmark d'optimisation du moteur.

| Recherche | Durée backend | Appels amont | Réutilisations cache | Propositions |
| --- | ---: | ---: | ---: | ---: |
| Adresse → adresse, aller | 16 876,5 ms | 48 | 2 | 3 |
| Adresse → adresse, retour indépendant | 15 942,8 ms | 48 | 2 | 6 |
| Favori modifié, Arriver avant | 5 452,5 ms | 0 | 50 | 4 |
| Adresse → arrêt | 11 003 ms | 26 | 23 | 6 |
| Arrêt → arrêt | 498,8 ms | — | — | 6 |
| Arrêt → adresse | 8 665 ms | 26 | 23 | 6 |
| Ancien favori migré entre quais | 336,8 ms | — | — | 6 |
| Nouvelle recherche après annulation | 318,6 ms | — | — | 6 |

Le changement de mode et d'heure réutilise les marches disponibles tout en recalculant le trajet ; ce n'est pas une comparaison du même calcul avant/après optimisation. Le premier calcul IGN conserve une attente proche de 16 secondes, avec étapes réelles et Annuler. Le gain concerne la ressaisie et les appels évités à l'affichage, pas une promesse de résultat instantané. Aucun préchargement ni consommation de quota en arrière-plan n'est ajouté ; un calcul explicite peut encore nécessiter plusieurs dizaines de requêtes piétonnes contrôlées par le moteur existant.

## 12. Limites restantes

Le stockage dépend du navigateur, du profil et de l'origine (protocole/hôte/port). Pas d'export/import, synchronisation ou sauvegarde garantie. Un conflit entre onglets demande un rechargement. Les références peuvent évoluer et nécessiter correction. Une modification de coordonnées BAN, même légère, impose une nouvelle sélection plutôt qu'un remplacement silencieux. Les fournisseurs peuvent être indisponibles ; les premiers calculs restent coûteux.

Le périmètre réseau, les deux correspondances maximum et la couverture partielle Trafic sont inchangés. Le temps réel Grand Lyon reste désactivé après HTTP 401. Les horaires demeurent théoriques. Aucun déploiement Cloudflare ni validation d'environnement déployé n'a été effectué.

## 13. Fichiers créés ou modifiés

- `src/types/favorites.ts` : modèle versionné.
- `src/services/favorites.ts` : validation, migration, CRUD et compatibilité ancienne API.
- `src/services/favoriteJourney.ts` : préférences et jour de recherche.
- `src/components/FavoriteFields.tsx` : sélection explicite, préférences et confirmation.
- `src/components/FavoritesPanel.tsx` : gestion des lieux et trajets.
- `src/components/GtfsSearchField.tsx` : recherche manuelle facultative.
- `src/components/JourneyForm.tsx` : préremplissage, recalcul, références et sauvegarde.
- `src/App.tsx`, `src/App.css` : intégration et affichage responsive.
- `src/services/mobility.ts` : recherche d'adresses existante réutilisée.
- `src/types/mobility.ts`, `server/mobility/api.ts`, `server/mobility/planner.ts` : cohérence des coordonnées sauvegardées.
- `tests/favorites-smart.test.mjs` : tests du nouveau système.
- `scripts/qa/validate-favorites.mjs`, `scripts/qa/validate-favorites-regressions.mjs` : parcours Edge et orchestration.
- `scripts/qa/browser-driver.mjs`, `scripts/qa/validate-journeys.mjs`, `scripts/qa/validate-experience.mjs` : nouveaux formats et robustesse du banc de test.
- `README.md`, `docs/FAVORIS-INTELLIGENTS.md` : documentation.

Aucune archive GTFS ni donnée personnelle existante n'a été remplacée.