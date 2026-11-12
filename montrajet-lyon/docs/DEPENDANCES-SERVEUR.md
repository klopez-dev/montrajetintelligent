# Dépendances serveur — préproduction V0.1

Audit du **10 novembre 2026**. L'application active conserve son backend. Le build séparé de préproduction ne l'utilise pas : il doit seulement recevoir ses fichiers par HTTP/HTTPS.

| Fonction | Application active | Préproduction | Dépendance restante |
|---|---|---|---|
| Frontend React/Vite | Vite local ou build | Mêmes composants compilés | Hébergement statique |
| Recherche lignes/quais | API SQLite | Catalogue statique dans le Worker | Assets GTFS |
| Horaires | API SQLite | Calendriers/partitions et fonction temporelle existante | Assets GTFS, bonne date utilisateur |
| Itinéraires, une/deux correspondances | Node/SQLite | Moteurs existants dans le Worker | Puissance/mémoire du navigateur |
| Adresses et marche | Fournisseur IGN serveur | Même fournisseur dans le Worker, appels directs | API IGN, CORS et quotas par IP |
| Favoris | localStorage | Même modèle et stockage | Stockage local du navigateur |
| Carte | MapLibre + API de coordonnées | MapLibre + partitions/annexe statique | WebGL ; IGN pour les marches |
| Fond de carte | OSM configurable | Désactivé au build validé | Aucun fournisseur de tuiles requis pour cet essai |
| Trafic TCL | Collecteur partiel et cache serveur | Non connecté, état indéterminé explicite | Une future méthode autorisée de mise à jour |
| Temps réel Grand Lyon | Préparé, authentification requise | Désactivé | Accès technique autorisé, jamais un secret frontend |
| Renouvellement GTFS | Import hors ligne | Compilation hors ligne avant nouvelle publication | Source et droits officiels, demande Grand Lyon en cours |

Le serveur QA `serve-preproduction.mjs` ne contient ni SQLite, ni moteur de calcul, ni proxy IGN ou TCL. Les `/api/` générés par les composants sont interceptés dans le bundle de préproduction : les journaux du serveur de fichiers confirment qu'ils ne l'atteignent pas. Cela n'est pas un backend dissimulé. Un serveur HTTP générique peut distribuer le même répertoire ; aucun processus Node métier permanent n'est exigé.

## IGN : accès direct vérifié, pas un fournisseur nouveau

Les services restent :

- géocodage `https://data.geopf.fr/geocodage/search` ;
- marche `https://data.geopf.fr/navigation/itineraire`, ressource `bdtopo-osrm`, profil `pedestrian`.

