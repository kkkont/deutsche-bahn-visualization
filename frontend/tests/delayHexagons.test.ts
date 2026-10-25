import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { geoArea, geoAzimuthalEqualArea, polygonContains } from 'd3'
import { HEX_AREA_KM2, summarizeHexagons } from '../src/data/delayHexagons.ts'
import type { ExplorerDataset } from '../src/data/delayExplorer.ts'

const fixture: ExplorerDataset = JSON.parse(readFileSync(new URL('../src/data/delay-explorer-demo.json', import.meta.url), 'utf8'))

test('cells aggregate raw sums and counts rather than averaging station means', () => {
  const a = fixture.stations[0]
  const b = { ...a, stationId: 'test-b', stationName: 'Second station' }
  const c = { ...a, stationId: 'test-c', stationName: 'Unmeasured station' }
  const data: ExplorerDataset = { ...fixture, stations: [a, b, c], daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: b.stationId, date: '2024-07-01', totalDelayMinutes: 90, delayObservations: 90 },
    { stationId: c.stationId, date: '2024-07-01', totalDelayMinutes: 0, delayObservations: 0 },
    { stationId: a.stationId, date: '2024-08-01', totalDelayMinutes: 999, delayObservations: 1 },
    { stationId: 'unknown', date: '2024-07-01', totalDelayMinutes: 999, delayObservations: 1 },
  ] }
  const [cell] = summarizeHexagons(data)
  assert.equal(cell.stations.length, 3)
  assert.equal(cell.measuredStationCount, 2)
  assert.equal(cell.delayObservations, 91)
  assert.equal(cell.totalDelayMinutes, 100)
  assert.equal(cell.averageDelayMinutes, 100 / 91)
  const [zero] = summarizeHexagons({ ...data, daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 0, delayObservations: 5 },
  ] })
  assert.equal(zero.averageDelayMinutes, 0)
  const [missing] = summarizeHexagons({ ...data, daily: [] })
  assert.equal(missing.averageDelayMinutes, null)
})

test('fixed equal-area grid contains each station once and conserves observations', () => {
  const cells = summarizeHexagons(fixture)
  assert.equal(cells.length, 17)
  assert.ok(cells.some((cell) => cell.stations.length > 1))
  assert.equal(cells.flatMap((cell) => cell.stations).length, fixture.stations.length)
  assert.equal(new Set(cells.flatMap((cell) => cell.stations.map((station) => station.stationId))).size, fixture.stations.length)
  assert.equal(cells.reduce((sum, cell) => sum + cell.delayObservations, 0),
    fixture.daily.reduce((sum, row) => sum + row.delayObservations, 0))
  const projection = geoAzimuthalEqualArea().rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)
  for (const cell of cells) {
    assert.deepEqual(cell.coordinates[0], cell.coordinates.at(-1))
    const polygon = cell.coordinates.map((coordinate) => projection(coordinate)!)
    for (const station of cell.stations) {
      assert.ok(polygonContains(polygon, projection([station.longitude, station.latitude])!))
    }
    // D3's spherical winding convention differs from GeoJSON's exterior winding.
    const area = geoArea({ type: 'Polygon', coordinates: [cell.coordinates] })
    const smallArea = Math.min(area, 4 * Math.PI - area) * 6_371_008.8 ** 2 / 1_000_000
    assert.ok(Math.abs(smallArea - HEX_AREA_KM2) / HEX_AREA_KM2 < 0.00001)
  }
  const reordered = summarizeHexagons({ ...fixture, stations: [...fixture.stations].reverse() })
  for (const cell of cells) {
    const match = reordered.find((item) => item.cellId === cell.cellId)!
    assert.deepEqual(match.coordinates, cell.coordinates)
    assert.deepEqual(match.stations.map((station) => station.stationId).sort(), cell.stations.map((station) => station.stationId).sort())
  }
})
