import { writeFile } from 'node:fs/promises'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:54829'
const samples = [
  { name: 'Lyon', from: { kind: 'address', id: 'address:69383_4080_00100', name: '100 Avenue Lacassagne 69003 Lyon' }, to: { kind: 'stop', id: '35668' } },
  { name: 'Villeurbanne', from: { kind: 'address', id: 'address:69266_3505_00010', name: '10 Cours de la République 69100 Villeurbanne' }, to: { kind: 'stop', id: '36394' } },
]
const report = { at: new Date().toISOString(), cases: [] }
for (const sample of samples) {
  const query = { from: sample.from, to: sample.to, at: '2026-11-09T10:00:00Z', mode: 'departure', order: 'arrival', marginSeconds: 120, walkingTransfers: true, maxTransfers: 2 }
  const runs = []
  for (let i = 0; i < 3; i++) {
    const started = performance.now()
    const response = await fetch(`${base}/api/mobility/search`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query), signal: AbortSignal.timeout(90000) })
    const body = await response.json()
    if (!response.ok || body.status !== 'connected') throw new Error(`${sample.name}: HTTP ${response.status}: ${body.error || body.message || 'réponse invalide'}`)
    const result = body.data
    runs.push({ httpMs: performance.now() - started, state: result.state, metrics: result.metrics, first: result.itineraries[0] && { departureTime: result.itineraries[0].departureTime, arrivalTime: result.itineraries[0].arrivalTime, trips: result.itineraries[0].transit.legs.map(leg => leg.tripId), accessMeters: result.itineraries[0].access?.distanceMeters, accessSeconds: result.itineraries[0].access?.durationSeconds }, limitWarnings: result.warnings.filter(w => w.startsWith('Budget')) })
  }
  report.cases.push({ name: sample.name, runs })
  console.log(sample.name, runs.map(run => Math.round(run.httpMs)).join('/'), 'ms', 'requêtes amont', runs.map(run => run.metrics.upstreamRequests).join('/'))
}
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2))
