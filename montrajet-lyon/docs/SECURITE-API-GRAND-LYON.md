# Sécurité de l’accès Data Grand Lyon

- Authentification Basic construite uniquement dans `server/realtime/client.ts` et transmise par HTTPS à l’URL officielle fixe. Redirections refusées.
- Entrées `lineId`/`stopId` validées contre la table `route_stops` avant tout appel externe. Le backend ne possède aucun proxy générique vers un hôte fourni par le navigateur.
- Secret local dans `.data/`, ignoré par Git ; DPAPI prioritaire, fichier NTFS à ACL strictes seulement en repli. La commande d’initialisation ne met jamais le mot de passe dans ses arguments. Un fichier NTFS de repli contient néanmoins le secret en clair **pour le compte Windows autorisé** : il doit être protégé par le système et n’est pas équivalent à DPAPI.
- La procédure d’initialisation ne sauvegarde pas les identifiants si la requête officielle échoue. Les erreurs 401/403 ne publient ni en-têtes ni mot de passe et ne déclenchent pas de boucle de connexion.
- Les réponses JSON et erreurs publiques indiquent l’état fonctionnel, sans identifiant ni champ `Authorization`. Le cache ne conserve que des lignes fournisseur, aucun secret.
- Les variables d’environnement Cloudflare sont préparées conceptuellement ; aucune configuration distante n’a été créée.

La protection locale dépend du compte Windows et des ACL effectivement appliquées. Un administrateur du poste peut accéder aux secrets locaux ; la sécurité contre un poste compromis n’est pas garantie par l’application. Une revue indépendante des bundles, des logs et de la configuration de production sera nécessaire avant déploiement.
