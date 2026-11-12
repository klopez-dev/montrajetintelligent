import test from 'node:test'
import assert from 'node:assert/strict'
import {gzipSync} from 'node:zlib'
import {createHash} from 'node:crypto'
import {compileCatalog,compileDay} from '../scripts/prototype/compile.mjs'
import {StaticDatabase,DayPacket} from '../experiments/hybrid/database.ts'
import {decodeAsset} from '../experiments/hybrid/load.ts'
import {createNetworkPlanner} from '../server/journeys/network.ts'
import {routingDatabase,query} from './helpers/journeys.mjs'
import {serviceDayOrigin} from '../server/gtfs/time.ts'
import {renewGtfs,officialGtfsUrl} from '../scripts/gtfs/renew.mjs'
import {mkdtemp} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const canonical=r=>({state:r.state,itineraries:r.itineraries,scope:r.scope,warnings:r.warnings})
function staticDb(f){const c=compileCatalog(f.sqlite);return new StaticDatabase(c,async date=>new Uint8Array(compileDay(f.sqlite,c,date)).buffer)}
async function compare(f,q){const a=await createNetworkPlanner(f.db).search(q),b=await createNetworkPlanner(staticDb(f)).search(q);assert.deepEqual(canonical(b),canonical(a));return b}
test('Prototype : directions, quais homonymes et deux transferts orientés préservés',async()=>{
 const f=await routingDatabase();try{
 f.sqlite.exec("INSERT INTO stops VALUES('E','TEST CONNECTION','','','',45,4,0)")
 f.trip('A','BUS',[['O',39600],['X',40000]]);f.trip('B','TRAM',[['Y',40300],['Z',40700]]);f.trip('C','METRO',[['E',41000],['D',41600]],'DAILY',{direction:'1'});f.transfer();f.transfer({from:'Z',to:'E'})
 const r=await compare(f,query({maxTransfers:2}));assert.equal(r.itineraries[0].transfers,2);assert.equal(r.itineraries[0].legs[2].directionId,'1')
 await compare(f,query({fromStopId:'D',toStopId:'O',maxTransfers:2}))
 await compare(f,query({mode:'arrival',order:'departure',at:'2026-11-09T11:00:00Z',maxTransfers:2}))
 }finally{f.close()}
})
test('Prototype : calendriers et exceptions priment, aucun service fabriqué un dimanche',async()=>{
 const f=await routingDatabase();try{
 f.trip('A','BUS',[['O',39600],['D',40200]],'WEEKDAYS');f.sqlite.exec("INSERT INTO calendar_dates VALUES('WEEKDAYS','2026-11-09',2),('WEEKDAYS','2026-11-08',1)")
 assert.equal((await compare(f,query({maxTransfers:2}))).itineraries.length,0)
 assert.equal((await compare(f,query({at:'2026-11-08T10:00:00Z',maxTransfers:2}))).itineraries.length,1)
 }finally{f.close()}
})
test('Prototype : après 24 h et changements heure été/hiver, parité avec le SQL indépendant',async()=>{
 const f=await routingDatabase();try{
 f.trip('NIGHT','BUS',[['O',87000],['D',87600]]);f.trip('DST','TRAM',[['O',9000],['D',9600]])
 for(const [date,seconds] of [['2026-11-09',86900],['2026-10-25',8900],['2026-03-29',8900]]){
  const at=new Date(serviceDayOrigin(date,'Europe/Paris')+seconds*1000).toISOString(),r=await compare(f,query({at,maxTransfers:2}));assert.ok(r.itineraries.length)
 }
 }finally{f.close()}
})
test('Prototype : arrêts répétés, séquences, nulls et interdiction de montée ne sont pas simplifiés',async()=>{
 const f=await routingDatabase();try{
 f.trip('LOOP','BUS',[['O',39600],['X',39700],['O',39900],['D',40300]])
 f.sqlite.exec("UPDATE stop_times SET arrival=NULL WHERE trip_id='LOOP' AND sequence=2; UPDATE stop_times SET pickup_type=1 WHERE trip_id='LOOP' AND sequence=1")
 const r=await compare(f,query({maxTransfers:2}));assert.equal(r.itineraries[0].legs[0].from.sequence,3)
 }finally{f.close()}
})
test('Prototype : partition absente ou requête inconnue refusée, jamais de repli SQLite caché',async()=>{
 const f=await routingDatabase();try{
 f.trip('A','BUS',[['O',39600],['D',40200]])
 const db=new StaticDatabase(compileCatalog(f.sqlite),async()=>{throw new Error('missing partition')})
 await assert.rejects(()=>db.all('SELECT secret FROM unknown'),/non prise en charge/)
 await assert.rejects(()=>createNetworkPlanner(db).search(query({maxTransfers:2})),/missing partition/)
 assert.throws(()=>new DayPacket(new ArrayBuffer(27),2,2),/tronquée/)
 }finally{f.close()}
})
test('Prototype : checksum et taille contrôlés avant décodage gzip',async()=>{
 const raw=Buffer.from('TEST ONLY'),data=gzipSync(raw),asset={bytes:data.length,rawBytes:raw.length,sha256:createHash('sha256').update(data).digest('hex')}
 assert.equal(Buffer.from(await decodeAsset(data,asset)).toString(),'TEST ONLY')
 await assert.rejects(()=>decodeAsset(data,{...asset,sha256:'TEST'}),/Empreinte/)
 await assert.rejects(()=>decodeAsset(data,{...asset,rawBytes:1}),/Expansion/)
})
test('Renouvellement : droits/gratuité et compte technique obligatoires avant tout appel',async()=>{
 let calls=0;const fake=async()=>{calls++;throw new Error('Should not be called')}
 await assert.rejects(()=>renewGtfs({},fake),/droits et gratuité/)
 await assert.rejects(()=>renewGtfs({policyConfirmed:true,freeAccessConfirmed:true},fake),/Compte technique/)
 assert.equal(calls,0)
})
test('Renouvellement : HTTP 401 sans retry, URL fixe HTTPS et authentification non divulguée',async()=>{
 let calls=0
 await assert.rejects(()=>renewGtfs({policyConfirmed:true,freeAccessConfirmed:true,username:'TEST_LOGIN',password:'TEST_PASSWORD'},async(url,options)=>{
  calls++;assert.equal(url,officialGtfsUrl);assert.equal(options.redirect,'error');assert.match(options.headers.Authorization,/^Basic /);return new Response('TEST refused',{status:401})
 }),e=>e.message.includes('401')&&!e.message.includes('TEST_PASSWORD'))
 assert.equal(calls,1)
})
test('Renouvellement : limite de taille appliquée avant toute importation',async()=>{
 await assert.rejects(()=>renewGtfs({policyConfirmed:true,freeAccessConfirmed:true,username:'TEST',password:'TEST'},async()=>new Response('TEST',{headers:{'Content-Length':'64000001'}})),/volumineuse/)
})
test('Renouvellement : une page de connexion HTTP 200 ne devient jamais une archive validée',async()=>{
 const outputRoot=await mkdtemp(join(tmpdir(),'montrajet-renew-test-'))
 await assert.rejects(()=>renewGtfs({policyConfirmed:true,freeAccessConfirmed:true,username:'TEST',password:'TEST',outputRoot},async()=>new Response('<html>TEST LOGIN</html>')),/pas un ZIP GTFS/)
})
