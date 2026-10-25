import type { ExplorerDataset } from './delayExplorer.ts'
import { calendarTimestamp, summarizeTimeline } from './delayTimeline.ts'
import type { DelayTimePoint } from './delayTimeline.ts'

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const DAY = 86_400_000
const isoDate = (time: number) => new Date(time).toISOString().slice(0, 10)
const weekStart = (time: number) => time - (new Date(time).getUTCDay() + 6) % 7 * DAY

export function isoWeekLabel(date: string) {
  const time = weekStart(calendarTimestamp(date))
  const year = new Date(time + 3 * DAY).getUTCFullYear()
  const first = weekStart(Date.UTC(year, 0, 4))
  return { label: `Week ${Math.round((time - first) / (7 * DAY)) + 1}`, year }
}

export interface ProfilePoint extends DelayTimePoint { position: number }
export interface ProfileSeries { label: string; points: ProfilePoint[] }

export function summarizeProfiles(data: ExplorerDataset, stationId = '') {
  const scoped = stationId ? { ...data, stations: data.stations.filter((station) => station.stationId === stationId) } : data
  const daily = summarizeTimeline(scoped, 'daily').aggregatePoints
  const weekly = summarizeTimeline(scoped, 'weekly').aggregatePoints
  const weeks = weekly.map((point) => weekStart(calendarTimestamp(point.periodStart)))
  const dayByDate = new Map(daily.map((point) => [point.periodStart, point]))
  const daySeries: ProfileSeries[] = WEEKDAYS.map((label, weekday) => ({ label,
    points: weeks.map((week, position) => {
      const date = isoDate(week + weekday * DAY)
      const point = dayByDate.get(date)
      return point ? { ...point, position } : {
        stationId: null, stationName: 'All measured stations', periodStart: date, periodEnd: date,
        timestamp: calendarTimestamp(date), averageDelayMinutes: null,
        totalDelayMinutes: 0, delayObservations: 0, position,
      }
    }),
  }))
  const weekSeries: ProfileSeries[] = weeks.map((_, index) => ({
    label: isoWeekLabel(weekly[index].periodStart).label,
    points: WEEKDAYS.map((__, weekday) => ({ ...daySeries[weekday].points[index], position: weekday })),
  }))
  const weekdayAverage: ProfilePoint[] = WEEKDAYS.map((_, weekday) => {
    const points = daySeries[weekday].points
    const sum = points.reduce((total, point) => total + point.totalDelayMinutes, 0)
    const count = points.reduce((total, point) => total + point.delayObservations, 0)
    return { stationId: null, stationName: 'All measured stations', periodStart: data.periodStart,
      periodEnd: data.periodEnd, timestamp: calendarTimestamp(data.periodStart), position: weekday,
      totalDelayMinutes: sum, delayObservations: count, averageDelayMinutes: count ? sum / count : null }
  })
  return {
    weekdays: { series: daySeries, average: weekly.map((point, position) => ({ ...point, position })),
      ticks: weekly.map((point) => isoWeekLabel(point.periodStart).label) },
    weeks: { series: weekSeries, average: weekdayAverage, ticks: WEEKDAYS },
  }
}

// Spread only label positions. Data points and line endpoints stay at their actual values.
export function spreadProfileLabels(desired: number[], top: number, bottom: number, gap = 18) {
  const order = desired.map((y, index) => ({ y, index })).sort((a, b) => a.y - b.y)
  for (let index = 0; index < order.length; index++) {
    order[index].y = Math.max(order[index].y, index ? order[index - 1].y + gap : top)
  }
  for (let index = order.length - 1; index >= 0; index--) {
    order[index].y = Math.min(order[index].y, index === order.length - 1 ? bottom : order[index + 1].y - gap)
  }
  if (order.length) {
    const desiredMean = desired.reduce((sum, y) => sum + y, 0) / order.length
    const actualMean = order.reduce((sum, item) => sum + item.y, 0) / order.length
    const shift = Math.max(top - order[0].y, Math.min(bottom - order.at(-1)!.y, desiredMean - actualMean))
    for (const item of order) item.y += shift
  }
  const result = Array<number>(desired.length)
  for (const item of order) result[item.index] = item.y
  return result
}
