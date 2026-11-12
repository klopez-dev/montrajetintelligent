import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const script=fileURLToPath(new URL('./credential-store.ps1',import.meta.url))
if(process.platform!=='win32'){console.error('Initialisation locale DPAPI disponible uniquement sous Windows.');process.exitCode=1}
else {
 const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',script,'-Action','Initialize'],{stdio:'inherit',windowsHide:true,timeout:30000})
 if(result.status!==0){console.error('Initialisation non validée ; aucun identifiant nouveau n’a été enregistré.');process.exitCode=1}
}
