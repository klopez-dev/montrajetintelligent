# Couverture GTFS du moteur hybride — V0.1

Validation locale du **10 novembre 2026**. Aucun remplacement de la base active, téléchargement GTFS, déploiement ou service payant.

## Origine et méthode

Le compilateur utilise la base SQLite importée de l'archive locale `GTFS_TCL.ZIP`. Avant compilation, le SHA-256 du ZIP est recalculé et comparé à `metadata.sha256` de la base ouverte **en lecture seule**. Il n'effectue pas un nouvel import, n'altère pas les calendriers et ne télécharge rien. L'archive source correspond à celle déjà validée ; cela ne constitue pas une nouvelle vérification de sa publication distante.

La période complète est **du 8 novembre 2026 au 8 mars 2027 inclus**, soit **121 journées**, contre cinq auparavant. Chaque journée du domaine de validité a une entrée, y compris lorsqu'aucune course d'une ligne recherchée ne circule. Les exceptions ajoutant ou supprimant un service priment sur le calendrier hebdomadaire.

Les jeux de services actifs sont regroupés par liste exacte d'identifiants. Deux journées ne partagent une partition que si les données de courses, leurs identifiants, arrêts, séquences et heures sont identiques. Les assets sont nommés par leur SHA-256 compressé ; un contenu différent produit une autre URL. L'origine temporelle reste calculée pour chaque date par le moteur existant : partager des événements ne transforme pas deux journées en une même date de service.

L'index des courses reste journalier, le catalogue initial n'embarque pas toutes les courses. Aucun découpage géographique n'est introduit susceptible de couper un itinéraire ou une correspondance.

## Résultats de génération

Sortie : `.data/hybrid-full-1794333824540`. Durée observée : **268 762 ms**, environ 4 min 29 s sur le poste local. Cette durée de génération Node n'est pas un temps de recherche navigateur.

| Mesure | Valeur |
|---|---:|
| Journées compilées | 121 |
| Profils exacts de services | 92 |
| Assets compressés uniques, catalogue compris | 185 |
| Volume compressé des assets uniques | 190 077 427 octets |
| Volume sans déduplication, catalogue compris | 230 146 980 octets |
| Économie de stockage | 40 069 553 octets, environ 17,4 % |
| Catalogue compressé / décompressé | 502 394 / 3 996 005 octets |
| Manifeste | 65 115 octets |
| Pointeur de version | 227 octets |
| Taille moyenne des assets d'une journée, hors catalogue | 1 897 889 octets |
| Taille médiane / p95 / maximale d'une journée | 2 331 729 / 3 097 878 / 3 103 452 octets |
| Taille minimale d'une journée | 33 307 octets |

Les tailles par journée additionnent événements et index des courses ; elles ne sont ni le volume systématiquement téléchargé, ni la mémoire du Worker. La taille minimale très faible en fin de période provient des calendriers source, pas d'une réduction arbitraire de l'exploration.

Le build statique contient **197 fichiers pour 190 225 499 octets**, dont les deux pages du laboratoire. Le Worker regroupant moteur réseau, moteur historique et mobilité représente environ **50,73 ko** avant compression HTTP. Aucun fichier du build n'est une base SQLite ou l'archive GTFS complète.

## Contrôles de couverture

Les **121 dates** ont été vérifiées contre une requête SQLite indépendante utilisant les calendriers et exceptions, avec le jour de semaine calculé dans SQLite. Pour chacune : présence du manifeste, nombre d'événements source identique, décompression, références et ordre des événements validés. Les partitions nécessaires sont effectivement décodées lors du contrôle, pas simplement listées.

Les recherches échantillonnées incluent les 8, 9 et 11 novembre, le 25 décembre, le 1er janvier, le 15 février et le 8 mars, pour les trois familles de trajets de référence et les deux moteurs historiques/réseau. Les résultats en fin de période peuvent être `no_journey` : la validité globale du flux ne signifie pas que chaque ligne possède des courses chaque jour. Aucune course n'est prolongée au-delà de son calendrier.

