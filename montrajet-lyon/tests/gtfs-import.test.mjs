import { test } from 'node:test'
import assert from 'node:assert/strict'
import { crc32 } from 'node:zlib'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { csvObjects, csvRecords } from '../scripts/gtfs/csv.mjs'
import { openZip } from '../scripts/gtfs/zip.mjs'
import { importGtfs } from '../scripts/gtfs/import.mjs'
import { exportSql } from '../scripts/gtfs/export-sql.mjs'

async function collect(iterator) { const result=[];for await(const row of iterator)result.push(row);return result }
function chunks(text) { return [...Buffer.from(text)].map(byte=>Buffer.from([byte])) }

// Archives de tests uniquement ; aucun faux enregistrement TCL ni donnée servie au navigateur.
function zipFixture(files) {
  const local=[],central=[];let offset=0
  for(const [name,text] of Object.entries(files)){
    const data=Buffer.from(text),filename=Buffer.from(name),crc=crc32(data)
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4)
    header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(filename.length,26)
    const entry=Buffer.alloc(46);entry.writeUInt32LE(0x02014b50);entry.writeUInt16LE(20,4);entry.writeUInt16LE(20,6)
    entry.writeUInt32LE(crc,16);entry.writeUInt32LE(data.length,20);entry.writeUInt32LE(data.length,24);entry.writeUInt16LE(filename.length,28);entry.writeUInt32LE(offset,42)
    local.push(header,filename,data);central.push(entry,filename);offset+=30+filename.length+data.length
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50)
  end.writeUInt16LE(Object.keys(files).length,8);end.writeUInt16LE(Object.keys(files).length,10)
  end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16)
  return Buffer.concat([...local,directory,end])
}
const files={
  'agency.txt':'agency_id,agency_name,agency_url,agency_timezone\nA,TEST ONLY,https://example.org,Europe/Paris\n',
  'routes.txt':'route_id,agency_id,route_short_name,route_type\nR,A,TEST,3\n',
  'stops.txt':'stop_id,stop_name,stop_lat,stop_lon\nS1,Unit test one,45,4\nS2,Unit test two,45,4\n',
  'trips.txt':'route_id,service_id,trip_id,direction_id\nR,W,T,0\n',
  'stop_times.txt':'trip_id,stop_id,stop_sequence,arrival_time,departure_time\nT,S1,1,25:00:00,25:00:00\nT,S2,2,25:05:00,25:05:00\n',
  'calendar_dates.txt':'service_id,date,exception_type\nW,20261109,1\n',
}
async function temporary(fn) {
  const directory=await mkdtemp(join(tmpdir(),'montrajet-gtfs-test-'))
  try { return await fn(directory) }
  finally {
    assert.ok(resolve(directory).startsWith(resolve(tmpdir())+'\\montrajet-gtfs-test-') || resolve(directory).startsWith(resolve(tmpdir())+'/montrajet-gtfs-test-'))
    await rm(directory,{recursive:true})
  }
}
test('CSV en flux : UTF-8 multioctet, BOM, CRLF, guillemets et champs multilignes',async()=>{
  const data='\ufeffid,name\r\n1,"École, ""centre""\nannexe"\r\n'
  assert.deepEqual(await collect(csvObjects(chunks(data),['id','name'],'test.csv')),[{id:'1',name:'École, "centre"\nannexe'}])
})
test('CSV : rejeter les en-têtes absents, doublons, lignes incorrectes et guillemets incomplets',async()=>{
  for(const data of ['', 'id,id\n1,2', 'id\n1,2', 'name\nx', 'id\n"x', 'id\n"x"bad']){
    await assert.rejects(()=>collect(csvObjects(chunks(data),['id'],'test.csv')))
  }
  assert.deepEqual(await collect(csvRecords(chunks('a,b\n1,2'))),[['a','b'],['1','2']])
})
test('ZIP : vérifier le CRC et refuser les basenames ambigus',async()=>temporary(async directory=>{
  const path=join(directory,'test.zip')
  const archive=zipFixture({'agency.txt':'abc'})
  await writeFile(path,archive)
  const zip=await openZip(path)
  assert.equal(Buffer.concat(await collect(zip.read('agency.txt'))).toString(),'abc')
  archive[30+Buffer.byteLength('agency.txt')]=0
  await writeFile(path,archive)
  await assert.rejects(()=>collect(zip.read('agency.txt')),/CRC/)
  await writeFile(path,zipFixture({'a/stops.txt':'x','b/stops.txt':'x'}))
  await assert.rejects(()=>openZip(path),/ambigu/)
}))
test('Import avec calendar_dates seul, fichiers optionnels absents et non-écrasement de la base active',async()=>temporary(async directory=>{
  const archive=join(directory,'test.zip'),outputRoot=join(directory,'output')
  await writeFile(archive,zipFixture(files))
  const first=await importGtfs({archive,outputRoot})
  assert.equal(first.activated,true)
  assert.equal(first.report.validFrom,'2026-11-09')
  assert.equal(first.report.maxDepartureSeconds,90300)
  assert.ok(first.report.warnings.some(w=>w.includes('transfers.txt')))
  const bytes=await readFile(first.activePath)
  const second=await importGtfs({archive,outputRoot})
  assert.equal(second.activated,false)
  assert.deepEqual(await readFile(first.activePath),bytes)
  const db=new DatabaseSync(first.databasePath,{readOnly:true})
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM stop_times').get().n,2)
  db.close()
  const output=join(directory,'sql')
  const exported=await exportSql(first.databasePath,output)
  const restored=new DatabaseSync(':memory:')
  restored.exec('PRAGMA foreign_keys=ON')
  for(let i=0;i<exported.files;i++)restored.exec(await readFile(join(output,`${String(i).padStart(4,'0')}.sql`),'utf8'))
  assert.equal(restored.prepare('SELECT COUNT(*) AS n FROM stop_times').get().n,2)
  restored.close()
  await assert.rejects(()=>exportSql(first.databasePath,output),{code:'EEXIST'})
}))
test('Import : calendrier hebdomadaire, exceptions, correspondances et feed_info présents',async()=>temporary(async directory=>{
  const archive=join(directory,'test.zip')
  await writeFile(archive,zipFixture({...files,
    'calendar.txt':'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nW,1,1,1,1,1,0,0,20261101,20261130\n',
    'transfers.txt':'from_stop_id,to_stop_id,transfer_type,min_transfer_time\nS1,S2,2,60\n',
    'feed_info.txt':'feed_publisher_name,feed_publisher_url,feed_lang,feed_start_date,feed_end_date\nTEST,https://example.org,fr,20261108,20261120\n',
  }))
  const result=await importGtfs({archive,outputRoot:join(directory,'output')})
  assert.equal(result.report.validFrom,'2026-11-08');assert.equal(result.report.validUntil,'2026-11-20')
  assert.equal(result.report.files['transfers.txt'],1)
  assert.deepEqual(result.report.warnings,[])
}))
test('Import : absence d’archive, fichier obligatoire, deux calendriers ou format de fréquence non géré',async()=>temporary(async directory=>{
  const archive=join(directory,'test.zip'),outputRoot=join(directory,'output')
  await assert.rejects(()=>importGtfs({archive,outputRoot}),/Archive absente/)
  for(const missing of ['agency.txt','routes.txt','stops.txt','trips.txt','stop_times.txt','calendar_dates.txt']){
    const subset={...files};delete subset[missing]
    await writeFile(archive,zipFixture(subset))
    await assert.rejects(()=>importGtfs({archive,outputRoot}),/obligatoire/)
  }
  await writeFile(archive,zipFixture({...files,'frequencies.txt':'trip_id,start_time,end_time,headway_secs'}))
  await assert.rejects(()=>importGtfs({archive,outputRoot}),/frequencies/)
}))
test('Import invalide : référence inconnue ou heure impossible ne sont jamais activées',async()=>temporary(async directory=>{
  const archive=join(directory,'test.zip')
  for(const [i,change] of [files['stop_times.txt'].replace('T,S1','T,UNKNOWN'),files['stop_times.txt'].replaceAll('25:00:00','25:99:00')].entries()){
    await writeFile(archive,zipFixture({...files,'stop_times.txt':change}))
    await assert.rejects(()=>importGtfs({archive,outputRoot:join(directory,`output${i}`)}))
    await assert.rejects(()=>readFile(join(directory,`output${i}`,'gtfs.sqlite')), {code:'ENOENT'})
  }
}))
