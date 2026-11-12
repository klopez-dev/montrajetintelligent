import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fetchRealtime,preferFreshResult,withoutCoveredTrips } from '../src/services/realtime.ts'

test('Une course actualisee ne double pas le GTFS et revient si la source expire',()=>{
  const gtfs=[{tripId:'A'},{tripId:'B'}]
  assert.deepEqual(withoutCoveredTrips(gtfs,['A']),[gtfs[1]])
  assert.deepEqual(withoutCoveredTrips(gtfs,[]),gtfs)
})

const now=Date.parse('2026-11-09T10:00:00Z')
const estimate={tripId:'TEST_TRIP',lineId:'TEST_LINE',stopId:'TEST_STOP',directionId:'0',headsign:'TEST DESTINATION',estimatedTime:'2026-11-09T10:05:00Z',sourceUpdatedAt:'2026-11-09T09:59:50Z',validUntil:'2026-11-09T10:01:50Z',kind:'estimated'}
const result=(state='available',estimates=[estimate])=>({state,reason:'TEST',message:'TEST ONLY',checkedAt:'2026-11-09T10:00:00Z',fetchedAt:'2026-11-09T10:00:00Z',sourceUpdatedAt:estimates[0]?.sourceUpdatedAt||null,estimates,mapping:null})
test('Un échec backend ne supprime pas une estimation encore fraîche côté page',()=>{
  const preserved=preferFreshResult(result(),result('unavailable',[]),now)
  assert.equal(preserved.state,'available');assert.equal(preserved.estimates[0].validUntil,estimate.validUntil)
})
test('Une estimation expirée ne réapparaît pas lors du repli côté page',()=>{
  const unavailable=result('unavailable',[])
  assert.equal(preferFreshResult(result(),unavailable,now+120000),unavailable)
})
test('Une mise à jour plus ancienne ne remplace pas une estimation valide',()=>{
  const old={...estimate,estimatedTime:'2026-11-09T10:03:00Z',sourceUpdatedAt:'2026-11-09T09:58:00Z',validUntil:'2026-11-09T10:00:00Z'}
  const next={...estimate,tripId:'TEST_OTHER_TRIP',estimatedTime:'2026-11-09T10:06:00Z'}
  const merged=preferFreshResult(result(),result('available',[old,next]),now)
  assert.equal(merged.estimates[0].estimatedTime,estimate.estimatedTime)
  assert.equal(merged.estimates.length,2)
})
test('Réponse backend incomplète : aucun plantage et aucun faux temps réel',async t=>{
  for(const estimates of [[null],[{}],[{...estimate,kind:'unknown'}]]){
    const mock=t.mock.method(globalThis,'fetch',async()=>Response.json(result('available',estimates)))
    const response=await fetchRealtime('TEST_LINE','TEST_STOP',new AbortController().signal)
    assert.equal(response.state,'unavailable');assert.deepEqual(response.estimates,[])
    mock.mock.restore()
  }
})
test('Le navigateur ne contacte que le backend local et ne transmet aucun identifiant fournisseur',async t=>{
  let sent
  t.mock.method(globalThis,'fetch',async(url,options)=>{sent={url,options};return Response.json(result('unavailable',[]))})
  await fetchRealtime('TEST_LINE','TEST_STOP',new AbortController().signal)
  assert.ok(sent.url.startsWith('/api/realtime/passages?'))
  assert.equal('Authorization' in sent.options.headers,false)
})
