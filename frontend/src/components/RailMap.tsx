import { useEffect, useRef } from 'react'
import { AttributionControl, LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, setWorkerUrl } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import type { Metric, StationMetric } from '../data/types'

setWorkerUrl(mapWorkerUrl)

interface RailMapProps {
  stations: StationMetric[]
  metric: Metric
  selectedStationId: string
  onSelect: (stationId: string) => void
}

export function RailMap({ stations, metric, selectedStationId, onSelect }: RailMapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const hasFitBounds = useRef(false)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new MapLibreMap({
      container: containerRef.current,
      style: 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json',
      center: [10.4, 51.1],
      zoom: 5.4,
      minZoom: 4,
      maxZoom: 13,
      attributionControl: false,
    })
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')

    map.on('load', () => {
      map.resize()
      map.addSource('railway-network', {
        type: 'raster',
        tiles: [
          'https://a.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
          'https://b.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
          'https://c.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png',
        ],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors · OpenRailwayMap',
      })
      map.addLayer({ id: 'railway-network', type: 'raster', source: 'railway-network', paint: { 'raster-opacity': 0.66 } })
    })
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [onSelect])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const markers: Marker[] = []
    const addMarkers = () => {
      map.resize()
      if (!hasFitBounds.current && stations.length) {
        const bounds = new LngLatBounds()
        stations.forEach((station) => bounds.extend([station.longitude, station.latitude]))
        map.fitBounds(bounds, { padding: 42, maxZoom: 5.4, duration: 0 })
        hasFitBounds.current = true
      }
      stations.forEach((station) => {
        const element = document.createElement('button')
        const value = station.metricValue ?? 0
        const color = station.stationId === selectedStationId
          ? '#1d2926'
          : metric === 'cancelled'
            ? value > 4 ? '#bd4438' : value > 1.5 ? '#d49b37' : '#397a5f'
            : value > 10 ? '#bd4438' : value > 5 ? '#d49b37' : '#397a5f'
        const size = Math.max(10, Math.min(24, 9 + Math.sqrt(station.observations) / 18))
        element.type = 'button'
        element.className = 'station-marker'
        element.title = station.stationName
        element.setAttribute('aria-label', station.stationName)
        element.style.setProperty('--marker-color', color)
        element.style.width = `${size}px`
        element.style.height = `${size}px`
        element.addEventListener('click', () => onSelect(station.stationId))
        markers.push(new Marker({ element, anchor: 'center' })
          .setLngLat([station.longitude, station.latitude])
          .addTo(map))
      })
    }
    if (map.loaded()) addMarkers()
    else map.once('load', addMarkers)
    return () => {
      map.off('load', addMarkers)
      markers.forEach((marker) => marker.remove())
    }
  }, [stations, metric, selectedStationId, onSelect])

  return <div className="rail-map" ref={containerRef} />
}