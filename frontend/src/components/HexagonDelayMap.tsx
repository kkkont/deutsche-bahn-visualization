import { useEffect, useRef, useState } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import { HEX_AREA_KM2, HEX_SIDE_METRES } from '../data/delayHexagons'
import type { DelayHexagon } from '../data/delayHexagons'

setWorkerUrl(mapWorkerUrl)
const number = new Intl.NumberFormat('en-GB')

export function HexagonDelayMap({ cells, period }: { cells: DelayHexagon[]; period: string }) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const selectedRef = useRef<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const selected = cells.find((cell) => cell.cellId === selectedId)

  useEffect(() => {
    selectedRef.current = selectedId
    const map = mapRef.current
    if (map?.getLayer('hex-selected')) map.setFilter('hex-selected', ['==', ['get', 'cellId'], selectedId ?? ''])
  }, [selectedId])

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      bounds: [[5.8, 47.2], [15.1, 55.1]], fitBoundsOptions: { padding: 35 },
      minZoom: 2, maxZoom: 13, attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false })
    const color: ExpressionSpecification = ['interpolate', ['linear'], ['coalesce', ['get', 'averageDelayMinutes'], 0]]
    DELAY_COLORS.forEach((value, index) => color.push(index * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1), value))
    map.on('load', () => {
      map.addSource('delay-hexagons', { type: 'geojson', data: {
        type: 'FeatureCollection', features: cells.map((cell) => ({
          type: 'Feature', id: cell.cellId,
          geometry: { type: 'Polygon', coordinates: [cell.coordinates] },
          properties: { cellId: cell.cellId, averageDelayMinutes: cell.averageDelayMinutes },
        })),
      } })
      map.addLayer({ id: 'hex-fill', type: 'fill', source: 'delay-hexagons', paint: {
        'fill-color': color,
        'fill-opacity': ['case', ['==', ['get', 'averageDelayMinutes'], null], 0, 1],
      } })
      map.addLayer({ id: 'hex-outline', type: 'line', source: 'delay-hexagons',
        filter: ['!=', ['get', 'averageDelayMinutes'], null],
        paint: { 'line-color': '#666666', 'line-width': 1 } })
      map.addLayer({ id: 'hex-missing', type: 'line', source: 'delay-hexagons',
        filter: ['==', ['get', 'averageDelayMinutes'], null],
        paint: { 'line-color': '#333333', 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      map.addLayer({ id: 'hex-selected', type: 'line', source: 'delay-hexagons',
        filter: ['==', ['get', 'cellId'], selectedRef.current ?? ''],
        paint: { 'line-color': '#222222', 'line-width': 3 } })
      map.on('mousemove', 'hex-fill', (event) => {
        const cell = cells.find((item) => item.cellId === event.features?.[0]?.properties?.cellId)
        if (!cell) return
        map.getCanvas().style.cursor = 'pointer'
        const content = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = `${cell.stations.length} station${cell.stations.length === 1 ? '' : 's'} in this cell`
        const mean = document.createElement('div')
        mean.textContent = cell.averageDelayMinutes === null ? 'No measurements' : `${cell.averageDelayMinutes.toFixed(1)} min mean delay`
        const count = document.createElement('div')
        count.textContent = `${number.format(cell.delayObservations)} measured train stops · ${cell.measuredStationCount} measured stations`
        const names = document.createElement('div')
        names.textContent = cell.stations.map((station) => station.stationName).join(', ')
        const dates = document.createElement('div')
        dates.textContent = period
        content.append(title, mean, count, names, dates)
        popup.setLngLat(event.lngLat).setDOMContent(content).addTo(map)
      })
      map.on('mouseleave', 'hex-fill', () => { map.getCanvas().style.cursor = ''; popup.remove() })
      map.on('click', 'hex-fill', (event) => {
        const id = event.features?.[0]?.properties?.cellId
        if (typeof id === 'string') setSelectedId((current) => current === id ? null : id)
        popup.remove()
      })
      setStatus('ready')
    })
    map.on('error', () => setStatus('error'))
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => { observer.disconnect(); popup.remove(); map.remove(); mapRef.current = null }
  }, [cells, period])

  return <section className="explorer-hex-section" aria-labelledby="hex-title">
    <header className="explorer-heading">
      <div>
        <p className="explorer-eyebrow">AN ALTERNATIVE VIEW</p>
        <h2 id="hex-title">Average delays by area</h2>
        <p>Group the same stations into fixed equal-area hexagons to compare regional patterns.</p>
      </div>
      <div className="explorer-source"><strong>Synthetic demo data</strong><span>{period} · Europe/Berlin</span></div>
    </header>
    <p className="explorer-hex-resolution">{HEX_SIDE_METRES / 1000} km sides · approximately {number.format(Math.round(HEX_AREA_KM2))} km² per cell · grid stays fixed when zooming</p>
    <div className="explorer-toolbar">
      <div className="explorer-station-control">
        <label htmlFor="explorer-cell">Explore a cell</label>
        <select id="explorer-cell" value={selectedId ?? ''} onChange={(event) => setSelectedId(event.target.value || null)}>
          <option value="">Choose an occupied cell</option>
          {cells.map((cell) => <option key={cell.cellId} value={cell.cellId}>{cell.stations.map((station) => station.stationName).join(' / ')}</option>)}
        </select>
      </div>
      <p>{cells.length} occupied cells · {cells.filter((cell) => cell.stations.length > 1).length} contain multiple stations</p>
      <button type="button" disabled={!selectedId} onClick={() => setSelectedId(null)}>Clear cell selection</button>
    </div>
    <div className="explorer-workspace">
      <div className="explorer-map-frame">
        <div className="explorer-map" ref={container} role="region" aria-label="Hexagonal map of synthetic mean delays. Use the cell dropdown for keyboard selection."
          onKeyDown={(event) => { if (event.key === 'Escape') setSelectedId(null) }} />
        {status !== 'ready' && <p className="explorer-map-status" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? 'Map tiles could not load. You can still explore cells using the dropdown.' : 'Loading hexagon map…'}
        </p>}
      </div>
      <aside className="explorer-details" aria-label="Hexagon details">
        <div aria-live="polite" aria-atomic="true">
          {selected ? <>
            <p className="explorer-eyebrow">SELECTED CELL · {selected.cellId}</p>
            <h3>{selected.stations.length} station{selected.stations.length === 1 ? '' : 's'} in this area</h3>
            <p className={`explorer-value${selected.averageDelayMinutes === null ? ' explorer-value-missing' : ''}`}>{selected.averageDelayMinutes === null ? 'No measurements' : <>{selected.averageDelayMinutes.toFixed(1)} <span>min</span></>}</p>
            <p className="explorer-muted">Observation-weighted mean delay</p>
            <dl>
              <div><dt>Measured train stops</dt><dd>{number.format(selected.delayObservations)}</dd></div>
              <div><dt>Stations with measurements</dt><dd>{selected.measuredStationCount} of {selected.stations.length}</dd></div>
              <div><dt>Period</dt><dd>{period}</dd></div>
            </dl>
            <h3>Included stations</h3>
            <ul className="explorer-cell-stations">{selected.stations.map((station) => <li key={station.stationId}>{station.stationName}</li>)}</ul>
          </> : <>
            <p className="explorer-eyebrow">AREA COMPARISON</p>
            <h3>One cell, one weighted average.</h3>
            <p>Select a hexagon or choose a cell above to inspect its stations and measurement count.</p>
          </>}
        </div>
        <div className="explorer-legend" aria-label="Hexagon delay colour legend">
          <h3>Mean delay per observed train stop · minutes</h3>
          <div className="explorer-ramp" style={{ background: `linear-gradient(to right, ${DELAY_COLORS.join(', ')})` }} />
          <div className="explorer-ticks"><span>0</span><span>5</span><span>10</span><span>15</span><span>20+</span></div>
          <p><span className="explorer-hex-missing" aria-hidden="true" />Dashed, hollow: no measurements</p>
          <p className="explorer-muted">Empty cells are omitted. A cell describes its observed stations, not every location within its boundary.</p>
        </div>
      </aside>
    </div>
    <p className="explorer-hex-note">Cell means use total delay minutes divided by measured train-stop counts. With only 21 demo stations, many cells contain a single station. Boundaries are full grid cells and may extend beyond Germany.</p>
  </section>
}
