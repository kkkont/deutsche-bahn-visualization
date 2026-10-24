import { useEffect, useRef, useState } from 'react'
import { AttributionControl, Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl'
import { useTranslation } from 'react-i18next'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'

setWorkerUrl(mapWorkerUrl)

export function RailMap() {
  const { t } = useTranslation('map')
  const { t: stationText } = useTranslation('stations')
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const panelRef = useRef<HTMLElement>(null)
  const [stationStatus, setStationStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [selectedStationName, setSelectedStationName] = useState<string | null>(null)

  useEffect(() => {
    if (selectedStationName !== null) panelRef.current?.focus()
  }, [selectedStationName])

  const closeStationPanel = () => {
    setSelectedStationName(null)
    mapRef.current?.getCanvas().focus()
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const colors = getComputedStyle(containerRef.current)
    const stationColor = colors.getPropertyValue('--station-location-color').trim() || '#77AADD'
    const stationOutline = colors.getPropertyValue('--station-location-outline').trim() || '#333333'
    const map = new MapLibreMap({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      bounds: [[5.8, 47.2], [15.1, 55.1]],
      fitBoundsOptions: { padding: 24 },
      minZoom: 2,
      maxZoom: 13,
      attributionControl: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    const controller = new AbortController()
    const popup = new Popup({ closeButton: false, closeOnClick: false })
    map.on('load', async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/stations.geojson`, { signal: controller.signal })
        if (!response.ok) throw new Error('Station locations unavailable')
        const stations = await response.json()
        if (controller.signal.aborted) return
        map.addSource('stations', {
          type: 'geojson',
          data: stations,
          attribution: 'Station locations: Deutsche Bahn (DB), CC BY 4.0 · db-stations',
        })
        map.addLayer({
          id: 'stations',
          type: 'circle',
          source: 'stations',
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 4, 3, 10, 6],
            'circle-color': stationColor,
            'circle-stroke-color': stationOutline,
            'circle-stroke-width': 1,
          },
        })
        map.on('mousemove', 'stations', (event) => {
          const feature = event.features?.[0]
          if (!feature || feature.geometry.type !== 'Point') return
          map.getCanvas().style.cursor = 'pointer'
          popup.setLngLat(feature.geometry.coordinates as [number, number])
            .setText(String(feature.properties?.name ?? ''))
            .addTo(map)
        })
        map.on('mouseleave', 'stations', () => {
          map.getCanvas().style.cursor = ''
          popup.remove()
        })
        map.on('click', 'stations', (event) => {
          const name = event.features?.[0]?.properties?.name
          if (typeof name !== 'string' || !name.trim()) return
          popup.remove()
          setSelectedStationName(name)
        })
        setStationStatus('ready')
      } catch {
        if (!controller.signal.aborted) setStationStatus('error')
      }
    })

    const resizeObserver = new ResizeObserver(() => {
      map.resize()
      map.fitBounds([[5.8, 47.2], [15.1, 55.1]], { padding: 24, duration: 0 })
    })
    resizeObserver.observe(containerRef.current)
    mapRef.current = map

    return () => {
      controller.abort()
      popup.remove()
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  return <div className={selectedStationName !== null ? 'map-workspace has-selection' : 'map-workspace'}>
    <div className="map-frame">
      <div className="rail-map" ref={containerRef} />
      {stationStatus !== 'ready' && (
        <div className="station-status" role={stationStatus === 'error' ? 'alert' : 'status'}>
          {t(stationStatus === 'error' ? 'stationError' : 'loadingStations')}
        </div>
      )}
    </div>
    {selectedStationName !== null && (
      <aside
        ref={panelRef}
        className="station-panel"
        aria-labelledby="station-panel-name"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') closeStationPanel()
        }}
      >
        <div className="station-panel-header">
          <span>{stationText('selectedStation')}</span>
          <button type="button" onClick={closeStationPanel}>
            {stationText('closePanel')}
          </button>
        </div>
        <h2 id="station-panel-name">{selectedStationName}</h2>
      </aside>
    )}
  </div>
}