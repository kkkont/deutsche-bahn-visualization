import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { buildStationHours, hourlyIsApproximate, refreshCell, summarizeHourly } from '../src/data/linkedHourly.ts'
import { prepareRailMap } from '../src/data/railMapData.ts'
import { binStationTotals } from '../src/data/delayHexagons.ts'
import { drillIntoCell } from '../src/data/railMapDrilldown.ts'
import type { Dataset, HourPoint } from '../src/data/types.ts'
import type { RailStation } from '../src/data/railMapData.ts'

const station = (id: string): RailStation => ({ stationId: id, stationName: id, latitude: 52, longitude: 10,
  evas: [id], trainTypes: [], observations: 0, totalDelayMinutes: 0, delayObservations: 0,
  averageDelayMinutes: null, delayedOverFivePercent: null, cancelledPercent: null })
const row = (stationId: string, hour: number, count: number, total: number): HourPoint => ({
  stationId, hour, trainType: 'ICE', delayObservations: count, totalDelayMinutes: total, averageDelayMinutes: 999,
})

test('hourly linking pools raw service totals and preserves measured zero and absent hours', () => {
  const hours = buildStationHours([station('a'), station('b')], [row('a', 12, 1, 20), row('a', 12, 9, 0), row('b', 12, 90, 0), row('unknown', 12, 1, 999), row('b', 0, 0, 999)])
  assert.equal(hours.length, 24)
  assert.equal(hours[12][0].averageDelayMinutes, 2)
  assert.equal(hours[12][1].averageDelayMinutes, 0)
  assert.equal(hours[0][1].averageDelayMinutes, null)
  const all = summarizeHourly(hours, [])
  assert.equal(all[12].averageDelayMinutes, 0.2)
  assert.equal(all[12].delayObservations, 100)
  assert.equal(all[0].averageDelayMinutes, null)
  assert.equal(summarizeHourly(hours, ['a'])[12].averageDelayMinutes, 2)
  assert.equal(summarizeHourly(hours, ['unknown'])[12].averageDelayMinutes, null)
})

test('legacy hourly means are weighted by observation count and flagged approximate', () => {
  const legacy = row('a', 1, 2, 0); delete legacy.totalDelayMinutes; legacy.averageDelayMinutes = 3
  const dataset: Dataset = { period: '', generatedAt: '', source: '', stations: [], hourly: [legacy, row('b', 1, 4, 0)] }
  const result = summarizeHourly(buildStationHours([station('a'), station('b')], dataset.hourly), [])
  assert.equal(result[1].averageDelayMinutes, 1)
  assert.equal(hourlyIsApproximate(dataset), true)
  assert.equal(hourlyIsApproximate({ ...dataset, hourly: [row('a', 1, 2, 6)] }), false)
})

test('map and linked charts agree for bins and stations across every hour and preserve geometry', () => {
  const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
  const dataset: Dataset = read('demo.json')
  const model = prepareRailMap(dataset, read('stations.geojson'))
  const hours = buildStationHours(model.stations, dataset.hourly)
  const parent = model.cells.find((cell) => cell.stations.length === 37)!
  const children = drillIntoCell(parent, model.stations)
  const detail = drillIntoCell(children.find((cell) => cell.stations.length === 24)!, model.stations, 2000)
  for (const cell of [parent, ...children, ...detail]) {
    const profile = summarizeHourly(hours, cell.stations.map((item) => item.stationId))
    for (let hour = 0; hour < 24; hour++) {
      const refreshed = refreshCell(cell, new Map(hours[hour].map((item) => [item.stationId, item])))
      assert.equal(refreshed.averageDelayMinutes, profile[hour].averageDelayMinutes)
      assert.equal(refreshed.delayObservations, profile[hour].delayObservations)
      assert.equal(refreshed.coordinates, cell.coordinates)
      assert.equal(refreshed.stations, cell.stations)
    }
  }
  const all = summarizeHourly(hours, [])
  assert.equal(all.reduce((sum, point) => sum + point.delayObservations, 0), dataset.hourly.reduce((sum, row) => sum + row.delayObservations, 0))
  const empty = refreshCell(binStationTotals([station('absent')], [station('absent')])[0], new Map())
  assert.equal(empty.averageDelayMinutes, null)
})
