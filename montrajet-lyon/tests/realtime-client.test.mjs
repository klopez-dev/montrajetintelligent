import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createGrandLyonClient } from '../server/realtime/client.ts'
import { grandLyonConfig } from '../server/realtime/config.ts'
import { handleRealtimeRequest,realtimePassages } from '../server/realtime/api.ts'
import { getPassages } from '../server/gtfs/repository.ts'
import { edgeSnapshotStore } from '../server/realtime/edge-cache.ts'
import { provider,respond,config,database,instant,row } from './helpers/realtime.mjs'

test('HTTP 500 et panne reseau : repli sans passage invente',async t=>{
  const unavailable=await provider(t,(_req,res)=>respond(res,[],500))
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:unavailable.endpoint})
  const db=await database();t.after(()=>db.sqlite.close())
  const result=await realtimePassages(db,client,'TEST_LINE','TEST_STOP',120000,instant)
  assert.equal(result.state,'unavailable')
  assert.deepEqual(result.estimates,[])
  const network=createGrandLyonClient(config(),{now:()=>instant,fetch:async()=>{throw Error('offline')}})
  assert.equal((await network.get('TEST_STOP')).reason,'provider_unavailable')
})

test('Statut : passages et itineraires ont des verrous distincts',async()=>{
  const db=await database()
  try {
    const client={get:async()=>{throw Error('unexpected provider call')}}
    const request=new Request('https://example.org/api/realtime/status')
    const stopReady=await (await handleRealtimeRequest(request,db,client,120000,config({mappingConfirmed:false}))).json()
    assert.equal(stopReady.state,'ready_to_query')
    assert.equal(stopReady.itineraryEnrichment,'disabled')
    const stopBlocked=await (await handleRealtimeRequest(request,db,client,120000,config({stopPassagesConfirmed:false,mappingConfirmed:true}))).json()
    assert.equal(stopBlocked.state,'disabled')
    assert.equal(stopBlocked.itineraryEnrichment,'disabled')
  } finally {db.sqlite.close()}
})

test('Validation locale : une seule tentative fournisseur, sans ouvrir le niveau itineraires',async t=>{
  let now=instant
  const mock=await provider(t,(_req,res)=>respond(res))
  const local=config({policyConfirmed:false,stopPassagesConfirmed:false,mappingConfirmed:false,localValidationOnce:true,cacheTtlMs:60000})
  const client=createGrandLyonClient(local,{now:()=>now,endpointForTest:mock.endpoint})
  const first=await client.get('TEST_STOP')
  assert.equal(first.reason,'fetched')
  now+=121000
  const second=await client.get('TEST_STOP')
  assert.equal(second.reason,'validation_budget_exhausted')
  assert.equal(mock.requests.length,1)
  const db=await database();t.after(()=>db.sqlite.close())
  const status=await (await handleRealtimeRequest(new Request('https://example.org/api/realtime/status'),db,client,120000,local)).json()
  assert.equal(status.reason,'local_validation_once')
  assert.equal(status.itineraryEnrichment,'disabled')
})

