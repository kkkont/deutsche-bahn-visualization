import { useEffect, useMemo, useRef, useState } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import type { ExpressionSpecification, GeoJSONSource } from 'maplibre-gl'
import { useTranslation } from 'react-i18next'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { GERMANY_BOUNDS, lockToGermany } from './germanyBounds'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import { HEX_AREA_KM2, HEX_SIDE_METRES } from '../data/delayHexagons'
import { drillIntoCell, LOCAL_HEX_SIDE_METRES, DETAIL_HEX_SIDE_METRES } from '../data/railMapDrilldown'
import type { DelayHexagon } from '../data/delayHexagons'
import type { RailStation } from '../data/railMapData'
import type { prepareRailMap } from '../data/railMapData'
import { refreshCell } from '../data/linkedHourly'
import type { MapScope } from '../data/linkedHourly'

setWorkerUrl(mapWorkerUrl)
type Selection = { kind: 'station' | 'cell'; id: string } | null
type MapData = ReturnType<typeof prepareRailMap> & { source: string; period: string }

const cellFeatures = (cells: DelayHexagon[]) => ({ type: 'FeatureCollection' as const, features: cells.map((item) => ({
  type: 'Feature' as const, geometry: { type: 'Polygon' as const, coordinates: [item.coordinates] },
  properties: { cellId: item.cellId, averageDelayMinutes: item.averageDelayMinutes },
})) })
const stationFeatures = (stations: RailStation[]) => ({ type: 'FeatureCollection' as const, features: stations.map((item) => ({
  type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [item.longitude, item.latitude] },
  properties: { stationId: item.stationId, stationName: item.stationName },
})) })

