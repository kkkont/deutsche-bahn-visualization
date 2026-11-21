import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { geoArea, geoAzimuthalEqualArea, polygonContains } from 'd3'
import { HEX_AREA_KM2, binStationTotals } from '../src/data/delayHexagons.ts'
import { prepareRailMap } from '../src/data/railMapData.ts'
import type { StationLocation } from '../src/data/types.ts'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
const { stations } = prepareRailMap(read('demo.json'), read('stations.geojson'))

test('cells aggregate raw sums and counts rather than averaging station means', () => {
  const a: StationLocation = { stationId: 'a', stationName: 'First', latitude: 52, longitude: 10 }
  const b = { ...a, stationId: 'b', stationName: 'Second' }
  const c = { ...a, stationId: 'c', stationName: 'Unmeasured' }
  const members = [a, b, c]
  const [cell] = binStationTotals(members, [
    { stationId: 'a', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: 'b', totalDelayMinutes: 90, delayObservations: 90 },
    { stationId: 'c', totalDelayMinutes: 0, delayObservations: 0 },
    { stationId: 'unknown', totalDelayMinutes: 999, delayObservations: 1 },
  ])
  assert.equal(cell.stations.length, 3)
  assert.equal(cell.measuredStationCount, 2)
  assert.equal(cell.delayObservations, 91)
  assert.equal(cell.totalDelayMinutes, 100)
  assert.equal(cell.averageDelayMinutes, 100 / 91)
  const [zero] = binStationTotals(members, [{ stationId: 'a', totalDelayMinutes: 0, delayObservations: 5 }])
  assert.equal(zero.averageDelayMinutes, 0)
  assert.equal(binStationTotals(members, [])[0].averageDelayMinutes, null)
})

test('fixed equal-area grid contains each mapped station once and conserves observations', () => {
  const cells = binStationTotals(stations, stations)
  assert.equal(cells.length, 29)
  assert.ok(cells.some((cell) => cell.stations.length > 1))
  assert.equal(cells.flatMap((cell) => cell.stations).length, stations.length)
  assert.equal(new Set(cells.flatMap((cell) => cell.stations.map((station) => station.stationId))).size, stations.length)
  assert.equal(cells.reduce((sum, cell) => sum + cell.delayObservations, 0), stations.reduce((sum, row) => sum + row.delayObservations, 0))
  const projection = geoAzimuthalEqualArea().rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)
  for (const cell of cells) {
    assert.deepEqual(cell.coordinates[0], cell.coordinates.at(-1))
    const polygon = cell.coordinates.map((coordinate) => projection(coordinate)!)
    for (const station of cell.stations) assert.ok(polygonContains(polygon, projection([station.longitude, station.latitude])!))
    // D3's spherical winding convention differs from GeoJSON's exterior winding.
    const area = geoArea({ type: 'Polygon', coordinates: [cell.coordinates] })
    const smallArea = Math.min(area, 4 * Math.PI - area) * 6_371_008.8 ** 2 / 1_000_000
    assert.ok(Math.abs(smallArea - HEX_AREA_KM2) / HEX_AREA_KM2 < 0.00001)
  }
  const reordered = binStationTotals([...stations].reverse(), stations)
  for (const cell of cells) {
    const match = reordered.find((item) => item.cellId === cell.cellId)!
    assert.deepEqual(match.coordinates, cell.coordinates)
    assert.deepEqual(match.stations.map((station) => station.stationId).sort(), cell.stations.map((station) => station.stationId).sort())
  }
})