Les secondes après 24 h restent inchangées. Le moteur sélectionne aussi les jours adjacents dont les courses peuvent intersecter la fenêtre demandée. **Aucun changement d'heure Europe/Paris n'a lieu pendant cette période de validité** ; les tests déterministes existants et nouveaux utilisent des fixtures identifiées comme telles pour les changements d'heure, sans prétendre observer des courses TCL de ce flux à ces dates hors validité.

## Chargement et cache

- Première recherche simple : manifeste, catalogue, index des courses et événements de la journée — **quatre requêtes GTFS**, **3 515 094 octets** de corps compressés/JSON lus, hors code et en-têtes.
- Recherche suivante, même version et données résidentes : contrôle du seul `version.json`, **une requête de 227 octets** ; les courses et événements restent dans le Worker. Une heure différente a été testée avec ce même résultat de réutilisation.
- Traversée de minuit : chargement des journées adjacentes réellement demandées par `serviceDays`, pas d'anticipation de toute la période.
- Cache LRU de trois dates, partageant aussi la même promesse et le même paquet si leurs empreintes événement/courses sont identiques. Une erreur invalide toutes les références au paquet échoué ; un nouvel essai peut réussir.
- Le pointeur valide son schéma et l'empreinte du manifeste. Un changement impose une nouvelle lecture, un manifeste correspondant puis une reconstruction du planificateur et des caches. Un pointeur incohérent n'autorise pas à utiliser des résultats anciens comme actuels.
- Les anciens packages sans pointeur restent compatibles via HTTP 404 explicite et revalidation du manifeste complet. Un HTTP 503 du pointeur est une erreur, pas un succès silencieux.
- Les dates changées rapidement annulent l'ancien Worker ; sa réponse tardive ne peut pas remplacer la nouvelle. L'éviction peut imposer de retélécharger une date plus ancienne : c'est le compromis du cache borné.

Le journal du test de dates conserve les octets et requêtes cumulés : passage par cinq dates, trois entrées résidentes au maximum, puis ajout de **227 octets seulement** lors du dernier changement d'heure. Les compteurs sont ceux des réponses lues par le client, pas une mesure de trafic Internet incluant TLS/en-têtes. Les appels au relais IGN sont comptés séparément.

Il n'existe pas encore de cache persistant applicatif : changer de page ou recharger détruit le Worker. Le téléchargement complet de 190 Mo n'est jamais déclenché pour une recherche ordinaire.

## Hébergement statique gratuit : portée de la vérification

Les limites [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/platform/limits/) revérifiées le 10 novembre sont de **20 000 fichiers** en Free et **25 MiB par fichier**. Le build local est en dessous de ces seuils. Les [requêtes statiques sont annoncées gratuites](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/), à distinguer des requêtes exécutant du code serveur. Aucun compte ou déploiement n'a servi à vérifier une configuration distante.

Le build calcule entre arrêts avec un simple serveur de fichiers. Les parcours porte-à-porte nécessitent encore le **relais du fournisseur IGN existant**, ici local, pour respecter sa file et son cache ; ils ne deviennent pas entièrement autonomes du backend par la seule présence d'assets statiques. Le Worker n'appelle pas directement IGN.

Les noms par empreinte préparent des assets immuables, mais la politique effective du laboratoire conserve la revalidation et `fetch(..., cache:'no-store')`. Aucun bénéfice de cache HTTP persistant n'est revendiqué. Une publication future devra épingler les URLs d'une version, basculer le pointeur de manière cohérente et conserver un rollback vérifié. Les contrôles locaux de version existants et leurs tests restent disponibles ; aucune publication réelle n'est effectuée.

La licence et le renouvellement authentifié restent les conditions du [rapport source GTFS](SOURCE-GTFS-DURABLE.md). Une compatibilité de volume ne vaut pas autorisation de redistribution.

## Reproduction

```powershell
node scripts/prototype/compile-full.mjs
# Le compilateur crée un nouveau dossier ; celui validé ici est :
node scripts/prototype/validate-full.mjs .data/hybrid-full-1794333824540
node scripts/prototype/static-build.mjs .data/hybrid-full-1794333824540
```

Le build crée lui aussi un nouveau dossier. Celui mesuré : `.data/hybrid-dist-1794334796287`. Toutes les preuves sont référencées dans [la synthèse JSON](evidence/hybrid-complete-2026-11-10.json).
