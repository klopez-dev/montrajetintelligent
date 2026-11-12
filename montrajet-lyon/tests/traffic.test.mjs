import test from 'node:test'
import assert from 'node:assert/strict'
import { createTrafficProvider } from '../server/traffic/provider.ts'
import { parseLine, linePages, priorities, officialUrl, discoverLinePages } from '../server/traffic/html.ts'
import { parsePeriod, temporalStatus, overlaps } from '../server/traffic/time.ts'
import { mapIncidents, matchJourney } from '../server/traffic/matching.ts'
import { createTrafficApi } from '../server/traffic/api.ts'
import { routingDatabase } from './helpers/journeys.mjs'
import { readTrafficCache, writeTrafficCache } from '../server/traffic/localCache.ts'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { coverageAt, coverageSummary } from '../src/services/trafficCoverage.ts'

// SYNTHETIC TEST FIXTURES ONLY. Never loaded by the application or imported into TCL.
const at=Date.parse('2026-11-09T10:00:00Z')
const link=line=>`https://www.tcl.fr/se-deplacer/infos-trafic-accessibilite/trafic/line%3ASYTNEX%3A${line}`
const landing=(lines=priorities.map(p=>p.line))=>`<div class="info-trafic_category">${lines.map(l=>`<a class="teaser-card trafic-line" href="${link(l)}">${l}<p class="tcl-line-pictogram_label">${({bus:"Bus",metro:"M\u00e9tro",tram:"Tramway",funicular:"Funiculaire"})[priorities.find(p=>p.line===l)?.mode||"bus"]} ${l}</p></a>`).join('')}</div>`
const detail=(line,title='TEST incident',period='Du 09/11/2026 à 10:30 au 09/11/2026 à 12:30')=>`<div class="alert-detail-page"><h1>État du trafic de la ligne ${line}</h1><div class="alert-list">${title?`<div class="alert_content"><p>Perturbation TEST</p><p>${title}</p><p>TEST texte intégral &amp; &lt;script&gt;sans exécution&lt;/script&gt;</p><p class="alert_period">${period}</p></div>`:'Trafic normal'}</div></div>`
async function incident(changes={}){return {...(await parseLine(detail('T3'),link('T3'),'T3','tram',new Date(at).toISOString()))[0],...changes}}
const leg={routeId:'TRAM',directionId:'0',start:at,end:at+600000,stops:[{id:'O',at},{id:'X',at:at+300000},{id:'D',at:at+600000}]}
function mockSource(){let calls=0,version=0,fail=false;return {get calls(){return calls},set version(v){version=v},set fail(v){fail=v},fetch:async url=>{
  calls++;if(fail)return new Response('TEST panne',{status:503,headers:{'Retry-After':'1200'}})
  const path=new URL(url).pathname
  const body=path==='/robots.txt'?'User-agent: *\nDisallow: /admin/':path==='/mentions-legales'?'<p>Toute reproduction pas soumise à autorisation préalable ; sauf commerciales et publicitaires.</p>':path==='/infos-trafic'?landing():detail(decodeURIComponent(path).split(':').at(-1),version===2?'':version?'TEST incident modifié':'TEST incident')
  return new Response(body,{headers:{'Content-Type':'text/html; charset=utf-8'}})
}}}

