import {DatabaseSync} from 'node:sqlite'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve} from 'node:path'
import {createIgnProvider,GeographicError} from '../../server/mobility/provider.ts'
import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import {mobilityScenarios} from '../../experiments/hybrid/scenarios.ts'
const output=resolve(`.data/hybrid-complete-ign-${Date.now()}`);await mkdir(output)
const ledger=new Map(JSON.parse(await readFile('.data/hybrid-mobility-1794262559540/official-replay.json','utf8'))),pending=new Map(),ign=createIgnProvider(),report={cases:[],newProviderCalls:0,budget:80,errors:[],note:'Explicit bounded supplement to recorded official responses. Existing records retain dates; no fresh data claimed for replayed entries.'}
const sqlite=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
async function call(method,args,trace,signal){
 const key=JSON.stringify([method,args]);if(ledger.has(key)){const hit=ledger.get(key);if(hit.error)throw new GeographicError(hit.error);return structuredClone(hit.value)}
 if(!pending.has(key)){
  if(report.newProviderCalls>=report.budget)throw new GeographicError('Budget de collecte QA atteint : aucun parcours inventé')
  report.newProviderCalls++;const promise=(async()=>{try{const value=await ign[method](...args,trace,signal);ledger.set(key,{value});return value}catch(e){ledger.set(key,{error:e.message});report.errors.push({method,error:e.message});throw e}})();pending.set(key,promise)
 }
 return pending.get(key)
}
const provider={addresses:(q,t,s)=>call('addresses',[q],t,s),resolveAddress:(id,name,t,s)=>call('resolveAddress',[id,name],t,s),walk:(a,b,t,s)=>call('walk',[{latitude:a.latitude,longitude:a.longitude},{latitude:b.latitude,longitude:b.longitude}],t,s)}
try{
 const home=(await provider.addresses('100 avenue Lacassagne Lyon')).find(a=>a.precision==='housenumber'&&a.name.startsWith('100 Avenue Lacassagne')),work=(await provider.addresses('5 avenue des Canuts Vaulx-en-Velin')).find(a=>a.precision==='housenumber'&&a.name.startsWith('5 Avenue des Canuts')),planner=createMobilityPlanner({all:async(s,p=[])=>sqlite.prepare(s).all(...p)},provider),cases=mobilityScenarios(home,work)
 for(const scenario of [...cases,{...cases[1],id:'address-arrive',query:{...cases[1].query,mode:'arrival',order:'departure',at:'2026-11-09T12:00:00Z'}}]){const result=await planner.search(scenario.query);report.cases.push({id:scenario.id,state:result.state,proposals:result.itineraries.length,providerIssues:result.providerIssues});console.log(scenario.id,report.newProviderCalls,result.state,result.itineraries.length)}
 report.status='completed';report.records=ledger.size
}catch(e){report.status='failed';report.error=e.stack;process.exitCode=1;console.error(e)}finally{sqlite.close();await writeFile(resolve(output,'official-replay.json'),JSON.stringify([...ledger]),{flag:'wx'});await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2),{flag:'wx'});console.log(output)}
