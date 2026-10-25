import { geoAzimuthalEqualArea } from 'd3'
import type { ExplorerDataset, ExplorerStation } from './delayExplorer.ts'

export const HEX_SIDE_METRES = 50_000
export const HEX_AREA_KM2 = 3 * Math.sqrt(3) / 2 * HEX_SIDE_METRES ** 2 / 1_000_000

// Spherical Lambert azimuthal equal-area, fixed at 10°E, 52°N.
// Metre-based binning is independent of MapLibre's display projection and zoom.
const projection = geoAzimuthalEqualArea()
  .rotate([-10, -52]).translate([0, 0]).scale(6_371_008.8)

export interface DelayHexagon {
  cellId: string
  stations: ExplorerStation[]
  measuredStationCount: number
  delayObservations: number
  totalDelayMinutes: number
  averageDelayMinutes: number | null
  coordinates: [number, number][]
}

function stationCell(station: ExplorerStation): [number, number] {
  const [x, y] = projection([station.longitude, station.latitude])!
  const q = (Math.sqrt(3) / 3 * x - y / 3) / HEX_SIDE_METRES
  const r = 2 / 3 * y / HEX_SIDE_METRES
  // Round cube coordinates, correcting the largest rounding error.
  let a = Math.round(q), b = Math.round(r)
  const c = Math.round(-q - r)
  const da = Math.abs(a - q), db = Math.abs(b - r), dc = Math.abs(c + q + r)
  if (da > db && da > dc) a = -b - c
  else if (db > dc) b = -a - c
  return [a, b]
}

function cellRing(q: number, r: number): [number, number][] {
  const x = HEX_SIDE_METRES * Math.sqrt(3) * (q + r / 2)
  const y = HEX_SIDE_METRES * 1.5 * r
  const corners = Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index - 30) * Math.PI / 180
    return [x + HEX_SIDE_METRES * Math.cos(angle), y + HEX_SIDE_METRES * Math.sin(angle)]
  })
  // Densify straight projected edges before converting to geographic GeoJSON.
  const ring: [number, number][] = []
  for (let edge = 0; edge < 6; edge++) {
    const a = corners[edge], b = corners[(edge + 1) % 6]
    for (let step = 0; step < 8; step++) {
      const t = step / 8
      ring.push(projection.invert!([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])! as [number, number])
    }
  }
  ring.push([...ring[0]])
  // Projection's screen y is inverted; reverse to GeoJSON exterior winding.
  return ring.reverse()
}

export function summarizeHexagons(data: ExplorerDataset): DelayHexagon[] {
  const cells = new Map<string, DelayHexagon>()
  const stationCells = new Map<string, DelayHexagon>()
  const measuredStations = new Set<string>()
  for (const station of data.stations) {
    const [q, r] = stationCell(station)
    const cellId = `${q}:${r}`
    let cell = cells.get(cellId)
    if (!cell) {
      cell = { cellId, stations: [], measuredStationCount: 0, delayObservations: 0,
        totalDelayMinutes: 0, averageDelayMinutes: null, coordinates: cellRing(q, r) }
      cells.set(cellId, cell)
    }
    cell.stations.push(station)
    stationCells.set(station.stationId, cell)
  }
  for (const row of data.daily) {
    if (row.date < data.periodStart || row.date > data.periodEnd || row.delayObservations <= 0) continue
    const cell = stationCells.get(row.stationId)
    if (!cell) continue
    cell.totalDelayMinutes += row.totalDelayMinutes
    cell.delayObservations += row.delayObservations
    measuredStations.add(row.stationId)
  }
  return [...cells.values()].map((cell) => ({ ...cell,
    measuredStationCount: cell.stations.filter((station) => measuredStations.has(station.stationId)).length,
    averageDelayMinutes: cell.delayObservations ? cell.totalDelayMinutes / cell.delayObservations : null,
  }))
}
