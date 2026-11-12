import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {parse,serializeOuter} from 'parse5'
import {find,hasClass} from '../../server/traffic/html.ts'
const root='tests/fixtures/traffic';await mkdir(root,{recursive:true})
for(const [name,index]of [['c16',4],['t3',5],['d',6]]){
 const html=await readFile('.data/traffic-reliability-before-1794244013582/page-'+index+'.html','utf8')
 const main=find(parse(html),n=>hasClass(n,'alert-detail-page'))[0]
 await writeFile(root+'/tcl-'+name+'-2026-11-09.html','<!-- Official public TCL excerpt, collected 2026-11-09. Non-commercial reproduction, source and provenance: docs/FIABILISATION-TRAFIC.md. Tests only. -->\n'+serializeOuter(main))
}
