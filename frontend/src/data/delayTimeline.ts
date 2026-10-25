import type { ExplorerDataset } from './delayExplorer.ts'

export type TimeResolution = 'daily' | 'weekly'

export interface DelayTimePoint {
  stationId: string | null
  stationName: string
  periodStart: string
  periodEnd: string
  timestamp: number
  averageDelayMinutes: number | null
  totalDelayMinutes: number
  delayObservations: number
}

const DAY = 86_400_000
// UTC is used only as a calendar-date coordinate: no local-time conversion.
export const calendarTimestamp = (date: string) => Date.parse(`${date}T00:00:00Z`)
const isoDate = (timestamp: number) => new Date(timestamp).toISOString().slice(0, 10)
const monday = (timestamp: number) => timestamp - (new Date(timestamp).getUTCDay() + 6) % 7 * DAY

export function summarizeTimeline(data: ExplorerDataset, resolution: TimeResolution) {
  const first = calendarTimestamp(data.periodStart), last = calendarTimestamp(data.periodEnd)
  const stride = resolution === 'daily' ? DAY : 7 * DAY
  const bucketStart = (time: number) => resolution === 'daily' ? time : monday(time)
  const buckets: { key: number; start: string; end: string; timestamp: number }[] = []
  for (let key = bucketStart(first); key <= last; key += stride) {
    const start = Math.max(first, key), end = Math.min(last, key + stride - DAY)
    buckets.push({ key, start: isoDate(start), end: isoDate(end), timestamp: (start + end) / 2 })
  }
  const known = new Set(data.stations.map((station) => station.stationId))
  const totals = new Map<string, { sum: number; count: number }>()
  const keyFor = (stationId: string, bucket: number) => `${stationId}:${bucket}`
  for (const row of data.daily) {
    if (!known.has(row.stationId) || row.date < data.periodStart || row.date > data.periodEnd || row.delayObservations <= 0) continue
    const key = keyFor(row.stationId, bucketStart(calendarTimestamp(row.date)))
    const total = totals.get(key) ?? { sum: 0, count: 0 }
    total.sum += row.totalDelayMinutes
    total.count += row.delayObservations
    totals.set(key, total)
  }
  const stationPoints: DelayTimePoint[] = []
  const aggregatePoints: DelayTimePoint[] = []
  for (const bucket of buckets) {
    let sum = 0, count = 0
    for (const station of data.stations) {
      const total = totals.get(keyFor(station.stationId, bucket.key)) ?? { sum: 0, count: 0 }
      sum += total.sum
      count += total.count
      stationPoints.push({ stationId: station.stationId, stationName: station.stationName,
        periodStart: bucket.start, periodEnd: bucket.end, timestamp: bucket.timestamp,
        totalDelayMinutes: total.sum, delayObservations: total.count,
        averageDelayMinutes: total.count ? total.sum / total.count : null })
    }
    aggregatePoints.push({ stationId: null, stationName: 'All measured stations',
      periodStart: bucket.start, periodEnd: bucket.end, timestamp: bucket.timestamp,
      totalDelayMinutes: sum, delayObservations: count,
      averageDelayMinutes: count ? sum / count : null })
  }
  // Null points are retained for line gaps; render only measured points as dots.
  return { stationPoints, aggregatePoints }
}

const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
export function formatTimelinePeriod(start: string, end: string) {
  const a = dayFormat.format(calendarTimestamp(start))
  return start === end ? a : `${a}–${dayFormat.format(calendarTimestamp(end))}`
}
