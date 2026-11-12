import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDays, localServiceDate, normalizeSearch, parseGtfsDate, parseGtfsTime, serviceActive, serviceDayOrigin } from '../server/gtfs/time.ts'

test('Les horaires GTFS conservent les heures au-delà de 24 et 48 heures', () => {
  assert.equal(parseGtfsTime('7:05:09'), 25509)
  assert.equal(parseGtfsTime('24:10:00'), 87000)
  assert.equal(parseGtfsTime('49:00:00'), 176400)
  for (const value of ['-1:00:00', '12:60:00', '24:00', 'NaN', '']) assert.throws(() => parseGtfsTime(value))
})
test('Dates réelles, année bissextile et changement d’année', () => {
  assert.equal(parseGtfsDate('20240229'), '2024-02-29')
  for (const value of ['20260229', '20261301', '20260431', '2026-01-01']) assert.throws(() => parseGtfsDate(value))
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2024-03-01', -1), '2024-02-29')
})
const weekdays = { id: 'TEST', startDate: '2026-11-01', endDate: '2026-11-30', weekdays: [1,1,1,1,1,0,0] }
test('Calendrier hebdomadaire, bornes inclusives, aucune activité hors validité', () => {
  assert.equal(serviceActive(weekdays, '2026-11-09'), true)
  assert.equal(serviceActive(weekdays, '2026-11-08'), false)
  assert.equal(serviceActive(weekdays, '2026-11-30'), true)
  assert.equal(serviceActive(weekdays, '2026-12-01'), false)
  assert.equal(serviceActive(weekdays, '2026-10-30'), false)
})
test('Les exceptions ajoutent et suppriment un service et priment sur la semaine', () => {
  assert.equal(serviceActive(weekdays, '2026-11-11', 2), false)
  assert.equal(serviceActive(weekdays, '2026-11-08', 1), true)
  assert.equal(serviceActive(undefined, '2026-11-08', 1), true)
  assert.equal(serviceActive(undefined, '2026-11-08'), false)
  assert.equal(serviceActive(weekdays, '2026-12-25', 1), true)
})
test('Origine des jours de service : Europe/Paris en hiver et en été', () => {
  assert.equal(new Date(serviceDayOrigin('2026-11-08', 'Europe/Paris')).toISOString(), '2026-11-07T23:00:00.000Z')
  assert.equal(new Date(serviceDayOrigin('2026-07-08', 'Europe/Paris')).toISOString(), '2026-07-07T22:00:00.000Z')
})
test('Passage à l’heure d’été : midi moins 12 h, sans décalage inventé', () => {
  const origin = serviceDayOrigin('2026-03-29', 'Europe/Paris')
  assert.equal(new Date(origin).toISOString(), '2026-03-28T22:00:00.000Z')
  assert.equal(new Date(origin + parseGtfsTime('08:00:00') * 1000).toISOString(), '2026-03-29T06:00:00.000Z')
})
test('Passage à l’heure d’hiver : distinction des deux heures répétées', () => {
  const origin = serviceDayOrigin('2026-10-25', 'Europe/Paris')
  assert.equal(new Date(origin).toISOString(), '2026-10-24T23:00:00.000Z')
  assert.equal(new Date(origin + 3600_000).toISOString(), '2026-10-25T00:00:00.000Z')
  assert.equal(new Date(origin + 2 * 3600_000).toISOString(), '2026-10-25T01:00:00.000Z')
})
test('Un instant UTC de la veille peut appartenir au jour civil lyonnais suivant', () => {
  assert.equal(localServiceDate(Date.parse('2026-11-08T23:30:00Z'), 'Europe/Paris'), '2026-11-09')
})
test('Recherche normalisée : accents, ligatures et ponctuation', () => {
  assert.equal(normalizeSearch('  École — Part-Dieu / Cœur '), 'ecole part dieu coeur')
})
