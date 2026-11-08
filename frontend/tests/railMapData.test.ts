import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { prepareRailMap } from '../src/data/railMapData.ts'
import type { Dataset, StationMetric } from '../src/data/types.ts'
import type { StationLocations } from '../src/data/railMapData.ts'

const locations: StationLocations = { type: 'FeatureCollection', features: ['a', 'b', 'missing'].map((id) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates: [10, 52] }, properties: { id, name: id },
})) }
const row = (stationId: string, count: number, sum: number, observations = count): StationMetric => ({
  stationId, stationName: 'Unreliable label', latitude: 0, longitude: 0, evas: [], trainTypes: ['ICE'],
  observations, delayObservations: count, totalDelayMinutes: sum, averageDelayMinutes: 999,
  delayedOverFivePercent: 20, cancelledPercent: 10,
})
const dataset = (stations: StationMetric[]): Dataset => ({ period: '2025-11/2026-10', source: 'test', generatedAt: '', stations, hourly: [] })

test('joins by EVA, weights service types and bins from exact totals, preserves missing versus zero', () => {
  const result = prepareRailMap(dataset([row('a', 1, 20), row('a', 9, 0), row('b', 90, 0), row('missing', 0, 0, 5), row('unknown', 1000, 1000)]), locations)
  assert.equal(result.approximate, false)
  assert.equal(result.stations[0].averageDelayMinutes, 2)
  assert.equal(result.stations[0].stationName, 'a')
  assert.equal(result.stations[1].averageDelayMinutes, 0)
  assert.equal(result.stations[2].averageDelayMinutes, null)
  assert.equal(result.stations[2].observations, 5)
  assert.equal(result.stations[0].delayedOverFivePercent, 20)
  assert.equal(result.stations[0].cancelledPercent, 10)
  assert.deepEqual(result.stations[0].trainTypes, ['ICE'])
  assert.equal(result.cells.length, 1)
  assert.equal(result.cells[0].averageDelayMinutes, 0.2)
  assert.equal(result.cells[0].delayObservations, 100)
  assert.equal(result.cells[0].measuredStationCount, 2)
})

test('legacy summaries are explicitly approximate and remain observation weighted', () => {
  const legacy = row('a', 2, 0)
  delete legacy.totalDelayMinutes
  legacy.averageDelayMinutes = 3
  const result = prepareRailMap(dataset([legacy, row('b', 4, 0)]), locations)
  assert.equal(result.approximate, true)
  assert.equal(result.cells[0].averageDelayMinutes, 1)
})

test('current annual export maps all 200 stations once and conserves all measured stops', () => {
  const data: Dataset = JSON.parse(readFileSync(new URL('../public/data/demo.json', import.meta.url), 'utf8'))
  const geo: StationLocations = JSON.parse(readFileSync(new URL('../public/data/stations.geojson', import.meta.url), 'utf8'))
  const result = prepareRailMap(data, geo)
  assert.equal(data.months?.length, 12)
  assert.equal(result.stations.length, 200)
  assert.equal(result.stations.filter((station) => station.delayObservations > 0).length, 200)
  assert.equal(new Set(result.cells.flatMap((cell) => cell.stations.map((station) => station.stationId))).size, 200)
  assert.equal(result.cells.reduce((sum, cell) => sum + cell.delayObservations, 0), data.stations.reduce((sum, row) => sum + row.delayObservations, 0))
})
