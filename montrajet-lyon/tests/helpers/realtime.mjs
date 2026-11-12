import { DatabaseSync } from 'node:sqlite'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { grandLyonConfig } from '../../server/realtime/config.ts'

// Contrat hypothétique en attente de validation fournisseur. Fixtures exclusivement
// unitaires : identifiants TEST_ ; jamais chargées dans la base TCL ou l'interface.
export const instant = Date.parse('2026-11-09T10:00:00Z')
export function row(changes = {}) {
  return { id:'TEST_STOP',ligne:'TEST_LINE',direction:'TEST DESTINATION',type:'E',heurepassage:'2026-11-09T10:05:00Z',idtarretdestination:'TEST_DEST',coursetheorique:'TEST_TRIP',gid:1,last_update_fme:'2026-11-09T09:59:50Z',...changes }
}
export function config(changes = {}) {
  return {...grandLyonConfig({}),username:'TEST_USER',password:'TEST_PASSWORD',policyConfirmed:true,mappingConfirmed:true,stopPassagesConfirmed:true,...changes}
}
export async function database() {
  const sqlite = new DatabaseSync(':memory:')
  sqlite.exec(await readFile(new URL('../../server/gtfs/schema.sql',import.meta.url),'utf8'))
  sqlite.exec(`INSERT INTO agency VALUES('TEST_A','TEST','https://example.org','Europe/Paris');
    INSERT INTO routes VALUES('TEST_LINE','TEST_A','TEST','TEST',3);
    INSERT INTO stops VALUES('TEST_STOP','TEST STOP','','','',45,4,0),('TEST_OTHER_QUAY','TEST STOP','','','',45,4,0),('TEST_DEST','TEST DESTINATION','','','',45,4,0);
    INSERT INTO services VALUES('TEST_SERVICE','2026-11-01','2026-11-30',1,1,1,1,1,1,1);
    INSERT INTO trips VALUES('TEST_TRIP','TEST_LINE','TEST_SERVICE','0','TEST DESTINATION');
    INSERT INTO stop_times VALUES('TEST_TRIP','TEST_STOP',1,39900,39900,'',0,0,1),('TEST_TRIP','TEST_DEST',2,40500,40500,'',1,0,1);
    INSERT INTO route_stops VALUES('TEST_LINE','TEST_STOP'),('TEST_LINE','TEST_DEST');`)
  sqlite.prepare('INSERT INTO metadata VALUES(1,?)').run(JSON.stringify({schemaVersion:1,timezone:'Europe/Paris',validFrom:'2026-11-01',validUntil:'2026-11-30',maxDepartureSeconds:40500,files:{},warnings:[],importedAt:'2026-11-01T00:00:00Z',sha256:'TEST',sourceUrl:'https://example.org'}))
  return { sqlite, all:async(sql,params=[])=>sqlite.prepare(sql).all(...params) }
}
/** Vrai serveur HTTP éphémère : exerce fetch, filtre, auth, JSON et timeout réels. */
export async function provider(t, handler) {
  const requests=[]
  const server=createServer((req,res)=>{
    requests.push({url:req.url,method:req.method,authorization:req.headers.authorization})
    handler(req,res,requests.length)
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))})
  return {requests,endpoint:`http://127.0.0.1:${server.address().port}/official-test-resource`}
}
export function respond(res, rows=[row()], status=200, headers={}) {
  res.writeHead(status,{'Content-Type':'application/json',...headers})
  res.end(JSON.stringify({values:rows,nb_results:rows.length}))
}
