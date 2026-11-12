# Source GTFS durable — MonTrajet Lyon V0.1

Recherche et vérifications réalisées le **9 novembre 2026**. Verdict : **SOURCE OFFICIELLE SOUS CONDITIONS**.

La source du producteur est identifiée et la procédure officielle d'accès est documentée. **Aucune nouvelle archive authentifiée n'a été récupérée** : le serveur retourne HTTP 401 sans compte technique. La base active et l'archive locale ne sont pas remplacées. Aucun compte, souscription, achat ou déploiement n'a été créé.

## 1. Source recommandée et inventaire

URL canonique recommandée, sous réserve de droits effectifs :

`https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP`

Responsable des données : **SYTRAL Mobilités**. Diffuseur technique : **Métropole de Lyon / Data Grand Lyon**. Référencement national : **transport.data.gouv.fr**, avec métadonnées data.gouv.fr.

| Source examinée | URL de référence exacte | Format / organisme | Disponibilité vérifiée et mise à jour | Authentification, licence, coût et automatisation |
| --- | --- | --- | --- | --- |
| Site institutionnel | https://sytral-mobilites.fr/fr/ | HTML, SYTRAL Mobilités | GET 200. Date de modification non fournie. Aucun téléchargement GTFS direct alternatif identifié dans cette recherche. | Consultation publique. Ce site seul n'accorde pas un accès aux fichiers ; les métadonnées ci-dessous identifient le producteur. |
| Catalogue PAN | https://transport.data.gouv.fr/datasets/horaires-theoriques-du-reseau-transports-en-commun-lyonnais | HTML, Point d'accès national | Page et API accessibles. Le catalogue annonce une authentification du producteur. | Licence Mobilité ; accès au catalogue public, pas un proxy de téléchargement anonyme autorisant à ignorer le 401. |
| API PAN | https://transport.data.gouv.fr/api/datasets/5de42c4d8b4c417a10e62ec9 | JSON, PAN | GET 200. Champ `updated` : 2026-05-12T22:15:44.378000Z. Ressource GTFS 65812, producteur SYTRAL Mobilités, licence `mobility-licence`. | Métadonnées automatisables sans compte. Les dates du catalogue ne prouvent pas la fraîcheur du ZIP. |
| API data.gouv.fr | https://www.data.gouv.fr/api/1/datasets/5de42c4d8b4c417a10e62ec9/ | JSON, diffusion des métadonnées SYTRAL | GET 200. Jeu modifié le 28/07/2026 ; ressource GTFS datée du 22/01/2025 dans les métadonnées. Fréquence déclarée `daily`. | Licence générique `other-pd` à lire avec la description et la Licence Mobilité spécifique. `access_type: open` ne signifie pas absence d'authentification. |
| Ressource GTFS producteur | https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP | ZIP/GTFS, Grand Lyon pour SYTRAL | **GET 401**, sans redirection, challenge `Basic realm="Access to files"`. `Last-Modified` absent dans cette réponse. Aucun corps d'archive récupéré. | Compte technique Data et autorisation applicables. Gratuité générale annoncée sur l'assistance du portail, accès effectif au jeu à confirmer. Automatisation possible en principe par HTTPS Basic, non validée avec des identifiants réels. |
| Redirection de référence data.gouv | https://www.data.gouv.fr/api/1/datasets/r/2f1e1bfc-d378-4e3d-a175-e26f14abc3e6 | Référence de ressource GTFS | Identifiant fourni par l'API officielle, vers l'URL producteur ci-dessus. Pas utilisé pour tenter de contourner l'authentification. | Les droits de la source restent les mêmes ; pas une source indépendante. |
| Connexion officielle | https://data.grandlyon.com/portail/fr/connexion | HTML, Métropole de Lyon | GET 200 ; `Last-Modified` observé 12/10/2026. | GrandLyon Connect ou ProConnect, puis compte technique distinct pour les données. Aucun compte créé durant cette mission. |
| Archive PAN historique | https://transport.data.gouv.fr/resources/65812 | Page d'une ressource GTFS officielle | Les métadonnées décrivent notamment un historique daté du 15/04/2022, valable jusqu'au 12/07/2022. Pas de nouvelle archive téléchargée. | Une archive historique ne renouvelle pas le réseau actuel, même si sa provenance est officielle. |
| Dérivé historique mentionné sur le PAN | https://transport.data.gouv.fr/resources/81943 | Page « GTFS modifié », hébergement tiers | Page GET 200 ; absente de la liste courante des ressources renvoyée par l'API du jeu. Aucun appel au fichier tiers, aucune disponibilité ZIP déduite de la page. | Lien vers `https://gtech-transit-prod.apigee.net/v1/google/gtfs/odbl/lyon_tcl.zip`, avec paramètres de clé/secret publiés sur la page : **valeurs non conservées dans le rapport et non utilisées**. Autorisation actuelle de ce miroir non établie ; non retenu. |

