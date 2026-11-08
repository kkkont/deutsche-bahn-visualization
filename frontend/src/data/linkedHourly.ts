import type { Dataset, HourPoint } from './types.ts'
import type { RailStation } from './railMapData.ts'
import type { DelayHexagon } from './delayHexagons.ts'

export interface ClockHour { hour: number; averageDelayMinutes: number | null; delayObservations: number }
export interface ClockData { period: string; months?: string[]; source: string; timezone: string; hours: ClockHour[] }
export interface MapScope { stationIds: string[]; name: string | null }

/** Indexed once for playback; absent measurements stay null, never become zero. */
export function buildStationHours(stations: RailStation[], hourly: HourPoint[]): RailStation[][] {
  const hours = Array.from({ length: 24 }, () => stations.map((station) => ({
    ...station, totalDelayMinutes: 0, delayObservations: 0, averageDelayMinutes: null as number | null,
  })))
  const index = new Map(stations.map((station, i) => [station.stationId, i]))
  for (const row of hourly) {
    const i = index.get(row.stationId)
    if (i === undefined || !Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23 || row.delayObservations <= 0) continue
    const station = hours[row.hour][i]
    station.totalDelayMinutes += row.totalDelayMinutes ?? row.averageDelayMinutes * row.delayObservations
    station.delayObservations += row.delayObservations
  }
  for (const hour of hours) for (const station of hour)
    station.averageDelayMinutes = station.delayObservations ? station.totalDelayMinutes / station.delayObservations : null
  return hours
}

export function summarizeHourly(hours: RailStation[][], ids: string[]): ClockHour[] {
  const selected = new Set(ids)
  return hours.map((stations, hour) => {
    let sum = 0, count = 0
    for (const station of stations) if (!selected.size || selected.has(station.stationId)) {
      sum += station.totalDelayMinutes
      count += station.delayObservations
    }
    return { hour, averageDelayMinutes: count ? sum / count : null, delayObservations: count }
  })
}

export function refreshCell(cell: DelayHexagon, stations: Map<string, RailStation>): DelayHexagon {
  let sum = 0, count = 0, measured = 0
  for (const member of cell.stations) {
    const station = stations.get(member.stationId)
    if (!station || station.delayObservations <= 0) continue
    sum += station.totalDelayMinutes; count += station.delayObservations; measured++
  }
  return { ...cell, totalDelayMinutes: sum, delayObservations: count, measuredStationCount: measured,
    averageDelayMinutes: count ? sum / count : null }
}

export function hourlyIsApproximate(data: Dataset) {
  return data.hourly.some((row) => row.delayObservations > 0 && row.totalDelayMinutes === undefined)
}
