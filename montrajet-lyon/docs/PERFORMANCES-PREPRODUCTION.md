# Performances de la préproduction statique — V0.1

Mesures locales du **10 novembre 2026**. Les chiffres décrivent les scénarios exécutés, pas un engagement de latence sur smartphone ou sur un futur hébergement public. Les [preuves et empreintes](evidence/preproduction-step1-controle-final-2026-11-10.json) permettent de retrouver les rapports complets.

## Protocole et comparabilité

Edge headless, HTTP local sur port libre, pas d’API métier. Trajet de référence GTFS : quais 35660 → 35668, le 9 novembre 2026 à 11:00 Europe/Paris, deux correspondances maximum. Cinq nouvelles pages/Workers avec cache HTTP navigateur vidé, suivies chacune d’une recherche chaude identique. Le cache disque du système et les caches internes du fournisseur ne sont pas contrôlés.

La référence avant durcissement de version est `.data/preproduction-bench-1794343671348/report.json`. Après : `.data/preproduction-bench-1794344049143/report.json`. Les mesures finales portent sur `1794343892737` ; les JS/CSS sont identiques par SHA-256 à ceux du build final `1794344387115`, qui corrige uniquement le lien favicon dans le HTML. Les temps UI et carte sont, eux, repris sur ce dernier build dans Edge et Firefox.

Le p95 utilise le rang supérieur dans les valeurs triées. Avec cinq répétitions, il correspond au maximum et reste peu représentatif d’un percentile de population. Avec trois répétitions, fournir le maximum est plus honnête qu’une promesse de p95 stable. Le cas CPU n’a qu’une observation.

## Avant / après : recherche entre arrêts, sans IGN

| Scénario | n | Médiane avant | Médiane après | p95 avant / après |
|---|---:|---:|---:|---:|
| Ouverture de l’interface, froid | 5 | 66,6 ms | 65,4 ms | 97,0 / 95,8 ms |
| Recherche complète, froid | 5 | 247,7 ms | 237,3 ms | 299,5 / 304,7 ms |
| Recherche identique, cache chaud | 5 | 4,64 ms | 7,10 ms | 4,81 / 9,09 ms |
| Données bridées à 375 000 octets/s, délai 100 ms/réponse | 3 | 10 337 ms | 10 535 ms | maxima 10 344 / 10 541 ms |
| Page ralentie CPU ×4, recherche froide | 1 | 281,9 ms | 289,3 ms | Non interprétable statistiquement |

Ce n’est **pas une optimisation de vitesse revendiquée**. Les variations froides sont modestes et bruitées. La validation stricte ajoute une lecture du pointeur de version : à chaud, deux requêtes de 227 octets au lieu d’une, soit **454 octets** et quelques millisecondes supplémentaires. Sur le profil lent, le coût est visible. La correction de fiabilité est volontairement conservée.

Le profil lent ralentit les réponses de données statiques, pas l’ensemble de l’application ou IGN. Le ralentissement DevTools CPU ×4 porte sur la page ; le CPU du Worker **n’est pas garanti ralenti**. Ce test ne constitue donc pas une émulation complète d’un téléphone peu puissant.

## Phases instrumentées à froid

Cinq observations, même trajet entre arrêts :

| Mesure | Médiane | p95 observé | Définition |
|---|---:|---:|---|
| Démarrage Worker → premier message | 8,7 ms | 10,4 ms | Depuis le constructeur jusqu’au premier diagnostic d’opération ; pas jusqu’au chargement complet du GTFS |
| Catalogue complet | 25,7 ms | 31,2 ms | Lecture + empreinte/décompression + JSON et validation |
| Lecture catalogue seule | 3,0 ms | 3,6 ms | Corps HTTP lu localement |
| Décodage catalogue | 4,7 ms | 5,7 ms | SHA-256 et gzip |
| Lecture partition événements | 7,8 ms | 10,0 ms | Corps HTTP lu |
| Décodage événements | 20,8 ms | 21,5 ms | Empreinte et gzip |
| Lecture index de courses | 3,1 ms | 3,3 ms | Corps HTTP lu |
| Décodage index de courses | 1,6 ms | 1,6 ms | Empreinte et gzip |
| Construction des index | 8,2 ms | 8,7 ms | Index de la journée |
| Opérations adaptateur, champ historique `sqlMs` | 56,5 ms | 56,7 ms | Index/tableaux et chargements nécessaires, **aucun appel SQLite** |
| Calcul de transport, `routingMs` | 134,7 ms | 153,8 ms | Recherche du moteur, hors appels IGN |

