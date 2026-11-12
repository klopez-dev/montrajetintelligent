import { createHybridGeographicProvider } from './server/mobility/hybrid.ts'

const provider = createHybridGeographicProvider()

try {
  const results = await provider.addresses('135 avenue Lacassagne Lyon')

  console.log(JSON.stringify({
    query: '135 avenue Lacassagne Lyon',
    count: results.length,
    results: results.map(address => ({
      name: address.name,
      id: address.id,
      precision: address.precision,
      source: address.source,
      latitude: address.latitude,
      longitude: address.longitude
    }))
  }, null, 2))

  if (!results.some(address => address.precision === 'housenumber')) {
    process.exitCode = 1
  }
} catch (error) {
  console.error('Erreur de geocodage :', error)
  process.exitCode = 1
}
