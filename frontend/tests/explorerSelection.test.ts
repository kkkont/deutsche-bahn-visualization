import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { explorationReducer, initialExploration, intervalFromBrush, normalizeInterval, scopeDataset } from '../src/data/explorerSelection.ts'
import { summarizeStations } from '../src/data/delayExplorer.ts'
import { summarizeTimeline, calendarTimestamp } from '../src/data/delayTimeline.ts'
import { summarizeHexagons } from '../src/data/delayHexagons.ts'
import { summarizeProfiles } from '../src/data/delayProfiles.ts'
import type { ExplorerDataset } from '../src/data/delayExplorer.ts'

const fixture: ExplorerDataset = JSON.parse(readFileSync(new URL('../src/data/delay-explorer-demo.json', import.meta.url), 'utf8'))
const bounds = { start: fixture.periodStart, end: fixture.periodEnd }

test('select, add, brush, switch resolution, clear dates, clear stations and reset preserve independent state', () => {
  const a = fixture.stations[0].stationId, b = fixture.stations[1].stationId
  let state = initialExploration(bounds)
  state = explorationReducer(state, { type: 'station', id: a })
  state = explorationReducer(state, { type: 'add-mode', enabled: true })
  state = explorationReducer(state, { type: 'station', id: b })
  assert.deepEqual(state.selectedStationIds, [a, b])
  state = explorationReducer(state, { type: 'dates', range: { start: '2024-07-10', end: '2024-07-12' } })
  state = explorationReducer(state, { type: 'hover', id: fixture.stations[2].stationId })
  assert.deepEqual(state.selectedStationIds, [a, b])
  state = explorationReducer(state, { type: 'hover', id: null })
  assert.deepEqual(state.dateRange, { start: '2024-07-10', end: '2024-07-12' })
  state = explorationReducer(state, { type: 'resolution', resolution: 'weekly' })
  assert.deepEqual(state.dateRange, { start: '2024-07-08', end: '2024-07-14' })
  assert.deepEqual(state.selectedStationIds, [a, b])
  state = explorationReducer(state, { type: 'clear-dates' })
  assert.equal(state.dateRange, null)
  assert.deepEqual(state.selectedStationIds, [a, b])
  state = explorationReducer(state, { type: 'clear-stations' })
  assert.deepEqual(state.selectedStationIds, [])
  assert.equal(state.resolution, 'weekly')
  state = explorationReducer(state, { type: 'reset' })
  assert.deepEqual(state, initialExploration(bounds))
})

test('normal selection replaces, additive toggles, and group selection removes duplicate identities', () => {
  let state = initialExploration(bounds)
  state = explorationReducer(state, { type: 'station', id: 'a' })
  state = explorationReducer(state, { type: 'station', id: 'b' })
  assert.deepEqual(state.selectedStationIds, ['b'])
  state = explorationReducer(state, { type: 'station', id: 'a', additive: true })
  assert.deepEqual(state.selectedStationIds, ['b', 'a'])
  state = explorationReducer(state, { type: 'station', id: 'a', additive: true })
  assert.deepEqual(state.selectedStationIds, ['b'])
  state = explorationReducer(state, { type: 'station', id: 'b' })
  assert.deepEqual(state.selectedStationIds, [])
  state = explorationReducer(state, { type: 'stations', ids: ['a', 'a', 'b'] })
  assert.deepEqual(state.selectedStationIds, ['a', 'b'])
})

test('brush snaps inclusive dates and weeks without gaining a day when moved programmatically', () => {
  const start = calendarTimestamp('2024-07-08'), end = calendarTimestamp('2024-07-14')
  assert.deepEqual(intervalFromBrush(start - 43_200_000, end + 43_200_000, bounds, 'daily'), { start: '2024-07-08', end: '2024-07-14' })
  assert.deepEqual(intervalFromBrush(calendarTimestamp('2024-07-10'), calendarTimestamp('2024-07-12'), bounds, 'weekly'), { start: '2024-07-08', end: '2024-07-14' })
  assert.equal(normalizeInterval(bounds, bounds, 'daily'), null)
  assert.deepEqual(normalizeInterval({ start: '2024-08-01', end: '2024-08-02' }, bounds, 'weekly'), { start: '2024-07-22', end: '2024-07-28' })
  assert.deepEqual(intervalFromBrush(start + 1000, start + 2000, bounds, 'daily'), { start: '2024-07-08', end: '2024-07-08' })
})

test('all scoped views conserve the same counts while the contextual timeline retains every day', () => {
  const ids = fixture.stations.slice(0, 3).map((station) => station.stationId)
  const range = { start: '2024-07-08', end: '2024-07-14' }
  const scoped = scopeDataset(fixture, range, ids)
  const expected = fixture.daily.filter((row) => ids.includes(row.stationId) && row.date >= range.start && row.date <= range.end && row.delayObservations > 0)
  const expectedCount = expected.reduce((sum, row) => sum + row.delayObservations, 0)
  const expectedSum = expected.reduce((sum, row) => sum + row.totalDelayMinutes, 0)
  assert.equal(summarizeStations(scoped).reduce((sum, station) => sum + station.delayObservations, 0), expectedCount)
  assert.equal(summarizeHexagons(scoped).reduce((sum, cell) => sum + cell.delayObservations, 0), expectedCount)
  assert.equal(summarizeProfiles(scoped).weekdays.average[0].delayObservations, expectedCount)
  assert.equal(summarizeProfiles(scoped).weekdays.average[0].averageDelayMinutes, expectedSum / expectedCount)
  assert.equal(summarizeTimeline(scopeDataset(fixture, null, ids), 'daily').aggregatePoints.length, 28)
  assert.strictEqual(scoped.daily, fixture.daily)
})
