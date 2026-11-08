import { LngLat } from 'maplibre-gl'
import type { LngLatBoundsLike, Map as MapLibreMap } from 'maplibre-gl'

const [WEST, SOUTH, EAST, NORTH] = [5.8, 47.2, 15.1, 55.1]
export const GERMANY_BOUNDS: LngLatBoundsLike = [[WEST, SOUTH], [EAST, NORTH]]
const TILE_SIZE = 512

// Web Mercator in 0..1 world units, the space MapLibre pans in.
const mercatorX = (lng: number) => (lng + 180) / 360
const mercatorY = (lat: number) => (1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2
const latitude = (y: number) => 360 / Math.PI * Math.atan(Math.exp((1 - 2 * y) * Math.PI)) - 90
// If the view is larger than Germany in one direction, stay centred in that direction.
const clamp = (value: number, low: number, high: number) => low > high ? (low + high) / 2 : Math.min(high, Math.max(low, value))

/** Keep the visible area inside Germany and never zoom out further than the whole country. */
export function lockToGermany(map: MapLibreMap, padding: number, fitOnResize = true) {
  let minZoom = 0
  map.setTransformConstrain((center, zoom) => {
    const z = Math.max(zoom, minZoom)
    const world = TILE_SIZE * 2 ** z
    const halfWidth = map.getContainer().clientWidth / 2 / world
    const halfHeight = map.getContainer().clientHeight / 2 / world
    const x = clamp(mercatorX(center.lng), mercatorX(WEST) + halfWidth, mercatorX(EAST) - halfWidth)
    const y = clamp(mercatorY(center.lat), mercatorY(NORTH) + halfHeight, mercatorY(SOUTH) - halfHeight)
    return { center: new LngLat(x * 360 - 180, latitude(y)), zoom: z }
  })
  const fit = (resetCamera = true) => {
    map.setMinZoom(null)
    minZoom = map.cameraForBounds(GERMANY_BOUNDS, { padding })?.zoom ?? 0
    map.setMinZoom(minZoom)
    if (resetCamera) map.fitBounds(GERMANY_BOUNDS, { padding, duration: 0 })
  }
  fit()
  map.on('resize', () => fit(fitOnResize))
}
