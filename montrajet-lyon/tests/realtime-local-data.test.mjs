import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createGrandLyonClient } from '../server/realtime/client.ts'
import { grandLyonConfig } from '../server/realtime/config.ts'
import { handleRealtimeRequest } from '../server/realtime/api.ts'
import { getPassages } from '../server/gtfs/repository.ts'

const path=process.env.GTFS_DB || fileURLToPath(new URL('../.data/gtfs.sqlite',import.meta.url))
for(const lineId of ['C13','C9','C16','125','T3'])test(`${lineId} réel : accès non configuré, correspondance N/D et repli GTFS intact`,{skip:!existsSync(path)},async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  try {
    const db={all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}
    const stop=sqlite.prepare('SELECT stop_id FROM route_stops WHERE route_id=? ORDER BY stop_id LIMIT 1').get(lineId)
    assert.ok(stop)
    let requests=0
    const client=createGrandLyonClient(grandLyonConfig({}),{fetch:async()=>{requests++;throw new Error('No source call without credentials')}})
    const response=await handleRealtimeRequest(new Request(`https://example.org/api/realtime/passages?${new URLSearchParams({lineId,stopId:stop.stop_id})}`),db,client,120000)
    const result=await response.json()
    assert.equal(response.status,200);assert.equal(result.state,'unavailable');assert.equal(result.reason,'authentication_required')
    assert.equal(result.mapping,null);assert.deepEqual(result.estimates,[]);assert.equal(requests,0)
    const gtfs=await getPassages(db,lineId,stop.stop_id,Date.parse('2026-11-09T10:00:00Z'))
    assert.ok(gtfs.passages.length>0)
    assert.ok(gtfs.passages.every(p=>p.kind==='theoretical'))
  } finally {sqlite.close()}
})
