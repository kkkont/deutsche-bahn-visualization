import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RailMap } from './components/RailMap'
import { DelayClock } from './components/DelayClock'
import { PlaybackControls } from './components/PlaybackControls'
import { HourlyPulse } from './components/HourlyPulse'
import { DashboardFilters } from './components/DashboardFilters'
import { prepareRailMap } from './data/railMapData'
import type { StationLocations } from './data/railMapData'
import type { Dataset } from './data/types'
import { buildStationHours, hourlyIsApproximate, summarizeHourly } from './data/linkedHourly'
import type { MapScope } from './data/linkedHourly'
import { combineMonths, filterDashboard, formatMonths } from './data/dashboardFilters'

function App() {
  const { t, i18n } = useTranslation('common')
  const { t: chartText } = useTranslation('charts')
  const [loaded, setLoaded] = useState<{ dataset: Dataset; locations: StationLocations } | null>(null)
  const [failed, setFailed] = useState(false)
  const [hour, setHour] = useState(12)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [scope, setScope] = useState<MapScope>({ stationIds: [], name: null })
  const [stationId, setStationId] = useState<string | null>(null)
  const [services, setServices] = useState<string[]>([])
  const [stationLimit, setStationLimit] = useState(0)
  const [selectedMonths, setSelectedMonths] = useState<string[]>([])
  const [activeMonths, setActiveMonths] = useState<string[]>([])
  const [monthData, setMonthData] = useState<Dataset[] | null>(null)
  const [loadingMonths, setLoadingMonths] = useState(false)
  const [monthError, setMonthError] = useState(false)
  const monthCache = useRef(new Map<string, Dataset>())
  const monthRequest = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    const read = async (name: string) => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${name}`, { signal: controller.signal })
      if (!response.ok) throw new Error('Map data unavailable')
      return response.json()
    }
    void Promise.all([read('demo.json'), read('stations.geojson')]).then(([dataset, locations]) => {
      if (!controller.signal.aborted) {
        setLoaded({ dataset, locations })
        setSelectedMonths(dataset.months ?? [])
        setActiveMonths(dataset.months ?? [])
      }
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [])
  useEffect(() => () => monthRequest.current?.abort(), [])
  const changeMonths = async (months: string[]) => {
    if (!loaded || !months.length) return
    const requested = [...months].sort()
    const allMonths = loaded.dataset.months ?? []
    monthRequest.current?.abort()
    setSelectedMonths(requested)
    setMonthError(false)
    if (requested.length === allMonths.length && allMonths.every((month) => requested.includes(month))) {
      setMonthData(null)
      setActiveMonths(allMonths)
      setLoadingMonths(false)
      return
    }
    const controller = new AbortController()
    monthRequest.current = controller
    setLoadingMonths(true)
    try {
      const datasets = await Promise.all(requested.map(async (month) => {
        const cached = monthCache.current.get(month)
        if (cached) return cached
        const response = await fetch(`${import.meta.env.BASE_URL}data/months/${month}.json`, { signal: controller.signal })
        if (!response.ok) throw new Error('Monthly data unavailable')
        const data = await response.json() as Dataset
        monthCache.current.set(month, data)
        return data
      }))
      if (!controller.signal.aborted) {
        setMonthData(datasets)
        setActiveMonths(requested)
        setLoadingMonths(false)
      }
    } catch {
      if (!controller.signal.aborted) {
        setLoadingMonths(false)
        setMonthError(true)
        setSelectedMonths(activeMonths)
      }
    }
  }
  const filtered = useMemo(() => {
    if (!loaded) return null
    const data = monthData ? combineMonths(monthData, activeMonths) : loaded.dataset
    return filterDashboard(data, loaded.locations, services, stationLimit)
  }, [loaded, monthData, activeMonths, services, stationLimit])
  const model = useMemo(() => filtered ? { ...prepareRailMap(filtered.dataset, filtered.locations),
    source: filtered.dataset.source, period: filtered.dataset.period,
    periodLabel: formatMonths(filtered.dataset.months ?? [], i18n.resolvedLanguage ?? 'en') } : null, [filtered, i18n.resolvedLanguage])
  const stationHours = useMemo(() => model && filtered ? buildStationHours(model.stations, filtered.dataset.hourly) : [], [model, filtered])
  const hours = useMemo(() => summarizeHourly(stationHours, scope.stationIds), [stationHours, scope.stationIds])
  const clockData = useMemo(() => filtered ? { period: filtered.dataset.period, months: filtered.dataset.months,
    source: filtered.dataset.source, timezone: 'Europe/Berlin', hours } : null, [filtered, hours])
  const approximate = filtered ? hourlyIsApproximate(filtered.dataset) : false
  const serviceOptions = useMemo(() => loaded ? [...new Set(loaded.dataset.stations.flatMap((row) => row.trainTypes))].sort() : [], [loaded])
  const changeScope = useCallback((next: MapScope) => setScope(next), [])
  const chooseHour = useCallback((next: number) => { setPlaying(false); setHour(next) }, [])
  const togglePlaying = useCallback(() => setPlaying((value) => !value), [])
  const playback = { playing, speed, onPlaying: togglePlaying, onSpeed: setSpeed }
  const scopeLabel = scope.name ? `${scope.name} · ${chartText('mappedCount', { count: scope.stationIds.length })}` : chartText('mappedNetwork', { count: model?.stations.length ?? 0 })
  useEffect(() => {
    if (!playing) return
    const timer = window.setInterval(() => setHour((value) => (value + 1) % 24), 1000 / speed)
    const pauseHidden = () => { if (document.hidden) setPlaying(false) }
    document.addEventListener('visibilitychange', pauseHidden)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', pauseHidden) }
  }, [playing, speed])

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.slice(0, 2) ?? 'en'
    document.title = t('common:pageTitle')
  }, [i18n.resolvedLanguage, t])

  const changeLanguage = () => {
    const next = i18n.resolvedLanguage?.startsWith('de') ? 'en' : 'de'
    localStorage.setItem('language', next)
    void i18n.changeLanguage(next)
  }

  return (
    <main className="app-shell station-map-page">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={t('common:brand')}>
          <span className="brand-mark">DB</span><span className="brand-name">{t('common:brand')}</span>
        </a>
        <div className="topbar-right">
          <button className="language-toggle" onClick={changeLanguage} aria-label={t('common:switchLanguage')}>
            {i18n.resolvedLanguage?.startsWith('de') ? 'EN' : 'DE'}
          </button>
        </div>
      </header>

      <section className="intro-row" id="top">
        <div>
          <h1>{t('common:title')}</h1>
        </div>
      </section>

      {failed ? <p role="alert">{t('dataError')}</p> : !model || !clockData ? <p role="status">{t('loading')}</p> : <>
        <section className="dashboard-toolbar" aria-label={chartText('dashboardFilters')}>
          <div className="dashboard-context"><strong>{scopeLabel}</strong><p>{chartText('typicalDayNote')}</p></div>
          <div className="dashboard-filter-row">
            <DashboardFilters stations={model.stations} stationId={stationId} onStation={setStationId}
              services={serviceOptions} selectedServices={services} onServices={setServices}
              stationLimit={stationLimit} onStationLimit={setStationLimit}
              months={loaded?.dataset.months ?? []} selectedMonths={selectedMonths} onMonths={(months) => void changeMonths(months)}
              loadingMonths={loadingMonths} />
            <PlaybackControls {...playback} />
          </div>
          {monthError && <p role="alert">{chartText('monthLoadError')}</p>}
        </section>
        <section className="station-map-dashboard" aria-label={chartText('linkedPlayback')}>
          <section className="linked-map-view" aria-label={t('common:title')}>
            <RailMap data={model} hourlyStations={stationHours[hour]} hour={hour} approximate={approximate}
              onScopeChange={changeScope} stationId={stationId} onStationChange={setStationId} />
          </section>
          <HourlyPulse approximate={approximate} hours={hours} hour={hour} playing={playing} onHour={chooseHour} scopeLabel={scopeLabel} />
          <DelayClock data={clockData} selectedHour={hour} onHour={chooseHour} scopeLabel={scopeLabel} playing={playing} approximate={approximate} />
        </section>
      </>}
    </main>
  )
}

export default App
