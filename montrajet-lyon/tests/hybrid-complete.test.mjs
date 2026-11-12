import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,readFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {compileFull} from '../scripts/prototype/compile-full.mjs'
import {loadStaticDatabase,validateManifest} from '../experiments/hybrid/load.ts'
import {createJourneyPlanner} from '../server/journeys/planner.ts'
import {engineSelector} from '../experiments/hybrid/engine-selector.ts'
import {HybridClient} from '../experiments/hybrid/client.ts'
import {geographicProxy} from '../experiments/hybrid/geographic-rpc.ts'
import {HybridRuntime} from '../experiments/hybrid/runtime.ts'
import {compileV2} from '../scripts/prototype/compile-v2.mjs'
import {routingDatabase,query,auditJourney} from './helpers/journeys.mjs'
const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
async function compiled(f){
 f.sqlite.prepare("UPDATE metadata SET json=json_set(json,'$.sha256',?,'$.validFrom','2026-11-08','$.validUntil','2026-11-12')").run('2'.repeat(64))
 const root=await mkdtemp(join(tmpdir(),'mtl-hybrid-full-')),directory=join(root,'data'),result=await compileFull(f.sqlite,directory),calls=[]
 return{...result,db:await loadStaticDatabase(result.manifest,async file=>{calls.push(file);return readFile(join(directory,file))}),calls}
}
test('Compilation complète : chaque date, exception et déduplication exactes',async()=>{
 const f=await routingDatabase();try{
 f.trip('DAILY','BUS',[['O',39600],['D',40200]]);f.sqlite.exec("INSERT INTO calendar_dates VALUES('DAILY','2026-11-11',2)")
 const c=await compiled(f);assert.equal(Object.keys(c.manifest.days).length,5);assert.equal(c.manifest.days['2026-11-08'].sha256,c.manifest.days['2026-11-09'].sha256);assert.notEqual(c.manifest.days['2026-11-11'].sha256,c.manifest.days['2026-11-09'].sha256)
 const a=await c.db.packet('2026-11-08'),count=c.calls.length,b=await c.db.packet('2026-11-09');assert.equal(a,b);assert.equal(c.calls.length,count)
 for(const date of Object.keys(c.manifest.days)){const q=query({at:date+'T10:00:00Z',maxTransfers:2}),actual=await createJourneyPlanner(c.db).search(q),expected=await createJourneyPlanner(f.db).search(q);assert.deepEqual(canonical(actual),canonical(expected))}
 }finally{f.close()}
})
test('Adaptateur historique : parité directe, transfert, marges, arrivée, boucle et null',async()=>{
 const f=await routingDatabase();try{
 f.connection();f.trip('LOOP','BUS',[['O',39700],['X',39800],['O',39900],['D',40900]],'DAILY',{direction:'1'});f.sqlite.exec("UPDATE stop_times SET arrival=NULL WHERE trip_id='LOOP' AND sequence=2")
 const c=await compiled(f)
 for(const params of [{},{mode:'arrival',order:'departure',at:'2026-11-09T11:00:00Z'},{marginSeconds:600},{fromStopId:'D',toStopId:'O'},{order:'transfers'},{order:'duration'}]){
  const q=query({...params,maxTransfers:1}),a=await createJourneyPlanner(f.db).search(q),b=await createJourneyPlanner(c.db).search(q);assert.deepEqual(canonical(b),canonical(a));for(const journey of b.itineraries)auditJourney(f.sqlite,b,journey)
 }
 }finally{f.close()}
})
test('Partitions partagées : un même nom ne peut pas désigner deux contenus',async()=>{
 const f=await routingDatabase();try{f.trip('A','BUS',[['O',39600],['D',40200]]);const c=await compiled(f);const bad=structuredClone(c.manifest);bad.days['2026-11-09'].sha256='a'.repeat(64);assert.throws(()=>validateManifest(bad),/mélangées/)}finally{f.close()}
})
test('Sélection moteur : SQLite par défaut, expérimental interdit sans activation explicite',async()=>{
 let sqlite=0,hybrid=0;const factory=enabled=>engineSelector(async()=>{sqlite++;return'old'},async()=>{hybrid++;return'new'},enabled)
 assert.equal(await factory(false).search(query()),'old');await assert.rejects(()=>factory(false).search(query(),'hybrid'),/désactivé/);assert.equal(hybrid,0);assert.equal(sqlite,1);assert.equal(await factory(true).search(query(),'hybrid'),'new');assert.equal(sqlite,1)
})
test('Client Worker : annulation et dernière recherche gagnante, réponse ancienne ignorée',async()=>{
 const original=globalThis.Worker,instances=[];class FakeWorker{constructor(){instances.push(this)}postMessage(message){this.message=message}terminate(){this.terminated=true}}
 globalThis.Worker=FakeWorker
 try{const client=new HybridClient(),a=client.search(query()),rejected=assert.rejects(()=>a,/annulée/),old=instances[0],b=client.search(query({at:'2026-11-10T10:00:00Z'})),current=instances[1];assert.equal(old.terminated,true);old.onmessage({data:{id:old.message.id,result:'OLD'}});current.onmessage({data:{id:current.message.id,result:'LATEST'}});assert.equal((await b).result,'LATEST');await rejected;const abort=new AbortController(),pending=client.search(query(),abort.signal),failure=assert.rejects(()=>pending,/annulée/);abort.abort();await failure;assert.equal(client.worker,undefined)}finally{globalThis.Worker=original}
})
test('Relais IGN : requête, trace et signal conservés, erreur non masquée',async()=>{
 const signal=new AbortController().signal,trace={geocodingMs:0,walkingMs:0,queueMs:0,upstreamRequests:0,cacheHits:0,coalesced:0};const provider=geographicProxy(async(method,args,s)=>{assert.equal(method,'addresses');assert.deepEqual(args,['TEST ONLY']);assert.equal(s,signal);return{value:[],trace:{...trace,upstreamRequests:1}}});await provider.addresses('TEST ONLY',trace,signal);assert.equal(trace.upstreamRequests,1);await assert.rejects(()=>geographicProxy(async()=>{throw new Error('IGN HTTP 503')}).addresses('TEST'),/IGN HTTP 503/)
})
test('Version légère : cache réutilisé, manifeste incohérent refusé et fournisseur indisponible explicite',async()=>{
 const f=await routingDatabase();try{
 f.trip('A','BUS',[['O',39600],['D',40200]]);f.sqlite.prepare("UPDATE metadata SET json=json_set(json,'$.sha256',?)").run('3'.repeat(64));const root=await mkdtemp(join(tmpdir(),'mtl-pointer-')),directory=join(root,'data');await compileV2(f.sqlite,directory,['2026-11-08','2026-11-09','2026-11-10']);let altered=false,unavailable=false;const calls=[]
 const runtime=new HybridRuntime(async file=>{calls.push(file);if(file==='version.json'&&unavailable)return new Response('TEST',{status:503});const bytes=await readFile(join(directory,file));return new Response(file==='version.json'&&altered?JSON.stringify({...JSON.parse(bytes),manifestSha256:'f'.repeat(64)}):bytes)},undefined,true)
 const q=query({maxTransfers:2}),a=await runtime.search(q),count=calls.length,b=await runtime.search(q);assert.deepEqual(canonical(a.result),canonical(b.result));assert.deepEqual(calls.slice(count),['version.json']);altered=true;await assert.rejects(()=>runtime.search(q),/version annoncée/);unavailable=true;await assert.rejects(()=>runtime.search(q),/HTTP 503/)
 }finally{f.close()}
})
test('Partition partagée échouée : toutes les références invalidées, nouvel essai autorisé',async()=>{
 const f=await routingDatabase();try{
 f.trip('A','BUS',[['O',39600],['D',40200]]);const c=await compiled(f);let attempts=0;const original=c.db.readDay;c.db.readDay=async date=>{if(++attempts===1)throw new Error('TEST partition unavailable');return original(date)}
 const results=await Promise.allSettled([c.db.packet('2026-11-08'),c.db.packet('2026-11-09')]);assert.ok(results.every(r=>r.status==='rejected'));assert.equal(c.db.packets.size,0);assert.ok(await c.db.packet('2026-11-09'));assert.equal(attempts,2)
 }finally{f.close()}
})
test('Mémoire insuffisante simulée : constructeur Worker refusé, aucune réponse fabriquée',async()=>{
 const original=globalThis.Worker;globalThis.Worker=class{constructor(){throw new DOMException('TEST insufficient memory','QuotaExceededError')}}
 try{const client=new HybridClient();await assert.rejects(()=>client.search(query()),/insufficient memory/);assert.equal(client.worker,undefined)}finally{globalThis.Worker=original}
})
