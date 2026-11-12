// MTL V0.1 — Suppression de la marge facultative. Exécuter depuis la racine du projet.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.cwd(), changes=new Map(), original=new Map();
const read=p=>changes.get(p)??fs.readFileSync(path.join(root,p),'utf8').replace(/\r\n/g,'\n');
function edit(p,oldText,newText){let s=read(p);if(!s.includes(oldText))throw Error(`Signature introuvable dans ${p}: ${oldText.slice(0,100)}`);if(s.split(oldText).length!==2)throw Error(`Signature ambigüe dans ${p}: ${oldText.slice(0,100)}`);changes.set(p,s.replace(oldText,newText));}
function editAll(p,oldText,newText){let s=read(p);if(!s.includes(oldText))throw Error(`Signature introuvable dans ${p}: ${oldText.slice(0,100)}`);changes.set(p,s.split(oldText).join(newText));}
function remove(p,text){edit(p,text,'')}
try {
// Moteurs: conserver le minimum GTFS et la marche confirmée, sans majoration.
for(const p of ['server/journeys/network.ts','server/journeys/planner.ts']){
 edit(p,'query.marginSeconds < 30','query.marginSeconds < 0');
 edit(p,'marginSeconds: query.marginSeconds }','marginSeconds: 0 }');
 edit(p,'policy.minimum + query.marginSeconds','policy.minimum');
 edit(p,'marginSeconds: query.marginSeconds, requiredSeconds: required','marginSeconds: 0, requiredSeconds: required');
}
edit('server/journeys/network.ts','(label.legs.length ? query.marginSeconds * 1000 : 0)','0');
edit('server/journeys/network.ts','Même quai : déplacement interarrêt nul retenu comme hypothèse ; marge ajoutée.','Même quai : déplacement interarrêt nul retenu comme hypothèse ; aucune marge supplémentaire.');
edit('server/journeys/planner.ts','first.arrival + query.marginSeconds * 1000','first.arrival');
edit('server/journeys/planner.ts','`Marge de sécurité ajoutée au minimum officiel : ${query.marginSeconds} s (hypothèse configurable).`,','`Minima GTFS et marche confirmée, sans marge supplémentaire.`,');
// API : accepter les anciennes requêtes, ignorer systématiquement leur ancienne marge.
edit('server/journeys/api.ts',"const marginText = param('marginSeconds') || '120'","const marginText = param('marginSeconds') || '0'");
edit('server/journeys/api.ts','Number(marginText) < 30','Number(marginText) < 0');
edit('server/journeys/api.ts','marginSeconds: Number(marginText)','marginSeconds: 0');
edit('server/mobility/api.ts','query.marginSeconds < 30','query.marginSeconds < 0');
edit('server/mobility/api.ts',"parseGtfsDate(query.at.slice(0, 10).replaceAll('-', ''))","parseGtfsDate(query.at.slice(0, 10).replaceAll('-', ''))\n        query.marginSeconds = 0 // Compatibilité : les anciennes marges sont ignorées.");
// Porte-à-porte : aucune majoration avant embarquement.
edit('server/mobility/planner.ts','const safetySeconds = access ? query.marginSeconds : 0','const safetySeconds = 0');
editAll('server/mobility/planner.ts','access.path.durationSeconds + query.marginSeconds','access.path.durationSeconds');
editAll('server/mobility/planner.ts','origin.path.durationSeconds + query.marginSeconds','origin.path.durationSeconds');
edit('server/mobility/planner.ts','marginSeconds: query.marginSeconds','marginSeconds: 0');
edit('server/mobility/planner.ts','La marge avant embarquement est une hypothèse configurable, pas une garantie de correspondance.','Aucune marge supplémentaire n’est ajoutée avant embarquement.');
// Formulaire : retirer champ et état de marge, ne plus sauvegarder de marge.
const form='src/components/JourneyForm.tsx';
edit(form,'mode,dateTime,fold,order,margin,maxTransfers,walkingTransfers','mode,dateTime,fold,order,maxTransfers,walkingTransfers');
remove(form,"  const setMargin = useCallback((value: JourneyFormSettings['margin']) => onSettingsChange(current => ({ ...current, margin: value })), [onSettingsChange])\n");
edit(form,"dateTime: string; margin: string; order:","dateTime: string; order:");
editAll(form,'mode, marginSeconds:Number(margin), maxTransfers:','mode, maxTransfers:');
edit(form,'margin:String(p.marginSeconds ?? margin), ','');
edit(form,'setMargin(target.margin);','');
editAll(form,'dateTime,margin,maxTransfers','dateTime,maxTransfers');
edit(form,'setDateTime,setMargin,setMaxTransfers','setDateTime,setMaxTransfers');
edit(form,'target.margin!==margin || ','');
remove(form,"    if (!/^\\d+$/.test(margin) || Number(margin) < 30 || Number(margin) > 1800) { setError('Choisissez une marge entre 30 et 1800 secondes.'); return }\n");
editAll(form,'marginSeconds: Number(margin)','marginSeconds: 0');
remove(form,'        <label className="field"><span>Marge ajoutée (secondes, 30 minimum)</span><input type="number" min="30" max="1800" step="1" required value={margin} onChange={event => { clear(); setMargin(event.target.value) }}/></label>\n');
edit(form,'Marge configurable ajoutée aux minima GTFS.','Minima GTFS conservés, sans marge supplémentaire.');
// Favoris historiques : le champ ancien reste accepté, mais n'influence plus le calcul.
edit('src/services/favoriteJourney.ts',"margin:'120'","margin:'0'");
edit('src/services/favorites.ts','marginSeconds:120, maxTransfers:2','maxTransfers:2');
edit('src/services/favorites.ts','...effective })','...effective, marginSeconds: undefined })');
edit('src/components/FavoriteFields.tsx','<label className="field"><span>Marge de correspondance (secondes)</span><input type="number" min="30" max="1800" value={value.marginSeconds ?? \'\'} onChange={e => onChange({ ...value, marginSeconds: e.target.value ? Number(e.target.value) : undefined })}/></label>','');
// Présentation.
edit('src/components/JourneyResults.tsx','Marge ajoutée : {duration(connection.marginSeconds)}. Temps restant après minimum et marge :','Temps restant après le minimum requis :');
edit('src/components/MobilityResults.tsx','Attente et marges pendant le trajet :','Attente pendant le trajet :');
remove('src/components/MobilityResults.tsx',' Marge avant embarquement : {duration(item.safetySeconds)}.');
edit('src/services/mapGeometry.ts','min, marge incluse','min, sans marge supplémentaire');
edit('src/types/journey.ts','Le minimum GTFS inclut marche et marge ; pas de décomposition inventée.','Le minimum requis retient le maximum du minimum GTFS et de la marche vérifiée.');
// Tests : assertions métier indépendantes de l'ancien paramètre.
editAll('tests/helpers/journeys.mjs','+result.query.marginSeconds','');
edit('tests/helpers/journeys.mjs','marginSeconds:120','marginSeconds:0');
edit('tests/network-routing.test.mjs','+result.query.marginSeconds','');
edit('tests/journey-planner.test.mjs',"test('Correspondance officielle : minimum et marge respectés à la seconde'","test('Correspondance officielle : minimum GTFS sans marge ajouté à la seconde'");
edit('tests/journey-planner.test.mjs','connection.requiredSeconds,300','connection.requiredSeconds,180');
edit('tests/journey-planner.test.mjs',"assert.equal((await p.search(query({marginSeconds:121}))).state,'no_journey')","assert.equal((await p.search(query({marginSeconds:121}))).state,'ok')");
edit('tests/journey-transfer-walk.test.mjs','connection.requiredSeconds,300','connection.requiredSeconds,180');
edit('tests/journey-transfer-walk.test.mjs',"assert.equal((await createJourneyPlanner(f.db).search(query({maxTransfers,marginSeconds:121}))).state,'no_journey')","assert.equal((await createJourneyPlanner(f.db).search(query({maxTransfers,marginSeconds:121}))).state,'ok')");
edit('tests/network-routing.test.mjs',"assert.equal((await planner.search(query({maxTransfers:2,marginSeconds:121}))).state,'no_journey')","assert.equal((await planner.search(query({maxTransfers:2,marginSeconds:121}))).state,'ok')");
edit('tests/network-routing.test.mjs',"assert.equal((await planner.search({...q,marginSeconds:121})).state,'no_journey')","assert.equal((await planner.search({...q,marginSeconds:121})).state,'ok')");
edit('tests/journey-planner.test.mjs',"{marginSeconds:'0'},",'');
edit('tests/preproduction.test.mjs','{marginSeconds:0},','');
edit('tests/mobility.test.mjs','result.itineraries[0].connection.requiredSeconds,300','result.itineraries[0].connection.requiredSeconds,180');
edit('tests/mobility.test.mjs',"assert.equal((await planner.search(query({marginSeconds:121}),[{from:'X',to:'Y',path:path()}])).state,'no_journey')","assert.equal((await planner.search(query({marginSeconds:121}),[{from:'X',to:'Y',path:path()}])).state,'ok')");
edit('tests/mobility.test.mjs','item.safetySeconds,120','item.safetySeconds,0');
edit('tests/mobility.test.mjs','Date.parse(item.transit.departureTime)-300000','Date.parse(item.transit.departureTime)-180000');
edit('tests/mobility.test.mjs',"{...request(),marginSeconds:0},",'');
// Ajustements des trois tests : la marge de 120 s n'entre plus dans les durées.
edit('tests/journey-transfer-walk.test.mjs',"assert.equal((await planner.search(q,verifiedWalk(240))).state,'no_journey')","assert.equal((await planner.search(q,verifiedWalk(240))).state,'ok')")
edit('tests/mobility.test.mjs','result.itineraries[0].durationSeconds,1480','result.itineraries[0].durationSeconds,1360')
edit('tests/mobility.test.mjs','item.durationSeconds,1080','item.durationSeconds,960')
edit('tests/mobility.test.mjs','item.waitingSeconds,120','item.waitingSeconds,0')
// Rejeter les marges négatives et maintenir les vérifications de saisie.
// Validation statique avant toute écriture.
for(const [p,content] of changes){if(!fs.existsSync(path.join(root,p)))throw Error('Fichier absent: '+p); original.set(p,fs.readFileSync(path.join(root,p),'utf8')); if(original.get(p).includes('\r\n'))changes.set(p,content.replace(/\r?\n/g,'\r\n'));}
const stamp=new Date().toISOString().replace(/[-:TZ.]/g,'').slice(0,14),backup=path.join(root,'backup-correctif-marge-'+stamp);fs.mkdirSync(backup,{recursive:true});
for(const [p,s] of original){const dest=path.join(backup,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,s);}
try{
 for(const [p,s] of changes)fs.writeFileSync(path.join(root,p),s);
 console.log('Fichiers modifiés :',changes.size,'; sauvegarde :',backup);
 for(const [cmd,args] of [['npm',['test']],['npm',['run','build']]]){
  console.log('===',cmd,...args,'===');const r=cp.spawnSync(process.platform==='win32'?'npm.cmd':cmd,args,{cwd:root,stdio:'inherit',shell:process.platform==='win32'});if(r.status!==0)throw Error(`${cmd} ${args.join(' ')} a échoué (code ${r.status})`);
 }
 console.log('=== CORRECTIF VALIDE : tests et build réussis ===');
}catch(e){for(const [p,s] of original)fs.writeFileSync(path.join(root,p),s);console.error('=== RESTAURATION AUTOMATIQUE EFFECTUEE ===');throw e;}
}catch(e){console.error('ERREUR :',e.message);process.exitCode=1;}
