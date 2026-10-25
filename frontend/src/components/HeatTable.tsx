import { useMemo } from 'react'
import { CLASSIC, FixedRange, NIGHTFALL, type ColorModel } from './colorModel.ts'
import ColorLegend from './ColorLegend.tsx'
import './HeatTable.css'

/* ------------------------------------------------------------------ *
 * 1. COLOURS (Paul Tol)
 * ------------------------------------------------------------------ */

export { NIGHTFALL }

/** Grey from Tol "light", used for all averages. */
export const AVERAGE_GREY = '#DDDDDD'

/* ------------------------------------------------------------------ *
 * 2. DATA CONTRACT
 * ------------------------------------------------------------------ */

/** One hop between two stops. Several records per hop (e.g. one per train type) are allowed. */
export interface EdgeMetric {
  fromId: string
  toId: string
  trainType?: string
  observations: number
  averageDelayChange: number // minutes, + = lost time, - = recovered
}

export interface HeatTableLabels {
  from: string
  to: string
  average: string
  noData: string
  recovery: string
  buildUp: string
  observations: string
}

const DEFAULT_LABELS: HeatTableLabels = {
  from: 'From',
  to: 'To',
  average: 'Ø',
  noData: 'No data',
  recovery: 'Time made up',
  buildUp: 'Time lost',
  observations: 'runs',
}

export interface HeatTableProps {
  /** All hops you have. The table only uses the ones that match the filters below. */
  edges: EdgeMetric[]
  /** Which stations to show, in this order. Default: every station in `edges`, busiest first. */
  stationIds?: string[]
  /** Display names, e.g. { 'Berlin Hbf': 'Berlin' }. Falls back to the id. */
  names?: Record<string, string>
  /** Only use this train type. Default: all types combined. */
  trainType?: string
  /** Hide cells with fewer runs than this. */
  minObservations?: number
  /** How values become colours (range + shape + palette). Default: CLASSIC, the original ±max look. */
  colorModel?: ColorModel
  /** Shortcut: fixed colour range of ±maxAbs minutes. */
  maxAbs?: number
  /** Show grey average row and column. */
  showAverages?: boolean
  /** Highlighted cell. */
  selected?: { fromId: string; toId: string } | null
  onSelect?: (fromId: string, toId: string) => void
  /** Text overrides, handy for i18n. */
  labels?: Partial<HeatTableLabels>
  /** Number formatting, handy for locales. */
  formatValue?: (minutes: number) => string
}

/* ------------------------------------------------------------------ *
 * 3. PURE HELPERS (exported so you can test or reuse them)
 * ------------------------------------------------------------------ */

export interface Cell { value: number; observations: number }

const key = (from: string, to: string) => `${from}\u0000${to}`
export const cellKey = key

/** Merge records per (from, to), weighting by number of runs. */
export function buildMatrix(edges: EdgeMetric[], trainType?: string, minObservations = 1) {
  const sums = new Map<string, { weighted: number; n: number }>()
  for (const edge of edges) {
    if (trainType && trainType !== 'all' && edge.trainType !== trainType) continue
    const k = key(edge.fromId, edge.toId)
    const cur = sums.get(k) ?? { weighted: 0, n: 0 }
    cur.weighted += edge.averageDelayChange * edge.observations
    cur.n += edge.observations
    sums.set(k, cur)
  }
  const cells = new Map<string, Cell>()
  for (const [k, { weighted, n }] of sums) {
    if (n >= minObservations && n > 0) cells.set(k, { value: weighted / n, observations: n })
  }
  return cells
}

function weightedMean(cells: Cell[]): Cell | null {
  const n = cells.reduce((sum, c) => sum + c.observations, 0)
  if (!n) return null
  return { value: cells.reduce((sum, c) => sum + c.value * c.observations, 0) / n, observations: n }
}

/** Pick black or white text for a given "rgb(r, g, b)" background. */
export function textOn(background: string) {
  const [r, g, b] = (background.match(/\d+/g) ?? [255, 255, 255]).map(Number)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  return luminance > 0.55 ? '#1b1f1e' : '#ffffff'
}

