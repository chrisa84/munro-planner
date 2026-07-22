import type { Trip, TripRoute } from '../lib/types'
import type { Store } from '../hooks/useStore'
import { formatMins } from '../lib/osrm'

interface Props {
  store: Store
  activeTrip: Trip | null
  route: TripRoute | null
  routeError: string | null
  routeLoading: boolean
  flyTo: (lat: number, lon: number, zoom?: number) => void
}

export default function TripPanel({ store, activeTrip, route, routeError, routeLoading, flyTo }: Props) {
  const updateTrip = (id: string, fn: (t: Trip) => Trip) =>
    store.setTrips((trips) => trips.map((t) => (t.id === id ? fn(t) : t)))

  const newTrip = () => {
    const trip: Trip = { id: `trip-${Date.now()}`, name: `Trip ${store.trips.length + 1}`, stops: [] }
    store.setTrips((trips) => [...trips, trip])
    store.setActiveTripId(trip.id)
  }

  const moveStop = (i: number, dir: -1 | 1) => {
    if (!activeTrip) return
    updateTrip(activeTrip.id, (t) => {
      const stops = [...t.stops]
      const j = i + dir
      if (j < 0 || j >= stops.length) return t
      ;[stops[i], stops[j]] = [stops[j], stops[i]]
      return { ...t, stops }
    })
  }

  const totals = route
    ? route.legs.reduce(
        (acc, l) => ({
          km: acc.km + l.distanceKm,
          min: acc.min + l.durationMin,
          adj: acc.adj + l.adjustedMin,
        }),
        { km: 0, min: 0, adj: 0 },
      )
    : null

  return (
    <div className="panel">
      <div className="trip-select-row">
        <select
          value={store.activeTripId ?? ''}
          onChange={(e) => store.setActiveTripId(e.target.value || null)}
        >
          <option value="">— select trip —</option>
          {store.trips.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button onClick={newTrip}>New</button>
        {activeTrip && (
          <button
            onClick={() => {
              store.setTrips((trips) => trips.filter((t) => t.id !== activeTrip.id))
              store.setActiveTripId(null)
            }}
          >
            Delete
          </button>
        )}
      </div>

      {!activeTrip ? (
        <p className="hint">
          Create a trip, then add stops: click car parks or munros on the map, or right-click anywhere for a
          custom stop (campsite, supermarket…).
        </p>
      ) : (
        <>
          <input
            className="trip-name"
            value={activeTrip.name}
            onChange={(e) => updateTrip(activeTrip.id, (t) => ({ ...t, name: e.target.value }))}
          />

          <ol className="stop-list">
            {activeTrip.stops.map((s, i) => (
              <li key={s.id}>
                <div className="stop-row">
                  <button className="stop-name" onClick={() => flyTo(s.lat, s.lon)}>
                    {s.name}
                  </button>
                  <span className="stop-controls">
                    <button onClick={() => moveStop(i, -1)} disabled={i === 0} title="Move up">
                      ↑
                    </button>
                    <button
                      onClick={() => moveStop(i, 1)}
                      disabled={i === activeTrip.stops.length - 1}
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button
                      onClick={() =>
                        updateTrip(activeTrip.id, (t) => ({ ...t, stops: t.stops.filter((x) => x.id !== s.id) }))
                      }
                      title="Remove"
                    >
                      ✕
                    </button>
                  </span>
                </div>
                {route?.legs[i] && (
                  <div className="leg">
                    ↓ {route.legs[i].distanceKm.toFixed(0)} km · {formatMins(route.legs[i].durationMin)} (
                    {formatMins(route.legs[i].adjustedMin)} adj.)
                  </div>
                )}
              </li>
            ))}
            {activeTrip.stops.length === 0 && <li className="empty">No stops yet — add from the map.</li>}
          </ol>

          {routeLoading && <p className="hint">Calculating route…</p>}
          {routeError && <p className="error">Routing failed: {routeError}</p>}
          {totals && (
            <div className="totals">
              <strong>Total:</strong> {totals.km.toFixed(0)} km · {formatMins(totals.min)} raw ·{' '}
              {formatMins(totals.adj)} adjusted
            </div>
          )}

          <label className="factor-row">
            Single-track factor
            <input
              type="number"
              step="0.05"
              min="1"
              max="2"
              value={store.singleTrackFactor}
              onChange={(e) => store.setSingleTrackFactor(Number(e.target.value) || 1.25)}
            />
          </label>
          <p className="hint small">
            Drive times come from OSRM, which is optimistic on Highland single-track roads — the adjusted time
            multiplies by this factor.
          </p>
        </>
      )}
    </div>
  )
}
