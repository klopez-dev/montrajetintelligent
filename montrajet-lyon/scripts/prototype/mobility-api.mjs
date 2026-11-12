import {createMobilityPlanner} from '../../server/mobility/planner.ts'
import {geographicTrace} from '../../server/mobility/provider.ts'
import {mobilityScenarios} from '../../experiments/hybrid/scenarios.ts'
export function installMobilityApi(server,db,providerContext){
 const {provider,mode}=providerContext,planner=createMobilityPlanner(db,provider)
 server.middlewares.use('/prototype/mobility',async(req,res)=>{
  const controller=new AbortController();res.on('close',()=>{if(!res.writableEnded)controller.abort()})
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store')
  try{
   const path=(req.url||'').split('?')[0]
   if(path==='/scenarios'&&req.method==='GET'){
    const home=(await provider.addresses('100 avenue Lacassagne Lyon',undefined,controller.signal)).find(a=>a.precision==='housenumber'&&a.name.startsWith('100 Avenue Lacassagne')),work=(await provider.addresses('5 avenue des Canuts Vaulx-en-Velin',undefined,controller.signal)).find(a=>a.precision==='housenumber'&&a.name.startsWith('5 Avenue des Canuts'))
    if(!home||!work)throw new Error('Adresses officielles de référence non confirmées')
    res.end(JSON.stringify({mode,cases:mobilityScenarios(home,work)}));return
   }
   if(req.method!=='POST')throw new Error('Méthode expérimentale non autorisée')
   let text='';for await(const chunk of req){text+=chunk;if(text.length>4096)throw new Error('Requête trop grande')}
   const body=JSON.parse(text)
   if(path==='/reference'){res.end(JSON.stringify(await planner.search(body,controller.signal)));return}
   if(path!=='/geography')throw new Error('Ressource expérimentale inconnue')
   const {method,args}=body
   if(!['addresses','resolveAddress','walk'].includes(method)||!Array.isArray(args))throw new Error('Appel IGN invalide')
   const point=p=>p&&Number.isFinite(p.latitude)&&Math.abs(p.latitude)<=90&&Number.isFinite(p.longitude)&&Math.abs(p.longitude)<=180
   if(method==='walk'?(args.length!==2||!args.every(point)):(args.length!==(method==='addresses'?1:2)||!args.every(v=>typeof v==='string'&&v.length>0&&v.length<=160)))throw new Error('Paramètres IGN invalides')
   const trace=geographicTrace(),value=await provider[method](...args,trace,controller.signal);res.end(JSON.stringify({value,trace}))
  }catch(e){res.statusCode=503;res.end(JSON.stringify({error:e.message,source:'IGN / laboratoire expérimental'}))}
 })
}
