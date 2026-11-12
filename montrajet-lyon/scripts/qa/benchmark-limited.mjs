import { writeFile } from 'node:fs/promises'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:54829'
const cases = [
  ['Place Henri', '2397', '36394'],
  ['Harmonie Campus Pro', '1138', '36394'],
  ['Dauphiné-Lacassagne', '35660', '35668'],
]
const report = { at: new Date().toISOString(), cases: [] }
for (const [name, fromStopId, toStopId] of cases) {
  const samples = []
  for (let i = 0; i < 4; i++) {
    const query = new URLSearchParams({ fromStopId, toStopId, at: '2026-11-09T10:00:00Z', mode: 'departure', order: 'arrival', marginSeconds: '120', maxTransfers: '2' })
    const start = performance.now()
    const response = await fetch(`${base}/api/journeys/search?${query}`)
    const body = await response.json()
    if (!response.ok || body.status !== 'connected') throw new Error(`${name}: HTTP ${response.status}`)
    samples.push({ httpMs: performance.now() - start, state: body.data.state, metrics: body.data.metrics, first: body.data.itineraries[0] && { arrivalTime: body.data.itineraries[0].arrivalTime, trips: body.data.itineraries[0].legs.map(leg => leg.tripId) }, warnings: body.data.warnings.filter(warning => warning.startsWith('Budget')) })
  }
  report.cases.push({ name, samples })
  console.log(name, samples.map(sample => Math.round(sample.httpMs)).join('/'), 'ms')
}
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2))
