# Fiabilisation Trafic TCL — 9 novembre 2026, V0.1

**Verdict : PARTIELLEMENT OPÉRATIONNEL.** La collecte s’appuie toujours exclusivement sur les pages publiques officielles TCL. Aucune couverture exhaustive n’est revendiquée, aucun trajet n’est supprimé et aucun quai n’est associé par ressemblance de nom. Le GTFS, les favoris, les horaires et la version publique V0.1 sont conservés. Aucun déploiement, compte payant ou nouveau fournisseur.

## 1. Audit de la couverture précédente

Le collecteur précédent examinait uniquement les liens de fiches publiés dans l’index pour sept lignes prioritaires. Seules C16, T3 et D y avaient un lien exploitable. C13, C9, 125 et A **n’avaient pas été consultées**, et non pas consultées avec zéro annonce. La mention générique concernant le reste du réseau ne constitue pas une vérification individuelle de leurs fiches.

La référence mesurée avant modification le 9 novembre a reçu **10 annonces** (C16 : 4, T3 : 2, D : 4), alors que l’audit du 8 novembre en avait reçu neuf. Cette évolution est celle de la source, pas un incident fictif ajouté pour tester.

## 2. Bilan réel après fiabilisation

Photographie du **9 novembre 2026 à 18:17:06 Europe/Paris**, avec dates de succès propres à chaque fiche :

| Périmètre | Vérifiées avec annonces | Vérifiées sans annonce | Non consultées | Échecs | Périmées |
|---|---:|---:|---:|---:|---:|
| Sept prioritaires | 3 | 0 | 4 | 0 | 0 |
| Extension bornée | 2 | 0 | — | 0 | 0 |
| Catalogue GTFS, 807 couples code/mode distincts | **5** | **0** | **802** | **0** | **0** |

| Ligne | État constaté | Annonces |
|---|---|---:|
| C13 | Non consultée : pas de lien individuel retenu | Non déterminable |
| C9 | Non consultée : même limite | Non déterminable |
| C16 | Fiche consultée avec succès | 4 |
| 125 | Non consultée : pas de lien individuel retenu | Non déterminable |
| T3 | Fiche consultée avec succès | 2 |
| Métro A | Non consultée : pas de lien individuel retenu | Non déterminable |
| Métro D | Fiche consultée avec succès | 4 |
| 104B | Fiche consultée avec succès, extension | 2 |
| 106 | Fiche consultée avec succès, extension | 1 |

Total : **13 annonces officielles dédupliquées**, **13/13 rapprochées partiellement d’une ligne (100 %)**, **0/13 exactement par identifiants officiels communs (0 %)**. Aucun quai identifié structurellement dans ces fiches : taux de rapprochement d’arrêts **non mesurable**, pas un faux 0 %.

Ces comptes sont une observation datée. En cas de nouvelle collecte, les contenus et les états peuvent changer. Les 802 lignes non consultées ne sont pas déclarées sans perturbation. NAVI1, mode ferry non pris en charge par ce fournisseur, reste explicitement dans le catalogue comme non consultée.

## 3. Modifications opérationnelles

- Modèle de couverture par ligne : succès avec annonces, succès sans annonce, non consultée, échec, données périmées ; URL, dernière tentative réelle, dernier succès réel, nombre d’annonces et expiration séparés.
- Une erreur de fiche ne fait plus échouer toutes les autres. Les données précédentes de cette ligne restent datées, périmées et séparées des annonces récentes. Une panne de l’index ne fabrique pas de date de tentative sur des fiches qui n’ont pas été demandées.
- Les lectures du cache ne changent plus `checkedAt`. Les dates individuelles ne sont jamais avancées lors d’un échec.
- Inventaire des liens publiés et de leurs libellés de mode, sans requête supplémentaire. Le code commercial et le mode doivent correspondre au catalogue GTFS avant sélection d’une fiche supplémentaire.
- Extension progressive : au plus **deux fiches supplémentaires par cycle**, parmi les liens réellement publiés, compatibles GTFS, avec priorité aux moins récemment réussies. Aucune URL n’est construite pour les lignes absentes de l’index. Les anciennes fiches de l’extension deviennent périmées après leur propre délai ; ce mécanisme ne fournit donc pas une vue fraîche simultanée de tout le réseau.
- Le mode non pris en charge n’est pas omis du dénominateur GTFS : il reste non consulté.
- Détection de structure : index connu, chemin et hôte autorisés, en-tête exact de la fiche, liste et cartes attendues, vide explicitement confirmé. Si le nombre de cartes diffère du nombre annoncé par l’index, la fiche est en erreur (changement HTML ou publication concurrente), sans nouvelle requête immédiate.
- Cache disque conservé et contrôlé, sans écrasement d’un fichier inconnu. La date de vérification des droits est également conservée : robots et mentions ne sont pas redemandés à chaque redémarrage pendant leur fenêtre de 24 h.

