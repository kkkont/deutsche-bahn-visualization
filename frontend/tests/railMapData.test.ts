import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { prepareRailMap } from '../src/data/railMapData.ts'
import type { Dataset, StationMetric } from '../src/data/types.ts'
import type { StationLocations } from '../src/data/railMapData.ts'
import { calendarMonthGroups, combineMonths, filterDashboard, formatMonths, toggleCalendarMonth } from '../src/data/dashboardFilters.ts'
import { buildStationHours, summarizeHourly } from '../src/data/linkedHourly.ts'

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

test('calendar-month selection combines available years and keeps at least one month', () => {
  const months = ['2025-11', '2025-01', '2026-02', '2026-01', '2026-11']
  const groups = calendarMonthGroups(months)
  assert.deepEqual(groups[0].months, ['2025-01', '2026-01'])
  assert.deepEqual(groups[1].months, ['2026-02'])
  assert.deepEqual(groups[10].months, ['2025-11', '2026-11'])
  const january = toggleCalendarMonth(months, months, 1)
  assert.deepEqual(january, ['2025-01', '2026-01'])
  assert.deepEqual(toggleCalendarMonth(months, january, 1), january)
  assert.deepEqual(toggleCalendarMonth(months, january, 3), january)
  const withFebruary = toggleCalendarMonth(months, january, 2)
  assert.deepEqual(withFebruary, ['2025-01', '2026-02', '2026-01'])
  assert.deepEqual(toggleCalendarMonth(months, withFebruary, 1), ['2026-02'])
  const allManually = toggleCalendarMonth(months, withFebruary, 11)
  assert.deepEqual(allManually, months)
  assert.deepEqual(toggleCalendarMonth(months, allManually, 2), ['2026-02'])
})

test('selected months and services drive the same ranked stations and weighted hourly profile', () => {
  const ice = row('a', 1, 20)
  const regional = { ...row('a', 100, 0), trainTypes: ['RE'] }
  const first: Dataset = { ...dataset([ice, regional]), months: ['2026-01'],
    hourly: [{ stationId: 'a', trainType: 'ICE', hour: 12, delayObservations: 1, totalDelayMinutes: 20, averageDelayMinutes: 20 },
      { stationId: 'a', trainType: 'RE', hour: 12, delayObservations: 100, totalDelayMinutes: 0, averageDelayMinutes: 0 }] }
  const second: Dataset = { ...dataset([row('a', 9, 0), row('b', 30, 60)]), months: ['2026-03'],
    hourly: [{ stationId: 'a', trainType: 'ICE', hour: 12, delayObservations: 9, totalDelayMinutes: 0, averageDelayMinutes: 0 },
      { stationId: 'b', trainType: 'ICE', hour: 12, delayObservations: 30, totalDelayMinutes: 60, averageDelayMinutes: 2 }] }
  const combined = combineMonths([first, second], ['2026-01', '2026-03'])
  const filtered = filterDashboard(combined, locations, ['ICE'])
  assert.deepEqual(filtered.locations.features.map((feature) => feature.properties.id), ['b', 'a'])
  const map = prepareRailMap(filtered.dataset, filtered.locations)
  assert.equal(map.stations[0].averageDelayMinutes, 2)
  assert.equal(summarizeHourly(buildStationHours(map.stations, filtered.dataset.hourly), [])[12].averageDelayMinutes, 2)
  assert.equal(map.stations.find((item) => item.stationId === 'a')?.averageDelayMinutes, 2)
  assert.equal(formatMonths(combined.months!, 'en'), 'Jan 2026, Mar 2026')
})

test('dashboard keeps at most the 1000 busiest matching stations', () => {
  const ids = Array.from({ length: 1001 }, (_, index) => `s${index}`)
  const geo: StationLocations = { type: 'FeatureCollection', features: ids.map((id) => ({
    type: 'Feature', geometry: { type: 'Point', coordinates: [10, 52] }, properties: { id, name: id },
  })) }
  const filtered = filterDashboard(dataset(ids.map((id, index) => row(id, index + 1, 0))), geo, ['ICE'])
  assert.equal(filtered.locations.features.length, 1000)
  assert.equal(filtered.locations.features[0].properties.id, 's1000')
  assert.ok(!filtered.locations.features.some((feature) => feature.properties.id === 's0'))
})

test('current annual export maps stations once and conserves all measured stops', () => {
  const data: Dataset = JSON.parse(readFileSync(new URL('../public/data/demo.json', import.meta.url), 'utf8'))
  const geo: StationLocations = JSON.parse(readFileSync(new URL('../public/data/stations.geojson', import.meta.url), 'utf8'))
  const result = prepareRailMap(data, geo)
  assert.equal(data.months?.length, 12)
  assert.equal(result.stations.length, geo.features.length)
  assert.equal(result.stations.filter((station) => station.delayObservations > 0).length, geo.features.length)
  assert.equal(new Set(result.cells.flatMap((cell) => cell.stations.map((station) => station.stationId))).size, geo.features.length)
  assert.equal(result.cells.reduce((sum, cell) => sum + cell.delayObservations, 0), data.stations.reduce((sum, row) => sum + row.delayObservations, 0))
})
