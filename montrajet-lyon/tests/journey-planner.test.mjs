import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJourneyPlanner } from '../server/journeys/planner.ts'
import { handleJourneyRequest } from '../server/journeys/api.ts'
import { routingDatabase,query,auditJourney } from './helpers/journeys.mjs'
const setup=async t=>{const f=await routingDatabase();t.after(f.close);return f}
test('Direct multimodal : bus, métro, tramway et funiculaire suivent les mêmes horaires GTFS',async t=>{
  const f=await setup(t)
  for(const [index,route] of ['BUS','TRAM','METRO','FUNICULAR'].entries())f.trip(`T${index}`,route,[['O',39600+index*60],['D',40800+index*60]])
  const r=await createJourneyPlanner(f.db).search(query())
  assert.equal(r.state,'ok');assert.deepEqual(new Set(r.itineraries.map(j=>j.legs[0].routeType)),new Set([3,0,1,7]))
  r.itineraries.forEach(j=>auditJourney(f.sqlite,r,j))
})
test('Correspondance officielle : minimum GTFS sans marge ajouté à la seconde',async t=>{
  const f=await setup(t);f.connection()
  const p=createJourneyPlanner(f.db),r=await p.search(query())
  assert.equal(r.itineraries.length,1);assert.equal(r.itineraries[0].connection.requiredSeconds,180)
  assert.equal(r.itineraries[0].connection.walkingSeconds,null)
  auditJourney(f.sqlite,r,r.itineraries[0])
  assert.equal((await p.search(query({marginSeconds:121}))).state,'ok')
})
test('Même quai : marche interarrêt nulle explicitement qualifiée d’hypothèse',async t=>{
  const f=await setup(t);f.connection({samePlatform:true})
  const r=await createJourneyPlanner(f.db).search(query())
  assert.equal(r.itineraries[0].connection.source,'same_platform_assumption')
  auditJourney(f.sqlite,r,r.itineraries[0])
})
test('Quais homonymes sans lien : aucune marche supposée',async t=>{
  const f=await setup(t);f.connection({noTransfer:true})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Lien officiel inverse uniquement : ne pas le symétriser',async t=>{
  const f=await setup(t);f.connection({noTransfer:true});f.transfer({from:'Y',to:'X'})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Correspondance recommandée sans durée entre quais : exclue',async t=>{
  const f=await setup(t);f.connection({noTransfer:true});f.transfer({type:0,seconds:null})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Interdiction spécifique par courses prioritaire sur une règle générale permissive',async t=>{
  const f=await setup(t);f.connection();f.transfer({type:3,seconds:null,fromTrip:'B1',toTrip:'T1'})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Règle spécifique permissive prioritaire sur interdiction générale',async t=>{
  const f=await setup(t);f.connection({noTransfer:true});f.transfer({type:3,seconds:null});f.transfer({fromTrip:'B1',toTrip:'T1'})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'ok')
})
test('Règles de même spécificité ambiguës : ne pas choisir arbitrairement',async t=>{
  const f=await setup(t);f.connection();f.transfer({seconds:120})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Interdiction officielle au même quai : l’hypothèse zéro marche ne la contourne pas',async t=>{
  const f=await setup(t);f.connection({samePlatform:true});f.transfer({from:'X',to:'X',type:3,seconds:null})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Une règle de station s’applique à ses quais enfants, sans inventer de durée',async t=>{
  const f=await setup(t);f.connection({noTransfer:true})
  f.sqlite.exec("INSERT INTO stops VALUES('STATION','TEST STATION','','','',45,4,1);UPDATE stops SET parent_id='STATION' WHERE id IN('X','Y')")
  f.transfer({from:'STATION',to:'STATION'})
  const r=await createJourneyPlanner(f.db).search(query());assert.equal(r.state,'ok');auditJourney(f.sqlite,r,r.itineraries[0])
})
test('Le cache topologique évite quatre requêtes sur les recherches suivantes',async t=>{
  const f=await setup(t);f.connection();const planner=createJourneyPlanner(f.db)
  const first=await planner.search(query()),second=await planner.search(query())
  assert.equal(first.metrics.sqlQueries,6);assert.equal(second.metrics.sqlQueries,2)
  assert.equal(second.metrics.coldTopology,false)
})
test('Montée interdite et service sur réservation : exclus du périmètre',async t=>{
  const f=await setup(t)
  f.trip('FORBIDDEN','BUS',[['O',39600],['D',40000]],'DAILY',{pickup:1})
  f.trip('RESERVATION','TRAM',[['O',39600],['D',40000]],'DAILY',{pickup:2})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Descente interdite : ne pas proposer le tronçon',async t=>{
  const f=await setup(t);f.trip('FORBIDDEN','BUS',[['O',39600],['D',40000]],'DAILY',{dropoff:1})
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Ordre des arrêts : aucune circulation à rebours de stop_sequence',async t=>{
  const f=await setup(t);f.trip('REVERSE','BUS',[['D',39600],['O',40000]])
  assert.equal((await createJourneyPlanner(f.db).search(query())).state,'no_journey')
})
test('Calendrier : dimanche sans service et suppression exceptionnelle',async t=>{
  const f=await setup(t);f.trip('W','BUS',[['O',39600],['D',40000]],'WEEKDAYS')
  f.sqlite.exec("INSERT INTO calendar_dates VALUES('WEEKDAYS','2026-11-09',2)")
  const p=createJourneyPlanner(f.db)
  assert.equal((await p.search(query({at:'2026-11-08T10:00:00Z'}))).state,'no_journey')
  assert.equal((await p.search(query())).state,'no_journey')
})
test('Calendrier défini uniquement par exception d’ajout',async t=>{
  const f=await setup(t);f.trip('X','BUS',[['O',39600],['D',40000]],'EXCEPTIONS')
  f.sqlite.exec("INSERT INTO calendar_dates VALUES('EXCEPTIONS','2026-11-09',1)")
  const r=await createJourneyPlanner(f.db).search(query());assert.equal(r.state,'ok');auditJourney(f.sqlite,r,r.itineraries[0])
})
test('Horaires à 25 h : service de la veille, pas du jour civil courant',async t=>{
  const f=await setup(t);f.trip('NIGHT','BUS',[['O',25*3600],['D',25*3600+600]],'WEEKDAYS')
  f.sqlite.exec("INSERT INTO calendar_dates VALUES('WEEKDAYS','2026-11-10',2)")
  const r=await createJourneyPlanner(f.db).search(query({at:'2026-11-10T00:00:00Z'}))
  assert.equal(r.state,'ok');assert.equal(r.itineraries[0].legs[0].serviceDate,'2026-11-09');auditJourney(f.sqlite,r,r.itineraries[0])
})
test('Une correspondance peut joindre deux jours de service différents après minuit',async t=>{
  const f=await setup(t);f.trip('N1','BUS',[['O',25*3600],['X',25*3600+600]])
  f.trip('N2','TRAM',[['Y',3600+900],['D',3600+1800]])
  f.transfer()
  const r=await createJourneyPlanner(f.db).search(query({at:'2026-11-10T00:00:00Z'}))
  assert.equal(r.state,'ok');assert.equal(r.itineraries[0].legs[0].serviceDate,'2026-11-09');assert.equal(r.itineraries[0].legs[1].serviceDate,'2026-11-10')
  auditJourney(f.sqlite,r,r.itineraries[0])
})
test('Arriver avant : aucune arrivée après la limite et classement par départ tardif',async t=>{
  const f=await setup(t);f.trip('EARLY','BUS',[['O',39600],['D',40800]])
  f.trip('LATE','BUS',[['O',40200],['D',41400]]);f.trip('TOO_LATE','BUS',[['O',41000],['D',42000]])
  const r=await createJourneyPlanner(f.db).search(query({mode:'arrival',at:'2026-11-09T10:30:00Z',order:'departure'}))
  assert.equal(r.itineraries[0].legs[0].tripId,'LATE')
  assert.ok(r.itineraries.every(j=>Date.parse(j.arrivalTime)<=Date.parse(r.query.at)))
  r.itineraries.forEach(j=>auditJourney(f.sqlite,r,j))
})
test('Les critères durée, arrivée et correspondances donnent des ordres cohérents',async t=>{
  const f=await setup(t);f.connection();f.trip('DIRECT','METRO',[['O',39900],['D',41700]])
  const p=createJourneyPlanner(f.db)
  assert.equal((await p.search(query())).itineraries[0].transfers,1)
  assert.equal((await p.search(query({order:'transfers'}))).itineraries[0].transfers,0)
  assert.equal((await p.search(query({order:'departure'}))).itineraries[0].legs[0].tripId,'DIRECT')
})
test('Un direct dominant évite une correspondance superflue',async t=>{
  const f=await setup(t);f.connection();f.trip('DIRECT','METRO',[['O',39900],['D',41100]])
  const r=await createJourneyPlanner(f.db).search(query());assert.ok(r.itineraries.every(j=>j.transfers===0))
})
test('Dates hors validité et arrêt isolé ne fabriquent aucun trajet',async t=>{
  const f=await setup(t);f.connection();const p=createJourneyPlanner(f.db)
  assert.equal((await p.search(query({at:'2028-01-01T00:00:00Z'}))).state,'outside_validity')
  assert.equal((await p.search(query({toStopId:'Z'}))).state,'no_journey')
})
test('DST : midi moins douze heures, été et hiver, sans décalage des tronçons',async t=>{
  const f=await setup(t);f.trip('DST','BUS',[['O',8*3600],['D',9*3600]])
  for(const [at,expected] of [['2026-03-29T05:00:00Z','2026-03-29T06:00:00.000Z'],['2026-10-25T06:00:00Z','2026-10-25T07:00:00.000Z']]){
    const r=await createJourneyPlanner(f.db).search(query({at}));assert.equal(r.itineraries[0].departureTime,expected);auditJourney(f.sqlite,r,r.itineraries[0])
  }
})
test('Un trajet traversant l’heure répétée conserve une durée positive en instants absolus',async t=>{
  const f=await setup(t);f.trip('FOLD','BUS',[['O',3600],['D',7200]])
  const r=await createJourneyPlanner(f.db).search(query({at:'2026-10-25T00:00:00Z'}))
  assert.equal(r.itineraries[0].departureTime,'2026-10-25T00:00:00.000Z')
  assert.equal(r.itineraries[0].arrivalTime,'2026-10-25T01:00:00.000Z')
  assert.equal(r.itineraries[0].durationSeconds,3600);auditJourney(f.sqlite,r,r.itineraries[0])
})
test('API : données absentes, identifiants, date et marge invalides',async t=>{
  const f=await setup(t),req=params=>new Request('https://example.org/api/journeys/search?'+new URLSearchParams(params))
  assert.equal((await handleJourneyRequest(req(query()),null)).status,503)
  for(const changes of [{fromStopId:''},{toStopId:'UNKNOWN'},{toStopId:'O'},{mode:'x'},{marginSeconds:'-1'},{at:'2026-02-30T12:00:00Z'},{at:'2026-11-09T11:00:00'}])assert.equal((await handleJourneyRequest(req({...query(),...changes}),f.db)).status,400)
})
