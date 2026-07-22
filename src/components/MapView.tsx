import { useMemo, useState, type RefObject } from 'react'
import L, { type Map as LeafletMap, type LatLngBounds } from 'leaflet'
import {
  MapContainer,
  TileLayer,
  LayersControl,
  CircleMarker,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
} from 'react-leaflet'
import type { CarPark, Munro, Trip, TripRoute, TripStop } from '../lib/types'
import type { Store } from '../hooks/useStore'

const OS_KEY = import.meta.env.VITE_OS_MAPS_KEY as string | undefined

const carparkIcon = L.divIcon({ className: 'carpark-icon', html: 'P', iconSize: [20, 20], iconAnchor: [10, 10] })

function stopIcon(n: number) {
  return L.divIcon({ className: 'stop-icon', html: String(n), iconSize: [24, 24], iconAnchor: [12, 12] })
}

interface Props {
  munros: Munro[]
  carparks: CarPark[]
  store: Store
  addStop: (stop: TripStop) => void
  activeTrip: Trip | null
  route: TripRoute | null
  mapRef: RefObject<LeafletMap | null>
}

/** Tracks zoom/bounds so we can gate the (numerous) car-park markers. */
function ViewTracker({ onChange }: { onChange: (zoom: number, bounds: LatLngBounds) => void }) {
  const map = useMapEvents({
    moveend: () => onChange(map.getZoom(), map.getBounds()),
    zoomend: () => onChange(map.getZoom(), map.getBounds()),
  })
  return null
}

function ContextStop({ addStop }: { addStop: (stop: TripStop) => void }) {
  const [pos, setPos] = useState<[number, number] | null>(null)
  useMapEvents({
    contextmenu: (e) => setPos([e.latlng.lat, e.latlng.lng]),
    click: () => setPos(null),
  })
  if (!pos) return null
  return (
    <Popup position={pos} eventHandlers={{ remove: () => setPos(null) }}>
      <div className="popup">
        <strong>Custom stop</strong>
        <div className="popup-coords">
          {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
        </div>
        <button
          onClick={() => {
            addStop({
              id: `custom/${pos[0].toFixed(4)},${pos[1].toFixed(4)}`,
              kind: 'custom',
              name: `Point ${pos[0].toFixed(3)}, ${pos[1].toFixed(3)}`,
              lat: pos[0],
              lon: pos[1],
            })
            setPos(null)
          }}
        >
          + Add to trip
        </button>
      </div>
    </Popup>
  )
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

export default function MapView({ munros, carparks, store, addStop, activeTrip, route, mapRef }: Props) {
  const [view, setView] = useState<{ zoom: number; bounds: LatLngBounds | null }>({ zoom: 7, bounds: null })

  const visibleCarparks = useMemo(() => {
    if (view.zoom < 11 || !view.bounds) return []
    return carparks.filter((c) => view.bounds!.contains([c.lat, c.lon]))
  }, [carparks, view])

  const nearestCarparks = (m: Munro) =>
    carparks
      .filter((c) => c.munros.includes(m.id))
      .map((c) => ({ ...c, dist: haversineKm(c.lat, c.lon, m.lat, m.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)

  return (
    <MapContainer
      center={[57.1, -4.7]}
      zoom={7}
      className="map"
      ref={(m) => {
        mapRef.current = m
      }}
    >
      <LayersControl position="topright">
        {OS_KEY && (
          <LayersControl.BaseLayer checked name="OS Outdoor">
            <TileLayer
              url={`https://api.os.uk/maps/raster/v1/zxy/Outdoor_3857/{z}/{x}/{y}.png?key=${OS_KEY}`}
              attribution="© Crown copyright and database rights 2026 Ordnance Survey"
              maxZoom={16}
            />
          </LayersControl.BaseLayer>
        )}
        <LayersControl.BaseLayer checked={!OS_KEY} name="OpenTopoMap">
          <TileLayer
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · © OpenTopoMap (CC-BY-SA)'
            maxZoom={17}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <ViewTracker onChange={(zoom, bounds) => setView({ zoom, bounds })} />
      <ContextStop addStop={addStop} />

      {munros.map((m) => {
        const done = store.doneSet.has(m.id)
        return (
          <CircleMarker
            key={m.id}
            center={[m.lat, m.lon]}
            radius={6}
            pathOptions={{
              color: done ? '#1a7a3a' : '#b3262a',
              fillColor: done ? '#2ea15380' : '#d9484c',
              fillOpacity: 0.9,
              weight: 2,
            }}
          >
            <Popup>
              <div className="popup">
                <strong>{m.name}</strong>
                <div className="popup-sub">
                  {m.height} m · {Math.round(m.height * 3.28084)} ft · {m.gridref}
                </div>
                <div className="popup-sub">{m.region}</div>
                <div className="popup-links">
                  <a href={m.walkhighlands} target="_blank" rel="noreferrer">
                    Walkhighlands
                  </a>
                  {m.stevenfallon && (
                    <a href={m.stevenfallon} target="_blank" rel="noreferrer">
                      Steve Fallon
                    </a>
                  )}
                  <a href={m.hillbagging} target="_blank" rel="noreferrer">
                    Hill Bagging
                  </a>
                </div>
                <button onClick={() => store.toggleDone(m.id)}>{done ? '✓ Bagged — unmark' : 'Mark as bagged'}</button>
                {carparks.length > 0 && (
                  <div className="popup-carparks">
                    <em>Nearby car parks:</em>
                    {nearestCarparks(m).map((c) => (
                      <div key={c.id} className="popup-carpark-row">
                        <span>
                          {c.name ?? 'Car park'} ({c.dist.toFixed(1)} km)
                        </span>
                        <button
                          title="Add to trip"
                          onClick={() =>
                            addStop({ id: c.id, kind: 'carpark', name: c.name ?? `Car park nr ${m.name}`, lat: c.lat, lon: c.lon })
                          }
                        >
                          +
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Popup>
          </CircleMarker>
        )
      })}

      {visibleCarparks.map((c) => (
        <Marker key={c.id} position={[c.lat, c.lon]} icon={carparkIcon}>
          <Popup>
            <div className="popup">
              <strong>{c.name ?? 'Car park'}</strong>
              {c.fee && <div className="popup-sub">Fee: {c.fee}</div>}
              {c.munros.length > 0 && (
                <div className="popup-sub">
                  Serves:{' '}
                  {c.munros
                    .map((id) => munros.find((m) => m.id === id)?.name)
                    .filter(Boolean)
                    .slice(0, 6)
                    .join(', ')}
                </div>
              )}
              <div className="popup-links">
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${c.lat},${c.lon}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Google Maps
                </a>
              </div>
              <button
                onClick={() => addStop({ id: c.id, kind: 'carpark', name: c.name ?? 'Car park', lat: c.lat, lon: c.lon })}
              >
                + Add to trip
              </button>
            </div>
          </Popup>
        </Marker>
      ))}

      {activeTrip?.stops.map((s, i) => (
        <Marker key={s.id} position={[s.lat, s.lon]} icon={stopIcon(i + 1)}>
          <Popup>
            <div className="popup">
              <strong>
                Stop {i + 1}: {s.name}
              </strong>
            </div>
          </Popup>
        </Marker>
      ))}

      {route && route.geometry.length > 1 && (
        <Polyline positions={route.geometry} pathOptions={{ color: '#1d5fa8', weight: 4, opacity: 0.8 }} />
      )}
    </MapContainer>
  )
}
