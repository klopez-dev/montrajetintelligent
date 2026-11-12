import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { loadLocalCredential, serverCredential } from '../server/realtime/credentials.ts'
import { grandLyonConfig } from '../server/realtime/config.ts'
import { handleRealtimeRequest } from '../server/realtime/api.ts'

test('Le coffre local absent laisse le GTFS fonctionnel et ne révèle aucun secret', async () => {
  assert.equal(loadLocalCredential(resolve('.data/credential-absent-test.clixml')), null)
  assert.equal(serverCredential({}, null), null)
  assert.deepEqual(serverCredential({ GRANDLYON_USERNAME: 'TEST_USER', GRANDLYON_PASSWORD: 'TEST_PASSWORD' }, null), { username: 'TEST_USER', password: 'TEST_PASSWORD' })
  const config=grandLyonConfig({ GRANDLYON_USERNAME: 'TEST_USER', GRANDLYON_PASSWORD: 'TEST_PASSWORD' })
  const response=await handleRealtimeRequest(new Request('http://localhost/api/realtime/status'), null, { get: async () => { throw Error('unexpected') } }, config.maxAgeMs, config)
  const body=await response.text()
  assert.equal(response.status,200)
  assert.equal(JSON.parse(body).reason,'policy_unconfirmed')
  assert.ok(!body.includes('TEST_USER')&&!body.includes('TEST_PASSWORD'))
})

test('Coffre Windows : DPAPI ou repli NTFS strict conserve des identifiants fictifs entre deux chargements', { skip: process.platform !== 'win32' }, async () => {
  await mkdir('.data',{recursive:true})
  const path=resolve(`.data/realtime-credential-test-${process.pid}.clixml`)
  const fallback=path.replace(/\.clixml$/,'.local.json')
  const command="$ErrorActionPreference='Stop'; $p=ConvertTo-SecureString 'TEST_PASSWORD' -AsPlainText -Force; $c=[System.Management.Automation.PSCredential]::new('TEST_USER',$p); try { $c | Export-Clixml -LiteralPath $env:MTL_TEST_STORE } catch { Remove-Item -LiteralPath $env:MTL_TEST_STORE -Force -ErrorAction SilentlyContinue; @{username='TEST_USER';password='TEST_PASSWORD'} | ConvertTo-Json -Compress | Set-Content -LiteralPath $env:MTL_TEST_FALLBACK -Encoding UTF8 -NoNewline; $sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value; & icacls.exe $env:MTL_TEST_FALLBACK /inheritance:r /grant:r ('*'+$sid+':F') | Out-Null; if($LASTEXITCODE -ne 0){throw 'acl_failed'} }"
  try {
    execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{stdio:'ignore',windowsHide:true,timeout:5000,env:{...process.env,MTL_TEST_STORE:path,MTL_TEST_FALLBACK:fallback}})
    if(await readFile(path,'utf8').catch(()=>null))assert.ok(!(await readFile(path,'utf8')).includes('TEST_PASSWORD'))
    assert.equal(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/realtime/credential-store.ps1'),'-Action','Status','-StorePath',path],{encoding:'utf8'}).trim(),'configured')
    const raw=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('scripts/realtime/credential-store.ps1'),'-Action','Read','-StorePath',path],{encoding:'utf8'}).trim()
    assert.notEqual(raw,'unavailable','Le stockage local existe mais ne peut pas être lu dans ce contexte Windows.')
    assert.deepEqual(loadLocalCredential(path),{username:'TEST_USER',password:'TEST_PASSWORD'})
    assert.deepEqual(loadLocalCredential(path),{username:'TEST_USER',password:'TEST_PASSWORD'})
  } finally { await unlink(path).catch(()=>{});await unlink(fallback).catch(()=>{}) }
})
