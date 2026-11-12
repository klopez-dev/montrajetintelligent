import { createValhallaProvider } from './server/mobility/valhalla.ts'
import { geographicTrace } from './server/mobility/provider.ts'

const provider = createValhallaProvider()
const trace = geographicTrace()

const from = {
  latitude: 45.7488478,
  longitude: 4.8782357
}

const to = {
  latitude: 45.749865,
  longitude: 4.880478
}

console.log('=== VALIDATION VALHALLA ===')

const first = await provider.walk(from, to, trace)

console.log('Distance :', first.distanceMeters, 'm')
console.log('Duree :', first.durationSeconds, 's')
console.log('Points :', first.geometry.coordinates.length)
console.log('Raccordement depart :', first.startSnapMeters.toFixed(2), 'm')
console.log('Raccordement arrivee :', first.endSnapMeters.toFixed(2), 'm')

const second = await provider.walk(from, to, trace)

if (
  second !== first ||
  trace.upstreamRequests !== 1 ||
  trace.cacheHits !== 1
) {
  throw new Error('Echec du test cache')
}

console.log('Requetes reseau :', trace.upstreamRequests)
console.log('Cache hits :', trace.cacheHits)
console.log('=== TESTS REUSSIS ===')
