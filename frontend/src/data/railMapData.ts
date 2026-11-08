import { binStationTotals } from './delayHexagons.ts'
import type { Dataset } from './types.ts'
import type { ExplorerStation } from './delayExplorer.ts'

export interface RailStation extends ExplorerStation {
  evas: string[]
  trainTypes: string[]
  observations: number
  delayObservations: number
  totalDelayMinutes: number
  averageDelayMinutes: number | null
  delayedOverFivePercent: number | null
  cancelledPercent: number | null
}

export interface StationLocations {
  type: 'FeatureCollection'
  features: { type: 'Feature'; geometry: { type: 'Point'; coordinates: [number, number] };
    properties: { id: string; name: string; evas?: string[] } }[]
}

/** Join by canonical EVA identity; names are labels, never join keys. */
export function prepareRailMap(dataset: Dataset, locations: StationLocations) {
  const stations = locations.features.map(({ properties, geometry }): RailStation => ({
    stationId: properties.id, stationName: properties.name,
    longitude: geometry.coordinates[0], latitude: geometry.coordinates[1],
    evas: properties.evas ?? [properties.id], trainTypes: [], observations: 0,
    delayObservations: 0, totalDelayMinutes: 0, averageDelayMinutes: null,
    delayedOverFivePercent: null, cancelledPercent: null,
  }))
  const byId = new Map(stations.map((station) => [station.stationId, station]))
  const overFive = new Map<string, number>(), cancelled = new Map<string, number>()
  let approximate = false
  for (const row of dataset.stations) {
    const station = byId.get(row.stationId)
    if (!station) continue
    station.observations += row.observations
    station.trainTypes.push(...row.trainTypes)
    cancelled.set(row.stationId, (cancelled.get(row.stationId) ?? 0) + row.cancelledPercent / 100 * row.observations)
    if (row.delayObservations <= 0) continue
    station.delayObservations += row.delayObservations
    // Older committed exports contain rounded means; new pipeline builds supply exact sums.
    station.totalDelayMinutes += row.totalDelayMinutes ?? row.averageDelayMinutes * row.delayObservations
    approximate ||= row.totalDelayMinutes === undefined
    overFive.set(row.stationId, (overFive.get(row.stationId) ?? 0) + row.delayedOverFivePercent / 100 * row.delayObservations)
  }
  for (const station of stations) {
    station.trainTypes = [...new Set(station.trainTypes)].sort()
    station.averageDelayMinutes = station.delayObservations ? station.totalDelayMinutes / station.delayObservations : null
    station.delayedOverFivePercent = station.delayObservations ? (overFive.get(station.stationId) ?? 0) / station.delayObservations * 100 : null
    station.cancelledPercent = station.observations ? (cancelled.get(station.stationId) ?? 0) / station.observations * 100 : null
  }
  return { stations, cells: binStationTotals(stations, stations), approximate }
}
