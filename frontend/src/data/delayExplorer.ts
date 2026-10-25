export interface ExplorerStation {
  stationId: string
  stationName: string
  latitude: number
  longitude: number
}

export interface StationDay {
  stationId: string
  date: string
  totalDelayMinutes: number
  delayObservations: number
}

export interface ExplorerDataset {
  synthetic: boolean
  periodStart: string
  periodEnd: string
  timezone: string
  stations: ExplorerStation[]
  daily: StationDay[]
}

export interface StationSummary extends ExplorerStation {
  averageDelayMinutes: number | null
  delayObservations: number
}

// Fixed Tol YlOrBr scale. Selection never changes these stops or the domain.
// https://tol-colors.readthedocs.io/en/latest/colormaps.html#ylorbr
export const DELAY_COLORS = ['#FFFFE5', '#FFF7BC', '#FEE391', '#FEC44F', '#FB9A29', '#EC7014', '#CC4C02', '#993404', '#662506']
export const DELAY_MAX_MINUTES = 20

export function summarizeStations(data: ExplorerDataset): StationSummary[] {
  const totals = new Map<string, { sum: number; count: number }>()
  for (const row of data.daily) {
    if (row.date < data.periodStart || row.date > data.periodEnd || row.delayObservations <= 0) continue
    const total = totals.get(row.stationId) ?? { sum: 0, count: 0 }
    total.sum += row.totalDelayMinutes
    total.count += row.delayObservations
    totals.set(row.stationId, total)
  }
  return data.stations.map((station) => {
    const total = totals.get(station.stationId)
    return {
      ...station,
      averageDelayMinutes: total ? total.sum / total.count : null,
      delayObservations: total?.count ?? 0,
    }
  })
}
