import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RailMap } from './components/RailMap'
import { DelayClock } from './components/DelayClock'
import { PlaybackControls } from './components/PlaybackControls'
import { HourlyPulse } from './components/HourlyPulse'
import { prepareRailMap } from './data/railMapData'
import type { StationLocations } from './data/railMapData'
import type { Dataset } from './data/types'
import { buildStationHours, hourlyIsApproximate, summarizeHourly } from './data/linkedHourly'
import type { MapScope } from './data/linkedHourly'

function App() {
  const { t, i18n } = useTranslation('common')
  const { t: chartText } = useTranslation('charts')
  const [loaded, setLoaded] = useState<{ dataset: Dataset; locations: StationLocations } | null>(null)
  const [failed, setFailed] = useState(false)
  const [hour, setHour] = useState(12)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [scope, setScope] = useState<MapScope>({ stationIds: [], name: null })
  useEffect(() => {
    const controller = new AbortController()
    const read = async (name: string) => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${name}`, { signal: controller.signal })
      if (!response.ok) throw new Error('Map data unavailable')
      return response.json()
    }
    void Promise.all([read('demo.json'), read('stations.geojson')]).then(([dataset, locations]) => {
      if (!controller.signal.aborted) setLoaded({ dataset, locations })
    }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [])
  const model = useMemo(() => loaded ? { ...prepareRailMap(loaded.dataset, loaded.locations),
    source: loaded.dataset.source, period: loaded.dataset.period } : null, [loaded])
  const stationHours = useMemo(() => model && loaded ? buildStationHours(model.stations, loaded.dataset.hourly) : [], [model, loaded])
  const hours = useMemo(() => summarizeHourly(stationHours, scope.stationIds), [stationHours, scope.stationIds])
  const clockData = useMemo(() => loaded ? { period: loaded.dataset.period, months: loaded.dataset.months,
    source: loaded.dataset.source, timezone: 'Europe/Berlin', hours } : null, [loaded, hours])
  const approximate = loaded ? hourlyIsApproximate(loaded.dataset) : false
  const changeScope = useCallback((next: MapScope) => setScope(next), [])
  const chooseHour = useCallback((next: number) => { setPlaying(false); setHour(next) }, [])
  const togglePlaying = useCallback(() => setPlaying((value) => !value), [])
  const playback = { hour, playing, speed, onHour: chooseHour, onPlaying: togglePlaying, onSpeed: setSpeed }
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
        <section className="station-map-dashboard" aria-label={chartText('linkedPlayback')}>
        <div className="linked-day-controls">
          <strong>{scopeLabel}</strong>
          <p>{chartText('typicalDayNote')}</p>
          <PlaybackControls {...playback} />
        </div>
        <section className="linked-map-view" aria-label={t('common:title')}>
          <RailMap data={model} hourlyStations={stationHours[hour]} hour={hour} approximate={approximate} onScopeChange={changeScope} />
        </section>
        <HourlyPulse compact approximate={approximate} hours={hours} hour={hour} playing={playing} onHour={chooseHour} />
        </section>
        <DelayClock data={clockData} selectedHour={hour} onHour={chooseHour} scopeLabel={scopeLabel} playback={playback} approximate={approximate} />
      </>}
    </main>
  )
}

export default App
