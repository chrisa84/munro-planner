import { useMemo, useRef, useState } from 'react'
import type { Munro } from '../lib/types'
import type { Store } from '../hooks/useStore'

interface Props {
  munros: Munro[]
  store: Store
  flyTo: (lat: number, lon: number, zoom?: number) => void
}

type Filter = 'all' | 'done' | 'todo'

export default function Sidebar({ munros, store, flyTo }: Props) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [region, setRegion] = useState('all')
  const fileInput = useRef<HTMLInputElement>(null)

  const regions = useMemo(() => [...new Set(munros.map((m) => m.region))].sort(), [munros])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return munros.filter((m) => {
      if (q && !m.name.toLowerCase().includes(q)) return false
      if (region !== 'all' && m.region !== region) return false
      const done = store.doneSet.has(m.id)
      if (filter === 'done' && !done) return false
      if (filter === 'todo' && done) return false
      return true
    })
  }, [munros, search, filter, region, store.doneSet])

  return (
    <div className="panel">
      <div className="filters">
        <input
          type="search"
          placeholder="Search munros…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
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
      </div>

      <ul className="munro-list">
        {filtered.map((m) => {
          const done = store.doneSet.has(m.id)
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
