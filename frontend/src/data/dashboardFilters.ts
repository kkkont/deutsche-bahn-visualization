import type { Dataset } from './types.ts'
import type { StationLocations } from './railMapData.ts'

export function calendarMonthGroups(months: string[]) {
  return Array.from({ length: 12 }, (_, index) => {
    const number = index + 1
    const suffix = `-${String(number).padStart(2, '0')}`
    return { number, months: months.filter((month) => /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && month.endsWith(suffix)) }
  })
}

export function toggleCalendarMonth(months: string[], selected: string[], number: number) {
  const group = calendarMonthGroups(months).find((item) => item.number === number)?.months ?? []
  if (!group.length) return selected
  const active = new Set(selected)
  if (months.every((month) => active.has(month))) return group
  if (group.every((month) => active.has(month))) {
    const remaining = selected.filter((month) => !group.includes(month))
    return remaining.length ? remaining : selected
  }
  return months.filter((month) => active.has(month) || group.includes(month))
}

export function combineMonths(datasets: Dataset[], months: string[]): Dataset {
  const first = datasets[0]
  return {
    period: months.length === 1 ? months[0] : `${months[0]}/${months[months.length - 1]}`,
    months, source: first.source, generatedAt: first.generatedAt,
    stations: datasets.flatMap((data) => data.stations),
    hourly: datasets.flatMap((data) => data.hourly),
  }
}

export function filterDashboard(dataset: Dataset, locations: StationLocations, services: string[]) {
  const selected = new Set(services)
  const stations = selected.size ? dataset.stations.filter((row) => row.trainTypes.some((type) => selected.has(type))) : dataset.stations
  const hourly = selected.size ? dataset.hourly.filter((row) => selected.has(row.trainType)) : dataset.hourly
  const observations = new Map<string, number>()
  for (const row of stations) observations.set(row.stationId, (observations.get(row.stationId) ?? 0) + row.observations)
  const features = locations.features.filter((feature) => (observations.get(feature.properties.id) ?? 0) > 0)
    .sort((a, b) => (observations.get(b.properties.id) ?? 0) - (observations.get(a.properties.id) ?? 0)
      || a.properties.id.localeCompare(b.properties.id))
  return {
    dataset: { ...dataset, stations, hourly },
    locations: { ...locations, features: features.slice(0, 1000) },
  }
}

export function formatMonths(months: string[], locale: string) {
  const format = new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
  const sorted = [...months].sort()
  const groups: string[][] = []
  for (const month of sorted) {
    const previous = groups.at(-1)?.at(-1)
    const [year, value] = month.split('-').map(Number)
    const [previousYear, previousValue] = previous?.split('-').map(Number) ?? []
    if (previous && year * 12 + value === previousYear * 12 + previousValue + 1) groups.at(-1)!.push(month)
    else groups.push([month])
  }
  const label = (month: string) => format.format(new Date(`${month}-01T00:00:00Z`))
  return groups.map((group) => group.length === 1 ? label(group[0]) : `${label(group[0])} – ${label(group.at(-1)!)}`).join(', ')
}
