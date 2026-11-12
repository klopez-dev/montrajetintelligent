import { test } from 'node:test'
import assert from 'node:assert/strict'
import { gtfsApi } from '../src/services/gtfs.ts'

test('Client : encode les identifiants et conserve le statut théorique de la réponse',async t=>{
  let requested
  t.mock.method(globalThis,'fetch',async url=>{
    requested=new URL(url,'https://example.org')
    return Response.json({status:'connected',data:{passages:[{kind:'theoretical'}],metadata:{validFrom:'2026-11-08'}}})
  })
  const result=await gtfsApi.passages('R&1','S/2','2026-11-08T12:00:00Z')
  assert.equal(requested.pathname,'/api/gtfs/passages')
  assert.equal(requested.searchParams.get('lineId'),'R&1')
  assert.equal(requested.searchParams.get('stopId'),'S/2')
  assert.equal(result.status,'connected')
  assert.equal(result.data.passages[0].kind,'theoretical')
})
test('Client : conserve les listes de quais homonymes sans fusion',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'connected',data:[{id:'TEST1',name:'Homonyme de test'},{id:'TEST2',name:'Homonyme de test'}]}))
  const result=await gtfsApi.searchStops('homonyme','R')
  assert.equal(result.status,'connected');assert.equal(result.data.length,2)
})
test('Client : erreur serveur et réponse statique non JSON deviennent un état indisponible',async t=>{
  t.mock.method(globalThis,'fetch',async()=>Response.json({status:'disconnected',message:'Archive non importée'},{status:503}))
  assert.equal((await gtfsApi.status()).message,'Archive non importée')
  t.mock.method(globalThis,'fetch',async()=>new Response('<html>Page statique</html>'))
  assert.equal((await gtfsApi.status()).status,'disconnected')
})
test('Client : propage les annulations pour éviter les réponses obsolètes',async t=>{
  const controller=new AbortController();controller.abort()
  t.mock.method(globalThis,'fetch',async()=>{throw new DOMException('Abort','AbortError')})
  await assert.rejects(()=>gtfsApi.searchLines('test',controller.signal),{name:'AbortError'})
})
