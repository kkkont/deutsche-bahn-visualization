import { binStationTotals, HEX_SIDE_METRES } from './delayHexagons.ts'
import type { DelayHexagon } from './delayHexagons.ts'
import type { RailStation } from './railMapData.ts'

// Fixed geographic resolutions; zoom changes grouping, never the colour scale.
export const BIN_RESOLUTIONS = [
  { minZoom: 0, side: HEX_SIDE_METRES },
  { minZoom: 6.5, side: 10_000 },
  { minZoom: 9, side: 2_000 },
] as const

export function binSideForZoom(zoom: number): number {
  return [...BIN_RESOLUTIONS].reverse().find((level) => zoom >= level.minZoom)?.side ?? HEX_SIDE_METRES
}

/** Each grid covers the same mapped population, independently of selections and pan. */
export function buildZoomGrids(stations: RailStation[], overviewCells?: DelayHexagon[]) {
  return BIN_RESOLUTIONS.map((level) => ({ ...level,
    cells: (level.side === HEX_SIDE_METRES && overviewCells ? overviewCells : binStationTotals(stations, stations, level.side)).map((cell) => ({
      ...cell, cellId: `${level.side}/${cell.cellId}`,
    })),
  }))
}
