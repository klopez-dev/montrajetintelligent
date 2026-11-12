MonTrajet Lyon V0.1

Le projet React / TypeScript / Vite exécutable est dans montrajet-lyon/.
L’ébauche src/ à la racine est conservée, mais n’est pas le point d’entrée Vite.

Démarrage depuis ce dossier :
  cd montrajet-lyon
  npm.cmd run dev -- --host 127.0.0.1 --port 0
Un seul Vite fournit le frontend et les API locales. Le port est choisi librement.

Vérifications depuis montrajet-lyon/ :
  npm.cmd run build
  npm.cmd run lint
  npm.cmd test
  npm.cmd run test:journeys
  npm.cmd run test:browser
  npm.cmd run test:mobility
  npm.cmd run test:network

Itinéraires : calcul GTFS entre deux quais, directs ou jusqu’à deux correspondances,
plusieurs propositions, modes Partir à / Arriver avant et marge configurable.
Adresses BAN : sélection explicite, accès piétons estimés sur le réseau IGN BD TOPO.
Correspondances piétonnes supplémentaires en option, sans accès métro inventé.
Horaires : recherche de lignes/quais et prochains passages théoriques.
Favoris : stockage local préservé, avec identifiants pour les nouvelles entrées.
Temps réel et perturbations restent non connectés ; aucune estimation fictive.

Détails : montrajet-lyon/docs/ITINERAIRES.md et montrajet-lyon/README.md.
Extension et limites : montrajet-lyon/docs/ADRESSES-MARCHE.md.
Performances, couverture et budgets : montrajet-lyon/docs/PERFORMANCES-COUVERTURE.md.
Aucun réimport de données, aucune activation payante et aucun déploiement.
