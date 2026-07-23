import { useEffect, useMemo, useState, type RefObject } from 'react'
import L, { type Map as LeafletMap, type LatLngBounds } from 'leaflet'
import {
  MapContainer,
  TileLayer,
  LayersControl,
  LayerGroup,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
} from 'react-leaflet'
import type { CarPark, Munro, ParkUp, Trip, TripRoute, TripStop } from '../lib/types'
import type { Store } from '../hooks/useStore'

const OS_KEY = import.meta.env.VITE_OS_MAPS_KEY as string | undefined

function frogSvg(fill: string, dark: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <ellipse cx="12" cy="14.5" rx="9.3" ry="7.8" fill="${fill}" stroke="${dark}" stroke-width="1.6"/>
    <circle cx="6.8" cy="6.4" r="3.7" fill="${fill}" stroke="${dark}" stroke-width="1.6"/>
    <circle cx="17.2" cy="6.4" r="3.7" fill="${fill}" stroke="${dark}" stroke-width="1.6"/>
    <circle cx="6.8" cy="6.2" r="1.5" fill="${dark}"/>
    <circle cx="17.2" cy="6.2" r="1.5" fill="${dark}"/>
    <path d="M7.5 15.5 Q12 19 16.5 15.5" fill="none" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`
}

const FROG_COLORS = {
  munro: { fill: '#3fa14a', dark: '#1c5a28' },
  corbett: { fill: '#8f80d6', dark: '#453782' },
  done: { fill: '#efb51f', dark: '#7c5a10' },
}

function frogIcon(colors: { fill: string; dark: string }, size: number) {
  return L.divIcon({
    className: 'frog-icon',
    html: frogSvg(colors.fill, colors.dark),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2 - 2],
  })
}

const munroFrog = frogIcon(FROG_COLORS.munro, 26)
const corbettFrog = frogIcon(FROG_COLORS.corbett, 22)
const doneMunroFrog = frogIcon(FROG_COLORS.done, 26)
const doneCorbettFrog = frogIcon(FROG_COLORS.done, 22)

const carparkIcon = L.divIcon({ className: 'carpark-icon', html: 'P', iconSize: [20, 20], iconAnchor: [10, 10] })
const parkupIcon = L.divIcon({ className: 'parkup-icon', html: '⛺', iconSize: [22, 22], iconAnchor: [11, 11] })
const overnightIcon = L.divIcon({ className: 'parkup-icon', html: '🚐', iconSize: [22, 22], iconAnchor: [11, 11] })
const laybyIcon = L.divIcon({ className: 'layby-icon', html: 'L', iconSize: [16, 16], iconAnchor: [8, 8] })
const informalIcon = L.divIcon({ className: 'informal-icon', html: '▲', iconSize: [16, 16], iconAnchor: [8, 8] })

/** Unnamed OSM camp_sites are almost always informal wild-camp pitches, not businesses. */
function isInformalSite(p: ParkUp) {
  return p.kind === 'camp_site' && !p.name
}

const KIND_LABEL: Record<string, string> = {
  camp_site: 'Campsite',
  caravan_site: 'Caravan/motorhome site',
  rest_area: 'Rest area',
  layby: 'Layby',
}
const startIcon = L.divIcon({ className: 'start-icon', html: '⚑', iconSize: [20, 20], iconAnchor: [4, 18] })

function stopIcon(n: number) {
  return L.divIcon({ className: 'stop-icon', html: String(n), iconSize: [24, 24], iconAnchor: [12, 12] })
}

interface Props {
  munros: Munro[]
  corbetts: Munro[]
  carparks: CarPark[]
  parkups: ParkUp[]
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
  useEffect(() => {
    onChange(map.getZoom(), map.getBounds())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])
  return null
}

function ContextStop({
  addStop,
  munros,
  setStart,
}: {
  addStop: (stop: TripStop) => void
  munros: Munro[]
  setStart: (munroId: number, pos: { lat: number; lon: number } | null) => void
}) {
  const [pos, setPos] = useState<[number, number] | null>(null)
  useMapEvents({
    contextmenu: (e) => setPos([e.latlng.lat, e.latlng.lng]),
    click: () => setPos(null),
  })
  if (!pos) return null
  const nearest = munros
    .map((m) => ({ m, dist: haversineKm(pos[0], pos[1], m.lat, m.lon) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 3)
  return (
    <Popup position={pos} eventHandlers={{ remove: () => setPos(null) }}>
      <div className="popup">
        <strong>
          {pos[0].toFixed(4)}, {pos[1].toFixed(4)}
        </strong>
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
        <div className="popup-carparks">
          <em>Set as walk start for:</em>
          {nearest.map(({ m, dist }) => (
            <div key={m.id} className="popup-carpark-row">
              <span>
                {m.name} ({dist.toFixed(1)} km)
              </span>
              <button
                title="Pin as this munro's start"
                onClick={() => {
                  setStart(m.id, { lat: pos[0], lon: pos[1] })
                  setPos(null)
                }}
              >
                ⚑
              </button>
            </div>
          ))}
        </div>
      </div>
    </Popup>
  )
}

function ParkupMarker({ p, addStop }: { p: ParkUp; addStop: (stop: TripStop) => void }) {
  const informal = isInformalSite(p)
  const icon = informal
    ? informalIcon
    : p.category === 'site'
      ? parkupIcon
      : p.category === 'overnight'
        ? overnightIcon
        : laybyIcon
  const label = informal ? 'Informal camp spot' : (KIND_LABEL[p.kind] ?? 'Park-up')
  return (
    <Marker position={[p.lat, p.lon]} icon={icon}>
      <Popup>
        <div className="popup">
          <strong>{p.name ?? label}</strong>
          <div className="popup-sub">
            {label}
            {p.category === 'overnight' ? ' · tagged overnight-OK in OSM' : ''}
            {p.fee ? ` · fee: ${p.fee}` : ''}
            {p.motorhome ? ` · motorhomes: ${p.motorhome}` : ''}
          </div>
          {(p.category !== 'site' || informal) && (
            <div className="popup-sub">Check local signage — OSM tags are no guarantee of overnight tolerance.</div>
          )}
          <div className="popup-links">
            {p.website && (
              <a href={p.website} target="_blank" rel="noreferrer">
                Website
              </a>
            )}
            <a
              href={`https://park4night.com/en/search?lat=${p.lat.toFixed(4)}&lng=${p.lon.toFixed(4)}`}
              target="_blank"
              rel="noreferrer"
            >
              park4night
            </a>
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`}
              target="_blank"
              rel="noreferrer"
            >
              Google Maps
            </a>
          </div>
          <button
            onClick={() =>
              addStop({ id: p.id, kind: 'parkup', name: p.name ?? label, lat: p.lat, lon: p.lon })
            }
          >
            + Add to trip
          </button>
        </div>
      </Popup>
    </Marker>
  )
}

function LegendFrog({ colors }: { colors: { fill: string; dark: string } }) {
  return <span className="legend-swatch" dangerouslySetInnerHTML={{ __html: frogSvg(colors.fill, colors.dark) }} />
}

function MapLegend({ showCorbetts }: { showCorbetts: boolean }) {
  const [open, setOpen] = useState(() => window.innerWidth > 700)
  if (!open) {
    return (
      <button className="legend-toggle" onClick={() => setOpen(true)} aria-label="Show map key">
        Key
      </button>
    )
  }
  return (
    <div className="map-legend">
      <div className="legend-header">
        <strong>Key</strong>
        <button onClick={() => setOpen(false)} aria-label="Hide map key">
          ✕
        </button>
      </div>
      <div className="legend-row">
        <LegendFrog colors={FROG_COLORS.munro} /> Munro
      </div>
      {showCorbetts && (
        <div className="legend-row">
          <LegendFrog colors={FROG_COLORS.corbett} /> Corbett
        </div>
      )}
      <div className="legend-row">
        <LegendFrog colors={FROG_COLORS.done} /> Bagged
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="carpark-icon">P</span>
        </span>{' '}
        Car park
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="parkup-icon">⛺</span>
        </span>{' '}
        Campsite
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="parkup-icon">🚐</span>
        </span>{' '}
        Overnight park-up
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="layby-icon">L</span>
        </span>{' '}
        Layby
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="informal-icon">▲</span>
        </span>{' '}
        Informal camp spot
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="start-icon">⚑</span>
        </span>{' '}
        Pinned walk start
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="stop-icon">1</span>
        </span>{' '}
        Trip stop
      </div>
      <div className="legend-row">
        <span className="legend-swatch">
          <span className="legend-route" />
        </span>{' '}
        Driving route
      </div>
    </div>
  )
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = Math.PI / 180
  const a =
    Math.sin(((lat2 - lat1) * rad) / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(((lon2 - lon1) * rad) / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

export default function MapView({
  munros,
  corbetts,
  carparks,
  parkups,
  store,
  addStop,
  activeTrip,
  route,
  mapRef,
}: Props) {
  const [view, setView] = useState<{ zoom: number; bounds: LatLngBounds | null }>({ zoom: 7, bounds: null })

  const corbettIds = useMemo(() => new Set(corbetts.map((c) => c.id)), [corbetts])
  const hills = useMemo(
    () => (store.showCorbetts ? [...munros, ...corbetts] : munros),
    [munros, corbetts, store.showCorbetts],
  )

  const visibleCarparks = useMemo(() => {
    if (view.zoom < 11 || !view.bounds) return []
    return carparks.filter((c) => view.bounds!.contains([c.lat, c.lon]))
  }, [carparks, view])

  const visibleSites = useMemo(() => {
    if (view.zoom < 9 || !view.bounds) return []
    return parkups.filter(
      (p) => p.category === 'site' && !isInformalSite(p) && view.bounds!.contains([p.lat, p.lon]),
    )
  }, [parkups, view])

  const visibleLaybys = useMemo(() => {
    if (view.zoom < 10 || !view.bounds) return []
    return parkups.filter(
      (p) => (p.category !== 'site' || isInformalSite(p)) && view.bounds!.contains([p.lat, p.lon]),
    )
  }, [parkups, view])

  const nearestCarparks = (m: Munro) =>
    carparks
      .filter((c) => c.munros.includes(m.id))
      .map((c) => ({ ...c, dist: haversineKm(c.lat, c.lon, m.lat, m.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 5)

  return (
    <div className="map-shell">
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
                maxNativeZoom={16}
                maxZoom={19}
              />
            </LayersControl.BaseLayer>
          )}
          <LayersControl.BaseLayer name="OpenStreetMap (best paths)">
            <TileLayer
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer checked={!OS_KEY} name="OpenTopoMap">
            <TileLayer
              url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
              attribution='© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · © OpenTopoMap (CC-BY-SA)'
              maxZoom={17}
            />
          </LayersControl.BaseLayer>

          <LayersControl.Overlay checked name="Car parks (zoom in)">
            <LayerGroup>
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
                        onClick={() =>
                          addStop({ id: c.id, kind: 'carpark', name: c.name ?? 'Car park', lat: c.lat, lon: c.lon })
                        }
                      >
                        + Add to trip
                      </button>
                    </div>
                  </Popup>
                </Marker>
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay checked name="Campsites (zoom in)">
            <LayerGroup>
              {visibleSites.map((p) => (
                <ParkupMarker key={p.id} p={p} addStop={addStop} />
              ))}
            </LayerGroup>
          </LayersControl.Overlay>

          <LayersControl.Overlay name="Hiking routes (OSM)">
            <TileLayer
              url="https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png"
              attribution='© <a href="https://waymarkedtrails.org">Waymarked Trails</a> (CC-BY-SA)'
              maxZoom={18}
            />
          </LayersControl.Overlay>

          <LayersControl.Overlay checked name="Laybys, informal & overnight spots (zoom in)">
            <LayerGroup>
              {visibleLaybys.map((p) => (
                <ParkupMarker key={p.id} p={p} addStop={addStop} />
              ))}
            </LayerGroup>
          </LayersControl.Overlay>
        </LayersControl>

        <ViewTracker onChange={(zoom, bounds) => setView({ zoom, bounds })} />
        <ContextStop addStop={addStop} munros={hills} setStart={store.setStart} />

        {hills.map((m) => {
          const done = store.doneSet.has(m.id)
          const corbett = corbettIds.has(m.id)
          const icon = done ? (corbett ? doneCorbettFrog : doneMunroFrog) : corbett ? corbettFrog : munroFrog
          return (
            <Marker key={m.id} position={[m.lat, m.lon]} icon={icon}>
              <Popup>
                <div className="popup">
                  <strong>{m.name}</strong>
                  <div className="popup-sub">
                    {m.height} m · {Math.round(m.height * 3.28084)} ft · {m.gridref}
                  </div>
                  <div className="popup-sub">{m.region}</div>
                  <div className="popup-links">
                    {m.walkhighlands && (
                      <a href={m.walkhighlands} target="_blank" rel="noreferrer">
                        Walkhighlands
                      </a>
                    )}
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
                  {m.routes.length > 0 && (
                    <div className="popup-carparks">
                      <em>Walk starts (walkhighlands):</em>
                      {m.routes.map((r, ri) => (
                        <div key={ri} className="popup-carpark-row">
                          <span title={`${r.name}${r.distance ? ` · ${r.distance}` : ''}${r.time ? ` · ${r.time}` : ''}`}>
                            {r.startName ?? r.name}
                            {r.startGridref ? ` (${r.startGridref})` : ''}
                          </span>
                          <button
                            title="Add this start to trip"
                            onClick={() =>
                              addStop({
                                id: `whstart/${m.id}/${ri}`,
                                kind: 'custom',
                                name: r.startName ?? `Start: ${m.name}`,
                                lat: r.startLat,
                                lon: r.startLon,
                              })
                            }
                          >
                            +
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {store.starts[m.id] && (
                    <button
                      onClick={() =>
                        addStop({
                          id: `start/${m.id}`,
                          kind: 'custom',
                          name: `Start: ${m.name}`,
                          lat: store.starts[m.id].lat,
                          lon: store.starts[m.id].lon,
                        })
                      }
                    >
                      + Add pinned start to trip
                    </button>
                  )}
                  {carparks.length > 0 && nearestCarparks(m).length > 0 && (
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
            </Marker>
          )
        })}

        {Object.entries(store.starts).map(([munroId, pos]) => {
          const m = munros.find((x) => x.id === Number(munroId))
          return (
            <Marker key={`start-${munroId}`} position={[pos.lat, pos.lon]} icon={startIcon}>
              <Popup>
                <div className="popup">
                  <strong>Walk start: {m?.name ?? munroId}</strong>
                  <button
                    onClick={() =>
                      addStop({
                        id: `start/${munroId}`,
                        kind: 'custom',
                        name: `Start: ${m?.name ?? munroId}`,
                        lat: pos.lat,
                        lon: pos.lon,
                      })
                    }
                  >
                    + Add to trip
                  </button>
                  <button onClick={() => store.setStart(Number(munroId), null)}>Remove pin</button>
                </div>
              </Popup>
            </Marker>
          )
        })}

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
      <MapLegend showCorbetts={store.showCorbetts} />
    </div>
  )
}