Ces phases peuvent être incluses dans d’autres mesures ou se chevaucher : **ne pas additionner toutes les lignes** pour recomposer une durée totale. L’instrumentation reste expérimentale, bornée et sans paramètres personnels.

## Adresses et IGN

Trajet : **135 Avenue Lacassagne, Lyon → 10 Rue Olympe de Gouges, Villeurbanne**, départ fixé au 10 novembre à 08:00 locales. Trois nouvelles pages/Workers, cache HTTP navigateur explicitement vidé avant chaque répétition froide ; une répétition chaude immédiatement après chaque calcul. Les caches serveurs IGN/CDN ne sont ni vidés ni contournés. Données officielles en direct ou cache navigateur autorisé lors du passage chaud, **aucun rejeu positif du fournisseur**.

Résultats définitifs : `.data/step1-address-bench-1794344726233/report.json`.

| Phase/scénario | n | Médiane | Minimum / maximum |
|---|---:|---:|---:|
| Adresse → adresse, froid complet navigateur | 3 | **15 739,6 ms** | 13 890,5 / 21 028,6 ms |
| Même recherche, caches mémoire chauds | 3 | **9,0 ms** | 8,5 / 731,2 ms |
| Géocodage, temps mural froid | 3 | 561,9 ms | 559,5 / 2 210,0 ms |
| Marche IGN et file, temps mural froid | 3 | 12 911,6 ms | 12 737,0 / 19 826,9 ms |
| Recherche de transport froide | 3 | 451,3 ms | 427,2 / 493,5 ms |
| Adaptateur de données froid | 3 | 77,2 ms | 73,9 / 95,2 ms |

L’observation à 21,03 s n’est pas retirée des statistiques : elle confirme 41 quais, contre 42 dans les deux autres essais. La répétition chaude suivante requiert **un nouvel appel IGN**, confirme le 42e quai et recalcule les transports en 731 ms. Les deux autres répétitions chaudes font zéro appel fournisseur. Le détail HTTP de l’accès non confirmé n’est pas enregistré dans ce rapport chronométrique ; il ne faut pas lui attribuer arbitrairement un code d’erreur précis. Les pannes contrôlées sont documentées séparément. Ce comportement montre pourquoi « cache chaud » ne garantit pas toujours une réponse immédiate.

Le premier protocole qui ne vidait que le cache Worker est conservé séparément comme essai intermédiaire ; il n’est pas utilisé pour annoncer un coût réseau entièrement froid.

Les appels sont séquentiellement orchestrés par la file existante : 260 ms entre démarrages, deux simultanés maximum. Chaque recherche froide demande deux revérifications d’adresse et jusqu’à 48 parcours piétons dans le budget courant. Le compteur `upstreamRequests` mesure les appels fetch du fournisseur ; ce n’est pas une preuve d’absence de cache chez IGN. Deux recherches chaudes réutilisent tous les résultats ; la troisième complète un accès non confirmé avec un appel supplémentaire.

Le calcul des accès piétons domine la durée murale : celle-ci inclut l’attente dans la file, pas seulement le temps HTTP. La somme des délais de file de plusieurs requêtes concurrentes ne doit pas être confondue avec la durée du calcul. Le script n’augmente pas les limites de débit pour améliorer artificiellement les chiffres.

Ces observations ne garantissent ni un temps maximal futur ni une couverture exhaustive de tous les quais. Les budgets et la mention d’exploration partielle sont maintenus. Plusieurs onglets ou utilisateurs partageant une IP peuvent dépasser le débit autorisé malgré des files individuelles correctes.

