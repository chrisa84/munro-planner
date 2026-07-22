import { useCallback, useEffect, useState } from 'react'
import type { Trip } from '../lib/types'

const KEY = 'munro-camper-planner:v1'

interface Persisted {
  done: number[]
  trips: Trip[]
  activeTripId: string | null
  singleTrackFactor: number
}

const DEFAULTS: Persisted = { done: [], trips: [], activeTripId: null, singleTrackFactor: 1.25 }

function load(): Persisted {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    return { ...DEFAULTS, ...JSON.parse(raw) }
  } catch {
    return DEFAULTS
  }
}

export function useStore() {
  const [state, setState] = useState<Persisted>(load)

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(state))
  }, [state])

  const doneSet = new Set(state.done)

  const toggleDone = useCallback((id: number) => {
    setState((s) => ({
      ...s,
      done: s.done.includes(id) ? s.done.filter((d) => d !== id) : [...s.done, id],
    }))
  }, [])

  const setTrips = useCallback((fn: (trips: Trip[]) => Trip[]) => {
    setState((s) => ({ ...s, trips: fn(s.trips) }))
  }, [])

  const setActiveTripId = useCallback((id: string | null) => {
    setState((s) => ({ ...s, activeTripId: id }))
  }, [])

  const setSingleTrackFactor = useCallback((f: number) => {
    setState((s) => ({ ...s, singleTrackFactor: f }))
  }, [])

  const exportJson = useCallback(() => {
    const blob = new Blob([localStorage.getItem(KEY) ?? '{}'], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `munro-planner-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
  }, [])

  const importJson = useCallback((file: File) => {
    file.text().then((text) => {
      const parsed = JSON.parse(text)
      setState({ ...DEFAULTS, ...parsed })
    })
  }, [])

  return {
    ...state,
    doneSet,
    toggleDone,
    setTrips,
    setActiveTripId,
    setSingleTrackFactor,
    exportJson,
    importJson,
  }
}

export type Store = ReturnType<typeof useStore>
