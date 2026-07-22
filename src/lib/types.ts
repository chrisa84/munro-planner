export interface MunroRoute {
  name: string
  url: string
  startName: string | null
  startLat: number
  startLon: number
  startGridref: string | null
  distance: string | null
  time: string | null
  ascent: string | null
}

export interface Munro {
  id: number
  name: string
  height: number
  gridref: string
  lat: number
  lon: number
  region: string
  area: string
  walkhighlands: string
  stevenfallon: string | null
  hillbagging: string
  routes: MunroRoute[]
}

export interface CarPark {
  id: string
  lat: number
  lon: number
  name: string | null
  fee: string | null
  munros: number[]
}

export interface ParkUp {
  id: string
  lat: number
  lon: number
  name: string | null
  kind: 'camp_site' | 'caravan_site'
  fee: string | null
  motorhome: string | null
  website: string | null
}

export interface TripStop {
  /** carpark/parkup osm id, munro id as "munro/<id>", or "custom/<n>" */
  id: string
  kind: 'carpark' | 'parkup' | 'custom'
  name: string
  lat: number
  lon: number
}

export interface Trip {
  id: string
  name: string
  stops: TripStop[]
}

export interface RouteLeg {
  distanceKm: number
  durationMin: number
  adjustedMin: number
}

export interface TripRoute {
  legs: RouteLeg[]
  /** [lat, lon] polyline for the whole trip */
  geometry: [number, number][]
}
