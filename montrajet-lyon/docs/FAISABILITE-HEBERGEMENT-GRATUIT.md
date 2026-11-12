# Faisabilité d'un hébergement gratuit — préproduction V0.1

Examen documentaire et mesures locales du **10 novembre 2026**. **Aucun compte, abonnement, carte bancaire, domaine, stockage distant ou déploiement créé.** Aucun service payant n'est requis pour les essais locaux.

## Charge réellement à héberger

Le build statique mesuré contient **202 fichiers et 192 342 015 octets**, avec un asset maximal de **2 994 783 octets**. La base SQLite de 416,7 Mo et le ZIP GTFS ne sont pas distribués au navigateur. Les 121 journées sont présentes sur l'hébergement, mais la recherche ordinaire charge seulement les assets nécessaires.

La première recherche entre arrêts lit environ **3,58 Mo de fichiers après le déclenchement**, Worker compris, hors scripts d'ouverture, headers et TLS. La suivante, sur les mêmes données résidentes, ne lit que le pointeur de version de **227 octets**. Les accès supplémentaires à la carte chargent à la demande MapLibre et l'annexe GTFS de 571 ko. Fermer/recharger le Worker perd son cache mémoire.

Les mesures locales ne déterminent pas le coût d'un trafic mondial. Par exemple, 1 000 visites entièrement froides avec ce seul scénario représentent un ordre de grandeur de **3,58 Go**, hors application, carte et IGN. Ce calcul est une estimation de volume, pas une facture ni une prévision d'usage.

## Offres examinées

| Offre documentée | Limites pertinentes | Conclusion pour ce build |
|---|---|---|
| Cloudflare Workers Static Assets, Free | 20 000 fichiers/version, 25 MiB/fichier | 202 fichiers et 2,995 Mo maximum : tailles compatibles |
| Cloudflare Pages, Free | 20 000 fichiers, 25 MiB/asset, 500 builds/mois, un build simultané, délai de build de 20 min | Taille compatible ; préférer générer et valider le GTFS localement avant une éventuelle publication |
| Functions/Worker serveur éventuel | Budget gratuit de 100 000 requêtes/jour et 10 ms CPU/invocation ; autres limites à vérifier par produit | Aucun calcul GTFS n'y est exécuté ici ; ne pas réintroduire le moteur dans une fonction en supposant ces budgets suffisants |

Sources officielles : [limites Workers](https://developers.cloudflare.com/workers/platform/limits/), [limites Pages](https://developers.cloudflare.com/pages/platform/limits/), [tarification Workers](https://developers.cloudflare.com/workers/platform/pricing/).

La [documentation Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) annonce les requêtes statiques gratuites et illimitées et aucun coût additionnel de stockage des assets. Les requêtes qui invoquent du code serveur sont un autre cas ; une configuration `run_worker_first` peut consommer le quota serveur même pour des fichiers. Cette préproduction n'exige pas un tel passage systématique et ne souscrit aucun plan payant.

Il n'y a pas de raison, dans ces seuils documentés, d'imposer R2, D1, KV ou un gros fichier SQLite distant. Aucun de ces produits n'a été activé. Les limites de fichiers ne constituent toutefois pas une preuve de déploiement distant, de cache effectif ou d'absence de toute politique anti-abus.

Un sous-domaine fourni par une plateforme statique suffirait en principe ; aucun achat de domaine n'est nécessaire à l'architecture. Le parcours de création de compte sans carte n'a pas été exécuté : il ne faut pas confondre un plan Free documenté avec une inscription réellement vérifiée.

## Fournisseurs externes et coûts indirects

Les services publics IGN observés fonctionnent sans secret ni authentification depuis les navigateurs testés. Leur [cadre officiel](https://cartes.gouv.fr/cgu/?lang=fr) prévoit la gratuité des géoservices sauf conditions de licence spécifiques. Les limites de **50 géocodages/s/IP** et **5 itinéraires/s/IP** restent applicables ; aucun quota n'est acheté ni contourné. Dépasser un quota doit conduire à une erreur ou à l'attente prévue, pas à une bascule payante automatique.

Un éventuel relais TCL ou une actualisation périodique n'est **pas** budgété comme « gratuit et prêt » : il faudrait d'abord vérifier les droits de collecte, le CPU réel, les requêtes, la coordination des caches et la fréquence autorisée. Le choix actuel est un trafic non connecté. Les tuiles OSM sont désactivées ; leur capacité communautaire ne remplace pas une offre illimitée de cartographie.

Le renouvellement GTFS demeure soumis à l'accès officiel demandé à Grand Lyon et aux conditions de redistribution. La mission n'a téléchargé aucune archive protégée. La faisabilité d'un stockage public n'autorise pas à publier un jeu sans les droits requis ; consulter [SOURCE-GTFS-DURABLE.md](SOURCE-GTFS-DURABLE.md).

## Sécurité financière et décision

Le prototype n'a créé aucun mécanisme de paiement, dépassement facturable, clé cloud ou tâche distante. Sa consommation est celle des fichiers locaux, des appels publics IGN testés et du navigateur. Les CGU et limites peuvent évoluer : les références ci-dessus devront être revérifiées avant une publication autorisée.

**PRÉPRODUCTION STATIQUE PARTIELLEMENT VALIDÉE.** Le calcul GTFS, les horaires, favoris et cartes du périmètre testé fonctionnent sans backend métier permanent. L'accès IGN direct fonctionne réellement. Restent non validés : trafic actualisé, renouvellement authentifié/redistribution, hébergement distant, smartphone physique, autonomie hors ligne complète et tenue en charge multi-utilisateurs partageant une IP.

Plan recommandé : conserver l'application active ; tester la préproduction sur téléphone ; qualifier une publication cohérente/rollback et les droits GTFS ; décider séparément d'une méthode de trafic autorisée ; seulement ensuite proposer une migration progressive explicitement approuvée. Aucun de ces jalons n'est activé automatiquement.

Les volumes, preuves CORS, métriques et empreintes sont dans [la synthèse vérifiable](evidence/preproduction-statique-2026-11-10.json). Le [rapport de préproduction](PREPRODUCTION-STATIQUE.md) décrit les fichiers et commandes ; le [rapport de dépendances](DEPENDANCES-SERVEUR.md) distingue ce qui reste externe.