La [documentation officielle du géocodage](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/geocodage/) fixe **50 requêtes/s/IP**. La [documentation du calcul d'itinéraire](https://cartes.gouv.fr/aide/fr/guides-utilisateur/utiliser-les-services-de-la-geoplateforme/calcul-itineraire/) fixe **5 requêtes/s/IP**. Le [cadre d'utilisation IGN](https://cartes.gouv.fr/cgu/?lang=fr) prévoit la gratuité des géoservices sauf licence spécifique et impose le respect des conditions des données/services. Vérification du 10 novembre 2026 ; ce n'est pas un avis juridique ou une garantie de disponibilité future.

Les sondes depuis Edge/Firefox ont accès au JSON en mode CORS avec HTTP 200, sans clé ni cookie d'authentification. Un calcul complet depuis le Worker a utilisé des chemins frais fournis par IGN, contrôlés comme auparavant : profil, ressource, géométrie, unités, durée et distance, raccordement maximal de 25 m. Aucun trajet à vol d'oiseau ne remplace une réponse refusée.

La file existante limite à deux demandes concurrentes et espace les départs de 260 ms ; les caches restent ceux du fournisseur, cinq minutes pour les adresses et une heure pour la marche. Les suggestions React conservent leur temporisation. Les échecs, `Retry-After` et annulations sont traités par ce code réutilisé. Cette file est **par Worker**, pas un coordinateur de toutes les personnes derrière une même IP : plusieurs onglets ou utilisateurs peuvent dépasser le quota partagé. Aucun contournement par changement d'IP ou de fournisseur n'est prévu.

Un relais IGN n'est donc pas nécessaire au périmètre observé. S'il devient nécessaire à cause de CORS, d'une authentification ou de quotas, il devra être évalué séparément : une fonction gratuite n'efface ni les restrictions fournisseur ni son propre quota. Aucun relais nouveau non testé n'est présenté ici comme opérationnel.

Les adresses et coordonnées demandées sont envoyées à IGN ; un bandeau et le texte existant le signalent. Les favoris restent sur l'origine du site dans localStorage, sans synchronisation ni télémétrie ajoutée. Leurs données ne sont pas incorporées au build.

## Trafic : options sans serveur permanent

| Option | Avantage | Limite / décision |
|---|---|---|
| Snapshot précompilé d'annonces officielles | Lecture statique sans collecteur permanent | Périme vite ; garder `fetchedAt`, `validUntil`, couverture et erreurs d'origine. Aucune ancienne annonce publiée dans ce build |
| Actualisation périodique hors ligne | Un ordinateur ou job autorisé peut régénérer le snapshot | Nécessite fréquence/conditions de collecte revérifiées, publication et surveillance des échecs ; non automatisé ici |
| Relais léger/cache | Peut mutualiser quelques consultations | Les pages TCL, leur structure et restrictions restent à respecter ; CPU, quotas et renouvellement du cache non qualifiés sur une offre gratuite |
| Dégradé explicite | Fiable et sans collecte | Choix effectif : pas de trafic actuel déterminable ; lien officiel |

La mission ne déclenche **aucune collecte TCL**, massive ou ciblée. Le précompilateur ne recycle pas l'âge d'un ancien snapshot pour le faire passer pour neuf. Un état sans incident avec couverture non vérifiée n'est jamais une preuve de réseau normal. Les avertissements itinéraires indiquent que l'impact n'est pas déterminable.

Pour retrouver les annonces dans une future préproduction, il faudra décider d'une collecte autorisée et prouver la conservation de la fraîcheur/couverture, sans se contenter de lire une archive locale. Voir les audits précédents `SOURCES-TRAFIC.md` et `FIABILISATION-TRAFIC.md` ; leurs observations datées ne constituent pas une nouvelle autorisation permanente.

## Carte et tuiles

MapLibre est réutilisé, avec le fond distant explicitement désactivé dans ce build. La carte représente les arrêts exacts et les géométries de marche disponibles. Le GTFS ne contient pas de tracés de transport : aucun segment droit entre arrêts n'est présenté comme la voie suivie par le véhicule.

Le fournisseur optionnel existant est `https://tile.openstreetmap.org/{z}/{x}/{y}.png`. Sa [politique officielle](https://operations.osmfoundation.org/policies/tiles/) impose attribution, identification/Referer et cache respecté ; elle interdit préchargement massif et téléchargement pour usage hors ligne. Son service n'est pas une capacité illimitée ni un SLA gratuit. Les tests headless de cette mission n'ont pas parcouru ses tuiles : ils utilisent le fond désactivé pour éviter de forcer des téléchargements automatisés.

L'échec de fond de carte ne doit pas supprimer marqueurs, marches et texte. La validation du fond distant lui-même reste distincte ; la carte sans fond a réellement été testée dans Edge et Firefox.

## Sécurité et modes dégradés

Les messages du Worker vérifient dates ISO, modes, classements, marges, limites de correspondances, lieux explicites et coordonnées. Les entrées textuelles/cartographiques sont bornées. Les fichiers GTFS ont des contrôles d'empreinte, schéma et expansion ; l'annexe de consultation possède aussi une empreinte et une association au même flux. Un mélange de versions est refusé.

Le build fournit des en-têtes CSP, `nosniff`, Referrer-Policy et Permissions-Policy, réellement appliqués par le serveur QA. La CSP limite les scripts à l'origine et les connexions à l'origine, IGN et le fournisseur de tuiles optionnel ; `blob:` est admis pour les Workers MapLibre. Les styles inline restent permis pour les composants et marqueurs existants : cette exception n'est pas présentée comme une CSP maximale.

Les scripts/CSS hachés ont une politique immutable ; configuration/version et données sont revalidées. Le Worker utilise encore `cache:'no-store'` pour ses vérifications et ne possède pas de cache persistant PWA. Les données personnelles ne sont ni loguées par un serveur API ni stockées dans un snapshot public ; elles transitent toutefois vers IGN au moment des recherches, conformément à l'information donnée à l'utilisateur.

L'audit npm **des dépendances de production uniquement** retourne zéro vulnérabilité déclarée. Aucun paquet/version n'a été modifié. Ce résultat ne prouve pas l'absence de vulnérabilité inconnue ni l'audit de tous les outils de développement.

Les pannes réseau sont visibles. Quand Internet externe est bloqué mais les assets locaux accessibles, les trajets entre arrêts fonctionnent et les adresses échouent explicitement. Sans accès au serveur statique lui-même à froid, l'ouverture n'est pas garantie : aucun mode totalement hors ligne n'est revendiqué.
