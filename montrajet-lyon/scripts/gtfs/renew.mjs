import {mkdir,open,writeFile,rename} from 'node:fs/promises'
import {createHash,randomUUID} from 'node:crypto'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {importGtfs,projectRoot} from './import.mjs'
export const officialGtfsUrl='https://download.data.grandlyon.com/files/rdata/tcl_sytral.tcltheorique/GTFS_TCL.ZIP'
/** Separate staging only. Flags represent prior authorisation, not a claim that it exists. */
export async function renewGtfs(options,fetcher=fetch){
  if(options.policyConfirmed!==true||options.freeAccessConfirmed!==true)throw new Error('Renouvellement bloqué : droits et gratuité doivent être confirmés pour cette source.')
  if(!options.username||!options.password||options.username.includes(':'))throw new Error('Compte technique Data Grand Lyon requis ; aucun essai de mot de passe automatique.')
  let response
  try{response=await fetcher(officialGtfsUrl,{redirect:'error',signal:AbortSignal.timeout(60000),headers:{Accept:'application/zip,application/octet-stream',Authorization:'Basic '+Buffer.from(options.username+':'+options.password).toString('base64')}})}catch{throw new Error('Source officielle inaccessible. Aucun autre hôte ni miroir essayé.')}
  if(!response.ok){await response.body?.cancel();throw new Error(`Téléchargement officiel refusé (HTTP ${response.status}). Aucun contournement ni nouvel essai.`)}
  const maximum=64000000
  if(Number(response.headers.get('content-length')||0)>maximum||!response.body){await response.body?.cancel();throw new Error('Archive trop volumineuse ou vide.')}
  const directory=resolve(options.outputRoot||resolve(projectRoot,'.data'),`gtfs-renewal-${Date.now()}-${randomUUID()}`);await mkdir(directory,{recursive:true})
  const partial=resolve(directory,'archive.part'),archive=resolve(directory,'GTFS_TCL.ZIP'),file=await open(partial,'wx'),hash=createHash('sha256');let size=0,signature=Buffer.alloc(0)
  try{
    for await(const chunk of response.body){
      size+=chunk.length;if(size>maximum)throw new Error('Limite de téléchargement dépassée.')
      if(signature.length<4)signature=Buffer.concat([signature,Buffer.from(chunk)]).subarray(0,4)
      hash.update(chunk);await file.writeFile(chunk)
    }
    if(signature.length!==4||signature.readUInt32LE()!==0x04034b50)throw new Error('La réponse officielle n’est pas un ZIP GTFS, validation refusée.')
  }finally{await file.close()}
  await rename(partial,archive)
  const staging=resolve(directory,'validated');await mkdir(staging)
  // importGtfs may create its own activePath INSIDE staging, never the project's active base.
  const imported=await importGtfs({archive,outputRoot:staging,sourceUrl:officialGtfsUrl})
  const receipt={sourceUrl:officialGtfsUrl,downloadedAt:new Date().toISOString(),bytes:size,sha256:hash.digest('hex'),validFrom:imported.report.validFrom,validUntil:imported.report.validUntil,validation:imported.report,databasePath:imported.databasePath,projectActiveDatabaseModified:false,requiresReviewBeforeAnyActivation:true}
  await writeFile(resolve(directory,'receipt.json'),JSON.stringify(receipt,null,2),{flag:'wx'});return receipt
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{console.log(JSON.stringify(await renewGtfs({username:process.env.GTFS_SOURCE_USERNAME,password:process.env.GTFS_SOURCE_PASSWORD,policyConfirmed:process.env.GTFS_SOURCE_POLICY_CONFIRMED==='true',freeAccessConfirmed:process.env.GTFS_SOURCE_FREE_ACCESS_CONFIRMED==='true'}),null,2))}
  catch(e){console.error(e.message);process.exitCode=1}
}
