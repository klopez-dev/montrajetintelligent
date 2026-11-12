# Optimisation du prototype hybride — V0.1

Mission du **10 novembre 2026**. Le moteur de l'application active, sa configuration et sa base ne sont pas remplacés. Aucun téléchargement GTFS, appel IGN réel supplémentaire, compte, service payant ou déploiement n'est nécessaire à cette expérimentation.

## Audit et périmètre

L'ancien format chargeait dès l'initialisation les 140 442 courses du GTFS, soit un catalogue JSON décompressé de 14 854 229 octets. Les partitions journalières utilisaient ces indices globaux : chaque partition allouait deux index de 140 442 entiers même si peu de courses circulaient ce jour-là. La décompression copiait le contenu compressé, le plaçait dans un Blob, conservait les morceaux décompressés puis les recopiait dans une sortie finale. La quatrième journée était refusée au lieu de remplacer une entrée ancienne.

Le calcul demeure celui de `server/journeys/network.ts`, non modifié. L'adaptateur expérimental émule uniquement les requêtes connues de ce moteur et de la mobilité. Il refuse une requête inconnue, sans demander silencieusement son résultat à SQLite. La limite existante de deux correspondances, les calendriers, les interdictions de montée/descente, les règles orientées et les limites de recherche sont conservés.

Le graphe, les libellés, les arrêts/quais exacts, les appartenances aux lignes et les transferts restent globaux. Une partition géographique a été écartée à cette étape : couper des courses ou des correspondances à une frontière sans preuve de fermeture peut modifier les résultats.

## Changements réalisés

1. **Format expérimental 2** : catalogue sans les courses globales ; index des seules courses actives associé à chaque journée. Les indices numériques des événements sont remappés en conservant l'ordre des identifiants SQLite. Aucun identifiant public n'est remplacé par un nom.
2. **Décompression bornée** : destination préallouée à la taille annoncée, écriture progressive, arrêt si la taille dépasse la limite. Suppression du Blob, de la copie compressée initiale et de la liste de morceaux décompressés. La réception HTTP conserve encore des morceaux compressés avant assemblage ; ce n'est donc pas une chaîne totalement sans copie.
3. **Index compacts** : TypedArrays existantes conservées ; les index début/fin sont dimensionnés aux courses de la journée. Les informations textuelles des courses sont chargées à la demande.
4. **LRU de trois journées** : accès récent réordonné, éviction de la plus ancienne, promesse partagée pour deux demandes identiques. Les partitions évincées ne sont plus conservées par le cache ; leur collecte mémoire dépend du navigateur.
5. **Runtime borné** : un calcul à la fois, refus explicite d'une recherche concurrente, cache de résultats du moteur existant limité à 24 entrées/60 secondes. Aucune anticipation réseau à chaque frappe.
6. **Version de données** : SHA-256 du manifeste complet, distinct de la version publique V0.1. Chaque recherche revalide le petit manifeste ; un changement libère le planificateur, les résultats et les partitions précédents. Une heure différente réutilise les partitions déjà résidentes.
7. **Libération** : remise à zéro des références du runtime et terminaison du Worker à l'annulation. La terminaison constitue aussi la frontière d'annulation d'un calcul JavaScript synchrone ; un simple AbortSignal ne suffirait pas pendant une boucle bloquante.
8. **Erreurs** : contrôle HTTP, taille de réponse reçue, schéma, dates, métadonnées, empreintes, taille d'expansion, ordre et références des événements. Une journée absente produit une erreur, jamais une journée sans service supposée.

Les téléchargements de jours adjacents suivent exactement `serviceDays`, y compris les secondes GTFS après 24 heures. Une recherche ne se contente pas de la date civile affichée. Le catalogue et les fichiers binaires restent dans le Worker ; seuls résultats et diagnostics reviennent au thread principal.

## Volumes réels

Package : `.data/hybrid-v2-1794331885744`, cinq journées du 8 au 12 novembre 2026. Ce n'est pas toute la période de validité du GTFS.

| Données | Ancien format | Format 2 |
|---|---:|---:|
| Catalogue compressé | 1 090 076 o | 502 394 o |
| Catalogue décompressé | 14 854 229 o | 3 996 005 o |
| Recherche simple, données compressées | 3 923 070 o | 3 449 979 o |
| Recherche simple, données décompressées | 27 851 325 o | 18 667 996 o |
| Scénario traversant minuit, cumul compressé | 6 766 815 o | 6 408 487 o |

