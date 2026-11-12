import {DatabaseSync} from 'node:sqlite'
import {mkdir,stat,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {resolve} from 'node:path'
const directory=resolve(`.data/cost-audit-compact-${Date.now()}`);await mkdir(directory)
const source=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true}),target=new DatabaseSync(resolve(directory,'candidate.sqlite')),start=performance.now()
try{
 target.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; BEGIN')
 const tables=['metadata','agency','routes','stops','services','calendar_dates','trips','route_stops','search_tokens','transfers']
 for(const name of tables){
   target.exec(source.prepare('SELECT sql FROM sqlite_master WHERE type=\'table\' AND name=?').get(name).sql)
   const columns=source.prepare(`PRAGMA table_info("${name}")`).all().map(c=>c.name),insert=target.prepare(`INSERT INTO "${name}" VALUES(${columns.map(()=>'?').join(',')})`)
   for(const row of source.prepare(`SELECT * FROM "${name}"`).iterate())insert.run(...columns.map(c=>row[c]))
 }
 const trips=source.prepare('SELECT id FROM trips ORDER BY id').all().map(r=>r.id),stops=source.prepare('SELECT id FROM stops ORDER BY id').all().map(r=>r.id),tripMap=new Map(trips.map((id,i)=>[id,i])),stopMap=new Map(stops.map((id,i)=>[id,i]))
 target.exec('CREATE TABLE audit_trip_keys(idx INTEGER PRIMARY KEY,gtfs_id TEXT NOT NULL UNIQUE); CREATE TABLE audit_stop_keys(idx INTEGER PRIMARY KEY,gtfs_id TEXT NOT NULL UNIQUE); CREATE TABLE audit_stop_times(trip_idx INTEGER NOT NULL,stop_idx INTEGER NOT NULL,sequence INTEGER NOT NULL,arrival INTEGER,departure INTEGER,headsign TEXT NOT NULL,pickup_type INTEGER NOT NULL,drop_off_type INTEGER NOT NULL,timepoint INTEGER NOT NULL,PRIMARY KEY(trip_idx,sequence)) WITHOUT ROWID')
 const ti=target.prepare('INSERT INTO audit_trip_keys VALUES(?,?)'),si=target.prepare('INSERT INTO audit_stop_keys VALUES(?,?)');trips.forEach((id,i)=>ti.run(i,id));stops.forEach((id,i)=>si.run(i,id))
 const insert=target.prepare('INSERT INTO audit_stop_times VALUES(?,?,?,?,?,?,?,?,?)'),inputHash=createHash('sha256');let count=0
 for(const r of source.prepare('SELECT * FROM stop_times ORDER BY trip_id,sequence').iterate()){
   const t=tripMap.get(r.trip_id),s=stopMap.get(r.stop_id);if(t===undefined||s===undefined)throw new Error('Invalid source reference')
   const row=[r.trip_id,r.stop_id,r.sequence,r.arrival,r.departure,r.headsign,r.pickup_type,r.drop_off_type,r.timepoint];inputHash.update(JSON.stringify(row)+'\n')
   insert.run(t,s,r.sequence,r.arrival,r.departure,r.headsign,r.pickup_type,r.drop_off_type,r.timepoint);count++
 }
 target.exec('CREATE INDEX audit_departures ON audit_stop_times(stop_idx,departure,trip_idx)')
 for(const r of source.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL AND tbl_name<>'stop_times'").iterate())target.exec(r.sql)
 target.exec('COMMIT; PRAGMA optimize')
 const outputHash=createHash('sha256');let copied=0
 for(const r of target.prepare('SELECT * FROM audit_stop_times ORDER BY trip_idx,sequence').iterate()){outputHash.update(JSON.stringify([trips[r.trip_idx],stops[r.stop_idx],r.sequence,r.arrival,r.departure,r.headsign,r.pickup_type,r.drop_off_type,r.timepoint])+'\n');copied++}
 const originalSha=inputHash.digest('hex'),copySha=outputHash.digest('hex')
 if(originalSha!==copySha||count!==copied)throw new Error('Lossless round-trip audit failed')
 const objects=target.prepare('SELECT name,sum(pgsize) bytes FROM dbstat GROUP BY name ORDER BY bytes DESC').all()
 const report={checkedAt:new Date().toISOString(),feedSha256:JSON.parse(source.prepare('SELECT json FROM metadata WHERE id=1').get().json).sha256,count,copied,originalSha,copySha,sqliteBytes:(await stat(resolve(directory,'candidate.sqlite'))).size,objects,totalMs:performance.now()-start,status:'passed',notes:['Offline audit candidate only. Separate new directory, no active file modified.','All non-stop_times tables retained; official string IDs preserved in reversible dictionaries. Full stop_times reconstruction SHA-256 checked.','Not compatible with current SQL adapter without query rewrite. No D1 import or billing measurement performed.']}
 await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(directory);console.log(JSON.stringify({bytes:report.sqliteBytes,records:count,roundTrip:originalSha===copySha,totalMs:report.totalMs}))
}finally{source.close();target.close()}
