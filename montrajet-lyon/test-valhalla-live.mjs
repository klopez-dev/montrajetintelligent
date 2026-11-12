import { createValhallaProvider } from './server/mobility/valhalla.ts'
import { geographicTrace } from './server/mobility/provider.ts'

const provider = createValhallaProvider()
const trace = geographicTrace()

const from = {
  latitude: 45.7488478,
  longitude: 4.8782357
}

const to = {
  latitude: 45.7500,
  longitude: 4.8800
}

console.log('=== TEST REEL VALHALLA ===')

const first = await provider.walk(from, to, trace)

console.log('Source :', first.source)
console.log('Distance :', first.distanceMeters, 'm')
console.log('Duree :', first.durationSeconds, 'secondes')
console.log('Points cartographiques :', first.geometry.coordinates.length)
console.log('Raccordement depart :', first.startSnapMeters.toFixed(2), 'm')
console.log('Raccordement arrivee :', first.endSnapMeters.toFixed(2), 'm')

if (
  first.distanceMeters <= 0 ||
  first.durationSeconds <= 0 ||
  first.geometry.coordinates.length < 2 ||
  first.startSnapMeters > 25 ||
  first.endSnapMeters > 25
) {
  throw new Error('Validation du parcours echouee')
}

console.log('=== TEST CACHE ===')

const second = await provider.walk(from, to, trace)

if (second !== first || trace.cacheHits !== 1 || trace.upstreamRequests !== 1) {
  throw new Error('Cache Valhalla invalide')
}

console.log('Requetes reseau :', trace.upstreamRequests)
console.log('Cache hits :', trace.cacheHits)
console.log('=== TESTS REUSSIS ===')
