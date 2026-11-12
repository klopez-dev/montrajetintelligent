import type {MobilityQuery} from '../../src/types/mobility.ts'
import type {RoutingQuery} from '../../src/types/journey.ts'
export type ExperimentalQuery=MobilityQuery|RoutingQuery
export type Engine='sqlite'|'hybrid'
/** Not imported by the active application. Default and opt-in are explicit. */
export function engineSelector<T>(sqlite:(q:ExperimentalQuery)=>Promise<T>,hybrid:(q:ExperimentalQuery)=>Promise<T>,experimentalEnabled=false){
 return{search(query:ExperimentalQuery,engine:Engine='sqlite'){
   if(engine==='hybrid'&&!experimentalEnabled)return Promise.reject(new Error('Moteur hybride expérimental désactivé'))
   if(engine!=='sqlite'&&engine!=='hybrid')return Promise.reject(new Error('Moteur inconnu'))
   return(engine==='sqlite'?sqlite:hybrid)(query)
 }}
}
