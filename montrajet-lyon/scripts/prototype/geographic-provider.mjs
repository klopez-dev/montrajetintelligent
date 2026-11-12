import {readFile} from 'node:fs/promises'
import {createIgnProvider,GeographicError} from '../../server/mobility/provider.ts'
/** Replays are opt-in QA only, labelled by the laboratory; never silently used
 * on provider failure. Unknown requests fail instead of fabricating paths. */
export async function experimentalProvider(replayFile){
 if(!replayFile)return{provider:createIgnProvider(),mode:'IGN officiel en ligne — mêmes services et limites que l’application'}
 const ledger=new Map(JSON.parse(await readFile(replayFile,'utf8')));let calls=0,misses=0
 async function call(method,args,signal){signal?.throwIfAborted();calls++;const hit=ledger.get(JSON.stringify([method,args]));if(!hit){misses++;throw new GeographicError('Rejeu IGN : requête non enregistrée, aucun remplacement')}if(hit.error)throw new GeographicError(hit.error);return structuredClone(hit.value)}
 return{provider:{addresses:(q,t,s)=>call('addresses',[q],s),resolveAddress:(id,name,t,s)=>call('resolveAddress',[id,name],s),walk:(a,b,t,s)=>call('walk',[{latitude:a.latitude,longitude:a.longitude},{latitude:b.latitude,longitude:b.longitude}],s)},mode:'QA — rejeu explicite de réponses officielles IGN enregistrées, dates originales conservées ; aucune fraîcheur actuelle revendiquée',metrics:()=>({calls,misses,upstreamRequests:0})}
}
