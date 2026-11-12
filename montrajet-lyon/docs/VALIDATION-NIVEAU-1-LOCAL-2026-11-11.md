# Validation locale du niveau 1 — 11 novembre 2026

## Campagnes GTFS distinctes

La campagne initiale a examiné 160 passages sur C13, C9, C16, 125, T3, T1, T2 et T4 : 160 couples course/ligne/quai exacts ; 60 calendriers vérifiés sur T1, T2 et T4. Les rapports conservés pour les 100 autres ne contiennent pas les identifiants de course nécessaires à une vérification rétroactive complète. Leur taux de correspondance calendaire reste **non mesuré**.

Une **nouvelle campagne**, distincte, a consulté C13 une seule fois à 09 h 43, heure de Paris : HTTP 200, 20 passages (19 `E`, 1 `T`), 20/20 identifiants ligne/quai/course exacts et 20/20 services GTFS actifs près de l’heure annoncée. Le seul `T` coïncidait à une minute près avec l’horaire de sa course GTFS. Les 20 destinations correspondaient au dernier arrêt de la course et les 20 directions au `headsign` GTFS dans cette page. Ce constat ne résout pas les divergences des observations nocturnes : une direction commerciale discordante reste non confirmée, sans attribution d’itinéraire. Rapport local ignoré par Git : `.data/realtime-official-audit-1794386594504.json`.

## Mode local ponctuel

Le plugin Vite local accepte `MONTRAJET_REALTIME_VALIDATE_ONCE=1` **uniquement sur la boucle locale**. Il injecte un mode de validation en mémoire dans le client serveur, sans modifier les variables de production ou la configuration Cloudflare. Le client autorise une seule tentative HTTPS fournisseur par démarrage du serveur. Les consultations suivantes utilisent uniquement un instantané encore frais, puis reviennent au GTFS. Le mode est faux par défaut, n’ajoute aucun secret au navigateur et désactive le rafraîchissement automatique dans l’écran Horaires. Le niveau 2 reste désactivé dans `/api/realtime/status`.

Commande locale de validation, depuis la racine du projet, à lancer dans un terminal PowerShell pour une session ponctuelle :

```powershell
$env:MONTRAJET_REALTIME_VALIDATE_ONCE='1'
npm run preview -- --host 127.0.0.1 --port 54823 --strictPort
```

La variable de session n’est pas enregistrée. Le coffre DPAPI existant est lu automatiquement. La [licence officielle](https://data.grandlyon.com/portail/fr/assets/licences/Licence_mobilit%C3%A9s_V_02_2021.pdf) renvoie aux conditions d’utilisation de la plateforme : ce mode ponctuel **ne constitue pas** une autorisation de consultation continue.

## Parcours navigateur réel

Edge local a sélectionné C13 et le quai GTFS 50141, appelé le backend et affiché **quatre passages officiels futurs**, dont **deux `E` « Passage estimé » et deux `T` « Horaire théorique »**. Les quatre ont passé les contrôles ligne, quai, course, calendrier, fraîcheur et heure future ; aucune direction n’était discordante dans cette réponse. L’heure de dernière mise à jour, la ligne et l’arrêt étaient visibles. Le GTFS restait affiché ; les courses présentes dans le bloc Data Grand Lyon n’étaient pas dupliquées dans la liste GTFS. Aucun appel direct du navigateur au fournisseur n’a été observé. Le rapport et la capture sont dans `.data/realtime-local-browser-1794386697759/` (données locales non publiées). Ce test était **réel**, pas une simulation.

## Situations dégradées et limites

Les tests automatisés couvrent réponse vide, HTTP 401/403/429/500, panne réseau, délai d’attente, cache, coalescence, budget d’une tentative, arrêt homonyme ou absent, course/calendrier invalides, exception de service, après minuit, données périmées, deux courses proches et direction divergente. Le résultat GTFS reste disponible lorsque la source échoue. Les passages sont filtrés au bout de deux minutes de fraîcheur ou dès qu’ils sont passés ; une direction discordante n’est jamais présentée comme confirmée.

Le premier écran affiche cinq passages au maximum et propose « Voir les N passages » au-delà. Le test réel ci-dessus ne contenait que quatre passages : le bouton n’y a donc pas été exercé. Un second parcours ponctuel a réussi avec quatre passages et une capture à 390 px, sans débordement horizontal : `.data/realtime-local-browser-1794386852936/`. Les validations de non-régression restent consignées dans les rapports `.data/validation-*`.

## Décision

Validation finale : `npm test` **274 réussis, 0 échec** ; `npm run lint` sans avertissement ; `npm run build` réussi (avertissement de taille MapLibre préexistant). Le parcours navigateur normal, avec niveau 1 désactivé par défaut, a réussi dans `.data/validation-1794386902257/`, y compris à 320, 390 et 768 px. L’audit de sécurité final a inspecté six fichiers distribués et 132 journaux locaux avec le secret DPAPI en mémoire : aucune occurrence du mot de passe ni de l’en-tête Basic. Les deux serveurs locaux de validation ont été arrêtés.

Niveau 1 **testé de bout en bout localement**, mais désactivé par défaut. L’activation continue attend la confirmation des droits de réutilisation, de la cadence ou des quotas de cette couche et la validation de davantage de missions et dates. Les divergences direction/destination ne permettent toujours pas d’activer le niveau 2. Version publique V0.1 inchangée ; aucun déploiement.