L'API PAN fournit aussi une URL permanente d'historique officielle, **non téléchargée et périmée** :

`https://transport-data-gouv-fr-resource-history-prod.cellar-c2.services.clever-cloud.com/c6a3d03f-f8e4-44f3-9e7d-fcaf1ab30b92/c6a3d03f-f8e4-44f3-9e7d-fcaf1ab30b92.20220415.060247.709832.zip`

Aucun miroir actuel officiellement autorisé et utilisable pour le renouvellement n'a été établi. Un lien public, un annuaire ou un paramètre d'API visible ne suffit pas à démontrer les droits de réutilisation ou le droit d'utiliser un compte tiers. Les ressources NeTEx, PDF et SIRI du jeu officiel ne sont pas assimilées à une archive GTFS compatible.

## 2. Explication documentée du HTTP 401

La [documentation du portail](https://data.grandlyon.com/portail/en/documentation) renvoie vers la [documentation technique officielle d'authentification](https://rdata-grandlyon.readthedocs.io/fr/latest/authentification.html), dont l'accès a été vérifié HTTP 200.

Elle distingue deux étapes : connexion GrandLyon Connect/ProConnect, puis définition d'un **mot de passe spécifique à la plateforme Data**. Les comptes partagent l'identifiant, mais leurs mots de passe doivent être différents. Les appels techniques utilisent **HTTP Basic sur HTTPS**. Utiliser le mot de passe de connexion institutionnelle comme s'il était celui de l'API peut donc être incorrect.

Le challenge réellement reçu par le fichier est cohérent avec cette méthode. **Aucun identifiant disponible n'a permis de vérifier la réussite**, et aucun mot de passe n'a été essayé. Le 401 n'est pas traité comme un téléchargement vide ou comme une autorisation de changer de miroir.

L'[assistance officielle](https://data.grandlyon.com/portail/fr/contact) présente les données comme accessibles gratuitement aux citoyens, associations et entreprises, sous leurs licences, et précise le compte requis pour les données de mobilité. Cela justifie une piste **sans achat ni carte bancaire**, pas une garantie d'autorisation déjà accordée à ce projet ni de capacité illimitée. Le parcours d'inscription et l'acceptation effective des conditions n'ont pas été effectués.

## 3. Conditions d'utilisation à conserver

Licence liée au jeu par le PAN : **Licence Mobilité**. Le [document officiel diffusé par Grand Lyon](https://data.grandlyon.com/portail/fr/assets/licences/Licence_mobilit%C3%A9s_V_02_2021.pdf) est la version du 03/02/2021. La licence et les CGU de diffusion encadrent la réutilisation, le partage et les obligations associées. Il reste à confirmer qu'il s'agit bien des conditions du compte et de la ressource effectivement délivrée aujourd'hui.

Avant publication de données dérivées : conserver producteur, source, date et licence ; examiner le partage à l'identique applicable et la compatibilité avec les politiques de mobilité ; distinguer les droits sur les marques et les contenus. Ne pas remplacer cette licence par une déclaration ODbL générale fondée sur un ancien annuaire.

Les [bonnes pratiques officielles](https://rdata-grandlyon.readthedocs.io/fr/latest/bonne_pratique.html), vérifiées HTTP 200, prévoient récupération et stockage par les réutilisateurs autorisés, à une fréquence adaptée aux mises à jour, et recommandent de ne pas exposer les identifiants au navigateur. Aucun quota spécifique de téléchargement GTFS n'a été établi dans cette mission. `daily` est une fréquence déclarée du jeu, pas une autorisation de sondage continu.

La documentation liée par le portail est une source technique ; elle ne remplace pas la validation des droits du titulaire. Aucun service payant ou abonnement n'est proposé comme solution au blocage.

## 4. Méthode de renouvellement préparée dans le projet

Nouveau script : **`scripts/gtfs/renew.mjs`**. Il est livré mais **pas exécuté avec un compte réel**.

1. Exiger confirmation préalable des droits et de l'accès gratuit à cette ressource, puis identifiant/mot de passe du **compte technique Data**.
2. Lire uniquement des variables serveur `GTFS_SOURCE_USERNAME`, `GTFS_SOURCE_PASSWORD`, `GTFS_SOURCE_POLICY_CONFIRMED` et `GTFS_SOURCE_FREE_ACCESS_CONFIRMED`. Aucune variable `VITE_`, donnée en argument de ligne de commande ou valeur enregistrée dans le frontend.
3. Appeler uniquement l'URL canonique HTTPS, avec redirections refusées, limite de temps et taille maximale de 64 millions d'octets. Une erreur 401/403/429 arrête l'opération, sans nouvel essai ni changement d'hôte.
4. Écrire un fichier `.part` dans un nouveau dossier `gtfs-renewal-…`, vérifier la signature ZIP, puis utiliser l'importateur GTFS existant. CSV, fichiers requis, calendriers/exceptions, identifiants, CRC et cohérence du modèle sont validés par cet importateur. Un HTTP 200 contenant une page de connexion est refusé.
5. Importer **dans le staging neuf**, jamais vers la base active du projet. L'importateur peut créer un `activePath` interne à ce staging : ce n'est pas `.data/gtfs.sqlite` du projet.
6. Produire un reçu uniquement après validation réussie : SHA, tailles, provenance, validité, rapport d'import et chemin de candidate. Le reçu impose une revue avant toute activation. Une date valide dans le format ne prouve pas que la nouvelle archive couvre les déplacements actuels : vérifier ses bornes et les services avant utilisation.

Les variables de confirmation ne créent ni droits ni gratuité : elles représentent une décision préalable justifiée. Aucune configuration manuelle de fichier n'est demandée à l'utilisateur. Les secrets pourront être configurés côté serveur lors d'une étape autorisée, après obtention du compte technique ; ils ne doivent pas être communiqués dans un rapport ou un dépôt.

La fréquence cible prudente est une vérification quotidienne, à confirmer avec le producteur. Une future automatisation devra gérer ETag/Last-Modified si disponibles, validité, arrêt au refus d'accès, intégrité, tests de candidate et rollback. **Aucune tâche récurrente n'est activée.** Le script n'achète rien et ne déploie rien.

## 5. Validation réellement obtenue et blocage restant

- Métadonnées officielles PAN/data.gouv reçues et conservées ; producteur, URL, licence, formats et dates identifiés.
- GET officiel du ZIP : 401, challenge Basic, sans redirection ; aucun ZIP nouveau présenté comme reçu.
- Procédure du compte technique et bonnes pratiques : HTTP 200, méthode officiellement documentée.
- Tests automatisés du renouvellement : refus avant réseau sans droits/gratuité/compte, 401 sans retry, URL fixe et absence de secret dans l'erreur, taille excessive refusée, page de connexion HTTP 200 refusée.
- **Pas de test du téléchargement authentifié complet ni d'import d'une nouvelle archive réelle.** Le chemin de succès du script devra être validé avec le compte autorisé et la ressource courante.
- L'archive existante reste celle fournie localement, SHA `7b9f4d1b94e054d6d47159130d34c972a083c750ce5a106f0786e386f878225d`, valable du 08/11/2026 au 08/03/2027. Les résultats du prototype ne prouvent pas son renouvellement.

Preuves : `.data/gtfs-source-audit-1794262674787.json` ; métadonnées détaillées `.data/gtfs-source-metadata-1794253668341.json` ; tests `tests/hybrid-prototype.test.mjs`. Les valeurs des paramètres du lien tiers sont retirées de la preuve de recherche, et le domaine tiers n'a pas été appelé.

## 6. Décision

**SOURCE OFFICIELLE SOUS CONDITIONS.** La voie recommandée est le GTFS producteur avec le compte technique Data, licence et accès gratuit confirmés. Le blocage opérationnel reste l'absence d'identifiants et de droits effectifs validés pour ce projet. Aucun contournement, miroir non autorisé, téléchargement réussi fictif ou remplacement de base n'a eu lieu.
