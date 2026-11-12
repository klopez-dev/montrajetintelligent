import {build} from 'vite'
import {mkdir,readFile,copyFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'
import {loadStaticDatabase} from '../../experiments/hybrid/load.ts'
export async function buildStatic(directory,output){
 const manifest=JSON.parse(await readFile(resolve(directory,'manifest.json'),'utf8'))
 const db=await loadStaticDatabase(manifest,f=>readFile(resolve(directory,f)))
 for(const date of Object.keys(manifest.days))await db.packet(date)
 db.release()
 await build({configFile:false,root:resolve('.'),build:{outDir:output,emptyOutDir:false,rollupOptions:{input:[resolve('experiments/hybrid/index.html'),resolve('experiments/hybrid/mobility.html')]}},worker:{format:'es'}})
 await mkdir(resolve(output,'prototype-data'))
 const files=[...new Set(['manifest.json',manifest.catalog.file,...Object.values(manifest.days).flatMap(d=>[d.file,...(d.trips?[d.trips.file]:[])])])]
 for(const file of files)await copyFile(resolve(directory,file),resolve(output,'prototype-data',file))
 try{await copyFile(resolve(directory,'version.json'),resolve(output,'prototype-data/version.json'))}catch(e){if(e.code!=='ENOENT')throw e}
 await writeFile(resolve(output,'_headers'),'/prototype-data/*\n  Cache-Control: no-cache\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n',{flag:'wx'})
 return files
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const output=resolve(`.data/hybrid-dist-${Date.now()}`);await buildStatic(resolve(process.argv[2]||''),output);console.log(output)}
