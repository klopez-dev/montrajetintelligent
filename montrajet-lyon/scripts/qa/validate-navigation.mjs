import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startBrowser } from './browser-driver.mjs'
import { startLocalServer } from './local-server.mjs'

const server = await startLocalServer()
const browser = await startBrowser(await mkdtemp(join(tmpdir(), 'mtl-navigation-')))
const d = browser.driver
 d.on('Runtime.exceptionThrown', event => console.error('BROWSER EXCEPTION', event.exceptionDetails.exception?.description || event.exceptionDetails.text))
const tab = () => d.evaluate('document.querySelector("nav [aria-current=page]")?.textContent.trim()')
try {
  await d.send('Page.navigate', { url: server.url + '/' })
  await d.wait('document.querySelector("nav [aria-current=page]")')
  assert.equal(await tab(), 'Accueil')
  await d.type('.journey-stop-fields .gtfs-search-field:first-child input', 'Place Henri')
  await d.click('nav button:nth-child(3)')
  assert.equal(await tab(), 'Horaires')
  assert.equal(await d.evaluate('new URL(location.href).searchParams.get("page")'), 'horaires')
  await d.wait('!document.querySelector(".standalone .gtfs-search-field:first-child input").disabled')
  await d.type('.standalone .gtfs-search-field:first-child input', 'C13')
  await d.click('nav button:nth-child(5)')
  assert.equal(await tab(), 'Favoris')
  await d.send('Page.navigateToHistoryEntry', { entryId: (await d.send('Page.getNavigationHistory')).entries.at(-2).id })
  await d.wait('document.querySelector("nav [aria-current=page]")?.textContent.includes("Horaires")')
  assert.equal(await tab(), 'Horaires')
  assert.equal(await d.evaluate('document.querySelector(".standalone .gtfs-search-field:first-child input").value'), 'C13')
  await d.send('Page.navigateToHistoryEntry', { entryId: (await d.send('Page.getNavigationHistory')).entries.find(entry => entry.url === server.url + '/').id })
  await d.wait('document.querySelector("nav [aria-current=page]")?.textContent.includes("Accueil")')
  assert.equal(await d.evaluate('document.querySelector(".journey-stop-fields .gtfs-search-field:first-child input").value'), 'Place Henri')
  await d.send('Page.navigateToHistoryEntry', { entryId: (await d.send('Page.getNavigationHistory')).entries.at(-1).id })
  await d.wait('document.querySelector("nav [aria-current=page]")?.textContent.includes("Favoris")')
  await d.reload()
  assert.equal(await tab(), 'Favoris')
  await d.send('Page.navigate', { url: server.url + '/?page=trafic' })
  await d.wait('document.querySelector("nav [aria-current=page]")?.textContent.includes("Trafic")')
  assert.equal(await tab(), 'Trafic')
  for (const width of [320, 390, 768, 1440]) {
    await d.send('Emulation.setDeviceMetricsOverride', { width, height: 844, deviceScaleFactor: 1, mobile: width < 768 })
    assert.ok(await d.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), `Débordement à ${width}px`)
  }
  console.log('Navigation : Retour, Suivant, actualisation, lien direct et 320/390/768/1440 px réussis')
} finally {
  await browser.close()
  await server.close()
}