test('HTML TCL : vrais sélecteurs, texte intégral décodé, liens sûrs, aucune extraction de scripts',async()=>{
  const [i]=await parseLine(detail('T3'),link('T3'),'T3','tram',new Date(at).toISOString())
  assert.equal(i.title,'TEST incident');assert.match(i.description,/<script>sans exécution/);assert.equal(i.identity,'content-derived');assert.equal(i.mapping,'unmatched');assert.equal(i.type,'other');assert.equal(i.updatedAt,undefined);assert.equal(i.stops,undefined)
  assert.throws(()=>officialUrl('https://evil.example/test'));assert.throws(()=>officialUrl('javascript:alert(1)'));assert.equal(linePages(landing(['T3'])).size,1)
  assert.throws(()=>linePages('<html>TEST maintenance</html>'))
  await assert.rejects(()=>parseLine(detail('A'),link('T3'),'T3','tram',new Date(at).toISOString()),/non reconnue/)
  assert.equal((await parseLine(detail('T3',''),link('T3'),'T3','tram',new Date(at).toISOString())).length,0)
  await assert.rejects(()=>parseLine(detail('T3','').replace('Trafic normal','Aucune donnée disponible'),link('T3'),'T3','tram',new Date(at).toISOString()),/non confirmée/)
})
test('Cache disque isolé : intégrité vérifiée, dates intactes et fichier inconnu jamais écrasé',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'montrajet-traffic-test-')),path=join(dir,'cache.json'),now=Date.now()
  const i=await incident(),snapshot={state:'available',partial:true,incidents:[i],coverage:['T3'],sourceUrl:'https://www.tcl.fr/infos-trafic',fetchedAt:new Date(now).toISOString(),validUntil:new Date(now+600000).toISOString(),metrics:{upstreamRequests:0,cacheHit:true,durationMs:0}}
  await writeTrafficCache(path,snapshot);assert.deepEqual(readTrafficCache(path),JSON.parse(JSON.stringify(snapshot)))
  const corrupt=JSON.parse(await readFile(path,'utf8'));corrupt.data.incidents[0].title='TEST MODIFICATION NON SIGNÉE';await writeFile(path,JSON.stringify(corrupt));assert.equal(readTrafficCache(path),undefined)
  await writeTrafficCache(path,snapshot);assert.equal(JSON.parse(await readFile(path,'utf8')).data.incidents[0].title,'TEST MODIFICATION NON SIGNÉE')
})
test('Cache persistant : redémarrage sans appel fournisseur puis péremption sans renouvellement fictif',async()=>{
  const i=await incident();let now=at,calls=0
  const initial={state:'available',partial:true,incidents:[i],coverage:['T3'],sourceUrl:'https://www.tcl.fr/infos-trafic',fetchedAt:new Date(at).toISOString(),validUntil:new Date(at+600000).toISOString(),metrics:{upstreamRequests:0,cacheHit:true,durationMs:0}}
  const provider=createTrafficProvider(async()=>{calls++;throw new Error('TEST timeout')},()=>now,async()=>{},{initial,save:async()=>{throw new Error('TEST ne doit pas sauvegarder un échec')}})
  assert.equal((await provider.get()).state,'available');assert.equal(calls,0);now+=600001;const stale=await provider.get();assert.equal(stale.state,'stale');assert.equal(stale.fetchedAt,initial.fetchedAt);assert.equal(stale.validUntil,initial.validUntil);assert.equal(calls,1)
})
test('Périodes : actif, futur, terminé, fin ouverte et plusieurs plages sans fausse continuité',async()=>{
  const i=await incident();assert.equal(temporalStatus(i,at),'active');assert.equal(temporalStatus(i,at-7200000),'future');assert.equal(temporalStatus(i,at+7200000),'ended')
  const open={...i,periods:[{start:new Date(at).toISOString()}]};assert.equal(temporalStatus(open,at+86400000),'active')
  const gaps={...i,periods:[{start:new Date(at-7200000).toISOString(),end:new Date(at-3600000).toISOString()},{start:new Date(at+3600000).toISOString(),end:new Date(at+7200000).toISOString()}]}
  assert.equal(temporalStatus(gaps,at),'future');assert.equal(overlaps(gaps,at,at+60000),false)
})
test('Minuit et changements d’heure : Paris, heures inexistantes ou ambiguës exclues, récurrences inconnues',()=>{
  assert.equal(parsePeriod('Du 09/11/2026 à 23:30 au 10/11/2026 à 02:30').periods[0].end,'2026-11-10T01:30:00.000Z')
  assert.equal(parsePeriod('Du 29/03/2026 à 02:30 au 29/03/2026 à 05:00').temporalPrecision,'text_only')
  assert.equal(parsePeriod('Du 25/10/2026 à 02:30 au 25/10/2026 à 05:00').temporalPrecision,'text_only')
  assert.equal(parsePeriod('Du 28/03/2026 à 23:30 au 29/03/2026 à 04:30').periods[0].end,'2026-03-29T02:30:00.000Z')
  assert.equal(parsePeriod('Du 09/11/2026 au 28/11/2026 De 20:30 à 02:30').temporalPrecision,'text_only')
})
test('Cache partagé : dix appels maximum au premier cycle sept lignes, zéro par lecteur supplémentaire',async()=>{
  const source=mockSource(),provider=createTrafficProvider(source.fetch,()=>at,async()=>{})
  const [a,b]=await Promise.all([provider.get(),provider.get()]);assert.equal(source.calls,10);assert.equal(a.state,'available');assert.equal(a.incidents.length,1);assert.equal(a.incidents[0].lines.length,7);assert.deepEqual(a.incidents,b.incidents);assert.equal(b.metrics.upstreamRequests,0)
  assert.equal((await provider.get()).metrics.cacheHit,true);assert.equal(source.calls,10)
})
test('Annuaire partiel : aucune URL inventée pour une ligne absente et couverture explicite',async()=>{
  const source=mockSource();const provider=createTrafficProvider(url=>new URL(url).pathname==='/infos-trafic'?Promise.resolve(new Response(landing(['T3']),{headers:{'Content-Type':'text/html'}})):source.fetch(url),()=>at,async()=>{})
  const snapshot=await provider.get();assert.deepEqual(snapshot.coverage,['T3']);assert.equal(snapshot.incidents.length,1)
})
test('Incident modifié ou supprimé : remplacement atomique du flux, pas d’accumulation',async()=>{
  const source=mockSource();let now=at;const provider=createTrafficProvider(source.fetch,()=>now,async()=>{})
  const first=await provider.get();source.version=1;now+=600001;const second=await provider.get();assert.notEqual(first.incidents[0].id,second.incidents[0].id);assert.equal(second.incidents.length,1)
  source.version=2;now+=600001;const empty=await provider.get();assert.equal(empty.state,'available');assert.equal(empty.incidents.length,0);assert.equal(source.calls,26)
})
test('Panne et Retry-After : ancien instant conservé, état périmé explicite, sans rafale',async()=>{
  const source=mockSource();let now=at;const provider=createTrafficProvider(source.fetch,()=>now,async()=>{})
  const first=await provider.get();now+=600001;source.fail=true;const stale=await provider.get();assert.equal(stale.state,'stale');assert.equal(stale.fetchedAt,first.fetchedAt);assert.match(stale.error,/HTTP 503/)
  const count=source.calls;now+=600001;await provider.get();assert.equal(source.calls,count)
})
test('Fournisseur refusé, réponses malformées, corps trop grand et droits modifiés : aucun faux incident',async()=>{
  for(const fetcher of [async()=>new Response('TEST refus',{status:401}),async()=>new Response('TEST malformed',{headers:{'Content-Type':'application/json'}}),async()=>new Response('x'.repeat(1500001),{headers:{'Content-Type':'text/html'}}),async()=>{throw new Error('TEST network')},async()=>new Response('User-agent: *\nDisallow: /',{headers:{'Content-Type':'text/plain'}}),async()=>new Response('TEST droits inconnus',{headers:{'Content-Type':'text/html'}})]){
    const result=await createTrafficProvider(fetcher,()=>at,async()=>{}).get();assert.equal(result.state,'unavailable');assert.equal(result.incidents.length,0);assert.equal(result.fetchedAt,undefined)
  }
})
test('Correspondance : même code et mode = partiel ; quais homonymes jamais fusionnés ; incompatible exclu',async()=>{
  const f=await routingDatabase();try{
    const i=await incident({lines:[{label:'TEST TRAM',mode:'tram',sourceId:'line:SYTNEX:TEST',namespace:'tcl-web',gtfsIds:[],precision:'unmatched'}],stops:[{label:'TEST CONNECTION',sourceId:'UNKNOWN',gtfsIds:[],precision:'unmatched'}]})
    const [mapped]=await mapIncidents(f.db,[i]);assert.equal(mapped.mapping,'partial');assert.deepEqual(mapped.lines[0].gtfsIds,['TRAM']);assert.deepEqual(mapped.stops[0].gtfsIds,[])
    const [wrong]=await mapIncidents(f.db,[{...i,lines:[{...i.lines[0],mode:'metro'}]}]);assert.equal(wrong.mapping,'unmatched')
    const [exact]=await mapIncidents(f.db,[{...i,lines:[{...i.lines[0],namespace:'gtfs',sourceId:'TRAM'}],stops:[{...i.stops[0],namespace:'gtfs',sourceId:'X'}]}]);assert.equal(exact.mapping,'exact');assert.deepEqual(exact.stops[0].gtfsIds,['X'])
  }finally{f.close()}
})
test('Rapprochement trajet : arrêt intermédiaire, direction unique, ligne générale et déviation partielle',async()=>{
  const i=await incident({lines:[{label:'TEST',gtfsIds:['TRAM'],precision:'exact'}],directionIds:['0'],stops:[{label:'TEST',gtfsIds:['X'],precision:'exact'}]})
  assert.equal(matchJourney([i],[leg])[0].level,'confirmed');assert.equal(matchJourney([i],[{...leg,directionId:'1'}]).length,0)
  assert.equal(matchJourney([{...i,stops:[]}],[leg])[0].level,'general')
  assert.equal(matchJourney([{...i,type:'interruption',stops:[]}],[leg])[0].level,'general')
  assert.equal(matchJourney([{...i,type:'diversion',temporalPrecision:'text_only',periods:[]}],[leg])[0].level,'general')
  assert.equal(matchJourney([i],[{...leg,start:at+86400000,end:at+86400600000}]).length,0)
  assert.equal(matchJourney([i],[{...leg,routeId:'BUS'}]).length,0)
})
test('API : filtres ligne/mode/date, vide distinct de panne, méthodes et dates invalides',async()=>{
  const i=await incident(),provider={get:async()=>({state:'available',partial:true,incidents:[i],coverage:['T3'],sourceUrl:'https://www.tcl.fr/infos-trafic',fetchedAt:new Date(at).toISOString(),validUntil:new Date(at+600000).toISOString(),metrics:{upstreamRequests:0,cacheHit:true,durationMs:0}})},api=createTrafficApi(provider)
  assert.equal((await api(new Request('http://local/api/traffic?line=C13'),null).then(r=>r.json())).data.incidents.length,0)
  assert.equal((await api(new Request('http://local/api/traffic?mode=tram'),null).then(r=>r.json())).data.incidents.length,1)
  assert.equal((await api(new Request('http://local/api/traffic?date=2026-11-10'),null).then(r=>r.json())).data.incidents.length,0)
  assert.equal((await api(new Request('http://local/api/traffic?date=2026-02-30'),null)).status,400)
  assert.equal((await api(new Request('http://local/api/traffic',{method:'POST'}),null)).status,405)
})
test('API trajets : horaires reconstruits depuis SQLite, récurrences du service et repli trafic indisponible',async()=>{
  const f=await routingDatabase();try{
    f.trip('T1','TRAM',[['O',39600],['X',39900],['D',40200]])
    const i=await incident({lines:[{label:'TEST TRAM',sourceId:'TRAM',namespace:'gtfs',gtfsIds:[],precision:'unmatched'}],stops:[{label:'TEST',sourceId:'X',namespace:'gtfs',gtfsIds:[],precision:'unmatched'}]})
    let state='available';const api=createTrafficApi({get:async()=>({state,partial:true,incidents:[i],coverage:['TEST'],sourceUrl:'https://www.tcl.fr',metrics:{upstreamRequests:0,cacheHit:true,durationMs:0}})})
    const request=changes=>new Request('http://local/api/traffic/journeys',{method:'POST',body:JSON.stringify({journeys:[[{tripId:'T1',serviceDate:'2026-11-09',from:{id:'O',sequence:1},to:{id:'D',sequence:3},departureTime:'FAKE IGNORED',...changes}]]})})
    const result=await api(request(),f.db).then(r=>r.json());assert.equal(result.data.notices[0][0].level,'confirmed')
    state='stale';const stale=await api(request(),f.db).then(r=>r.json());assert.deepEqual(stale.data.notices,[[]]);assert.equal(stale.data.matchingUnavailable,true)
    assert.equal((await api(request({tripId:'MISSING'}),f.db)).status,400)
    assert.equal((await api(request({serviceDate:'2028-01-01'}),f.db)).status,400)
  }finally{f.close()}
})

