# Validation de l’intégration temps réel préparée

> Historique de la validation **avant** initialisation DPAPI. Pour les résultats authentifiés du 11 novembre 2026, consulter [VALIDATION-TEMPS-REEL-2026-11-11.md](./VALIDATION-TEMPS-REEL-2026-11-11.md).

État au 11 novembre 2026 : l’accès direct au flux officiel depuis le backend local répond HTTP 401 sans compte technique. Aucun identifiant réel n’a été enregistré, aucun passage réel n’a été affiché, et aucune heure d’itinéraire n’a été modifiée. Le mode GTFS théorique et la version publique V0.1 restent inchangés.

Tests exécutés : **266 tests réussis, 0 échec** ; linter sans avertissement et compilation Vite réussis. Les tests du client et du rapprochement utilisent des valeurs **fictives**, jamais présentées comme données TCL. La persistance Windows est testée avec identifiants fictifs, DPAPI lorsque disponible ou ACL NTFS stricte en repli. Dans le processus de test, DPAPI n’a pas accès au profil Windows ; le repli NTFS a été vérifié. L’audit du bundle distribué a inspecté six fichiers (1 495 720 octets) sans marqueur de secret ni mot de passe configuré ; aucun vrai identifiant n’était présent à comparer.

Critères non atteints : accès réel authentifié, licence/quotas de la couche confirmés, correspondance exacte mesurée sur flux officiel, horaires actualisés dans les itinéraires, carte et favoris, mesure de performance réelle, déploiement Cloudflare. Ils ne doivent pas être décrits comme opérationnels.

**Verdict : INTÉGRATION TEMPS RÉEL PARTIELLEMENT VALIDÉE.** Le backend sécurisé, le coffre local et le repli sont testables ; le flux officiel demeure indisponible dans cet environnement et les fonctions qui en dépendent restent désactivées.

Le parcours Horaires dans **Edge** a réussi depuis le build local via `vite preview` : rapport `.data/validation-1794353540520/report.json`. Le contrôle **Firefox** du chargement Horaires, du statut désactivé et des largeurs 320/390/768/1440 px a réussi : `.data/realtime-firefox-1794353600177/report.json`. Le backend de prévisualisation répondait `disabled/authentication_required` sur `/api/realtime/status` et `unavailable/authentication_required` pour T3 au quai 35668, sans requête authentifiée.

Le test sur le **serveur Vite de développement** a échoué avant l’affichage React : la racine renvoyait HTTP 200, mais les modules `/src/main.tsx` et `/@vite/client` ne répondaient pas avant le timeout dans cet environnement. Les requêtes `/api/gtfs/*` et `/api/realtime/status` répondaient. La prévisualisation du build a été utilisée pour la validation navigateur ; la cause du blocage du serveur de développement reste à investiguer. Ce défaut ne doit pas être présenté comme résolu.
