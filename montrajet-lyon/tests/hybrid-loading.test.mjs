import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile,writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {compileV2} from '../scripts/prototype/compile-v2.mjs'
import {loadStaticDatabase,validateManifest} from '../experiments/hybrid/load.ts'
import {HybridRuntime} from '../experiments/hybrid/runtime.ts'
import {createNetworkPlanner} from '../server/journeys/network.ts'
import {routingDatabase,query,auditJourney} from './helpers/journeys.mjs'
import {serviceDays} from '../server/journeys/schedules.ts'
import {serviceDayOrigin} from '../server/gtfs/time.ts'
import {publishLocal} from '../scripts/prototype/version-store.mjs'
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
async function fixture(){
 const f=await routingDatabase();f.trip('REAL_TEST_ONLY','BUS',[['O',39600],['D',40200]])
 f.sqlite.prepare("UPDATE metadata SET json=json_set(json,'$.sha256',?)").run('0'.repeat(64))
 const directory=await mkdtemp(join(tmpdir(),'mtl-hybrid-v2-')),manifest=await compileV2(f.sqlite,join(directory,'package'),['2026-11-08','2026-11-09','2026-11-10','2026-11-11','2026-11-12'])
 return{...f,manifest,read:file=>readFile(join(directory,'package',file))}
}
test('Hybride v2 : catalogue sans courses globales, parité structurée SQLite',async()=>{
 const f=await fixture();try{const db=await loadStaticDatabase(f.manifest,f.read);assert.equal(db.catalog.trips.length,0);const q=query({maxTransfers:2});assert.deepEqual(canonical(await createNetworkPlanner(db).search(q)),canonical(await createNetworkPlanner(f.db).search(q)))}finally{f.close()}
})
test('Hybride v2 : chargement journalier dédupliqué et LRU de trois entrées',async()=>{
 const f=await fixture();try{const calls=[],db=await loadStaticDatabase(f.manifest,async file=>{calls.push(file);return f.read(file)});await Promise.all([db.packet('2026-11-09'),db.packet('2026-11-09')]);assert.equal(calls.filter(s=>s==='2026-11-09.bin.gz').length,1);for(const date of ['2026-11-10','2026-11-11','2026-11-12'])await db.packet(date);assert.equal(db.packets.size,3);assert.equal(db.packets.has('2026-11-09'),false);db.release();assert.equal(db.packets.size,0)}finally{f.close()}
})
test('Hybride : version, chemins et dates de partitions validés avant lecture',async()=>{
 const f=await fixture();try{for(const bad of [{...f.manifest,format:99},{...f.manifest,catalog:{...f.manifest.catalog,file:'../private'}},{...f.manifest,days:{'2026-02-30':f.manifest.days['2026-11-09']}}])assert.throws(()=>validateManifest(bad));let calls=0;await assert.rejects(()=>loadStaticDatabase({...f.manifest,format:99},async()=>{calls++;return new Uint8Array()}));assert.equal(calls,0)}finally{f.close()}
})
test('Hybride : partition manquante ou corrompue ne produit aucun remplacement',async()=>{
 const f=await fixture();try{const db=await loadStaticDatabase(f.manifest,async file=>file==='2026-11-09.bin.gz'?new Uint8Array(f.manifest.days['2026-11-09'].bytes):f.read(file));await assert.rejects(()=>db.packet('2026-11-09'),/Empreinte/);assert.equal(db.packets.size,0);await assert.rejects(()=>db.packet('2026-11-13'),/non compilé/)}finally{f.close()}
})
test('Hybride runtime : cache chaud ne retélécharge pas les horaires, libération explicite',async()=>{
 const f=await fixture();try{const calls=[],runtime=new HybridRuntime(async file=>{calls.push(file);return new Response(await f.read(file))});const a=await runtime.search(query({maxTransfers:2})),count=calls.length,b=await runtime.search(query({maxTransfers:2}));assert.deepEqual(canonical(a.result),canonical(b.result));assert.equal(calls.length,count+1);assert.equal(calls.at(-1),'manifest.json');await runtime.search(query({at:'2026-11-09T10:30:00Z',maxTransfers:2}));assert.equal(calls.length,count+2);assert.equal(calls.at(-1),'manifest.json');runtime.release();assert.equal(runtime.db,undefined);assert.equal(runtime.planner,undefined)}finally{f.close()}
})
test('Hybride runtime : manifeste changé invalide catalogue, partitions et résultats',async()=>{
 const f=await fixture();try{let revision=0;const runtime=new HybridRuntime(async file=>new Response(file==='manifest.json'?JSON.stringify({...f.manifest,note:String(revision)}):await f.read(file)));const a=await runtime.search(query({maxTransfers:2})),old=runtime.db;revision++;const b=await runtime.search(query({maxTransfers:2}));assert.notEqual(a.version,b.version);assert.notEqual(runtime.db,old);assert.equal(old.packets.size,0);assert.deepEqual(canonical(a.result),canonical(b.result))}finally{f.close()}
})
test('Hybride runtime : erreur HTTP fournisseur explicite, aucune réponse périmée',async()=>{
 const f=await fixture();try{let down=false;const runtime=new HybridRuntime(async file=>down?new Response('offline',{status:503}):new Response(await f.read(file)));await runtime.search(query({maxTransfers:2}));down=true;await assert.rejects(()=>runtime.search(query({maxTransfers:2})),/HTTP 503.*manifest/)}finally{f.close()}
})
test('Hybride runtime : calcul simultané refusé et flux trop volumineux interrompu',async()=>{
 const f=await fixture();try{let unblock;const runtime=new HybridRuntime(()=>new Promise(resolve=>{unblock=resolve}));const pending=runtime.search(query({maxTransfers:2}));await assert.rejects(()=>runtime.search(query({maxTransfers:2})),/déjà en cours/);unblock(new Response('unavailable',{status:503}));await assert.rejects(()=>pending,/503/);const oversized=new HybridRuntime(async()=>new Response('TEST',{headers:{'Content-Length':'1000001'}}));await assert.rejects(()=>oversized.search(query({maxTransfers:2})),/volumineuse/)}finally{f.close()}
})
test('Hybride : publication locale atomique, précondition de version et rollback vérifié',async()=>{
 const f=await fixture();try{
 const root=await mkdtemp(join(tmpdir(),'mtl-hybrid-store-')),source=join(root,'source'),store=join(root,'store')
 await compileV2(f.sqlite,source,['2026-11-09'])
 const a=await publishLocal(source,store);assert.ok(a.current);assert.equal(a.previous,null)
 await writeFile(join(source,'manifest.json'),JSON.stringify({...f.manifest,note:'TEST revision',days:{'2026-11-09':f.manifest.days['2026-11-09']}}))
 // The one-day assets are byte-identical to the fixture's day.
 const b=await publishLocal(source,store,a.current);assert.notEqual(b.current,a.current);assert.equal(b.previous,a.current)
 await assert.rejects(()=>publishLocal(source,store,a.current),/modifiée/)
 const back=await publishLocal(source,store,b.current,true);assert.equal(back.current,a.current)
 const manifest=JSON.parse(await readFile(join(store,b.current,'manifest.json'),'utf8'));await writeFile(join(store,b.current,manifest.catalog.file),'CORRUPT TEST')
 await assert.rejects(()=>publishLocal(source,store,back.current,true));assert.equal(JSON.parse(await readFile(join(store,'current.json'),'utf8')).current,a.current)
 }finally{f.close()}
})
test('Hybride v2 : parité calendrier/exception, minuit, DST et absence de service avec oracle des courses',async()=>{
 const f=await routingDatabase();try{
 f.sqlite.prepare("UPDATE metadata SET json=json_set(json,'$.sha256',?)").run('1'.repeat(64))
 f.trip('NIGHT','BUS',[['O',87000],['D',87600]]);f.trip('DST','TRAM',[['O',9000],['D',9600]])
 f.trip('SCHOOL_TEST_ONLY','BUS',[['O',39600],['D',40200]],'WEEKDAYS');f.sqlite.exec("INSERT INTO calendar_dates VALUES('WEEKDAYS','2026-11-11',2),('WEEKDAYS','2026-11-08',1)")
 const metadata=JSON.parse(f.sqlite.prepare('SELECT json FROM metadata').get().json)
 for(const [date,seconds,mode]of [['2026-11-09',86900,'departure'],['2026-10-25',8900,'departure'],['2026-03-29',9800,'arrival'],['2026-11-11',39500,'departure'],['2026-11-08',39500,'departure']]){
  const at=new Date(serviceDayOrigin(date,'Europe/Paris')+seconds*1000).toISOString(),time=Date.parse(at),days=serviceDays(metadata,mode==='arrival'?time-21600000:time,mode==='arrival'?time:time+21600000).map(d=>d.date),directory=await mkdtemp(join(tmpdir(),'mtl-v2-calendar-')),manifest=await compileV2(f.sqlite,join(directory,'data'),days),db=await loadStaticDatabase(manifest,file=>readFile(join(directory,'data',file))),q=query({at,mode,order:mode==='arrival'?'departure':'arrival',maxTransfers:2}),a=await createNetworkPlanner(f.db).search(q),b=await createNetworkPlanner(db).search(q)
  assert.deepEqual(canonical(b),canonical(a));for(const journey of b.itineraries)auditJourney(f.sqlite,b,journey)
 }
 }finally{f.close()}
})
