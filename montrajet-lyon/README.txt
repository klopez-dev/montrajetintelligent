MonTrajet Lyon V0.1 - tests de qualite des itineraires

Contenu : tests/route-quality-regression.test.mjs
Ce paquet ajoute deux tests GTFS synthétiques sans modifier le moteur ni la base TCL.

Installation : copier le fichier .mjs dans le dossier tests du projet.
Depuis PowerShell :
Set-Location "C:\Users\ankou\Desktop\MTL (MonTrajetIntelligent)\montrajet-lyon"
node --test tests/route-quality-regression.test.mjs

Les horaires et les noms de lignes du test sont fictifs. Ils servent uniquement a verifier l'algorithme.
Les tests ne garantissent pas l'optimalite globale et ne reproduisent pas le GTFS reel.
