import { useEffect, useRef, useState } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import type { ExpressionSpecification } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import type { StationSummary } from '../data/delayExplorer'

setWorkerUrl(mapWorkerUrl)

interface Props {
  stations: StationSummary[]
  period: string
  selectedStationId: string | null
  onSelectStation: (id: string) => void
}

export function AverageDelayMap({ stations, period, selectedStationId, onSelectStation }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const selectRef = useRef(onSelectStation)
  const selectedRef = useRef(selectedStationId)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => { selectRef.current = onSelectStation }, [onSelectStation])
  useEffect(() => {
    selectedRef.current = selectedStationId
    const map = mapRef.current
    if (map?.getLayer('explorer-selection')) {
      map.setFilter('explorer-selection', ['==', ['get', 'stationId'], selectedStationId ?? ''])
    }
  }, [selectedStationId])

  useEffect(() => {
    if (!container.current) return
    const map = new MapLibreMap({
      container: container.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      bounds: [[5.8, 47.2], [15.1, 55.1]],
      fitBoundsOptions: { padding: 35 }, minZoom: 2, maxZoom: 13,
      attributionControl: false,
    })
    mapRef.current = map
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    const popup = new Popup({ closeButton: false, closeOnClick: false })
    const radius: ExpressionSpecification = ['interpolate', ['linear'], ['zoom'], 4, 7, 10, 10]
    const color: ExpressionSpecification = ['interpolate', ['linear'], ['coalesce', ['get', 'averageDelayMinutes'], 0]]
    DELAY_COLORS.forEach((value, index) => color.push(index * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1), value))

    map.on('load', () => {
      map.addSource('explorer-stations', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: stations.map((station) => ({
          type: 'Feature', id: station.stationId,
          geometry: { type: 'Point', coordinates: [station.longitude, station.latitude] },
          properties: { ...station },
        })) },
      })
      map.addLayer({ id: 'explorer-stations', type: 'circle', source: 'explorer-stations', paint: {
        'circle-radius': radius, 'circle-color': color,
        'circle-opacity': ['case', ['==', ['get', 'averageDelayMinutes'], null], 0, 1],
        'circle-stroke-color': '#333333',
        'circle-stroke-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.5, 1],
      } })
      // Separate ring preserves the quantitative fill and its constant radius.
      map.addLayer({ id: 'explorer-selection', type: 'circle', source: 'explorer-stations',
        filter: ['==', ['get', 'stationId'], selectedRef.current ?? ''], paint: {
          'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 11, 10, 14],
          'circle-opacity': 0, 'circle-stroke-color': '#222222', 'circle-stroke-width': 2.5,
        } })
      let hovered: string | null = null
      const clearHover = () => {
        if (hovered) map.setFeatureState({ source: 'explorer-stations', id: hovered }, { hover: false })
        hovered = null
        popup.remove()
        map.getCanvas().style.cursor = ''
      }
      map.on('mousemove', 'explorer-stations', (event) => {
        const feature = event.features?.[0]
        if (!feature || feature.geometry.type !== 'Point') return
        const station = stations.find((item) => item.stationId === feature.properties?.stationId)
        if (!station) return
        clearHover()
        hovered = station.stationId
        map.setFeatureState({ source: 'explorer-stations', id: hovered }, { hover: true })
        map.getCanvas().style.cursor = 'pointer'
        const content = document.createElement('div')
        const title = document.createElement('strong')
        title.textContent = station.stationName
        const detail = document.createElement('div')
        detail.textContent = station.averageDelayMinutes === null ? 'No measurements' : `${station.averageDelayMinutes.toFixed(1)} min mean delay`
        const count = document.createElement('div')
        count.textContent = `${station.delayObservations.toLocaleString('en-GB')} measured train stops`
        const dates = document.createElement('div')
        dates.textContent = period
        content.append(title, detail, count, dates)
        popup.setLngLat(feature.geometry.coordinates as [number, number]).setDOMContent(content).addTo(map)
      })
      map.on('mouseleave', 'explorer-stations', clearHover)
      map.on('click', 'explorer-stations', (event) => {
        const id = event.features?.[0]?.properties?.stationId
        if (typeof id === 'string') { clearHover(); selectRef.current(id) }
      })
      setStatus('ready')
    })
    map.on('error', () => setStatus('error'))
    const observer = new ResizeObserver(() => map.resize())
    observer.observe(container.current)
    return () => {
      observer.disconnect()
      popup.remove()
      map.remove()
      mapRef.current = null
    }
  }, [stations, period])

  return <div className="explorer-map-frame">
    <div className="explorer-map" ref={container} role="region" aria-label="Map of synthetic average station delays. Use the station dropdown for keyboard selection."
      onKeyDown={(event) => { if (event.key === 'Escape' && selectedRef.current) selectRef.current(selectedRef.current) }} />
    {status !== 'ready' && <p className="explorer-map-status" role={status === 'error' ? 'alert' : 'status'}>
      {status === 'error' ? 'Map tiles could not load. You can still explore stations using the dropdown.' : 'Loading station map…'}
    </p>}
  </div>
}
