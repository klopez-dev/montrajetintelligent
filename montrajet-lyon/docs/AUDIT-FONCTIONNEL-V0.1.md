# Audit fonctionnel de MonTrajet Lyon V0.1

Date : 11 novembre 2026. Périmètre : copie locale, build Vite servi par `vite preview` sur `127.0.0.1:54826`, SQLite existante. Aucun téléchargement GTFS, déploiement, changement de secret ou correction applicative.

## A. Synthèse exécutive

**Verdict : PARTIELLEMENT FONCTIONNELLE.** Les recherches d'arrêts, les horaires GTFS, les trajets théoriques directs et avec une ou deux correspondances, la carte à marqueurs et les favoris fonctionnent dans les scénarios vérifiés. L'usage quotidien depuis une adresse n'a pas été revalidé pendant cet audit avec IGN ; la couverture et l'optimalité du moteur restent volontairement bornées, et le renouvellement GTFS n'est pas garanti. Aucun défaut P0 ni horaire inventé n'a été observé dans l'échantillon. Ce constat n'établit pas une absence générale de défaut.

Fonctionnement partiel : trajet porte à porte dépendant du géocodage et du routage IGN, carte sans tracé réel des véhicules, navigation navigateur sans historique, temps réel suspendu pour politique de réutilisation non confirmée. Fonction indisponible : ajustement temps réel des itinéraires, volontairement désactivé. Confiance **élevée** pour les trajets entre arrêts testés contre SQLite, **moyenne** pour Horaires/Carte/Favoris, **faible** pour les adresses et les fournisseurs externes pendant cette session.

## B. Preuves et matrice de recette

Commandes exécutées dans le projet : `npm.cmd test` (277 réussis, 0 échec), `npm.cmd run lint` (réussi), `npm.cmd run build` (réussi, avertissement de taille du bloc MapLibre à 1 078,23 kB), `npm.cmd run test:browser`, `npm.cmd run test:journeys`, `npm.cmd run test:network`, `MAP_ERROR_ONLY=true node scripts/qa/validate-map.mjs` (toutes réussies contre le build local). `node scripts/qa/audit-realtime-secrets.mjs` : réussi sur six fichiers distribués et 132 journaux ; `credentialConfigured:false`, donc le mot de passe DPAPI réel n'a pas été contrôlé dans cette session. Les rapports détaillés restent dans `.data/validation-1794388670155`, `.data/routing-validation-1794388707405`, `.data/network-validation-1794388996771`, `.data/map-validation-1794388744595`.

| Fonctionnalité | Scénarios testés | Réussites | Échecs | Verdict |
|---|---:|---:|---:|---|
| Horaires GTFS | C13, C9, C16, 125, T3 ; absence, péremption, erreur API, mobile | 32 contrôles navigateur | 0 | Réussi sur l'échantillon |
| Itinéraires entre arrêts | trois départs Lacassagne, départ/arrivée, 0/1/2 correspondances, dates invalides, DST, minuit, contre SQLite | 27 contrôles et 12 contrôles réseau | 0 | Réussi dans le périmètre borné |
| Carte | marqueurs, sélection, recentrage, tuiles indisponibles, 320/390/768/1440 px | 9 contrôles | 0 | Partiel : tracé GTFS absent |
| Favoris | ajout, persistance, réutilisation, suppression, erreurs | contrôles du scénario navigateur Itinéraires | 0 | Réussi sur l'échantillon ; modification et ancien ID non retestés ici |
| Adresses / marche IGN | code et anciens rapports examinés, aucun appel externe dans cette session | 0 contrôle réel récent | — | Non revalidé |
| Navigation / clavier / responsive | changement d'onglet et historique ; mobile dans suites ciblées | onglet change | retour navigateur échoue | Partiel ; 1024 px et parcours clavier complet non vérifiés |
| API / sécurité | statut GTFS, statut temps réel, paramètres invalides, scan secrets distribué | 5 contrôles ciblés | 0 | Réussi dans le périmètre ; DPAPI réel non contrôlé |
| Trafic | code et état existant | aucune collecte nouvelle | — | Non revalidé ; pas de preuve de fraîcheur globale |

La liste `checks` et les réponses complètes dans les quatre rapports sont les preuves primaires ; le décompte du tableau ne signifie pas autant de scénarios indépendants.

### Recette des itinéraires réels

Toutes les dates ci-dessous sont des instants UTC ; le GTFS utilise `Europe/Paris`. Les paramètres communs étaient `mode=departure`, `order=arrival`, `marginSeconds=120`, `maxTransfers=2`, sauf lorsqu'un mode « Arriver avant » est explicitement indiqué. Les rapports JSON conservent les paramètres, courses, temps de marche, marges, réponses et comparaisons à SQLite sans retranscrire ici des centaines de lignes.

