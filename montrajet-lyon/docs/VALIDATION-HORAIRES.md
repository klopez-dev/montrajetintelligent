# Validation fonctionnelle Horaires — V0.1

Validation réalisée le **8 novembre 2026** avec **Microsoft Edge 157.0.4341.42 headless**, sur l’application React réelle, l’API Vite locale et `.data/gtfs.sqlite` en lecture seule. Aucun déploiement ni nouvelle dépendance.

## Démarrage

Depuis le dossier parent actuellement ouvert :

```powershell
cd montrajet-lyon
npm.cmd run dev -- --host 127.0.0.1 --port 0
```

Vite affiche `http://127.0.0.1:<port-libre>/`. **Ce seul service lance le frontend et l’API `/api/gtfs`**, via `localGtfsPlugin`. Aucun second serveur ni nouvel import n’est nécessaire. Le port 0 demande un port libre au système, sans modifier les ports des autres applications. Les scripts sont dans `montrajet-lyon/package.json`, et non dans le package parent.

Le build peut être consulté avec `npm.cmd run build`, puis `npm.cmd run preview -- --host 127.0.0.1 --port 0`. Le plugin raccorde également l’API à Vite preview ; un serveur statique générique de `dist/` ne la fournit pas.

## Matrice des recherches vérifiées

Référence : **9 novembre 2026 à 11 h Europe/Paris**, dans la validité du GTFS (8 novembre 2026 au 8 mars 2027). Le tableau donne le nombre de **quais distincts proposés pour chaque ligne**, sans fusion par nom. Un zéro produit « Aucun résultat » ; aucun arrêt de remplacement n’est inventé.

| Ligne | Place Henri | Domrémy-Lacassagne | Dauphiné-Lacassagne | Vaulx-en-Velin La Soie |
| --- | ---: | ---: | ---: | ---: |
| C13 | 2 | 2 | 2 | 0 |
| C9 | 2 | 2 | 2 | 0 |
| C16 | 0 | 2 | 2 | 0 |
| 125 | 2 | 2 | 2 | 0 |
| T3 | 0 | 0 | 2 | 3 |

Les **20 combinaisons**, **27 couples ligne/quai et 315 horaires affichés** sont parcourus dans le navigateur. Chaque course, direction, jour de service, seconde GTFS et instant est comparé à un contrôle SQLite indépendant, qui ne réutilise pas le calcul du dépôt applicatif.

| Ligne | Directions rencontrées dans les résultats GTFS |
| --- | --- |
| C13 | Grange Blanche ; Montessuy Gutenberg |
| C9 | Hôpitaux Est ; Bellecour A. Poncet |
| C16 | Surville Route de Vienne ; Charpennes Charles Hernu |
| 125 | Kimmerling - Genêts ; Gare Part-Dieu V.Merle |
| T3 | Meyzieu les Panettes ; Gare Part-Dieu Villette ; Vaulx-en-Velin La Soie selon les courses/quais |

Les libellés proviennent de `stop_headsign`, sinon `trip_headsign`, et non du préfixe d’un identifiant de course. Place Henri distingue notamment les quais `2396` et `2397`. Pour T3 à La Soie, les quais proposés sont `35668`, `35669` et `47685`.

## Contrôles navigateur

- Navigation réelle vers Horaires, modules React chargés, catalogue et API connectés à SQLite.
- Saisie par événements clavier natifs, sélection par clics natifs, capture des réponses réseau reçues par la page et comparaison au texte DOM et à SQLite.
- Cinq lignes et quatre noms d’arrêts, accents/tirets, homonymes et filtrage par ligne.
- Heures Europe/Paris, directions, validité et « Horaire théorique » sur les résultats. Pas de temps réel ni d’horaire fabriqué.
- Mode « maintenant » : départs antérieurs à la requête exclus, retrait des passages qui expirent pendant la consultation ou au retour sur l’onglet. Le test avance l’horloge du navigateur, sans modifier les horaires.
- Date de 2028 hors validité : message explicite et aucun résultat de substitution.
- Ligne inconnue/arrêt non desservi : aucun résultat, anciens horaires effacés après modification de la saisie.
- Requête retardée : chargement visible et bouton désactivé ; HTTP 503 contrôlé : erreur visible sans conservation de l’ancienne liste.
- Catalogue indisponible : recherche désactivée, erreur explicite, bouton Réessayer, attente distincte de l’erreur et reconnexion à la vraie API.
- Recherche lente suivie d’une nouvelle saisie : réponse obsolète ignorée.
- Écrans **1440, 768, 390 et 320 px** : captures et contrôles de dimensions, sans débordement horizontal ni champ hors écran. Recherche complète T3/La Soie aussi réalisée à 320 px.
- Aucune exception JavaScript de l’application relevée sur le scénario complet. Les erreurs réseau contrôlées sont attendues.

Les erreurs et retards sont injectés uniquement dans le navigateur de test via DevTools. Aucun horaire n’est simulé et aucun enregistrement SQLite n’est écrit.

## Corrections

1. La liste « maintenant » conservait les départs devenus passés. Elle les retire désormais au premier instant suivant le départ, puis au retour de visibilité/focus. Si la liste est épuisée, elle invite à relancer la recherche, sans fabriquer d’autres horaires.
2. Le chargement initial apparaissait dans un panneau d’indisponibilité. L’attente est maintenant distincte d’une erreur, y compris lors de la reconnexion.

Une consultation datée garde son instantané sous un titre explicite. L’API fournit `queriedAt`, utilisé pour afficher l’instant de référence. Les données source et la version publique **V0.1** sont conservées.

## Reproduction et preuves

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:browser
```

`test:browser` lance son propre Vite sur un port libre et un profil Edge de test isolé, enregistre `.data/validation-<date>/report.json` et les captures, puis ferme uniquement ses propres services. Il ne ferme ni navigateur personnel ni autre application. `BROWSER_BIN` permet d’indiquer un Chromium/Edge local différent ; aucun navigateur n’est téléchargé. Dans cet environnement restreint, Edge utilise `--no-sandbox` avec ce profil distinct, uniquement sur l’application locale à tester.

`TEST_BASE_URL` permet de réutiliser un Vite existant ; dans ce cas le test ne l’arrête pas. Le rapport conserve la matrice, les identifiants et premiers passages source, les réponses réseau, les tailles d’écran, l’empreinte de l’archive et les éventuelles erreurs JavaScript. Les captures restent hors du dossier public. Les anciens rapports d’échec sont préservés comme preuves des corrections.

Le SHA-256 de `GTFS_TCL.ZIP` est recalculé et comparé aux métadonnées de la base active : `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`. Les horaires contrôlés proviennent des enregistrements du **GTFS TCL fourni et importé**, sans substitution.

## Limites

Validation Edge desktop et émulation mobile uniquement : pas de téléphone physique, Safari/iOS, Firefox, lecteur d’écran ni compte Cloudflare vérifiés. Les deux références à des stations parentes absentes dans l’archive restent signalées dans le rapport d’import ; les quais existants restent consultables. Temps réel, trafic et calcul d’itinéraires restent non connectés.
