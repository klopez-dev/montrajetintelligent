import {createHash} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {writeFile,readFile} from 'node:fs/promises'
import {DatabaseSync} from 'node:sqlite'
import {openZip} from './zip.mjs'
import {csvObjects} from './csv.mjs'
const archive=process.argv[2]||'GTFS_TCL.ZIP',hash=createHash('sha256')
for await(const chunk of createReadStream(archive))hash.update(chunk)
const sha256=hash.digest('hex'),db=new DatabaseSync('.data/gtfs.sqlite',{readOnly:true})
const metadata=JSON.parse(db.prepare('SELECT json FROM metadata WHERE id=1').get().json);db.close()
if(metadata.sha256!==sha256)throw new Error('Archive différente du GTFS actif : complément refusé.')
const zip=await openZip(archive),colors={};let shapeIds=0,trips=0
for await(const row of csvObjects(zip.read('routes.txt'),['route_id'],'routes.txt'))if(/^[0-9a-f]{6}$/i.test(row.route_color||''))colors[row.route_id]='#'+row.route_color
for await(const row of csvObjects(zip.read('trips.txt'),['trip_id'],'trips.txt')){trips++;if(row.shape_id)shapeIds++}
const data={sha256,colors,shapesAvailable:zip.names.includes('shapes.txt'),trips,shapeIds}
const path='.data/map-catalog.json'
try{const old=JSON.parse(await readFile(path,'utf8'));if(JSON.stringify(old)!==JSON.stringify(data))throw new Error('Complément existant différent : conservation, vérifier avant remplacement.')}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(path,JSON.stringify(data),{flag:'wx'})}
console.log(JSON.stringify({sha256,colors:Object.keys(colors).length,trips,shapeIds,shapesAvailable:data.shapesAvailable}))