test('Couverture : deux échecs distincts ne masquent pas les fiches réussies ; absence de lien = non consultée',async()=>{
  const source=mockSource(),now=at,provider=createTrafficProvider(async(url,options)=>{
    const path=decodeURIComponent(new URL(url).pathname)
    if(path==='/infos-trafic')return new Response(landing(['T3','C16','D']),{headers:{'Content-Type':'text/html'}})
    if(path.endsWith(':C16'))return new Response('TEST',{status:500})
    if(path.endsWith(':D'))return new Response(detail('D',''),{headers:{'Content-Type':'text/html'}})
    return source.fetch(url,options)
  },()=>now,async()=>{})
  const result=await provider.get();assert.equal(result.state,'available');const summary=coverageSummary(result.lineCoverage)
  assert.deepEqual(summary,{total:7,verified:2,withAnnouncements:1,withoutAnnouncements:1,notChecked:4,failed:1,stale:0})
  assert.equal(result.lineCoverage.find(r=>r.line==='C13').lastAttemptAt,undefined)
  const checked=result.checkedAt;assert.equal((await provider.get()).checkedAt,checked)
})
test('Fiche échouée : conserver son dernier succès réel, son incident et sa péremption individuelle',async()=>{
  const source=mockSource();let now=at,fail=false
  const provider=createTrafficProvider((url,options)=>fail&&decodeURIComponent(new URL(url).pathname).endsWith(':T3')?Promise.resolve(new Response('TEST',{status:500})):source.fetch(url,options),()=>now,async()=>{})
  const first=await provider.get(),old=first.lineCoverage.find(r=>r.line==='T3');now+=600001;fail=true
  const next=await provider.get(),row=next.lineCoverage.find(r=>r.line==='T3');assert.equal(row.state,'stale');assert.equal(row.lastSuccessAt,old.lastSuccessAt);assert.equal(row.validUntil,old.validUntil);assert.ok(next.incidents.some(i=>i.lines.some(l=>l.label==='T3')))
  assert.equal(coverageAt(first.lineCoverage,now).find(r=>r.line==='T3').state,'stale')
})
test('Extraits publics autorisés : récurrence T3 explicite, soirée après minuit, direction littérale et fréquence',async()=>{
  const html=await readFile(new URL('./fixtures/traffic/tcl-t3-2026-11-09.html',import.meta.url),'utf8')
  const items=await parseLine(html,link('T3'),'T3','tram',new Date(at).toISOString()),evenings=items.find(i=>i.recurrenceText)
  assert.equal(evenings.periods.length,4);assert.equal(evenings.temporalPrecision,'exact')
  assert.equal(overlaps(evenings,Date.parse('2026-11-09T10:00:00Z'),Date.parse('2026-11-09T10:30:00Z')),false)
  assert.equal(overlaps(evenings,Date.parse('2026-11-09T20:00:00Z'),Date.parse('2026-11-09T20:30:00Z')),true)
  assert.equal(overlaps(evenings,Date.parse('2026-11-11T00:30:00Z'),Date.parse('2026-11-11T00:31:00Z')),true)
  assert.equal(overlaps(evenings,Date.parse('2026-11-12T00:30:00Z'),Date.parse('2026-11-12T00:31:00Z')),false)
  assert.ok(evenings.explicitDetails.some(d=>d.kind==='frequency'))
  const closure=items.find(i=>i.explicitDetails.some(d=>d.kind==='direction'));assert.ok(closure);assert.equal(closure.directionIds,undefined);assert.equal(closure.removedStops,undefined)
  const index=discoverLinePages(await readFile(new URL('./fixtures/traffic/tcl-index-2026-11-09.html',import.meta.url),'utf8'))
  assert.equal(items.length,index.get('T3').announcedCount)
  for(const [line,mode,file]of [['C16','bus','c16'],['D','metro','d']])assert.equal((await parseLine(await readFile(new URL(`./fixtures/traffic/tcl-${file}-2026-11-09.html`,import.meta.url),'utf8'),link(line),line,mode,new Date(at).toISOString())).length,index.get(line).announcedCount)
})
test('Récurrence : liste hors bornes, heure ambiguë et phrase inconnue restent non interprétées',()=>{
  assert.equal(parsePeriod('Du 09/11/2026 au 28/11/2026 De 20:30 à 02:30','Le 8, 10 et 27 novembre 2026').temporalPrecision,'text_only')
  assert.equal(parsePeriod('Du 24/10/2026 au 27/10/2026 De 23:30 à 02:30','Le 24 et 25 octobre 2026').temporalPrecision,'text_only')
  assert.equal(parsePeriod('Du 09/11/2026 au 28/11/2026 De 20:30 à 02:30','Tous les soirs sauf exceptions').temporalPrecision,'text_only')
})
test('Extension : deux fiches supplémentaires maximum, compatibles catalogue, puis rotation bornée',async()=>{
  const source=mockSource();let now=at
  const provider=createTrafficProvider((url,options)=>new URL(url).pathname==='/infos-trafic'?Promise.resolve(new Response(landing([...priorities.map(p=>p.line),'107','108','109']),{headers:{'Content-Type':'text/html'}})):source.fetch(url,options),()=>now,async()=>{})
  const catalogue=['107','108','109'].map(line=>({line,mode:'bus'}))
  const first=await provider.get(catalogue);assert.equal(first.lineCoverage.filter(r=>r.lastSuccessAt).length,9);assert.equal(first.metrics.upstreamRequests,12);assert.equal(first.lineCoverage.some(r=>r.line==='109'),false)
  now+=600001;const second=await provider.get(catalogue);assert.ok(second.lineCoverage.find(r=>r.line==='109')?.lastSuccessAt);assert.equal(second.metrics.upstreamRequests,10)
})
test('Échec index : les fiches non demandées ne reçoivent pas de fausse date de tentative',async()=>{
  const source=mockSource(),provider=createTrafficProvider((url,options)=>new URL(url).pathname==='/infos-trafic'?Promise.resolve(new Response('TEST',{status:500})):source.fetch(url,options),()=>at,async()=>{})
  const result=await provider.get();assert.equal(result.state,'unavailable');assert.ok(result.lineCoverage.every(r=>r.state==='not_checked'&&r.lastAttemptAt===undefined))
})
test('Catalogue GTFS : mode non pris en charge inclus comme non consulté, sans collecte automatique',async()=>{
  const f=await routingDatabase();try{
    f.sqlite.prepare('INSERT INTO routes VALUES(?,?,?,?,?)').run('BOAT','TEST','TEST BOAT','TEST BOAT',4)
    const api=createTrafficApi({get:async catalogue=>{assert.ok(!catalogue.some(r=>r.line==='TEST BOAT'));return {state:'unavailable',partial:true,incidents:[],coverage:[],lineCoverage:[],sourceUrl:'https://www.tcl.fr/infos-trafic',checkedAt:new Date(at).toISOString(),metrics:{upstreamRequests:0,cacheHit:true,durationMs:0}}}})
    const response=await api(new Request('http://local/api/traffic'),f.db).then(r=>r.json());assert.equal(response.data.lineCoverage.find(r=>r.line==='TEST BOAT').state,'not_checked');assert.equal(response.data.coverageSummary.total,5)
  }finally{f.close()}
})
test('Droits revérifiés une fois par jour : cache persistant ne provoque pas deux requêtes de politique à chaque redémarrage',async()=>{
  const source=mockSource(),first=await createTrafficProvider(source.fetch,()=>at,async()=>{}).get();assert.equal(first.policyCheckedAt,new Date(at).toISOString())
  const secondSource=mockSource(),restored=createTrafficProvider(secondSource.fetch,()=>at+600001,async()=>{},{initial:first,save:async()=>{}})
  const next=await restored.get();assert.equal(next.metrics.upstreamRequests,8);assert.equal(next.policyCheckedAt,first.policyCheckedAt)
})
test('Changement partiel du HTML : un nombre de cartes différent de l’index n’est pas accepté comme une liste complète',async()=>{
  const source=mockSource(),provider=createTrafficProvider((url,options)=>new URL(url).pathname==='/infos-trafic'?Promise.resolve(new Response(landing(['T3']).replace('</a>','Voir 2 infos trafic</a>'),{headers:{'Content-Type':'text/html'}})):source.fetch(url,options),()=>at,async()=>{})
  const result=await provider.get();assert.equal(result.lineCoverage.find(r=>r.line==='T3').state,'failed');assert.equal(result.incidents.length,0);assert.equal(result.state,'unavailable')
})