| Scénario | Paramètres et observation | Attendu / verdict |
|---|---|---|
| Place Henri → La Soie | Arrêts GTFS `2397` → `36394`, date couverte du 09/11/2026 ; C13 puis métro A dans le rapport de recette | Courses et ordre des arrêts vérifiés contre SQLite ; réussi sur cet horaire |
| Domrémy-Lacassagne → La Soie | `12230` → `36394`, même date ; C13 puis A | Courses vérifiées ; réussi sur cet horaire |
| Dauphiné-Lacassagne → La Soie | `35660` → `35668`, même date ; T3 direct | Course vérifiée ; réussi |
| Bus → métro | C13 puis A dans les deux premiers cas | Marges et quais rapportés ; réussi sur cet horaire |
| Bus → tramway | `2404` → `32128` à `2026-11-09T09:50:00Z`, `maxTransfers=1` ; bus 37 `37_37A-108AB_00401014` puis T4 `550_T4A-173AT_01501020`, 09:52 → 10:02:42Z | Transfert officiel `46642` → `32126`, minimum GTFS 60 s + marge 120 s = 180 s ; 373 s disponibles. Réussi |
| Deux correspondances | `1138` → `36394` à `2026-11-09T10:00:00Z` ; C16 `916_C16A-068AT_00701006` → TB11 `511_TB11-135AT_01201011` → A `301_301A-080CM_01601035`, 10:00 → 10:48:31Z | Chemin contrôlé dans SQLite ; état API `limited`, donc pas de preuve d'optimalité globale. Réussi dans le budget calculatoire |
| Sans solution / hors validité | Scénarios des suites Itinéraires et Réseau ; date non couverte | Aucun service recyclé ; réussi |
| Dernier service et minuit | `10068` → `2975`, recherche à `2026-11-09T22:59:00Z` ; C12 `912_C12A-010AB_01101030`, départ GTFS 86400, arrivée 86520, service du 09/11 | Départ local 10/11 00:00, arrivée 00:02, course et calendrier présents ; réussi. Une recherche à 23:01Z trouve C14 23:03Z : ne pas conclure à l'absence de tout service après C12 |
| « Arriver avant » et changement d'heure | Suites Itinéraires/Réseau, contrôles des marges, créneau de printemps et heure répétée d'automne | Réussi sur les cas de test ; pas de preuve exhaustive pour tous les fuseaux/ambiguïtés |

Pour ces trajets entre arrêts, le temps de marche à chaque changement de quai est celui du transfert officiel GTFS lorsque la règle existe ; aucune marche d'adresse n'est affirmée. Le classement est celui de l'API ; un résultat `limited` signale qu'il peut manquer une meilleure option. Le lien C13/T3 à Dauphiné ne doit pas être présumé meilleur sans comparer les horaires de courses à l'instant précis.

### GTFS et backend

Provenance enregistrée : `https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP`; import `2026-11-08T12:25:54.683Z`, validité `2026-11-08` à `2027-03-08`, fuseau `Europe/Paris`. Base : 807 lignes, 14 026 arrêts, 140 442 courses, 2 927 249 horaires, 3 356 services, 22 435 exceptions et 5 457 règles de transfert. Les jointures ciblées n'ont trouvé ni course sans ligne/service ni horaire sans course/arrêt. Deux arrêts réfèrent à une station parente absente ; l'import a conservé les IDs sans inventer de regroupement. Pas de contrôle intégral d'intégrité SQLite (`quick_check`) établi ici.

L'API locale renvoie HTTP 200 pour `/api/gtfs/status` et `/api/realtime/status`, HTTP 400 pour recherche de trajet sans arrêts et pour couple ligne/quai invalide. Le temps réel rapporte `disabled / policy_unconfirmed`, `automaticRefresh:false`, enrichissement itinéraires `disabled / mapping_unconfirmed`. Aucun appel de consultation continue n'a été déclenché. Les délais, caches et limites sont présents dans le code serveur, mais leur robustesse sous charge n'a pas été testée. Les identifiants ne figurent pas dans les six fichiers distribués ni 132 journaux inspectés ; DPAPI et les secrets effectifs restent hors preuve de cet audit.

## C. Registre des anomalies et limites

**P0 : 0. P1 : 0 défaut reproduit ; 1 risque majeur ouvert. P2 : 2. P3 : 2.** Les risques et absences de preuve ne sont pas comptés comme défauts reproduits.

