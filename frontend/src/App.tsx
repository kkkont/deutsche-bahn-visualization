import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { line, curveMonotoneX } from 'd3-shape'
import { select } from 'd3-selection'
import { useTranslation } from 'react-i18next'
import { RailMap } from './components/RailMap'
import type { Dataset, HourPoint, Metric, StationMetric } from './data/types'

function combineStationMetrics(records: StationMetric[], metric: Metric) {
  const grouped = new Map<string, StationMetric>()
  for (const record of records) {
    const current = grouped.get(record.stationId)
    if (!current) {
      grouped.set(record.stationId, { ...record })
      continue
    }
    const total = current.observations + record.observations
    const delayTotal = current.delayObservations + record.delayObservations
    current.averageDelayMinutes = delayTotal
      ? (current.averageDelayMinutes * current.delayObservations + record.averageDelayMinutes * record.delayObservations) / delayTotal
      : 0
    current.delayedOverFivePercent = delayTotal
      ? (current.delayedOverFivePercent * current.delayObservations + record.delayedOverFivePercent * record.delayObservations) / delayTotal
      : 0
    current.cancelledPercent = total
      ? (current.cancelledPercent * current.observations + record.cancelledPercent * record.observations) / total
      : 0
    current.observations = total
    current.delayObservations = delayTotal
    current.trainTypes = [...new Set([...current.trainTypes, ...record.trainTypes])]
    current.evas = [...new Set([...current.evas, ...record.evas])]
  }
  return [...grouped.values()].map((station) => ({
    ...station,
    metricValue: metric === 'delay'
      ? station.averageDelayMinutes
      : metric === 'late'
        ? station.delayedOverFivePercent
        : station.cancelledPercent,
  }))
}

function DelayChart({ points }: { points: HourPoint[] }) {
  const svgRef = useRef<SVGSVGElement>(null)
  const { t } = useTranslation('charts')

  useEffect(() => {
    if (!svgRef.current) return
    const width = 520
    const height = 148
    const margin = { top: 12, right: 12, bottom: 26, left: 34 }
    const chart = select(svgRef.current)
    chart.selectAll('*').remove()
    chart.attr('viewBox', `0 0 ${width} ${height}`)
    if (!points.length) return

    const x = scaleLinear().domain([0, 23]).range([margin.left, width - margin.right])
    const minDelay = Math.min(0, ...points.map((point) => point.averageDelayMinutes))
    const maxDelay = Math.max(5, ...points.map((point) => point.averageDelayMinutes))
    const y = scaleLinear().domain([minDelay, maxDelay]).nice().range([height - margin.bottom, margin.top])
    const root = chart.append('g')

    root.selectAll('.grid-line')
      .data(y.ticks(3))
      .join('line')
      .attr('x1', margin.left).attr('x2', width - margin.right)
      .attr('y1', (value) => y(value)).attr('y2', (value) => y(value))
      .attr('stroke', '#dce2df').attr('stroke-dasharray', '2 5')

    root.selectAll('.y-label')
      .data(y.ticks(3))
      .join('text')
      .attr('x', margin.left - 8).attr('y', (value) => y(value) + 3)
      .attr('text-anchor', 'end').attr('class', 'chart-tick')
      .text((value) => `${value}m`)

    root.selectAll('.x-label')
      .data([0, 6, 12, 18, 23])
      .join('text')
      .attr('x', (value) => x(value)).attr('y', height - 6)
      .attr('text-anchor', 'middle').attr('class', 'chart-tick')
      .text((value) => `${String(value).padStart(2, '0')}:00`)

    const makeLine = line<HourPoint>()
      .x((point) => x(point.hour))
      .y((point) => y(point.averageDelayMinutes))
      .curve(curveMonotoneX)

    root.append('path').datum(points)
      .attr('fill', 'none').attr('stroke', '#bd4438').attr('stroke-width', 2.5)
      .attr('stroke-linecap', 'round').attr('d', makeLine)

    root.selectAll('.chart-point')
      .data(points)
      .join('circle')
      .attr('cx', (point) => x(point.hour)).attr('cy', (point) => y(point.averageDelayMinutes))
      .attr('r', 3).attr('fill', '#fff').attr('stroke', '#bd4438').attr('stroke-width', 2)
      .append('title')
      .text((point) => `${String(point.hour).padStart(2, '0')}:00 · ${point.averageDelayMinutes.toFixed(1)} min`)
  }, [points])

  return <div className="chart-wrap"><svg ref={svgRef} role="img" aria-label={t('hourlyDelay')} /></div>
}