Les plafonds restent prudents : un cycle toutes les **10 minutes par processus**, un départ par seconde, aucune requête parallèle de fiches ni relance automatique. Le délai par page passe de 8 à **12 secondes**, dans le même budget global de **45 secondes**. `Retry-After` et l’arrêt du reste du cycle sur HTTP 429/503 sont respectés. Au plus 9 fiches, un index et, si nécessaire, deux vérifications de politique : **12 requêtes maximum** par cycle initial complet. Ce sont des budgets techniques, pas des quotas publiés par TCL. Les limites exactes et la fréquence de mise à jour du site restent non documentées.

## 4. Normalisation et rapprochement

Les paragraphes mentionnant explicitement direction, non-desserte, déplacement, remplacement, déviation ou fréquence sont indexés comme **extraits littéraux**. Ils ne créent aucun identifiant de quai, direction GTFS ou arrêt de remplacement. Les textes complets et liens officiels sont conservés.

Une syntaxe strictement reconnue combine désormais une liste explicite de dates et une plage nocturne. L’annonce T3 « Le 9, 10, 25 et 27 novembre 2026 », accompagnée de la plage 20:30–02:30 et de ses bornes de dates, donne **quatre intervalles distincts**, avec fin le lendemain. Elle ne devient ni une interruption continue ni un événement du matin. Les jours doivent être valides, dans les bornes, et toutes les heures doivent être univoques en Europe/Paris. Sinon, retour au texte officiel et précision inconnue, sans interprétation partielle hasardeuse.

Les autres récurrences, exceptions de jours ou tournures non prises en charge restent textuelles. Une direction écrite en toutes lettres n’est pas convertie en identifiant GTFS. Le moteur compare toujours les jours de service et les heures réelles des tronçons reconstruits depuis SQLite, y compris après minuit.

**Une annonce connue uniquement au niveau de la ligne produit désormais une information générale**, même lorsque sa période est exacte. Un impact possible nécessite un élément plus précis rapproché mais une incertitude restante. Un impact confirmé nécessite l’élément exact, l’instant et la direction vérifiée lorsqu’elle est spécifiée. Les données périmées d’une ligne ne produisent pas d’avertissement courant, même si une autre ligne du même cycle a réussi. Aucune suppression automatique ni horaire alternatif inventé.

## 5. Interface

L’onglet Trafic affiche les comptes du catalogue et une liste des états de couverture, les sept prioritaires et les lignes déjà consultées. Le filtre permet d’examiner toute autre ligne ; l’affichage est borné à 50 entrées visibles, sans masquer le total. Chaque fiche consultée expose son lien, sa dernière tentative, son dernier succès et son erreur éventuelle.

Les groupes en cours / à venir / période incertaine / terminées restent disponibles pour les données récentes. Les anciennes annonces sont regroupées séparément sous **Données anciennes non reconfirmées**. Les filtres de ligne, mode et date sont conservés, ainsi que le rendu Edge à 320 et 390 px.

## 6. Sources et autorisation

