# Validation de la refonte des résultats

## Scénarios et preuves

La préproduction finale `.data/preproduction-1794351393487` utilise le GTFS SHA-256 `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`. Le scénario vérifié est Dauphiné-Lacassagne, quai `35660`, vers Vaulx-en-Velin La Soie, quai `35668`, le 10 novembre 2026 à 08h00. Le test navigateur compare l’ordre, les identifiants, les durées, les heures et toutes les lignes de chaque carte à la réponse réelle du Worker, sans fixture d’itinéraire.

| Contrôle | Résultat |
| --- | --- |
| Cartes, niveaux de détail, quais, données GTFS exactes | Réussi dans Edge et Firefox |
| Recherche partielle, trafic indisponible, source | États affichés explicitement |
| Favori de carte, changement de proposition sur la carte | Réussi dans Edge et Firefox |
| Largeurs 1440, 768, 390 et 320 px | Aucun débordement horizontal ; captures enregistrées |
| Activation de « Voir les étapes » par Entrée | Réussie dans Edge après correctif expérimental |
| Adresses domicile/travail réelles, IGN, recalcul, carte, favoris | Réussi dans Edge ; géocodage et routage officiels effectivement consultés |
| Tests unitaires | 264 réussis, 0 échec |
| TypeScript préproduction, linter, compilation Vite | Réussis |

Captures : `.data/step2-results-edge-1794351420536/results-390.png`, `.data/step2-results-firefox-1794351434581/results-390.png` et `.data/step1-favorites-1794351404480/map-390.png` pour le trajet avec adresses et marche. Les rapports JSON complets sont dans ces mêmes dossiers. Les contrôles de non-régression du prototype sont dans `.data/preproduction-test-edge-1794351200361/report.json` et `.data/preproduction-test-firefox-1794351217452/report.json` ; la classe historique du conteneur a ensuite été restaurée, puis les résultats ont été retestés dans les deux navigateurs.

Le recalcul réel entre 135 Avenue Lacassagne et 10 Rue Olympe de Gouges a pris **20,6 s** lors de cet essai, dont les requêtes IGN ; huit marqueurs ont été affichés. Cette durée est une observation unique du test fonctionnel, pas une mesure de performance représentative. Le tronçon affiché emprunte T3 de Reconnaissance - Balzac vers Vaulx-en-Velin La Soie, avec marche initiale et finale IGN ; ce choix provient de la réponse réelle du moteur, sans scénario inventé.

## Avant et après

Avant, la même recherche affichait les propositions dans le composant historique, avec les heures et la chronologie noyées dans davantage de détails. Capture de référence d’un parcours adresse à adresse : `.data/step1-favorites-1794343806162/map-390.png`. Après, les heures, la durée et les lignes sont visibles sur la première vue mobile ; la chronologie et les données exactes sont ouvertes à la demande. Les données du moteur ne sont pas modifiées : le paquet Worker conserve le même hash de compilation.

## Réserves

Le rendu de carte dans Firefox avec fond distant désactivé peut afficher un avertissement générique de rendu. Les essais automatisés n’établissent ni conformité complète WCAG ni qualité sur appareil mobile physique. La comparaison avant/après de la lisibilité est visuelle ; aucune mesure d’étude utilisateur n’a été réalisée.

**Verdict : REFONTE UX PARTIELLEMENT VALIDÉE.** La présentation et les parcours automatisés sont validés en préproduction ; la promotion attend la résolution de l’avertissement carte et une revue d’accessibilité manuelle.