La recherche simple charge le catalogue, l'index des courses et les événements du 9 novembre : environ **12,1 % de transfert en moins**, et **33 % de contenu décompressé en moins**. Les chiffres excluent manifeste, code et en-têtes HTTP. Ils ne sont pas une mesure de mémoire de processus.

Le build statique du laboratoire produit un Worker de 25,64 ko, un script principal de 3,72 ko et un HTML de 1,34 ko, avant compression HTTP. Il ne contient ni SQLite ni les dépendances Node de compilation. Le build React/MapLibre actif reste séparé.

## Mémoire : mesures et limites

Machine : Windows x64, Ryzen 7 3700X, 16 processeurs logiques, environ 31,93 Gio de RAM ; Node 24.19.0. Edge 157.0.4341.42. Les tests sont headless et locaux, sans téléphone physique.

Les mesures CDP distinguent `usedSize` du tas JavaScript, `backingStorageSize` et le thread principal. Elles ne fournissent pas la RSS du Worker, ni un pic exhaustif des buffers natifs du décompresseur. L'échantillonnage vise 20 ms mais peut être retardé. Les maxima des colonnes ne surviennent pas nécessairement simultanément : **ne pas les additionner comme un pic physique**.

Sur la campagne finale :

| Indicateur échantillonné | Médiane | Maximum observé |
|---|---:|---:|
| Tas utilisé du Worker | 25,87 Mo | 53,80 Mo |
| Backing storage du Worker | 15,32 Mo | 83,91 Mo |
| Tas utilisé du thread principal | 1,43 Mo | 1,80 Mo |
| Backing storage principal | 0,24 Mo | 0,24 Mo |

446 échantillons/points de fin ont été conservés. Parmi eux, 24 correspondent temporellement à une phase de décompression instrumentée : maximum observé de 27,40 Mo de tas Worker et 81,69 Mo de backing storage. C'est une observation pendant ces phases, **pas une preuve du pic de décompression**.

Après les recherches successives : 37,29 Mo de tas et 74,24 Mo de backing storage du Worker. La libération logique ne diminue pas immédiatement ces compteurs. Après un GC forcé de diagnostic : 0,76 Mo de tas et 0,175 Mo de backing storage. Le thread principal passe à environ 0,80 Mo de tas. Le programme de production ne force pas ce GC. Aucun maintien manifeste des partitions après libération n'est observé dans cette campagne ; cela ne prouve pas l'absence de fuite pendant une journée entière.

La borne de trois entrées n'est pas une garantie de RSS : objets de calcul, réponses transitoires, caches moteur et données évincées non encore collectées s'y ajoutent. Les réponses/catalogues décompressés sont limités à 32 000 000 octets par asset ; une mémoire physique insuffisante n'a pas été provoquée volontairement. Aucun point mémoire n'est isolé exactement à la fin du seul catalogue : les observations disponibles sont les échantillons pendant le chargement, les points après chaque calcul et les points après libération.

### Avant/après en processus Node isolés

Ces mesures sont distinctes du navigateur. Une nouvelle campagne avant modification puis après optimisation utilise le même outil, un processus neuf par cas. Les durées sont des observations uniques à froid ; plusieurs outils tournaient sur le poste, donc aucune garantie statistique n'en est déduite.

| Cas statique | Avant : tas / externe / RSS maximale | Après : tas / externe / RSS maximale |
|---|---|---|
| Direct | 71,94 / 47,60 Mo / 236,95 Mio | 62,40 / 29,01 Mo / 164,45 Mio |
| Une correspondance | 96,43 / 48,45 Mo / 249,93 Mio | 77,68 / 29,12 Mo / 204,21 Mio |
| Deux correspondances | 88,55 / 60,04 Mo / 225,01 Mio | 44,70 / 40,56 Mo / 151,95 Mio |

Le tas est un point après calcul ; la RSS maximale est celle du processus entier. Les chiffres démontrent un gain sur ces cas, sans transformer Node en mesure d'un téléphone ou d'un Worker Cloudflare.

## Renouvellement et distribution statique

