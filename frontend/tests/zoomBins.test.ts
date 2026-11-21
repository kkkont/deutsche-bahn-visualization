import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { geoArea, geoAzimuthalEqualArea, polygonContains } from 'd3'
import { buildZoomGrids, binSideForZoom } from '../src/data/zoomBins.ts'
import { prepareRailMap } from '../src/data/railMapData.ts'

const read = (name: string) => JSON.parse(readFileSync(new URL(`../public/data/${name}`, import.meta.url), 'utf8'))
const data = prepareRailMap(read('demo.json'), read('stations.geojson'))

test('zoom thresholds switch in both directions without depending on selection', () => {
  for (const [zoom, side] of [[4, 50000], [6.499, 50000], [6.5, 10000], [8.999, 10000], [9, 2000], [13, 2000], [8, 10000], [5, 50000]]) {
    assert.equal(binSideForZoom(zoom), side)
  }
})

test('each resolution covers every station exactly once with equal-area cells and conserved totals', () => {
  const original = JSON.stringify(data)
  const projection = geoAzimuthalEqualArea().rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)
  const grids = buildZoomGrids(data.stations, data.cells)
  const ids = new Set<string>()
  for (const grid of grids) {
    assert.deepEqual(grid.cells.flatMap((cell) => cell.stations.map((station) => station.stationId)).sort(), data.stations.map((station) => station.stationId).sort())
    assert.equal(grid.cells.reduce((sum, cell) => sum + cell.delayObservations, 0), data.stations.reduce((sum, station) => sum + station.delayObservations, 0))
    assert.ok(Math.abs(grid.cells.reduce((sum, cell) => sum + cell.totalDelayMinutes, 0) - data.stations.reduce((sum, station) => sum + station.totalDelayMinutes, 0)) < 0.00001)
    const expectedArea = 3 * Math.sqrt(3) / 2 * grid.side ** 2
    for (const cell of grid.cells) {
      assert.equal(ids.has(cell.cellId), false, 'cell identities must distinguish resolutions')
      ids.add(cell.cellId)
      assert.deepEqual(cell.coordinates[0], cell.coordinates.at(-1))
      const polygon = cell.coordinates.map((point) => projection(point)!)
      for (const station of cell.stations) assert.ok(polygonContains(polygon, projection([station.longitude, station.latitude])!))
      const area = geoArea({ type: 'Polygon', coordinates: [cell.coordinates] })
      const smallArea = Math.min(area, 4 * Math.PI - area) * 6_371_008.8 ** 2
      assert.ok(Math.abs(smallArea - expectedArea) / expectedArea < 0.00001)
    }
  }
  assert.equal(JSON.stringify(data), original)
  assert.ok(grids[1].cells.length > grids[0].cells.length)
  assert.ok(grids[2].cells.length > grids[1].cells.length)
})

test('zoom grids remain deterministic and leave previous bin selections intact', () => {
  const grids = buildZoomGrids(data.stations, data.cells)
  const selected = grids[0].cells.find((cell) => cell.stations.length === 37)!
  const selectionBefore = JSON.stringify(selected)
  const reordered = buildZoomGrids([...data.stations].reverse())
  for (const grid of grids) for (const cell of grid.cells) {
    const match = reordered.find((other) => other.side === grid.side)!.cells.find((other) => other.cellId === cell.cellId)!
    assert.deepEqual(match.coordinates, cell.coordinates)
    assert.deepEqual(match.stations.map((station) => station.stationId).sort(), cell.stations.map((station) => station.stationId).sort())
  }
  assert.equal(JSON.stringify(selected), selectionBefore)
})