## Interface, carte et réseau

Temps d’un calcul UI entre arrêts avec les données déjà résidentes, du clic à la présence des résultats et à la fin de l’état occupé : **145,2 ms Edge**, **174,6 ms Firefox**, une observation chacun. Ce temps comprend validation et calcul ; le seul coût React n’est pas isolé, donc aucun « rendu React de X ms » n’est annoncé.

Carte, une observation sur chaque navigateur :

| Instrument de la carte | Edge | Firefox |
|---|---:|---:|
| Chargement des arrêts/annexe et préparation | 108,8 ms | 340,0 ms |
| Initialisation MapLibre | 103,5 ms | 336,0 ms |
| Premier rendu après mise à jour | 15,6 ms | 7,0 ms |

L’initialisation et la préparation s’exécutent en partie en parallèle ; ne pas les sommer comme trois étapes strictement successives. Le fond distant est désactivé dans ce benchmark.

Volume du build final complet : **202 fichiers, 192 329 996 octets**, fichier maximal **2 994 783 octets**, rapport de build inclus. Le navigateur ne télécharge pas ces 192 Mo à chaque visite. Les 121 journées utilisent 185 assets GTFS uniques ; la journée et ses courses sont chargées à la demande. L’annexe de consultation/map fait 571 242 octets comprimés, chargée quand nécessaire.

La recherche froide de référence demande **7 fichiers/réponses, 3 582 010 octets de corps de fichiers après déclenchement**, Worker compris ; l’application ouverte auparavant, les en-têtes HTTP/TLS et IGN sont exclus de ce compteur. À chaud : **2 réponses, 454 octets**. Ce sont des volumes de fichiers réellement demandés, pas une mesure des octets sur l’interface réseau physique.

La matrice réseau de douze recherches, ouverture comprise, capture **5 400 998 octets encodés observés** : 5 123 145 locaux et 277 853 IGN. Les tailles sont connues pour 176 requêtes sur 177 ; le démarrage du Worker échappe partiellement à l’attachement CDP. Ce total est donc **partiel**, pas une mesure exhaustive du trafic IP. Les requêtes supplémentaires de MapLibre, de la carte et des essais ultérieurs ont leurs propres traces.

## Mémoire et limites de mesure

Après plusieurs dates et ouverture de la carte dans Edge : heap JS page **7,38 Mo**, heap JS Worker **30,11 Mo**, backing storage Worker **53,47 Mo**, selon `Runtime.getHeapUsage`. Ces nombres sont des instantanés de catégories différentes, pas un pic RSS ni la consommation totale du navigateur. Ils ne doivent pas être additionnés sans connaître les recouvrements de mesure. La mémoire WebGL/driver, les pics transitoires et un appareil physique ne sont pas qualifiés.

Le cache des journées demeure borné à trois, celui des résultats à 24 éléments/60 secondes, géocodages à cinq minutes et marches à une heure. Rechargement ou interruption du Worker perd les caches mémoire. Aucune autonomie hors ligne complète ni préchargement massif n’est ajouté.

## Reproduction et conclusion

```powershell
node scripts/prototype/bench-preproduction.mjs .data/preproduction-1794344387115
node scripts/prototype/step1-address-bench.mjs .data/preproduction-1794344387115
```

Le second script contacte IGN : le lancer volontairement, une seule instance à la fois, sans boucle continue. Les rapports sont écrits dans de nouveaux dossiers `.data` et ne remplacent pas la base active. `step1-summarize.mjs` relit les preuves désignées par `docs/evidence/preproduction-step1-inputs.json`, vérifie les succès et les empreintes ; il refuse d’écraser une synthèse existante.

**PRÉPRODUCTION PARTIELLEMENT VALIDÉE.** Les recherches GTFS statiques sont rapides localement et autonomes vis-à-vis d’une API métier. Le premier parcours avec marche reste dominé par IGN et sa file réglementée. La publication distante, la charge multi-utilisateurs et le comportement mémoire/CPU sur smartphone restent à vérifier ; aucune promesse de performance globale n’est faite.
