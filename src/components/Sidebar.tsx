import { useMemo, useRef, useState } from 'react'
import type { Munro, WalkStats } from '../lib/types'
import type { Store } from '../hooks/useStore'

interface Props {
  munros: Munro[]
  corbetts: Munro[]
  store: Store
  flyTo: (lat: number, lon: number, zoom?: number) => void
}

type Filter = 'all' | 'done' | 'todo'
type Sort = 'name' | 'distance' | 'time' | 'ascent'

/** Preferred stats for filtering/sorting: walkhighlands shortest route, else Fallon's round. */
function hillStats(m: Munro): (WalkStats & { source: 'wh' | 'fallon' }) | null {
  if (m.walk) return { ...m.walk, source: 'wh' }
  if (m.fallon) return { ...m.fallon, source: 'fallon' }
  return null
}

function fmtStats(s: WalkStats & { source: 'wh' | 'fallon' }) {
  const parts = []
  if (s.distanceKm != null) parts.push(`${s.distanceKm} km`)
  if (s.ascentM != null) parts.push(`${s.ascentM} m↑`)
  if (s.timeH != null) parts.push(`~${s.timeH} h`)
  return parts.join(' · ') + (s.source === 'fallon' ? ' (SF)' : '')
}

export default function Sidebar({ munros, corbetts, store, flyTo }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [region, setRegion] = useState('all')
  const [sort, setSort] = useState<Sort>('name')
  const [maxKm, setMaxKm] = useState('')
  const [maxH, setMaxH] = useState('')
  const [maxAscent, setMaxAscent] = useState('')
  const fileInput = useRef<HTMLInputElement>(null)

  const corbettIds = useMemo(() => new Set(corbetts.map((c) => c.id)), [corbetts])
  const hills = useMemo(
    () =>
      store.showCorbetts
        ? [...munros, ...corbetts].sort((a, b) => a.name.localeCompare(b.name))
        : munros,
    [munros, corbetts, store.showCorbetts],
  )

  const regions = useMemo(() => [...new Set(hills.map((m) => m.region))].sort(), [hills])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const km = maxKm === '' ? null : Number(maxKm)
    const h = maxH === '' ? null : Number(maxH)
    const asc = maxAscent === '' ? null : Number(maxAscent)
    const result = hills.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false
      if (region !== 'all' && m.region !== region) return false
      const done = store.doneSet.has(m.id)
      if (filter === 'done' && !done) return false
      if (filter === 'todo' && done) return false
      if (km != null || h != null || asc != null) {
        const s = hillStats(m)
        if (!s) return false
        if (km != null && (s.distanceKm == null || s.distanceKm > km)) return false
        if (h != null && (s.timeH == null || s.timeH > h)) return false
        if (asc != null && (s.ascentM == null || s.ascentM > asc)) return false
      }
      return true
    })
    if (sort !== 'name') {
      const key = sort === 'distance' ? 'distanceKm' : sort === 'time' ? 'timeH' : 'ascentM'
      result.sort((a, b) => {
        const av = hillStats(a)?.[key] ?? Infinity
        const bv = hillStats(b)?.[key] ?? Infinity
        return av - bv
      })
    }
    return result
  }, [hills, search, filter, region, sort, maxKm, maxH, maxAscent, store.doneSet])

  return (
    <div className="panel">
      <div className="filters">
        <input
          type="search"
          placeholder="Search munros…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="corbett-toggle">
          <input
            type="checkbox"
            checked={store.showCorbetts}
            onChange={(e) => store.setShowCorbetts(e.target.checked)}
          />
          Show Corbetts (2500–3000 ft)
        </label>
        <div className="filter-row">
          <select value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="all">All regions</option>
            {regions.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">All</option>
            <option value="todo">To do</option>
            <option value="done">Bagged</option>
          </select>
        </div>
        <div className="filter-row stats-filter">
          <input
            type="number"
            min="0"
            placeholder="max km"
            title="Max walk distance (km)"
            value={maxKm}
            onChange={(e) => setMaxKm(e.target.value)}
          />
          <input
            type="number"
            min="0"
            placeholder="max h"
            title="Max walk time (hours)"
            value={maxH}
            onChange={(e) => setMaxH(e.target.value)}
          />
          <input
            type="number"
            min="0"
            placeholder="max m↑"
            title="Max ascent (m)"
            value={maxAscent}
            onChange={(e) => setMaxAscent(e.target.value)}
          />
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} title="Sort by">
            <option value="name">A–Z</option>
            <option value="distance">Shortest</option>
            <option value="time">Quickest</option>
            <option value="ascent">Least ascent</option>
          </select>
        </div>
        <div className="hint small">
          Walk stats: walkhighlands shortest route, or Steve Fallon’s round (SF). Filters hide hills with no data.
        </div>
      </div>

      <ul className="munro-list">
        {filtered.map((m) => {
          const done = store.doneSet.has(m.id)
          const s = hillStats(m)
          return (
            <li key={m.id} className={done ? 'done' : ''}>
              <input
                type="checkbox"
                checked={done}
                onChange={() => store.toggleDone(m.id)}
                title="Bagged?"
              />
              <button className="munro-name" onClick={() => flyTo(m.lat, m.lon)}>
                {m.name}
                {corbettIds.has(m.id) && <span className="corbett-badge">C</span>}
                {s && <span className="munro-stats">{fmtStats(s)}</span>}
              </button>
              <span className="munro-height">{m.height} m</span>
            </li>
          )
        })}
        {filtered.length === 0 && <li className="empty">No munros match.</li>}
      </ul>

      <div className="io-row">
        <button onClick={store.exportJson}>Export progress</button>
        <button onClick={() => fileInput.current?.click()}>Import</button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) store.importJson(f)
            e.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
