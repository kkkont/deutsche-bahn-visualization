import { useEffect, useMemo, useState } from 'react'
import type { EdgeMetric } from './HeatTable.tsx'

/**
 * Merge several batches of edges (e.g. one per month) into one.
 * Records with the same (from, to, trainType) are combined: runs are summed and the
 * average delay change is weighted by the number of runs, so busy months count more.
 */
export function mergeEdges(batches: EdgeMetric[][]): EdgeMetric[] {
  const acc = new Map<string, { edge: EdgeMetric; runs: number; weighted: number }>()
  for (const batch of batches) {
    for (const e of batch) {
      const key = `${e.fromId}\u0000${e.toId}\u0000${e.trainType ?? ''}`
      const cur = acc.get(key) ?? { edge: e, runs: 0, weighted: 0 }
      cur.runs += e.observations
      cur.weighted += e.averageDelayChange * e.observations
      acc.set(key, cur)
    }
  }
  return [...acc.values()].map(({ edge, runs, weighted }) => ({
    fromId: edge.fromId,
    toId: edge.toId,
    trainType: edge.trainType,
    observations: runs,
    averageDelayChange: runs ? weighted / runs : 0,
  }))
}

// One download per month for the whole session: switching months never refetches.
const cache = new Map<string, Promise<EdgeMetric[]>>()

function loadMonth(month: string) {
  let request = cache.get(month)
  if (!request) {
    request = fetch(`/data/edges_${month}.json`).then((r) => {
      if (!r.ok) throw new Error(`edges_${month}.json: HTTP ${r.status}`)
      return r.json() as Promise<EdgeMetric[]>
    })
    cache.set(month, request)
    request.catch(() => cache.delete(month)) // allow a retry after a failure
  }
  return request
}

export interface UseEdgesResult {
  edges: EdgeMetric[]
  loading: boolean
  /** true only if NO month could be loaded */
  error: boolean
  /** Months that were merged / months whose file was missing. */
  loaded: string[]
  failed: string[]
}

/** Fetch `edges_<month>.json` for every month in parallel and merge them. */
export function useEdges(months: string[]): UseEdgesResult {
  const key = months.join(',') // so a new array with the same months does not refetch
  const [state, setState] = useState<{ batches: Record<string, EdgeMetric[]>; failed: string[]; done: boolean }>(
    { batches: {}, failed: [], done: false },
  )

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, done: false }))
    Promise.allSettled(months.map(loadMonth)).then((results) => {
      if (cancelled) return
      const batches: Record<string, EdgeMetric[]> = {}
      const failed: string[] = []
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') batches[months[i]] = r.value
        else failed.push(months[i])
      })
      setState({ batches, failed, done: true })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const edges = useMemo(() => mergeEdges(Object.values(state.batches)), [state.batches])
  const loaded = Object.keys(state.batches)
  return { edges, loading: !state.done, error: state.done && loaded.length === 0, loaded, failed: state.failed }
}
