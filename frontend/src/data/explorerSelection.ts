import type { ExplorerDataset } from './delayExplorer.ts'
import { calendarTimestamp } from './delayTimeline.ts'
import type { TimeResolution } from './delayTimeline.ts'

export interface DateInterval { start: string; end: string }
export interface ExplorationState {
  selectedStationIds: string[]
  dateRange: DateInterval | null
  resolution: TimeResolution
  hoveredStationId: string | null
  addToSelection: boolean
  fullPeriod: DateInterval
}
export type ExplorationAction =
  | { type: 'station'; id: string; additive?: boolean }
  | { type: 'stations'; ids: string[]; additive?: boolean }
  | { type: 'dates'; range: DateInterval | null }
  | { type: 'resolution'; resolution: TimeResolution }
  | { type: 'hover'; id: string | null }
  | { type: 'add-mode'; enabled: boolean }
  | { type: 'clear-stations' | 'clear-dates' | 'reset' }

const DAY = 86_400_000
const date = (time: number) => new Date(time).toISOString().slice(0, 10)
const monday = (time: number) => time - (new Date(time).getUTCDay() + 6) % 7 * DAY

export function normalizeInterval(range: DateInterval | null, bounds: DateInterval, resolution: TimeResolution): DateInterval | null {
  if (!range) return null
  let start = calendarTimestamp(range.start), end = calendarTimestamp(range.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start > end) [start, end] = [end, start]
  start = Math.max(calendarTimestamp(bounds.start), Math.min(calendarTimestamp(bounds.end), start))
  end = Math.max(calendarTimestamp(bounds.start), Math.min(calendarTimestamp(bounds.end), end))
  if (resolution === 'weekly') { start = monday(start); end = monday(end) + 6 * DAY }
  start = Math.max(calendarTimestamp(bounds.start), Math.min(calendarTimestamp(bounds.end), start))
  end = Math.max(start, Math.min(calendarTimestamp(bounds.end), end))
  const result = { start: date(start), end: date(end) }
  return result.start === bounds.start && result.end === bounds.end ? null : result
}

export function intervalFromBrush(a: number, b: number, bounds: DateInterval, resolution: TimeResolution) {
  const low = Math.min(a, b), high = Math.max(a, b)
  let first = Math.ceil(low / DAY) * DAY, last = Math.floor(high / DAY) * DAY
  if (first > last) first = last = Math.round((low + high) / 2 / DAY) * DAY
  return normalizeInterval({ start: date(first), end: date(last) }, bounds, resolution)
}

export function initialExploration(fullPeriod: DateInterval): ExplorationState {
  return { selectedStationIds: [], dateRange: null, resolution: 'daily', hoveredStationId: null, addToSelection: false, fullPeriod }
}

export function explorationReducer(state: ExplorationState, action: ExplorationAction): ExplorationState {
  switch (action.type) {
    case 'station': {
      const additive = action.additive || state.addToSelection
      const ids = state.selectedStationIds
      const next = additive ? ids.includes(action.id) ? ids.filter((id) => id !== action.id) : [...ids, action.id]
        : ids.length === 1 && ids[0] === action.id ? [] : [action.id]
      return { ...state, selectedStationIds: next, hoveredStationId: null }
    }
    case 'stations': return { ...state, selectedStationIds: action.additive || state.addToSelection
      ? [...new Set([...state.selectedStationIds, ...action.ids])] : [...new Set(action.ids)], hoveredStationId: null }
    case 'dates': return { ...state, dateRange: normalizeInterval(action.range, state.fullPeriod, state.resolution), hoveredStationId: null }
    case 'resolution': return { ...state, resolution: action.resolution,
      dateRange: normalizeInterval(state.dateRange, state.fullPeriod, action.resolution), hoveredStationId: null }
    case 'hover': return state.hoveredStationId === action.id ? state : { ...state, hoveredStationId: action.id }
    case 'add-mode': return { ...state, addToSelection: action.enabled }
    case 'clear-stations': return { ...state, selectedStationIds: [], hoveredStationId: null }
    case 'clear-dates': return { ...state, dateRange: null, hoveredStationId: null }
    case 'reset': return initialExploration(state.fullPeriod)
  }
}

export function scopeDataset(data: ExplorerDataset, range: DateInterval | null, stationIds: string[] = []): ExplorerDataset {
  return { ...data, periodStart: range?.start ?? data.periodStart, periodEnd: range?.end ?? data.periodEnd,
    stations: stationIds.length ? data.stations.filter((station) => stationIds.includes(station.stationId)) : data.stations }
}
