import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { geoAzimuthalEqualArea, polygonArea, polygonContains } from 'd3'
import { prepareRailMap } from '../src/data/railMapData.ts'
import type { RailStation } from '../src/data/railMapData.ts'
import { binStationTotals } from '../src/data/delayHexagons.ts'
import { drillIntoCell, LOCAL_HEX_SIDE_METRES } from '../src/data/railMapDrilldown.ts'

const projection = geoAzimuthalEqualArea().rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)
const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
const data = prepareRailMap(read('demo.json'), read('stations.geojson'))

test('all local views conserve their parent population and weighted totals without mutating the overview', () => {
  const before = JSON.stringify(data)
  for (const parent of data.cells) {
    const children = drillIntoCell(parent, data.stations)
    assert.deepEqual(children.flatMap((cell) => cell.stations.map((station) => station.stationId)).sort(), parent.stations.map((station) => station.stationId).sort())
    assert.equal(children.reduce((sum, cell) => sum + cell.delayObservations, 0), parent.delayObservations)
    const total = children.reduce((sum, cell) => sum + cell.totalDelayMinutes, 0)
    assert.ok(Math.abs(total - parent.totalDelayMinutes) < 1e-5)
    assert.ok(Math.abs(total / parent.delayObservations - parent.averageDelayMinutes!) < 1e-10)
    for (const cell of children) {
      assert.ok(cell.cellId.startsWith(`${parent.cellId}/`))
      assert.ok(cell.coordinates.length >= 4)
      assert.deepEqual(cell.coordinates[0], cell.coordinates.at(-1))
      const polygon = cell.coordinates.map((point) => projection(point)!)
      for (const station of cell.stations) assert.ok(polygonContains(polygon, projection([station.longitude, station.latitude])!))
      const boundary = parent.coordinates.slice(0, -1).map((point) => projection(point)!)
      const sign = -Math.sign(polygonArea(boundary))
      for (const point of polygon) for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i], b = boundary[(i + 1) % boundary.length]
        const distance = sign * ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / Math.hypot(b[0] - a[0], b[1] - a[1])
        assert.ok(distance >= -0.00001, 'local geometry must stay inside parent')
      }
    }
  }
  assert.equal(JSON.stringify(data), before)
  const ruhr = data.cells.find((cell) => cell.stations.length === 19)!
  assert.ok(drillIntoCell(ruhr, data.stations).length > 1)
})

test('boundary cells are clipped, neighbours excluded, and zero and missing measurements remain distinct', () => {
  const makeStation = (stationId: string, xy: [number, number], count: number): RailStation => {
    const [longitude, latitude] = projection.invert!(xy)!
    return { stationId, stationName: stationId, longitude, latitude, evas: [stationId], trainTypes: [], observations: count,
      delayObservations: count, totalDelayMinutes: 0, averageDelayMinutes: count ? 0 : null, delayedOverFivePercent: null, cancelledPercent: null }
  }
  const stations = [makeStation('edge', [42000, 24000], 3), makeStation('missing', [0, 0], 0), makeStation('neighbour', [45000, 24000], 999)]
  const parent = binStationTotals(stations, stations).find((cell) => cell.stations.some((station) => station.stationId === 'edge'))!
  const children = drillIntoCell(parent, stations)
  assert.deepEqual(children.flatMap((cell) => cell.stations.map((station) => station.stationId)).sort(), ['edge', 'missing'])
  const edge = children.find((cell) => cell.stations.some((station) => station.stationId === 'edge'))!
  assert.equal(edge.averageDelayMinutes, 0)
  assert.equal(children.find((cell) => cell.stations[0].stationId === 'missing')!.averageDelayMinutes, null)
  const fullArea = 3 * Math.sqrt(3) / 2 * LOCAL_HEX_SIDE_METRES ** 2
  assert.ok(Math.abs(polygonArea(edge.coordinates.map((point) => projection(point)!))) < fullArea * 0.99)
})

test('dense Ruhr, Hamburg and Berlin areas split predictably while retaining all stations', () => {
  for (const [id, stations, bins, largest] of [
    ['-3:1', 19, 14, 2], ['1:-2', 37, 4, 24], ['3:-1', 66, 6, 43],
  ] as const) {
    const parent = data.cells.find((cell) => cell.cellId === id)!
    const children = drillIntoCell(parent, data.stations)
    assert.equal(parent.stations.length, stations)
    assert.equal(children.length, bins)
    assert.equal(children.reduce((sum, cell) => sum + cell.stations.length, 0), stations)
    assert.equal(Math.max(...children.map((cell) => cell.stations.length)), largest)
    if (stations > 19) {
      const crowded = children.find((cell) => cell.stations.length === largest)!
      const detail = drillIntoCell(crowded, data.stations, 2_000)
      assert.equal(detail.length, stations === 37 ? 10 : 14)
      assert.equal(Math.max(...detail.map((cell) => cell.stations.length)), stations === 37 ? 4 : 6)
    }
  }
})

test('2 km detail bins conserve every 10 km parent and stay within its clipped geometry', () => {
  for (const region of data.cells) for (const parent of drillIntoCell(region, data.stations)) {
    const detail = drillIntoCell(parent, data.stations, 2_000)
    assert.deepEqual(detail.flatMap((cell) => cell.stations.map((station) => station.stationId)).sort(), parent.stations.map((station) => station.stationId).sort())
    assert.equal(detail.reduce((sum, cell) => sum + cell.delayObservations, 0), parent.delayObservations)
    assert.ok(Math.abs(detail.reduce((sum, cell) => sum + cell.totalDelayMinutes, 0) - parent.totalDelayMinutes) < 1e-5)
    const boundary = parent.coordinates.slice(0, -1).map((point) => projection(point)!)
    const sign = -Math.sign(polygonArea(boundary))
    for (const cell of detail) {
      assert.deepEqual(cell.coordinates[0], cell.coordinates.at(-1))
      const polygon = cell.coordinates.map((point) => projection(point)!)
      for (const station of cell.stations) assert.ok(polygonContains(polygon, projection([station.longitude, station.latitude])!))
      for (const point of polygon) for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i], b = boundary[(i + 1) % boundary.length]
        const length = Math.hypot(b[0] - a[0], b[1] - a[1])
        if (length < 0.00001) continue
        assert.ok(sign * ((b[0] - a[0]) * (point[1] - a[1]) - (b[1] - a[1]) * (point[0] - a[0])) / length >= -0.00001)
      }
    }
  }
})