Les [mentions légales TCL](https://www.tcl.fr/mentions-legales) ont été revérifiées le 9 novembre : reproduction d’informations pour un usage non commercial et non publicitaire, avec attribution, date et intégrité du contenu. Les contrôles robots et mentions sont aussi exécutés par le fournisseur lors de la collecte. Aucun script, clé de widget, endpoint privé ou contenu photo n’est utilisé.

L’API Grand Lyon protégée n’a pas été réessayée sur un autre hôte ou format ; son accès légitime reste une piste ultérieure. La date de publication des annonces demeure inconnue si la source ne la donne pas ; la date de récupération n’est jamais présentée comme cette date de publication.

Extraits HTML de tests : `tests/fixtures/traffic/tcl-{c16,t3,d,index}-2026-11-09.html`, issus des pages autorisées conservées lors de la référence avant modification. Fiches complètes limitées au bloc éditorial, index limité aux liens utiles dans une enveloppe de test. Sources : [Infos trafic](https://www.tcl.fr/infos-trafic) et fiches officielles `/se-deplacer/infos-trafic-accessibilite/trafic/line:SYTNEX:{C16,T3,D}` liées dans l’index, avec leur requête de date originale dans les preuves locales. Ces extraits ne sont jamais chargés dans l’application ni importés dans le GTFS.

## 7. Mesures avant/après

| Mesure | Avant | Après |
|---|---:|---:|
| Fiches individuelles réussies | 3 | 5 |
| Annonces reçues dans le même audit daté | 10 | 13 |
| Appels du cycle froid observé | 6 | 8 |
| Temps du fournisseur à froid | **7,22 s** | **40,80 s** |
| Lectures directes du cache, médiane de 5 | 0,009 ms | 0,015 ms |

**Aucun gain à froid n’est démontré.** Le périmètre a augmenté et la latence du site a varié. Un seul cycle froid réel par version a été utilisé pour ne pas multiplier les requêtes ; ces valeurs ne sont pas des percentiles ni une comparaison à charge égale. Le délai plus tolérant vise à récupérer les fiches lentes tout en conservant les autres succès et le plafond global, au prix d’une attente potentiellement plus longue.

La collecte élargie a passé environ 29,6 secondes avant le premier appel de fiche (politiques et index), d’après ses horodatages, puis environ 11,2 secondes sur les cinq fiches. Ce constat ne permet pas d’isoler chaque requête préalable sans mesure supplémentaire. La persistance de la vérification des politiques évite deux requêtes redondantes lors des cycles suivants dans les 24 h, vérifié sur fixtures, sans promettre une latence réseau future.

Sept requêtes HTTP avec cache dans la série complète : **9,67–14,99 ms**, médiane **11,35 ms**, aucun nouvel appel TCL pour ces consultations. La série Edge finale réutilise le cache officiel daté et confirme également zéro appel supplémentaire sur son processus. La vérification Trafic reste asynchrone et ne bloque pas l’affichage des itinéraires GTFS.

## 8. Validation

- **199 tests automatisés réussis**, dont **23 Trafic**.
- Succès avec/sans annonce, absence de lien, échecs par fiche, erreur d’index, péremption individuelle, dates conservées, extension/rotation à deux fiches maximum, mode inconnu non consulté, contrôle des politiques entre redémarrages.
- Extraits HTML réels autorisés : détection des sélecteurs, comparaison du nombre d’annonces, récurrences nocturnes T3, fréquence et directions littérales, sans faux identifiant GTFS.
- Calendriers, dates impossibles, changements d’heure, heures ambiguës/inexistantes, segments/directions, correspondances exactes/partielles et homonymes restent testés.
- **98 contrôles API/navigateur** : Trafic 9, moteur à deux correspondances 12, itinéraires/Favoris 27, Horaires 32, mobilité IGN 18. Les succès utilisent les données officielles ; seuls les états de panne et de péremption du test sont contrôlés artificiellement.
- **Linter sans avertissement et compilation réussie.** Aucune modification de V0.1, aucun déploiement.

Rapports : `.data/traffic-reliability-before-1794244013582/`, série complète `.data/traffic-validation-1794244585261/`, série finale ciblée `.data/traffic-validation-1794244902738/`. La dernière série comprend les 807 lignes du catalogue ; les quatre suites déjà réussies n’y sont pas répétées. La cohérence cartes/index supplémentaire est contrôlée par les extraits et le test de structure. [Preuves consolidées](evidence/traffic-reliability-2026-11-09.json).

## 9. Fichiers et limites

Modifiés : `server/traffic/{provider,html,time,api,matching,localCache}.ts`, `src/types/traffic.ts`, `src/components/Traffic.tsx`, `src/App.css`, `tests/traffic.test.mjs`, `scripts/qa/validate-traffic.mjs`, README et rapports Trafic.

Créés : `src/services/trafficCoverage.ts`, les quatre extraits HTML, scripts QA de référence/extraction, ce rapport et ses preuves. Aucune dépendance supplémentaire.

Limites : couverture courante très partielle (5/807), pas de lien individuel pour quatre prioritaires, pas de dictionnaire officiel d’identifiants communs, pas de correspondance automatique de quais, récurrences reconnues seulement pour une syntaxe précise, source HTML et publication non horodatée. Le cache/limiteur demeure par processus ; la coordination multi-instance et la certification Cloudflare Free restent à faire avant un éventuel déploiement. Aucun de ces points n’est présenté comme terminé.