test('Sans authentification, politique ou contrat confirmé : aucun appel fournisseur',async()=>{
  for(const [changes,reason] of [[{username:''},'authentication_required'],[{policyConfirmed:false},'policy_unconfirmed'],[{stopPassagesConfirmed:false},'mapping_unconfirmed']]){
    let count=0
    const client=createGrandLyonClient(config(changes),{fetch:async()=>{count++;throw new Error('Must not call')}})
    assert.equal((await client.get('TEST_STOP')).reason,reason);assert.equal(count,0)
  }
})
test('Configuration TTL et intervalle cohérents ; valeurs invalides refusées',()=>{
  const result=grandLyonConfig({GRANDLYON_MIN_INTERVAL_MS:'90000',GRANDLYON_CACHE_TTL_MS:'60000'})
  assert.equal(result.cacheTtlMs,90000)
  assert.throws(()=>grandLyonConfig({GRANDLYON_TIMEOUT_MS:'NaN'}))
})
test('HTTP réel local : auth serveur, filtre exact du quai et JSON officiel attendu',async t=>{
  const mock=await provider(t,(_req,res)=>respond(res))
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  const r=await client.get('TEST_STOP')
  assert.equal(r.reason,'fetched');assert.equal(r.snapshot.rows.length,1)
  const url=new URL(mock.requests[0].url,'http://example.org')
  assert.equal(url.searchParams.get('id__eq'),'TEST_STOP')
  assert.equal(mock.requests[0].authorization,`Basic ${Buffer.from('TEST_USER:TEST_PASSWORD').toString('base64')}`)
})
test('Cache et coalescence : vingt demandes concurrentes ne font qu’une requête HTTP',async t=>{
  const mock=await provider(t,(_req,res)=>setTimeout(()=>respond(res),25))
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  await Promise.all(Array.from({length:20},()=>client.get('TEST_STOP')))
  await client.get('TEST_STOP');assert.equal(mock.requests.length,1)
})
test('Limite globale entre requêtes, y compris pour des quais différents',async t=>{
  const mock=await provider(t,(_req,res)=>respond(res))
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  await client.get('TEST_STOP')
  assert.equal((await client.get('TEST_OTHER_QUAY')).reason,'cooldown')
  assert.equal(mock.requests.length,1)
})
for(const code of [401,403])test(`HTTP ${code} arrête les tentatives, sans chercher un autre endpoint`,async t=>{
  let now=instant
  const mock=await provider(t,(_req,res)=>respond(res,[],code))
  const client=createGrandLyonClient(config(),{now:()=>now,endpointForTest:mock.endpoint})
  assert.equal((await client.get('TEST_STOP')).reason,'access_denied')
  now+=3600000;await client.get('TEST_STOP');assert.equal(mock.requests.length,1)
})
test('429 Retry-After est respecté au-delà du TTL technique',async t=>{
  let now=instant
  const mock=await provider(t,(_req,res)=>respond(res,[],429,{'Retry-After':'180'}))
  const client=createGrandLyonClient(config(),{now:()=>now,endpointForTest:mock.endpoint})
  assert.equal((await client.get('TEST_STOP')).reason,'rate_limited')
  now+=61000;assert.equal((await client.get('TEST_STOP')).reason,'cooldown');assert.equal(mock.requests.length,1)
  now+=120000;await client.get('TEST_STOP');assert.equal(mock.requests.length,2)
})
test('Redirection refusée : ne pas transmettre Authorization à une autre URL',async t=>{
  const mock=await provider(t,(_req,res)=>{res.writeHead(302,{Location:'https://example.org/never-called'});res.end()})
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  assert.equal((await client.get('TEST_STOP')).reason,'provider_unavailable');assert.equal(mock.requests.length,1)
})
test('Timeout HTTP : sortie bornée, pas de blocage de la recherche GTFS',async t=>{
  const mock=await provider(t,()=>{})
  const client=createGrandLyonClient(config({timeoutMs:100}),{now:()=>instant,endpointForTest:mock.endpoint})
  const start=Date.now();assert.equal((await client.get('TEST_STOP')).reason,'timeout');assert.ok(Date.now()-start<2000)
})
for(const [name,handler,reason] of [
  ['HTML',(_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>Error</html>')},'invalid_response'],
  ['JSON malformé',(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{')},'invalid_response'],
  ['réponse paginée incomplète',(_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({values:[row()],nb_results:2}))},'incomplete_response'],
  ['ligne incomplète',(_req,res)=>respond(res,[{id:'TEST_STOP'}]),'invalid_response'],
  ['mauvais quai',(_req,res)=>respond(res,[row({id:'TEST_OTHER_QUAY'})]),'invalid_response'],
])test(`Réponse ${name} : refuser le snapshot`,async t=>{
  const mock=await provider(t,handler)
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  const result=await client.get('TEST_STOP');assert.equal(result.reason,reason);assert.equal(result.snapshot,null)
})
test('Une estimation valide en cache survit à une panne, puis expire sans substitution',async t=>{
  let now=instant
  const mock=await provider(t,(_req,res,count)=>respond(res,count===1?[row()]:[],count===1?200:503))
  const client=createGrandLyonClient(config(),{now:()=>now,endpointForTest:mock.endpoint})
  const db=await database();t.after(()=>db.sqlite.close())
  const first=await realtimePassages(db,client,'TEST_LINE','TEST_STOP',120000,now)
  assert.equal(first.state,'available')
  now+=61000
  const second=await realtimePassages(db,client,'TEST_LINE','TEST_STOP',120000,now)
  assert.equal(second.state,'available');assert.deepEqual(second.estimates,first.estimates)
  now+=61000
  const third=await realtimePassages(db,client,'TEST_LINE','TEST_STOP',120000,now)
  assert.equal(third.state,'stale');assert.deepEqual(third.estimates,[])
  assert.ok((await getPassages(db,'TEST_LINE','TEST_STOP',now)).passages.length>0)
})
test('Un snapshot plus ancien ne remplace pas le cache récent',async t=>{
  let now=instant
  const mock=await provider(t,(_req,res,count)=>respond(res,[row(count===1?{}:{last_update_fme:'2026-11-09T09:58:00Z',heurepassage:'2026-11-09T10:06:00Z'})]))
  const client=createGrandLyonClient(config(),{now:()=>now,endpointForTest:mock.endpoint})
  const first=await client.get('TEST_STOP');now+=61000
  const second=await client.get('TEST_STOP');assert.equal(second.reason,'regressed_data');assert.deepEqual(second.snapshot,first.snapshot)
})
test('Une réponse vide non datée ne renouvelle pas artificiellement un cache valide',async t=>{
  let now=instant
  const mock=await provider(t,(_req,res,count)=>respond(res,count===1?[row()]:[]))
  const client=createGrandLyonClient(config(),{now:()=>now,endpointForTest:mock.endpoint})
  const first=await client.get('TEST_STOP');now+=61000
  const second=await client.get('TEST_STOP');assert.equal(second.reason,'empty_update');assert.deepEqual(second.snapshot,first.snapshot)
})
test('T reçu du fournisseur : aucune estimation, le GTFS est toujours disponible',async t=>{
  const mock=await provider(t,(_req,res)=>respond(res,[row({type:'T'})]))
  const client=createGrandLyonClient(config(),{now:()=>instant,endpointForTest:mock.endpoint})
  const db=await database();t.after(()=>db.sqlite.close())
  const rt=await realtimePassages(db,client,'TEST_LINE','TEST_STOP',120000,instant)
  assert.equal(rt.state,'available');assert.equal(rt.estimates[0].kind,'theoretical')
  assert.ok((await getPassages(db,'TEST_LINE','TEST_STOP',instant)).passages.length>0)
})
test('Endpoint applicatif : méthodes et quais incorrects refusés avant appel fournisseur',async t=>{
  const db=await database();t.after(()=>db.sqlite.close())
  let calls=0;const client={get:async()=>{calls++;throw new Error('Not expected')}}
  for(const [url,method,code] of [['/api/realtime/passages','POST',405],['/api/realtime/passages','GET',400],['/api/realtime/passages?lineId=TEST_LINE&stopId=TEST_OTHER_QUAY','GET',400]]){
    assert.equal((await handleRealtimeRequest(new Request('https://example.org'+url,{method}),db,client,120000)).status,code)
  }
  assert.equal(calls,0)
})
test('Cache Cloudflare : adaptateur générique sans dépendance payante et sans secret dans la clé',async()=>{
  const entries=new Map()
  const store=edgeSnapshotStore({match:async request=>entries.get(request.url)?.clone(),put:async(request,response)=>entries.set(request.url,response)},120000)
  const snapshot={stopId:'TEST_STOP',fetchedAt:instant,rows:[row()]}
  await store.put(snapshot);assert.deepEqual(await store.get('TEST_STOP'),snapshot)
  assert.ok([...entries.keys()].every(key=>!key.includes('PASSWORD')))
})