/* ------------------------------------------------------------------ *
 * 4. COMPONENT
 * ------------------------------------------------------------------ */

export function HeatTable({
  edges,
  stationIds,
  names = {},
  trainType,
  minObservations = 1,
  maxAbs,
  colorModel = CLASSIC,
  showAverages = true,
  selected = null,
  onSelect,
  labels: labelOverrides,
  formatValue = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`,
}: HeatTableProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides }

  const cells = useMemo(() => buildMatrix(edges, trainType, minObservations), [edges, trainType, minObservations])

  // Which stations: the caller's list, or everything seen, busiest first.
  const ids = useMemo(() => {
    if (stationIds) return stationIds
    const traffic = new Map<string, number>()
    for (const edge of edges) {
      traffic.set(edge.fromId, (traffic.get(edge.fromId) ?? 0) + edge.observations)
      traffic.set(edge.toId, (traffic.get(edge.toId) ?? 0) + edge.observations)
    }
    return [...traffic.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [edges, stationIds])

  const visible = useMemo(() => {
    const out: Cell[] = []
    for (const from of ids) for (const to of ids) {
      const cell = cells.get(key(from, to))
      if (cell) out.push(cell)
    }
    return out
  }, [ids, cells])

  // The colour model turns minutes into colours. It is fitted to the cells in view.
  const colors = useMemo(() => {
    const model = maxAbs ? colorModel.with({ range: new FixedRange(maxAbs) }) : colorModel
    return model.fit(visible.map((c) => c.value))
  }, [colorModel, maxAbs, visible])
  const color = colors.color

  const name = (id: string) => names[id] ?? id
  const rowAverage = (from: string) => weightedMean(ids.map((to) => cells.get(key(from, to))).filter(Boolean) as Cell[])
  const colAverage = (to: string) => weightedMean(ids.map((from) => cells.get(key(from, to))).filter(Boolean) as Cell[])


  return (
    <div className="heat-table">
      <div className="heat-scroll">
        <table>
          <thead>
            <tr>
              <th className="corner" scope="col">{labels.from} ↓ / {labels.to} →</th>
              {ids.map((to) => <th key={to} scope="col" className="col-head"><span>{name(to)}</span></th>)}
              {showAverages && <th scope="col" className="col-head avg-head"><span>{labels.average}</span></th>}
            </tr>
          </thead>
          <tbody>
            {ids.map((from) => {
              const avg = rowAverage(from)
              return (
                <tr key={from}>
                  <th scope="row" className="row-head">{name(from)}</th>
                  {ids.map((to) => {
                    const cell = cells.get(key(from, to))
                    if (from === to || !cell) {
                      return <td key={to} className={from === to ? 'cell self' : 'cell empty'} title={from === to ? undefined : labels.noData} />
                    }
                    const bg = color(cell.value)
                    const isSelected = selected?.fromId === from && selected?.toId === to
                    const label = `${name(from)} → ${name(to)}: ${formatValue(cell.value)} min (${cell.observations} ${labels.observations})`
                    return (
                      <td key={to} className="cell">
                        <button
                          type="button"
                          className={isSelected ? 'cell-button selected' : 'cell-button'}
                          style={{ background: bg, color: textOn(bg) }}
                          title={label}
                          aria-label={label}
                          aria-pressed={onSelect ? isSelected : undefined}
                          disabled={!onSelect}
                          onClick={() => onSelect?.(from, to)}
                        >
                          {formatValue(cell.value)}
                        </button>
                      </td>
                    )
                  })}
                  {showAverages && (
                    <td className="cell avg">{avg ? formatValue(avg.value) : ''}</td>
                  )}
                </tr>
              )
            })}
            {showAverages && (
              <tr>
                <th scope="row" className="row-head avg-head">{labels.average}</th>
                {ids.map((to) => {
                  const avg = colAverage(to)
                  return <td key={to} className="cell avg">{avg ? formatValue(avg.value) : ''}</td>
                })}
                <td className="cell avg" />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <ColorLegend colors={colors} left={labels.recovery} right={labels.buildUp} />
    </div>
  )
}

export default HeatTable