`compile-v2.mjs` ne lit que la base locale en lecture seule et crée un nouveau répertoire. Le manifeste lie schéma, SHA source et empreintes de tous les assets ; `version.json` fournit son empreinte et les dates de validité. Le runtime calcule lui-même l'identifiant du manifeste reçu et contrôle les données demandées. Les calendriers/exceptions sont précompilés au moment de la génération, sans règle scolaire ou fériée inventée dans le navigateur.

`version-store.mjs` constitue un **exercice local** : validation de toutes les partitions, snapshots nommés par SHA du manifeste, verrou exclusif, copie sans écrasement puis remplacement d'un seul pointeur par renommage. La version précédente reste disponible. Un basculement du package format 2 vers l'ancien package, puis un rollback vers le format 2, ont réellement été exécutés dans `.data/hybrid-publication`, indépendamment de la base active. Les tests vérifient aussi le refus d'un rollback corrompu et d'une précondition de version obsolète.

Ce mécanisme ne déploie rien et n'est pas encore le processus atomique d'un hébergeur. Pour une publication future : conserver les snapshots dans des URL de version immuables, rendre le pointeur revalidable et basculer un ensemble cohérent de fichiers. Le laboratoire utilise actuellement des chemins stables avec `no-store`/revalidation et contrôle les SHA ; une mise à jour pendant une recherche peut échouer proprement, sans mélanger silencieusement des données.

Les limites actuelles de [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/limits/) autorisent 20 000 assets en Free et 25 MiB par fichier. Le package local est sous ces seuils. Les [requêtes d'assets statiques](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) sont annoncées gratuites ; ne pas les faire passer systématiquement dans un Worker serveur. Documentation vérifiée le 10 novembre 2026. Le Web Worker navigateur ne consomme pas les 10 ms CPU d'une invocation Workers Free. Aucun compte ou déploiement n'a été utilisé pour vérifier une configuration réelle.

Pas de cache persistant IndexedDB/Service Worker : la fermeture/recharge de page retélécharge les données. Le cache borné améliore les recherches de la session ; sur un réseau lent, 3,45 Mo restent coûteux. La marche IGN, les secrets éventuels et la collecte Trafic ne sont pas transformés en services statiques par cette mission.

## Fichiers et reproduction

Modifiés : `experiments/hybrid/model.ts`, `database.ts`, `load.ts`, `browser-worker.ts`, `browser.ts`, `scripts/prototype/serve.mjs`, `mobility-compare.mjs`, `README.md`.

Créés :

- `experiments/hybrid/runtime.ts` : cycle de vie, chargement, version et diagnostics.
- `scripts/prototype/compile-v2.mjs`, `version-store.mjs` : génération et exercice de renouvellement local.
- `scripts/prototype/static-build.mjs`, `static-server.mjs` : build et serveur de fichiers de test, sans API.
- `scripts/prototype/browser-memory.mjs`, `repeated-resources.mjs` : benchmarks reproductibles.
- `scripts/prototype/static-test.mjs`, `firefox-test.mjs`, `fallback-test.mjs` : validations navigateur et erreurs.
- `scripts/prototype/summarize.mjs`, `tests/hybrid-loading.test.mjs`, trois rapports et preuves dans `docs/evidence`.

Depuis `montrajet-lyon` :

```powershell
node scripts/prototype/compile-v2.mjs
# La commande affiche un NOUVEAU répertoire ; celui mesuré ici est :
node scripts/prototype/serve.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/browser-memory.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/repeated-resources.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/compare.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/mobility-compare.mjs .data/hybrid-v2-1794331885744 .data/hybrid-mobility-1794262559540/official-replay.json
node scripts/prototype/static-build.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/static-test.mjs .data/hybrid-dist-1794333192964
node scripts/prototype/firefox-test.mjs .data/hybrid-dist-1794333192964
node scripts/prototype/fallback-test.mjs .data/hybrid-v2-1794331885744
node scripts/prototype/summarize.mjs
```

Les scripts de benchmark créent des dossiers neufs ; le fichier d'entrées de la synthèse désigne les observations de cette mission. Les mesures détaillées et empreintes sont dans [la preuve JSON](evidence/hybrid-2026-11-10.json). Les droits de redistribution GTFS restent ceux du [rapport source](SOURCE-GTFS-DURABLE.md), sans nouvel accès à l'archive protégée.
