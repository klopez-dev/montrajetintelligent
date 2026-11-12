# Performance : mesures et limites

La seule requête réelle effectuée ici, non authentifiée et limitée à un résultat, a renvoyé HTTP 401. Il n’existe donc **aucune mesure crédible de latence de consultation, de cache réel ou de couverture** Data Grand Lyon. Les tests locaux mesurent uniquement le code et les fixtures synthétiques.

Le client borne chaque réponse à 2 Mo, le temps d’attente à 5 s par défaut, le cache mémoire à 128 quais et les jointures de rapprochement à 24 lignes par requête. Il évite les demandes simultanées identiques. Le rafraîchissement Horaires n’est lancé qu’après une réponse exploitable, toutes les 120 s au plus, lorsque l’onglet est visible. Cette cadence est un choix d’interface et reste derrière le verrou de politique fournisseur ; elle n’est **pas** un quota autorisé par Data Grand Lyon.

Une architecture Cloudflare Free pourrait utiliser le cache Edge existant, mais la capacité de la couche Data Grand Lyon, le coût des requêtes D1 éventuelles et les quotas réels doivent être mesurés avant promotion. Aucune promesse de temps de réponse n’est faite.
