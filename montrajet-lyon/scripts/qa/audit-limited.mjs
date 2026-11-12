import { DatabaseSync } from 'node:sqlite'
import { writeFile } from 'node:fs/promises'
import { createJourneyPlanner } from '../../server/journeys/planner.ts'
import { createNetworkPlanner } from '../../server/journeys/network.ts'
import { defaultRoutingLimits } from '../../server/journeys/limits.ts'
import { auditJourney } from '../../tests/helpers/journeys.mjs'

const sqlite = new DatabaseSync('.data/gtfs.sqlite', { readOnly: true })
const db = { all: async (sql, values = []) => sqlite.prepare(sql).all(...values) }
const legacy = createJourneyPlanner(db)
const normal = createNetworkPlanner(db)
const expanded = createNetworkPlanner(db, { ...defaultRoutingLimits, maxLabelsPerStop: 256, maxLabels: 100000, maxEvents: 480000, deadlineMs: 90000 })
const cases = [
  ['Place Henri', '2397', '36394'],
  ['Harmonie Campus Pro', '1138', '36394'],
  ['Dauphiné-Lacassagne', '35660', '35668'],
]
const report = { at: new Date().toISOString(), method: 'legacy SQL par paires (0/1 correspondance) versus réseau par tours normal/élargi ; base SQLite en lecture seule', cases: [] }
const summary = result => ({ state: result.state, metrics: result.metrics, warnings: result.warnings.filter(w => w.startsWith('Budget')), proposals: result.itineraries.map(j => ({ departureTime: j.departureTime, arrivalTime: j.arrivalTime, transfers: j.transfers, trips: j.legs.map(leg => leg.tripId) })) })
try {
  for (const [name, fromStopId, toStopId] of cases) {
    const query = { fromStopId, toStopId, at: '2026-11-09T10:00:00Z', mode: 'departure', order: 'arrival', marginSeconds: 120, maxTransfers: 2 }
    const [one, two, wider] = await Promise.all([
      legacy.search({ ...query, maxTransfers: 1 }), normal.search(query), expanded.search(query),
    ])
    for (const result of [one, two, wider]) for (const journey of result.itineraries) auditJourney(sqlite, result, journey)
    const sameOrEarlier = (candidate, reference) => candidate && (!reference || Date.parse(candidate.arrivalTime) <= Date.parse(reference.arrivalTime))
    const legacyBest = one.itineraries[0], normalBest = two.itineraries[0], expandedBest = wider.itineraries[0]
    if (!sameOrEarlier(normalBest, legacyBest) && legacyBest) throw new Error(`${name}: le réseau manque une meilleure solution 0/1 correspondance`)
    const row = { name, legacy: summary(one), normal: summary(two), expanded: summary(wider), expandedImprovesArrival: Boolean(expandedBest && normalBest && Date.parse(expandedBest.arrivalTime) < Date.parse(normalBest.arrivalTime)) }
    report.cases.push(row)
    console.log(name, 'legacy', legacyBest?.arrivalTime || 'aucun', 'normal', normalBest?.arrivalTime || 'aucun', 'élargi', expandedBest?.arrivalTime || 'aucun', 'amélioration', row.expandedImprovesArrival)
  }
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2))
} finally { sqlite.close() }
