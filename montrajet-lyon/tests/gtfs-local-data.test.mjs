import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { fileURLToPath } from 'node:url'
import { getMetadata, getPassages, searchLines, searchStops } from '../server/gtfs/repository.ts'
import { addDays, normalizeSearch, serviceActive, serviceDayOrigin } from '../server/gtfs/time.ts'

const path=process.env.GTFS_DB || fileURLToPath(new URL('../.data/gtfs.sqlite',import.meta.url))
test('Archive locale importée : recherche et passages vérifiés contre les lignes GTFS stockées', {skip:!existsSync(path)}, async()=>{
  const sqlite=new DatabaseSync(path,{readOnly:true})
  const db={all:async(sql,params=[])=>sqlite.prepare(sql).all(...params)}
  try {
    const metadata=await getMetadata(db)
    assert.equal(metadata.timezone,'Europe/Paris')
    assert.ok(metadata.files['stop_times.txt']>0)
    const sample=sqlite.prepare(`SELECT t.id AS trip_id,t.service_id,t.route_id,st.stop_id,st.departure,s.* FROM trips t
      JOIN services s ON s.id=t.service_id JOIN stop_times st ON st.trip_id=t.id
      WHERE s.start_date IS NOT NULL AND st.departure IS NOT NULL AND st.pickup_type<>1 LIMIT 1`).get()
    assert.ok(sample)
    const service={id:sample.service_id,startDate:sample.start_date,endDate:sample.end_date,weekdays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>sample[k])}
    let date=sample.start_date>metadata.validFrom?sample.start_date:metadata.validFrom
    let active=false
    for(let i=0;i<31 && date<=metadata.validUntil;i++,date=addDays(date,1)){
      const exception=sqlite.prepare('SELECT exception_type FROM calendar_dates WHERE service_id=? AND date=?').get(sample.service_id,date)
      if(serviceActive(service,date,exception?.exception_type)){active=true;break}
    }
    assert.ok(active)
    const instant=serviceDayOrigin(date,metadata.timezone)+sample.departure*1000-1000
    const result=await getPassages(db,sample.route_id,sample.stop_id,instant)
    assert.ok(result.passages.length>0)
    for(const passage of result.passages){
      const source=sqlite.prepare('SELECT st.*,t.service_id,s.* FROM stop_times st JOIN trips t ON t.id=st.trip_id JOIN services s ON s.id=t.service_id WHERE st.trip_id=? AND st.stop_id=? AND st.departure=?').get(passage.tripId,passage.stopId,passage.gtfsSeconds)
      assert.ok(source)
      const exception=sqlite.prepare('SELECT exception_type FROM calendar_dates WHERE service_id=? AND date=?').get(source.service_id,passage.serviceDate)
      assert.ok(serviceActive({id:source.service_id,startDate:source.start_date,endDate:source.end_date,weekdays:['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(k=>source[k])},passage.serviceDate,exception?.exception_type))
      assert.equal(Date.parse(passage.departureTime),serviceDayOrigin(passage.serviceDate,metadata.timezone)+source.departure*1000)
      assert.equal(passage.kind,'theoretical')
    }
    const route=sqlite.prepare('SELECT short_name FROM routes WHERE id=?').get(sample.route_id)
    assert.ok((await searchLines(db,route.short_name)).length>0)
    const stop=sqlite.prepare('SELECT name FROM stops WHERE id=?').get(sample.stop_id)
    assert.ok((await searchStops(db,normalizeSearch(stop.name),sample.route_id)).length>0)
  } finally { sqlite.close() }
})
