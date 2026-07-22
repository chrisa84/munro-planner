import type { TripRoute, TripStop } from './types'

const OSRM = 'https://router.project-osrm.org/route/v1/driving'

/**
 * One request for the whole trip: OSRM returns per-leg durations/distances
 * plus the full geometry. Durations are optimistic on Highland single-track
 * roads, so the caller applies a configurable factor.
 */
export async function fetchTripRoute(stops: TripStop[], singleTrackFactor: number): Promise<TripRoute> {
  if (stops.length < 2) return { legs: [], geometry: [] }
  const coords = stops.map((s) => `${s.lon},${s.lat}`).join(';')
  const res = await fetch(`${OSRM}/${coords}?overview=full&geometries=geojson&steps=false`)
  if (!res.ok) throw new Error(`OSRM HTTP ${res.status}`)
  const json = await res.json()
  if (json.code !== 'Ok' || !json.routes?.[0]) throw new Error(`OSRM: ${json.code ?? 'no route'}`)
  const route = json.routes[0]
  return {
    legs: route.legs.map((l: { distance: number; duration: number }) => ({
      distanceKm: l.distance / 1000,
      durationMin: l.duration / 60,
      adjustedMin: (l.duration / 60) * singleTrackFactor,
    })),
    geometry: route.geometry.coordinates.map(([lon, lat]: [number, number]) => [lat, lon] as [number, number]),
  }
}

export function formatMins(mins: number): string {
  const m = Math.round(mins)
  const h = Math.floor(m / 60)
  return h > 0 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`
}