export function RailMap({ data, hourlyStations, hour, approximate, onScopeChange }: {
  data: MapData; hourlyStations: RailStation[]; hour: number; approximate: boolean; onScopeChange: (scope: MapScope) => void;
}) {
  const { t, i18n } = useTranslation('map')
  const { t: stationText } = useTranslation('stations')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const popupRef = useRef<Popup | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selection, setSelection] = useState<Selection>(null)
  const [drillPath, setDrillPath] = useState<DelayHexagon[]>([])
  const parent = drillPath.at(-1) ?? null
  const side = !parent ? HEX_SIDE_METRES : drillPath.length === 1 ? LOCAL_HEX_SIDE_METRES : DETAIL_HEX_SIDE_METRES
  const parentSide = drillPath.length === 1 ? HEX_SIDE_METRES : LOCAL_HEX_SIDE_METRES
  const cells = useMemo(() => parent && data ? drillIntoCell(parent, data.stations, side) : data?.cells ?? [], [parent, data, side])
  const visibleStations = useMemo(() => parent && data ? data.stations.filter((item) => parent.stations.some((entry) => entry.stationId === item.stationId)) : data?.stations ?? [], [parent, data])
  const chooseCell = (id: string) => {
    const target = cells.find((item) => item.cellId === id)
    if (!target) return
    if (drillPath.length < 2) setDrillPath([...drillPath, target])
    setSelection({ kind: 'cell', id })
  }
  const backToGermany = () => { setDrillPath([]); setSelection(null); mapRef.current?.getCanvas().focus() }
  const backOneLevel = () => {
    const path = drillPath.slice(0, -1)
    setDrillPath(path)
    setSelection(path.length ? { kind: 'cell', id: path.at(-1)!.cellId } : null)
  }
  const locale = i18n.resolvedLanguage ?? 'en'
  const count = new Intl.NumberFormat(locale)
  const decimal = new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 })
  const value = (mean: number | null | undefined) => mean == null ? t('noMeasurements') : `${approximate ? '≈ ' : ''}${decimal.format(mean)} min`
  const period = data?.period.split('/').map((month) => new Intl.DateTimeFormat(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-01T00:00:00Z`))).join(' – ') ?? ''
  const latest = useRef({ t, stationText, value, count, period, cells, parent, chooseCell, hourlyStations, hour })
  useEffect(() => { latest.current = { t, stationText, value, count, period, cells, parent, chooseCell, hourlyStations, hour } })
  const station = selection?.kind === 'station' ? data?.stations.find((item) => item.stationId === selection.id) : null
  const cell = selection?.kind === 'cell' ? cells.find((item) => item.cellId === selection.id) ?? (parent?.cellId === selection.id ? parent : null) : (station ? null : parent)
  const highlightedIds = useMemo(() => station ? [station.stationId] : cell?.stations.map((item) => item.stationId) ?? [], [station, cell])

  const scopeIds = useMemo(() => station ? [station.stationId] : cell ? cell.stations.map((item) => item.stationId) : data.stations.map((item) => item.stationId), [station, cell, data])
  const scopeName = station?.stationName ?? (cell ? t('cellTitle', { id: cell.cellId }) : null)
  useEffect(() => onScopeChange({ stationIds: scopeIds, name: scopeName }), [scopeIds, scopeName, onScopeChange])
  const stationById = useMemo(() => new Map(hourlyStations.map((item) => [item.stationId, item])), [hourlyStations])
  const displayCells = useMemo(() => cells.map((item) => refreshCell(item, stationById)), [cells, stationById])
  const summary = station ? stationById.get(station.stationId)! : cell ? refreshCell(cell, stationById) : null

  useEffect(() => {
    if (selection || parent) {
      panelRef.current?.focus()
      if (panelRef.current) panelRef.current.scrollTop = 0
    }
  }, [selection, parent])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getLayer('station-selected')) return
    map.setFilter('station-selected', ['in', ['get', 'stationId'], ['literal', highlightedIds]])
    map.setFilter('hex-selected', ['==', ['get', 'cellId'], cell?.cellId ?? ''])
    map.setFilter('station-name-selected', ['==', ['get', 'stationId'], station?.stationId ?? ''])
    map.setFilter('station-labels', ['!=', ['get', 'stationId'], station?.stationId ?? ''])
  }, [highlightedIds, cell, station, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map?.getSource('delay-hexagons')) return
    popupRef.current?.remove()
    map.getSource<GeoJSONSource>('delay-hexagons')!.setData(cellFeatures(displayCells))
    map.getSource<GeoJSONSource>('stations')!.setData(stationFeatures(visibleStations))
    map.getSource<GeoJSONSource>('parent-area')!.setData(cellFeatures(parent ? [parent] : []))
    map.setLayoutProperty('station-labels', 'visibility', parent ? 'visible' : 'none')
  }, [displayCells, visibleStations, parent, status])

  useEffect(() => {
    const map = mapRef.current
    if (!map || status !== 'ready') return
    map.resize()
    const animation = {
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 750,
      easing: (progress: number) => progress * progress * (3 - 2 * progress),
    }
    if (!parent) {
      if (!station) map.fitBounds(GERMANY_BOUNDS, { padding: 24, linear: true, ...animation })
      return
    }
    if (station) {
      map.easeTo({ center: [station.longitude, station.latitude], zoom: Math.max(map.getZoom(), 11), ...animation })
      return
    }
    if (!cell) return
    // Area summaries frame occupied child bins; the parent outline stays as context.
    // Individual bin inspection still frames that bin's complete geometry.
    const framedCells = cell === parent && cells.length ? cells : [cell]
    const coordinates = framedCells.flatMap((item) => item.coordinates)
    const xs = coordinates.map((point) => point[0]), ys = coordinates.map((point) => point[1])
    map.fitBounds([[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], { padding: 48, maxZoom: 12, linear: true, ...animation })
  }, [parent, cell, station, cells, status])

  useEffect(() => {
    if (!containerRef.current || !data) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      maxZoom: 13, attributionControl: false,
    })
    mapRef.current = map
    lockToGermany(map, 24, false)
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false })
    popupRef.current = popup
    map.on('movestart', () => popup.remove())
    const color: ExpressionSpecification = ['interpolate', ['linear'], ['coalesce', ['get', 'averageDelayMinutes'], 0]]
    DELAY_COLORS.forEach((hex, index) => color.push(index * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1), hex))
    map.on('load', () => {
      map.addSource('delay-hexagons', { type: 'geojson', data: cellFeatures(latest.current.cells.map((item) => refreshCell(item, new Map(latest.current.hourlyStations.map((station) => [station.stationId, station]))))),
        attribution: 'Train observations: Deutsche Bahn · CC BY 4.0 · piebro/deutsche-bahn-data' })
      map.addSource('parent-area', { type: 'geojson', data: cellFeatures(latest.current.parent ? [latest.current.parent] : []) })
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
      map.addLayer({ id: 'parent-outline', type: 'line', source: 'parent-area', paint: {
        'line-color': '#222222', 'line-width': 2, 'line-dasharray': [4, 3],
      } })
      map.addSource('stations', { type: 'geojson', data: stationFeatures(data.stations),
        attribution: 'Station locations: Deutsche Bahn · CC BY 4.0 · db-stations' })
      map.addLayer({ id: 'stations', type: 'circle', source: 'stations', paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3.5, 10, 7],
        'circle-color': '#77AADD', 'circle-stroke-color': '#222222', 'circle-stroke-width': 1,
      } })
      map.addLayer({ id: 'station-selected', type: 'circle', source: 'stations',
        filter: ['in', ['get', 'stationId'], ['literal', []]], paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 6.5, 10, 10],
          'circle-color': '#77AADD', 'circle-opacity': 0, 'circle-stroke-color': '#222222', 'circle-stroke-width': 2,
        } })
      map.addLayer({ id: 'station-labels', type: 'symbol', source: 'stations', layout: {
        'visibility': latest.current.parent ? 'visible' : 'none',
        'text-field': ['get', 'stationName'], 'text-size': 12,
        'text-font': ['Open Sans Regular'], 'text-anchor': 'top', 'text-offset': [0, 0.9],
        'text-allow-overlap': false,
      }, paint: { 'text-color': '#222222', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } })
      map.addLayer({ id: 'station-name-selected', type: 'symbol', source: 'stations',
        filter: ['==', ['get', 'stationId'], ''], layout: {
          'text-field': ['get', 'stationName'], 'text-size': 13,
          'text-font': ['Open Sans Regular'], 'text-anchor': 'top', 'text-offset': [0, 1],
          'text-allow-overlap': true, 'text-ignore-placement': true,
        }, paint: { 'text-color': '#222222', 'text-halo-color': '#ffffff', 'text-halo-width': 2 } })
      // One hit test gives station markers priority over their underlying bins.
      map.on('click', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['stations', 'hex-fill'] })[0]
        popup.remove()
        if (!feature) return
        if (feature.layer.id === 'stations') {
          if (!latest.current.parent || latest.current.parent.stations.some((item) => item.stationId === feature.properties.stationId))
            setSelection({ kind: 'station', id: String(feature.properties.stationId) })
        }
        else latest.current.chooseCell(String(feature.properties.cellId))
      })
      map.on('mousemove', (event) => {
        const feature = map.queryRenderedFeatures(event.point, { layers: ['stations', 'hex-fill'] })[0]
        map.getCanvas().style.cursor = feature ? 'pointer' : ''
        if (!feature) { popup.remove(); return }
        const ui = latest.current
        const content = document.createElement('div')
        const title = document.createElement('strong'), mean = document.createElement('div'), stops = document.createElement('div'), period = document.createElement('div')
        const item = feature.layer.id === 'stations'
          ? ui.hourlyStations.find((entry) => entry.stationId === feature.properties.stationId)
          : (() => { const target = ui.cells.find((entry) => entry.cellId === feature.properties.cellId); return target ? refreshCell(target, new Map(ui.hourlyStations.map((station) => [station.stationId, station]))) : undefined })()
        if (!item) return
        title.textContent = 'stationName' in item ? item.stationName : ui.t('cellTitle', { id: item.cellId })
        mean.textContent = `${ui.stationText('averageDelay')}: ${ui.value(item.averageDelayMinutes)}`
        stops.textContent = `${ui.t('measuredStops')}: ${ui.count.format(item.delayObservations)}`
        period.textContent = `${ui.period} · ${String(ui.hour).padStart(2, '0')}:00–${String((ui.hour + 1) % 24).padStart(2, '0')}:00`
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
      <div className="rail-map-scope"><strong>{t('delayMapTitle')}</strong><span>{period} · {String(hour).padStart(2, '0')}:00 · {t('coverage', { count: visibleStations.length })}</span></div>
      <label>{t('selectStation')}<select aria-label={t('selectStation')} value={station?.stationId ?? ''} onChange={(event) => setSelection(event.target.value ? { kind: 'station', id: event.target.value } : null)}>
        <option value="">{t('chooseStation')}</option>
        {visibleStations.map((item) => <option key={item.stationId} value={item.stationId}>{item.stationName}</option>)}
      </select></label>
      <label>{t('selectCell')}<select aria-label={t('selectCell')} value={cells.some((item) => item.cellId === cell?.cellId) ? cell!.cellId : ''} onChange={(event) => event.target.value ? chooseCell(event.target.value) : setSelection(null)}>
        <option value="">{t('chooseCell')}</option>
        {cells.map((item) => <option key={item.cellId} value={item.cellId}>{item.cellId} · {item.stations.length} · {item.stations[0].stationName}</option>)}
      </select></label>
    </div>}
    {data && <div className="rail-drill-scope" role="status">
      <strong>{parent ? t('localScope', { id: parent.cellId, side: side / 1000 }) : t('nationalScope', { side: side / 1000 })}</strong>
      <details className="rail-map-help"><summary>{t('mapGuidance')}</summary><div>
        <p>{parent ? t(drillPath.length === 1 ? 'localHint' : 'detailHint', { side: side / 1000, nextSide: DETAIL_HEX_SIDE_METRES / 1000 }) : t('drillHint')}</p>
        {parent && <p>{t('clippedNote')}</p>}
        <p>{t('coverageNote')} {approximate && t('hourlyApproximateNote')}</p>
        <a href={data.source} target="_blank" rel="noreferrer">{t('dataSource')}</a>
      </div></details>
    </div>}
    <div className={selection || parent ? 'map-workspace has-selection' : 'map-workspace'}>
      <div className="map-frame">
        <div className="rail-map" ref={containerRef} role="region" aria-label={t('delayMapTitle')} />
        {status !== 'ready' && <div className="station-status" role={status === 'error' ? 'alert' : 'status'}>{t(status === 'error' ? 'stationError' : 'loadingStations')}</div>}
      </div>
      {(station || cell) && <aside ref={panelRef} className="station-panel" aria-labelledby="station-panel-name" tabIndex={-1}
        onKeyDown={(event) => { if (event.key === 'Escape') closePanel() }}>
        <div className="station-panel-header"><span>{station ? stationText('selectedStation') : t('selectedCell')}</span>{!parent && <button type="button" onClick={closePanel}>{stationText('closePanel')}</button>}</div>
        {parent && <div className="rail-area-actions" role="group" aria-label={t('areaNavigation')}>
          <button type="button" onClick={backToGermany}>{t('backGermany')}</button>
          {drillPath.length > 1 && <button type="button" onClick={backOneLevel}>{t('backOneLevel')}</button>}
          <button type="button" disabled={cell === parent} onClick={() => setSelection({ kind: 'cell', id: parent.cellId })}>{t('areaSummary')}</button>
        </div>}
        <h2 id="station-panel-name">{station?.stationName ?? t('cellTitle', { id: cell!.cellId })}</h2>
        <p className="rail-detail-period">{period}{cell && <> · {t('binResolution', { side: (cell === parent ? parentSide : side) / 1000 })}</>}</p>
        {cell === parent && parent?.stations.length === 1 && <p className="rail-sparse-note">{t('singleStationNote')}</p>}
        <p className="rail-hour-scope">{t('hourlyDetails', { hour: String(hour).padStart(2, '0') })}</p>
        <dl className="rail-detail-metrics">
          <div><dt>{stationText('averageDelay')}</dt><dd>{value(summary!.averageDelayMinutes)}</dd></div>
          <div><dt>{t('measuredStops')}</dt><dd>{count.format(summary!.delayObservations)}</dd></div>
          {station && <>
            <p className="rail-period-note">{t('fullPeriodDetails')}</p>
            <div><dt>{stationText('observations')}</dt><dd>{count.format(station.observations)}</dd></div>
            <div><dt>{stationText('overFive')}</dt><dd>{station.delayedOverFivePercent == null ? '—' : `≈ ${decimal.format(station.delayedOverFivePercent)}%`}</dd></div>
            <div><dt>{stationText('cancellation')}</dt><dd>{station.cancelledPercent == null ? '—' : `≈ ${decimal.format(station.cancelledPercent)}%`}</dd></div>
            <div><dt>{t('evaIds')}</dt><dd>{station.evas.join(', ')}</dd></div>
            <div><dt>{t('trainTypes')}</dt><dd>{station.trainTypes.join(', ') || '—'}</dd></div>
          </>}
          {cell && <div><dt>{t('measuredStations')}</dt><dd>{'measuredStationCount' in summary! ? summary.measuredStationCount : 0} / {cell.stations.length}</dd></div>}
        </dl>
        {station && <p>{t('coordinates', { latitude: station.latitude.toFixed(4), longitude: station.longitude.toFixed(4) })}</p>}
        {cell && <><h3>{t('stationsInCell')}</h3><ul className="rail-cell-stations">{cell.stations.map((item) => <li key={item.stationId}>
          <button type="button" onClick={() => setSelection({ kind: 'station', id: item.stationId })}>{item.stationName}</button>
        </li>)}</ul></>}
        {station && <button type="button" className="rail-parent-cell" onClick={() => chooseCell(cells.find((item) => item.stations.some((entry) => entry.stationId === station.stationId))!.cellId)}>{t('viewCell')}</button>}
      </aside>}
    </div>
    {data && <div className="rail-map-legend">
      <div><strong>{t('legendTitle')}</strong><div className="rail-delay-ramp" /><div className="rail-delay-ticks">{[0, 5, 10, 15, 20].map((tick) => <span key={tick}>{tick}{tick === 20 ? '+' : ''}</span>)}</div></div>
      <p><span className="rail-station-key" />{t('stationKey')} · {t(parent ? 'localGridNote' : 'gridNote', { side: side / 1000, area: count.format(Math.round(HEX_AREA_KM2 * (side / HEX_SIDE_METRES) ** 2)) })}</p>
    </div>}
  </>
}
