import { useCallback, useEffect, useRef, useState } from 'react'
import type { Map as LeafletMap } from 'leaflet'
import { useStore } from './hooks/useStore'
import type { CarPark, Munro, ParkUp, Trip, TripRoute, TripStop } from './lib/types'
import { fetchTripRoute } from './lib/osrm'
import MapView from './components/MapView'
import Sidebar from './components/Sidebar'
import TripPanel from './components/TripPanel'

export default function App() {
  const store = useStore()
  const [munros, setMunros] = useState<Munro[]>([])
  const [corbetts, setCorbetts] = useState<Munro[]>([])
  const [carparks, setCarparks] = useState<CarPark[]>([])
  const [parkups, setParkups] = useState<ParkUp[]>([])
  const [tab, setTab] = useState<'munros' | 'trip'>('munros')
  const [route, setRoute] = useState<TripRoute | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 700)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [routeLoading, setRouteLoading] = useState(false)
  const mapRef = useRef<LeafletMap | null>(null)

  useEffect(() => {
    const base = import.meta.env.BASE_URL
    fetch(`${base}data/munros.json`)
      .then((r) => r.json())
      .then((d) => setMunros(d.munros))
      .catch(() => setMunros([]))
    fetch(`${base}data/carparks.json`)
      .then((r) => (r.ok ? r.json() : { carparks: [] }))
      .then((d) => setCarparks(d.carparks ?? []))
      .catch(() => setCarparks([]))
    fetch(`${base}data/corbetts.json`)
      .then((r) => (r.ok ? r.json() : { corbetts: [] }))
      .then((d) => setCorbetts(d.corbetts ?? []))
      .catch(() => setCorbetts([]))
    fetch(`${base}data/parkups.json`)
      .then((r) => (r.ok ? r.json() : { parkups: [] }))
      .then((d) => setParkups(d.parkups ?? []))
      .catch(() => setParkups([]))
  }, [])

  const activeTrip = store.trips.find((t) => t.id === store.activeTripId) ?? null

  const addStop = useCallback(
    (stop: TripStop) => {
      store.setTrips((trips) => {
        const existing = store.activeTripId && trips.find((t) => t.id === store.activeTripId)
        if (existing) {
          return trips.map((t) =>
            t.id === existing.id && !t.stops.some((s) => s.id === stop.id)
              ? { ...t, stops: [...t.stops, stop] }
              : t,
          )
        }
        const trip: Trip = { id: `trip-${Date.now()}`, name: 'New trip', stops: [stop] }
        store.setActiveTripId(trip.id)
        return [...trips, trip]
      })
      setTab('trip')
    },
    [store.setTrips, store.setActiveTripId, store.activeTripId],
  )

  // Recompute driving route when the active trip's stops or the factor change.
  const stopsKey = activeTrip?.stops.map((s) => s.id).join('|') ?? ''
  useEffect(() => {
    setRouteError(null)
    if (!activeTrip || activeTrip.stops.length < 2) {
      setRoute(null)
      return
    }
    setRouteLoading(true)
    const timer = setTimeout(() => {
      fetchTripRoute(activeTrip.stops, store.singleTrackFactor)
        .then((r) => setRoute(r))
        .catch((e) => {
          setRoute(null)
          setRouteError(String(e.message ?? e))
        })
        .finally(() => setRouteLoading(false))
    }, 600)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stopsKey, store.singleTrackFactor])

  const flyTo = useCallback((lat: number, lon: number, zoom = 13) => {
    // On phones the sidebar covers the map — close it so the fly-to is visible.
    if (window.innerWidth <= 700) {
      setSidebarOpen(false)
      setTimeout(() => mapRef.current?.invalidateSize(), 250)
    }
    mapRef.current?.flyTo([lat, lon], zoom, { duration: 0.8 })
  }, [])

  const toggleSidebar = () => {
    setSidebarOpen((o) => !o)
    setTimeout(() => mapRef.current?.invalidateSize(), 250)
  }

  return (
    <div className="app">
      <button
        className="sidebar-toggle"
        onClick={toggleSidebar}
        title={sidebarOpen ? 'Hide panel' : 'Show panel'}
        aria-label={sidebarOpen ? 'Hide panel' : 'Show panel'}
      >
        {sidebarOpen ? '✕' : '☰'}
      </button>
      <aside className={sidebarOpen ? 'sidebar' : 'sidebar closed'}>
        <header className="sidebar-header">
          <h1>Munro Camper Planner</h1>
          <div className="progress">
            {munros.filter((m) => store.doneSet.has(m.id)).length} / {munros.length || 282} munros
            {store.showCorbetts &&
              ` · ${corbetts.filter((c) => store.doneSet.has(c.id)).length} / ${corbetts.length || 222} corbetts`}
          </div>
          <nav className="tabs">
            <button className={tab === 'munros' ? 'active' : ''} onClick={() => setTab('munros')}>
              Munros
            </button>
            <button className={tab === 'trip' ? 'active' : ''} onClick={() => setTab('trip')}>
              Trip
            </button>
          </nav>
        </header>
        {tab === 'munros' ? (
          <Sidebar munros={munros} corbetts={corbetts} store={store} flyTo={flyTo} />
        ) : (
          <TripPanel
            store={store}
            activeTrip={activeTrip}
            route={route}
            routeError={routeError}
            routeLoading={routeLoading}
            flyTo={flyTo}
          />
        )}
        <footer className="attribution">
          Hill data:{' '}
          <a href="https://www.hill-bagging.co.uk/dobih" target="_blank" rel="noreferrer">
            DoBIH
          </a>{' '}
          (CC-BY) · Routing:{' '}
          <a href="https://project-osrm.org" target="_blank" rel="noreferrer">
            OSRM
          </a>{' '}
          / OSM (ODbL)
        </footer>
      </aside>
      <main className="map-wrap">
        <MapView
          munros={munros}
          corbetts={corbetts}
          carparks={carparks}
          parkups={parkups}
          store={store}
          addStop={addStop}
          activeTrip={activeTrip}
          route={route}
          mapRef={mapRef}
        />
      </main>
    </div>
  )
}
