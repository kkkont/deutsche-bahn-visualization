import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { summarizeStations } from '../src/data/delayExplorer.ts'
import type { ExplorerDataset } from '../src/data/delayExplorer.ts'

const fixture: ExplorerDataset = JSON.parse(readFileSync(new URL('../src/data/delay-explorer-demo.json', import.meta.url), 'utf8'))

test('station mean uses observation counts, keeps measured zero, and distinguishes missing data', () => {
  const stations = fixture.stations.slice(0, 3)
  const data: ExplorerDataset = { ...fixture, stations, daily: [
    { stationId: stations[0].stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: stations[0].stationId, date: '2024-07-02', totalDelayMinutes: 90, delayObservations: 90 },
    { stationId: stations[0].stationId, date: '2024-08-01', totalDelayMinutes: 999, delayObservations: 1 },
    { stationId: stations[1].stationId, date: '2024-07-01', totalDelayMinutes: 0, delayObservations: 10 },
    { stationId: stations[2].stationId, date: '2024-07-01', totalDelayMinutes: 0, delayObservations: 0 },
  ] }
  const [weighted, zero, missing] = summarizeStations(data)
  assert.equal(weighted.averageDelayMinutes, 100 / 91)
  assert.equal(weighted.delayObservations, 91)
  assert.equal(zero.averageDelayMinutes, 0)
  assert.equal(missing.averageDelayMinutes, null)
  assert.equal(missing.delayObservations, 0)
})

test('fixture has unique EVA identities, four complete weeks, and intentional coverage scenarios', () => {
  assert.equal(fixture.synthetic, true)
  assert.equal(fixture.stations.length, 21)
  const ids = new Set(fixture.stations.map((station) => station.stationId))
  assert.equal(ids.size, 21)
  assert.ok(fixture.stations.every((station) => /^\d{7}$/.test(station.stationId)))
  const dates = [...new Set(fixture.daily.map((row) => row.date))].sort()
  assert.equal(dates.length, 28)
  assert.equal(new Date(`${dates[0]}T00:00:00Z`).getUTCDay(), 1)
  assert.equal(new Date(`${dates[27]}T00:00:00Z`).getUTCDay(), 0)
  assert.equal(new Set(fixture.daily.map((row) => `${row.stationId}:${row.date}`)).size, fixture.daily.length)
  assert.equal(fixture.daily.length, 21 * 28 - 1)
  assert.ok(fixture.daily.every((row) => ids.has(row.stationId) && row.delayObservations >= 0 && row.totalDelayMinutes >= 0))
  assert.ok(fixture.daily.some((row) => row.delayObservations > 0 && row.totalDelayMinutes === 0))
  assert.equal(summarizeStations(fixture).filter((station) => station.averageDelayMinutes === null).length, 1)
})