function App() {
  const { t, i18n } = useTranslation(['common', 'map', 'stations', 'charts'])
  const [dataset, setDataset] = useState<Dataset | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [trainType, setTrainType] = useState('all')
  const [metric, setMetric] = useState<Metric>('delay')
  const [selectedEva, setSelectedEva] = useState('')

  useEffect(() => {
    fetch('/data/demo.json')
      .then((response) => {
        if (!response.ok) throw new Error('dataset unavailable')
        return response.json() as Promise<Dataset>
      })
      .then((data) => {
        setDataset(data)
        setSelectedEva(data.stations[0]?.stationId ?? '')
      })
      .catch(() => setLoadError(true))
  }, [])

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.slice(0, 2) ?? 'en'
    document.title = t('common:pageTitle')
  }, [i18n.resolvedLanguage, t])

  const trainTypes = useMemo(
    () => [...new Set(dataset?.stations.flatMap((station) => station.trainTypes) ?? [])].sort(),
    [dataset],
  )
  const filteredRows = useMemo(
    () => (dataset?.stations ?? []).filter((station) => trainType === 'all' || station.trainTypes.includes(trainType)),
    [dataset, trainType],
  )
  const mapStations = useMemo(() => combineStationMetrics(filteredRows, metric), [filteredRows, metric])
  const selectedStation = mapStations.find((station) => station.stationId === selectedEva) ?? mapStations[0]
  const stationHours = useMemo(
    () => {
      const grouped = new Map<number, { weightedDelay: number; observations: number }>()
      for (const point of dataset?.hourly ?? []) {
        if (point.stationId !== selectedStation?.stationId || (trainType !== 'all' && point.trainType !== trainType)) continue
        const current = grouped.get(point.hour) ?? { weightedDelay: 0, observations: 0 }
        current.weightedDelay += point.averageDelayMinutes * point.delayObservations
        current.observations += point.delayObservations
        grouped.set(point.hour, current)
      }
      return [...grouped.entries()]
        .map(([hour, totals]) => ({
          stationId: selectedStation?.stationId ?? '',
          trainType,
          hour,
          averageDelayMinutes: totals.observations ? totals.weightedDelay / totals.observations : 0,
          delayObservations: totals.observations,
        }))
        .sort((left, right) => left.hour - right.hour)
    },
    [dataset, selectedStation?.stationId, trainType],
  )
  const typeDetails = filteredRows.filter((station) => station.stationId === selectedStation?.stationId)
  const language = i18n.resolvedLanguage?.startsWith('de') ? 'de-DE' : 'en-GB'
  const localNumber = new Intl.NumberFormat(language, { maximumFractionDigits: 1 })

  const changeLanguage = () => {
    const next = i18n.resolvedLanguage?.startsWith('de') ? 'en' : 'de'
    localStorage.setItem('language', next)
    void i18n.changeLanguage(next)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={t('common:brand')}>
          <span className="brand-mark">DB</span><span className="brand-name">{t('common:brand')}</span>
        </a>
        <div className="topbar-right">
          <span className="dataset-stamp">{dataset?.period ?? '2024-07'} <i /></span>
          <button className="language-toggle" onClick={changeLanguage} aria-label={t('common:switchLanguage')}>
            {i18n.resolvedLanguage?.startsWith('de') ? 'EN' : 'DE'}
          </button>
        </div>
      </header>

      <section className="intro-row" id="top">
        <div>
          <p className="eyebrow">{t('common:kicker')}</p>
          <h1>{t('common:title')}</h1>
          <p className="intro-copy">{t('common:subtitle')}</p>
        </div>
        <div className="source-note"><span className="source-dot" /><span>{t('common:sourceNote')}</span></div>
      </section>

      <section className="control-bar" aria-label={t('common:filters')}>
        <label className="control-field">
          <span>{t('common:trainType')}</span>
          <select value={trainType} onChange={(event) => setTrainType(event.target.value)}>
            <option value="all">{t('common:allTrains')}</option>
            {trainTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
        </label>
        <fieldset className="metric-control">
          <legend>{t('common:metric')}</legend>
          {(['delay', 'late', 'cancelled'] as Metric[]).map((value) => (
            <button key={value} className={metric === value ? 'metric-option active' : 'metric-option'}
              onClick={() => setMetric(value)} aria-pressed={metric === value}>
              {t(`common:metrics.${value}`)}
            </button>
          ))}
        </fieldset>
        <div className="period-control"><span>{t('common:period')}</span><strong>{dataset?.period ?? '2024-07'}</strong></div>
      </section>

      {loadError ? (
        <section className="load-error" role="alert">{t('common:dataError')}</section>
      ) : !dataset ? (
        <section className="load-error" role="status">{t('common:loading')}</section>
      ) : (
        <section className="workspace-grid">
          <div className="map-panel">
            <div className="panel-heading map-heading">
              <div><span className="eyebrow">{t('map:eyebrow')}</span><h2>{t('map:title')}</h2></div>
              <span className="station-count">{mapStations.length} {t('map:stations')}</span>
            </div>
            <div className="map-frame">
              <RailMap stations={mapStations} metric={metric} selectedStationId={selectedStation?.stationId ?? ''} onSelect={setSelectedEva} />
              <div className="map-legend">
                <span className="legend-title">{t(`common:metrics.${metric}`)}</span>
                <span><i className="legend-dot on-time" /> {t('map:low')}</span>
                <span><i className="legend-dot delayed" /> {t('map:medium')}</span>
                <span><i className="legend-dot severe" /> {t('map:high')}</span>
              </div>
            </div>
            <div className="map-footnote"><span>{t('map:networkAttribution')}</span><span>{t('map:pointHint')}</span></div>
          </div>

          <aside className="detail-panel" aria-live="polite">
            {selectedStation ? <>
              <div className="detail-topline"><span className="eyebrow">{t('stations:selectedStation')}</span><span className="rank-mark">●</span></div>
              <h2 className="station-name">{selectedStation.stationName}</h2>
              <p className="station-meta">{selectedStation.trainTypes.join(' · ')}</p>
              <div className="primary-stat"><strong>{localNumber.format(selectedStation.averageDelayMinutes)}</strong><span>{t('stations:averageDelay')}</span></div>
              <div className="stat-pair">
                <div><strong>{localNumber.format(selectedStation.delayedOverFivePercent)}%</strong><span>{t('stations:overFive')}</span></div>
                <div><strong>{localNumber.format(selectedStation.cancelledPercent)}%</strong><span>{t('stations:cancellation')}</span></div>
              </div>
              <div className="observations-line"><span>{t('stations:observations')}</span><strong>{new Intl.NumberFormat(language).format(selectedStation.observations)}</strong></div>
              <div className="chart-section">
                <div className="chart-heading"><div><span className="eyebrow">{t('charts:dayProfile')}</span><h3>{t('charts:hourlyDelay')}</h3></div><span className="chart-unit">{t('charts:minutes')}</span></div>
                <DelayChart points={stationHours} />
              </div>
              <div className="train-breakdown">
                <h3>{t('stations:byTrain')}</h3>
                {typeDetails.slice(0, 4).map((entry) => <div className="train-row" key={`${entry.stationId}-${entry.trainTypes[0]}`}>
                  <span>{entry.trainTypes.join(', ')}</span><span>{localNumber.format(entry.averageDelayMinutes)} {t('charts:minutesShort')}</span>
                </div>)}
              </div>
            </> : <p className="empty-state">{t('stations:noStation')}</p>}
          </aside>
        </section>
      )}

      <footer className="page-footer"><span>{t('common:footerSource')}</span><span>{t('common:statistaNote')}</span></footer>
    </main>
  )
}

export default App