| ID | Priorité / nature | Fonction | Reproduction ; attendu → obtenu | Cause / fichiers | Recommandation ; effort |
|---|---|---|---|---|---|
| A-01 | P1, risque non reproduit | Pérennité GTFS | Attendre au-delà du 08/03/2027 sans réimport ; attendu : flux officiel renouvelable → méthode de renouvellement actuellement non garantie, ancienne source connue HTTP 401 | Provenance dans SQLite, scripts `scripts/gtfs/` ; pas de panne actuelle | Qualifier une source officielle autorisée et automatisable, puis répéter import sur copie ; élevé |
| A-02 | P2, défaut reproduit | Navigation | Ouvrir Accueil puis Horaires, utiliser Retour ; attendu : Accueil → URL et historique inchangés, Retour ne restaure pas Accueil | `src/App.tsx` stocke l'onglet dans `useState` seul | Synchroniser onglet et `history`/`popstate`, tester rechargement et liens profonds ; moyen |
| A-03 | P2, limite fonctionnelle démontrée | Classement itinéraires | Chercher `1138` → `36394`, 09/11/2026 10:00Z, deux transferts ; attendu : options pertinentes classées → six options avec état `limited`, donc exhaustivité et meilleur trajet global non établis | Budget de recherche dans `server/journeys/` ; protection de ressources assumée | Mesurer les chemins omis avec oracle indépendant et ajuster budget seulement si exactitude/performance le permettent ; élevé |
| A-04 | P3, fonction absente annoncée | Carte | Afficher trajet T3 ; attendu si carte de parcours complet : tracé réel → marqueurs d'arrêts, texte précisant que le tracé GTFS est absent | `src/components/JourneyMap.tsx`, géométrie absente du GTFS importé | Fournir une géométrie officielle autorisée avant de dessiner des lignes ; élevé |
| A-05 | P3, amélioration | Poids frontend | `npm.cmd run build` ; attendu : téléchargement sobre → bloc MapLibre 1 078,23 kB et avertissement Vite >500 kB | Dépendance cartographique ; build Vite | Chargement différé de la carte, mesure réseau avant/après ; moyen |

**Validations manquantes, hors compte d'anomalies :** adresse et marche IGN sur des requêtes réelles pendant cette session ; 1024 px, parcours clavier complet, trafic actualisé, modification de favoris et ancien arrêt disparu ; tous les écrans combinés au mobile ; tests de charge backend ; secret DPAPI réel. Ces points ne peuvent pas être déclarés réussis. Les anciennes suites `test:mobility`, `validate-favorites` et `validate-traffic` existent, mais leurs exécutions antérieures ne prouvent pas l'état des fournisseurs au 11/11.

## D. Plan de correction

1. **Bloquants :** aucun P0 reproduit.
2. **Majeurs :** qualifier le renouvellement GTFS (A-01) sur une copie, licence et authentification documentées ; établir ensuite une procédure avec contrôle de dates, hash et régression. Cela conditionne l'usage après mars 2027.
3. **Fiabilisation :** refaire une recette adresse/marche IGN à faible volume, contrôler les fournisseurs et les erreurs ; comparer les propositions `limited` à un oracle élargi, puis corriger uniquement des omissions prouvées ; résoudre A-02 avec tests Retour, rechargement et favoris. Répéter les contrôles clavier, 1024 px, favoris édités et données obsolètes.
4. **Confort :** A-04 après obtention de géométries autorisées ; A-05 après mesure du coût de chargement réel.

## E. Critères de sortie V0.1 locale

- [x] Aucune anomalie P0 reproduite dans le périmètre testé.
- [x] Tests, lint et build réussis ; version publique V0.1 inchangée.
- [x] Trajets entre arrêts échantillonnés cohérents avec les courses, services, arrêts et transferts SQLite.
- [x] Temps réel désactivé tant que politique et rapprochement ne sont pas confirmés ; repli théorique explicite.
- [ ] Parcours porte à porte et erreurs IGN revalidés aujourd'hui sur plusieurs cas contrôlés, sans quota excessif.
- [ ] Tous écrans, clavier, 1024 px, historique et états vides vérifiés ; A-02 résolu ou explicitement accepté.
- [ ] Options `limited` comparées à des solutions indépendantes pour les parcours quotidiens prioritaires.
- [ ] Plan de renouvellement GTFS officiel, autorisé et reproductible avant expiration.
- [ ] Revalidation favoris modifiés/obsolètes et Trafic avec collecte fraîche autorisée.

## F. Verdict final

**PARTIELLEMENT FONCTIONNELLE** en local à la date de l'audit. Les fonctions théoriques centrales marchent sur les cas contrôlés ; la dépendance adresse/IGN non revalidée, l'exhaustivité bornée des propositions et l'absence de procédure GTFS durable empêchent de certifier l'usage quotidien fiable. Aucun déploiement ni activation du temps réel n'est justifié par ce rapport.
