import { geoAzimuthalEqualArea } from 'd3'
import { binStationTotals } from './delayHexagons.ts'
import type { DelayHexagon } from './delayHexagons.ts'
import type { RailStation } from './railMapData.ts'

export const LOCAL_HEX_SIDE_METRES = 10_000
export const DETAIL_HEX_SIDE_METRES = 2_000
const projection = geoAzimuthalEqualArea().rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)
type Point = [number, number]

// Sutherland–Hodgman intersection in the equal-area metre plane. Both grids
// have convex cells. Clipping avoids painting local cells outside their parent.
function clipToParent(subject: Point[], boundary: Point[]): Point[] {
  const signedArea = boundary.reduce((area, a, i) => {
    const b = boundary[(i + 1) % boundary.length]
    return area + a[0] * b[1] - b[0] * a[1]
  }, 0)
  const sign = Math.sign(signedArea)
  let output = subject
  for (let i = 0; i < boundary.length && output.length; i++) {
    const a = boundary[i], b = boundary[(i + 1) % boundary.length]
    const distance = (p: Point) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]))
    const input = output
    output = []
    let previous = input[input.length - 1], previousDistance = distance(previous)
    for (const current of input) {
      const currentDistance = distance(current)
      if ((currentDistance >= 0) !== (previousDistance >= 0)) {
        const fraction = previousDistance / (previousDistance - currentDistance)
        output.push([previous[0] + (current[0] - previous[0]) * fraction, previous[1] + (current[1] - previous[1]) * fraction])
      }
      if (currentDistance >= 0) output.push(current)
      previous = current
      previousDistance = currentDistance
    }
  }
  return output
}

/** Local membership comes exclusively from the selected parent, never neighbours. */
export function drillIntoCell(parent: DelayHexagon, allStations: RailStation[], side = LOCAL_HEX_SIDE_METRES): DelayHexagon[] {
  const ids = new Set(parent.stations.map((station) => station.stationId))
  const stations = allStations.filter((station) => ids.has(station.stationId))
  const boundary = parent.coordinates.slice(0, -1).map((point) => projection(point)! as Point)
  return binStationTotals(stations, stations, side).map((cell) => {
    const clipped = clipToParent(cell.coordinates.slice(0, -1).map((point) => projection(point)! as Point), boundary)
    const coordinates = clipped.map((point) => projection.invert!(point)! as Point)
    coordinates.push([...coordinates[0]])
    return { ...cell, cellId: `${parent.cellId}/${cell.cellId}`, coordinates }
  })
}
