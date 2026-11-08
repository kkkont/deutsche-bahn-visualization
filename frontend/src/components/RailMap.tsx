import { useEffect, useMemo, useRef, useState } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import { useTranslation } from 'react-i18next'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { lockToGermany } from './germanyBounds'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import { HEX_AREA_KM2, HEX_SIDE_METRES } from '../data/delayHexagons'
import { prepareRailMap } from '../data/railMapData'
import type { Dataset } from '../data/types'
import type { StationLocations } from '../data/railMapData'

setWorkerUrl(mapWorkerUrl)
type Selection = { kind: 'station' | 'cell'; id: string } | null
type MapData = ReturnType<typeof prepareRailMap> & { source: string; period: string }

export function RailMap() {
  const { t, i18n } = useTranslation('map')
  const { t: stationText } = useTranslation('stations')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [data, setData] = useState<MapData | null>(null)
  const [selection, setSelection] = useState<Selection>(null)
  const locale = i18n.resolvedLanguage ?? 'en'
  const count = new Intl.NumberFormat(locale)
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })
  const value = (mean: number | null | undefined) => mean == null ? t('noMeasurements') : `${data?.approximate ? '≈ ' : ''}${decimal.format(mean)} min`
  const period = data?.period.split('/').map((month) => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))).join(' – ') ?? ''
  const latest = useRef({ t, stationText, value, count, period })
  useEffect(() => { latest.current = { t, stationText, value, count, period } })
  const station = selection?.kind === 'station' ? data?.stations.find((item) => item.stationId === selection.id) : null
  const cell = selection?.kind === 'cell' ? data?.cells.find((item) => item.cellId === selection.id) : null
  const highlightedIds = useMemo(() => station ? [station.stationId] : cell?.stations.map((item) => item.stationId) ?? [], [station, cell])

  useEffect(() => {
    const controller = new AbortController()
    const read = async (file: string) => {
      const response = await fetch(`${import.meta.env.BASE_URL}data/${file}`, { signal: controller.signal })
      if (!response.ok) throw new Error(`Cannot load ${file}`)
      return response.json()
    }
    void Promise.all([read('demo.json'), read('stations.geojson')]).then(([metrics, locations]: [Dataset, StationLocations]) => {
      const prepared = prepareRailMap(metrics, locations)
      if (!prepared.stations.length) throw new Error('No station locations')
      if (!controller.signal.aborted) setData({ ...prepared, source: metrics.source, period: metrics.period })
    }).catch(() => { if (!controller.signal.aborted) setStatus('error') })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (selection) panelRef.current?.focus()
  }, [selection])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('station-selected')) return
    map.setFilter('station-selected', ['in', ['get', 'stationId'], ['literal', highlightedIds]])
    map.setFilter('hex-selected', ['==', ['get', 'cellId'], cell?.cellId ?? ''])
  }, [highlightedIds, cell, status])

  useEffect(() => {
    if (!containerRef.current || !data) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      maxZoom: 13, attributionControl: false,
    })
    mapRef.current = map
    lockToGermany(map, 24)
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false })
    const color: ExpressionSpecification = ['interpolate', ['linear'], ['coalesce', ['get', 'averageDelayMinutes'], 0]]
    DELAY_COLORS.forEach((hex, index) => color.push(index * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1), hex))
    map.on('load', () => {
      map.addSource('delay-hexagons', { type: 'geojson', data: {
        type: 'FeatureCollection', features: data.cells.map((item) => ({
          type: 'Feature', geometry: { type: 'Polygon', coordinates: [item.coordinates] },
          properties: { cellId: item.cellId, averageDelayMinutes: item.averageDelayMinutes },
        })),
      }, attribution: 'Train observations: Deutsche Bahn · CC BY 4.0 · piebro/deutsche-bahn-data' })
      map.addLayer({ id: 'hex-fill', type: 'fill', source: 'delay-hexagons', paint: {
        'fill-color': color, 'fill-opacity': ['case', ['==', ['get', 'averageDelayMinutes'], null], 0, 0.72],
      } })
      map.addLayer({ id: 'hex-outline', type: 'line', source: 'delay-hexagons', paint: {
        'line-color': '#666666', 'line-width': 1,
      } })
      map.addLayer({ id: 'hex-missing', type: 'line', source: 'delay-hexagons',
        filter: ['==', ['get', 'averageDelayMinutes'], null],
        paint: { 'line-color': '#333333', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      map.addLayer({ id: 'hex-selected', type: 'line', source: 'delay-hexagons',
        filter: ['==', ['get', 'cellId'], ''], paint: { 'line-color': '#222222', 'line-width': 3 } })
      map.addSource('stations', { type: 'geojson', data: {
        type: 'FeatureCollection', features: data.stations.map((item) => ({
          type: 'Feature', geometry: { type: 'Point', coordinates: [item.longitude, item.latitude] },
          properties: { stationId: item.stationId },
        })),
      }, attribution: 'Station locations: Deutsche Bahn · CC BY 4.0 · db-stations' })
      map.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 10, 7],
        'circle-color': '#77AADD', 'circle-stroke-color': '#222222', 'circle-stroke-width': 1,
      } })
      map.addLayer({ id: 'station-selected', type: 'circle', source: 'stations',
        filter: ['in', ['get', 'stationId'], ['literal', []]], paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6.5, 10, 10],
          'circle-color': '#77AADD', 'circle-opacity': 0, 'circle-stroke-color': '#222222', 'circle-stroke-width': 2,
        } })
      // One hit test gives station markers priority over their underlying bins.
      map.on('click', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['stations', 'hex-fill'] })[0]
        popup.remove()
        if (!feature) return
        setSelection(feature.layer.id === 'stations'
          ? { kind: 'station', id: String(feature.properties.stationId) }
          : { kind: 'cell', id: String(feature.properties.cellId) })
      })
      map.on('mousemove', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['stations', 'hex-fill'] })[0]
        map.getCanvas().style.cursor = feature ? 'pointer' : ''
        if (!feature) { popup.remove(); return }
        const ui = latest.current
        const content = document.createElement('div')
        const title = document.createElement('strong'), mean = document.createElement('div'), stops = document.createElement('div'), period = document.createElement('div')
        const item = feature.layer.id === 'stations'
          ? data.stations.find((entry) => entry.stationId === feature.properties.stationId)
          : data.cells.find((entry) => entry.cellId === feature.properties.cellId)
        if (!item) return
        title.textContent = 'stationName' in item ? item.stationName : ui.t('cellTitle', { id: item.cellId })
        mean.textContent = `${ui.stationText('averageDelay')}: ${ui.value(item.averageDelayMinutes)}`
        stops.textContent = `${ui.t('measuredStops')}: ${ui.count.format(item.delayObservations)}`
        period.textContent = ui.period
        content.append(title, mean, stops, period)
        popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map)
      })
      map.getCanvas().addEventListener('mouseleave', () => popup.remove())
      setStatus('ready')
    })
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(containerRef.current)
    return () => { popup.remove(); observer.disconnect(); map.remove(); mapRef.current = null }
  }, [data])

  const closePanel = () => { setSelection(null); mapRef.current?.getCanvas().focus() }
  return <>
    {data && <div className="rail-map-controls">
      <div className="rail-map-scope"><strong>{t('delayMapTitle')}</strong><span>{period} · {t('coverage', { count: data.stations.length })}</span></div>
      <label>{t('selectStation')}<select aria-label={t('selectStation')} value={station?.stationId ?? ''} onChange={(event) => setSelection(event.target.value ? { kind: 'station', id: event.target.value } : null)}>
        <option value="">{t('chooseStation')}</option>
        {data.stations.map((item) => <option key={item.stationId} value={item.stationId}>{item.stationName}</option>)}
      </select></label>
      <label>{t('selectCell')}<select aria-label={t('selectCell')} value={cell?.cellId ?? ''} onChange={(event) => setSelection(event.target.value ? { kind: 'cell', id: event.target.value } : null)}>
        <option value="">{t('chooseCell')}</option>
        {data.cells.map((item) => <option key={item.cellId} value={item.cellId}>{item.cellId} · {item.stations.length} · {item.stations[0].stationName}</option>)}
      </select></label>
    </div>}
    <div className={selection ? 'map-workspace has-selection' : 'map-workspace'}>
      <div className="map-frame">
        <div className="rail-map" ref={containerRef} role="region" aria-label={t('delayMapTitle')} />
        {status !== 'ready' && <div className="station-status" role={status === 'error' ? 'alert' : 'status'}>{t(status === 'error' ? 'stationError' : 'loadingStations')}</div>}
      </div>
      {(station || cell) && <aside ref={panelRef} className="station-panel" aria-labelledby="station-panel-name" tabIndex={-1}
        onKeyDown={(event) => { if (event.key === 'Escape') closePanel() }}>
        <div className="station-panel-header"><span>{station ? stationText('selectedStation') : t('selectedCell')}</span><button type="button" onClick={closePanel}>{stationText('closePanel')}</button></div>
        <h2 id="station-panel-name">{station?.stationName ?? t('cellTitle', { id: cell!.cellId })}</h2>
        <p className="rail-detail-period">{period}</p>
        <dl className="rail-detail-metrics">
          <div><dt>{stationText('averageDelay')}</dt><dd>{value((station ?? cell)!.averageDelayMinutes)}</dd></div>
          <div><dt>{t('measuredStops')}</dt><dd>{count.format((station ?? cell)!.delayObservations)}</dd></div>
          {station && <>
            <div><dt>{stationText('observations')}</dt><dd>{count.format(station.observations)}</dd></div>
            <div><dt>{stationText('overFive')}</dt><dd>{station.delayedOverFivePercent == null ? '—' : `≈ ${decimal.format(station.delayedOverFivePercent)}%`}</dd></div>
            <div><dt>{stationText('cancellation')}</dt><dd>{station.cancelledPercent == null ? '—' : `≈ ${decimal.format(station.cancelledPercent)}%`}</dd></div>
            <div><dt>{t('evaIds')}</dt><dd>{station.evas.join(', ')}</dd></div>
            <div><dt>{t('trainTypes')}</dt><dd>{station.trainTypes.join(', ') || '—'}</dd></div>
          </>}
          {cell && <div><dt>{t('measuredStations')}</dt><dd>{cell.measuredStationCount} / {cell.stations.length}</dd></div>}
        </dl>
        {station && <p>{t('coordinates', { latitude: station.latitude.toFixed(4), longitude: station.longitude.toFixed(4) })}</p>}
        {cell && <><h3>{t('stationsInCell')}</h3><ul className="rail-cell-stations">{cell.stations.map((item) => <li key={item.stationId}>
          <button type="button" onClick={() => setSelection({ kind: 'station', id: item.stationId })}>{item.stationName}</button>
        </li>)}</ul></>}
        {station && <button type="button" className="rail-parent-cell" onClick={() => setSelection({ kind: 'cell', id: data!.cells.find((item) => item.stations.some((entry) => entry.stationId === station.stationId))!.cellId })}>{t('viewCell')}</button>}
      </aside>}
    </div>
    {data && <div className="rail-map-legend">
      <div><strong>{t('legendTitle')}</strong><div className="rail-delay-ramp" /><div className="rail-delay-ticks">{[0, 5, 10, 15, 20].map((tick) => <span key={tick}>{tick}{tick === 20 ? '+' : ''}</span>)}</div></div>
      <p><span className="rail-station-key" />{t('stationKey')} · {t('gridNote', { side: HEX_SIDE_METRES / 1000, area: count.format(Math.round(HEX_AREA_KM2)) })}<br />{t('coverageNote')} {data.approximate && t('approximateNote')}</p>
      <a href={data.source} target="_blank" rel="noreferrer">{t('dataSource')}</a>
    </div>}
  </>
}
