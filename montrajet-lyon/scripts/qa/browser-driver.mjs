import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

class DevTools {
  constructor(socket, sessionId) {
    this.socket = socket
    this.sessionId = sessionId
    this.nextId = 0
    this.pending = new Map()
    this.listeners = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const call = this.pending.get(message.id)
        if (!call) return
        this.pending.delete(message.id)
        clearTimeout(call.timer)
        if (message.error) call.reject(new Error(JSON.stringify(message.error)))
        else call.resolve(message.result)
      } else {
        for (const callback of this.listeners.get(message.method) || []) callback(message.params, message.sessionId)
      }
    })
  }
  send(method, params = {}, sessionId = this.sessionId) {
    return new Promise((resolveCall, reject) => {
      const id = ++this.nextId
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)) }, 15000)
      this.pending.set(id, { resolve: resolveCall, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  on(method, callback) {
    const listeners = this.listeners.get(method) || []
    listeners.push(callback)
    this.listeners.set(method, listeners)
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true })
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text)
    return response.result.value
  }
  async wait(expression, timeout = 10000) {
    const end = Date.now() + timeout
    do {
      const result = await this.evaluate(`Boolean(${expression})`)
      if (result) return result
      await delay(40)
    } while (Date.now() < end)
    throw new Error(`DOM condition timeout: ${expression}`)
  }
  async reload() {
    let navigated=false,loaded=false
    this.on('Page.frameNavigated',event=>{if(!event.frame.parentId)navigated=true})
    this.on('Page.loadEventFired',()=>{if(navigated)loaded=true})
    await this.send('Page.reload')
    const deadline=Date.now()+30000
    while(!loaded){if(Date.now()>deadline)throw new Error('Rechargement navigateur non terminé');await delay(40)}
  }
  async click(selector) {
    const rect = await this.evaluate(`(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) throw new Error('Element absent: ' + ${JSON.stringify(selector)});
      element.scrollIntoView({block:'center'});
      const r=element.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};
    })()`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rect, button: 'left', clickCount: 1 })
  }
  async type(selector, text) {
    await this.click(selector)
    // Sélection/remplacement par événements clavier natifs et saisie du navigateur.
    await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2, windowsVirtualKeyCode: 65 })
    if (text) await this.send('Input.insertText', { text })
    else {
      await this.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
      await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    }
  }
  async date(value, selector = 'input[type="datetime-local"]') {
    // L'événement input natif reste celui consommé par React pour datetime-local.
    await this.evaluate(`(() => {
      const input=document.querySelector(${JSON.stringify(selector)});
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(value)});
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`)
  }
  async screenshot(path) {
    await this.evaluate('window.scrollTo(0,0)')
    const { contentSize } = await this.send('Page.getLayoutMetrics')
    const result = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: contentSize.width, height: contentSize.height, scale: 1 } })
    await writeFile(path, Buffer.from(result.data, 'base64'), { flag: 'wx' })
  }
}

export async function startBrowser(outputDirectory, existingProfile) {
  const executable = process.env.BROWSER_BIN || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '')
  if (!existsSync(executable)) throw new Error('Navigateur absent. Définir BROWSER_BIN avec un Chromium/Edge local existant.')
  await mkdir(outputDirectory, { recursive: true })
  if(existingProfile && !resolve(existingProfile).startsWith(resolve(outputDirectory)+'\\'))throw new Error('Profil de test hors du dossier de validation.')
  const profile = existingProfile || await mkdtemp(resolve(outputDirectory, 'edge-profile-'))
  // Only the verified isolated QA profile: an old port file must not be mistaken for the new browser.
  if (existingProfile) await unlink(resolve(profile,'DevToolsActivePort')).catch(error => { if(error.code!=='ENOENT')throw error })
  const child = spawn(executable, ['--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = ''
  child.stderr.on('data', data => { logs += data.toString() })
  child.on('error', error => { logs += error.message })
  const deadline = Date.now() + 20000
  let port
  while (!port && Date.now() < deadline) {
    try { port = Number((await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]) }
    catch { await delay(100) }
    if (child.exitCode !== null) throw new Error(`Le navigateur s'est arrêté : ${logs.slice(-2000)}`)
  }
  if (!port) { child.kill(); throw new Error(`DevTools indisponible : ${logs.slice(-2000)}`) }
  let version
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() }
  catch(error){ if(child.exitCode===null)child.kill(); throw error }
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }) })
  const driver = new DevTools(socket)
  try {
    const target = await driver.send('Target.createTarget', { url: 'about:blank' })
    const attached = await driver.send('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    driver.sessionId = attached.sessionId
    await driver.send('Page.enable')
    await driver.send('Runtime.enable')
    await driver.send('Network.enable')
    await driver.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Paris' })
    await driver.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  } catch (error) {
    try { await driver.send('Browser.close', {}, undefined) } catch { /* Arrêt de ce seul navigateur de test. */ }
    socket.close()
    if (child.exitCode === null) child.kill()
    throw new Error(`${error.message}\n${logs.slice(-3000)}`)
  }
  return {
    driver, profile, version: version.Browser,
    async close() {
      try { await driver.send('Browser.close', {}, undefined) } catch { /* Déjà fermé. */ }
      socket.close()
      if (child.exitCode === null) {
        await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(4000)])
        if (child.exitCode === null) child.kill()
      }
    },
  }
}
