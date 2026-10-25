import { useEffect, useMemo, useRef, useState } from 'react'
import { select } from 'd3-selection'
import { buildMatrix, cellKey, textOn, type Cell, type EdgeMetric } from './HeatTable.tsx'
import { CLASSIC, COLOR_MODELS, FixedRange, type ColorModel } from './colorModel.ts'
import ColorLegend from './ColorLegend.tsx'
import './HeatTableD3.css'

/* ------------------------------------------------------------------ *
 * 1. SORTING (pure, exported so you can reuse or test it)
 * ------------------------------------------------------------------ */

export type SortMode = 'given' | 'name' | 'traffic' | 'outgoing' | 'incoming'

/** Per station: weighted mean change leaving it, arriving at it, and total runs. */
export function stationStats(ids: string[], cells: Map<string, Cell>) {
  const acc = new Map(ids.map((id) => [id, { outW: 0, outN: 0, inW: 0, inN: 0 }]))
  for (const from of ids) for (const to of ids) {
    const c = cells.get(cellKey(from, to))
    if (!c) continue
    const a = acc.get(from)!
    a.outW += c.value * c.observations; a.outN += c.observations
    const b = acc.get(to)!
    b.inW += c.value * c.observations; b.inN += c.observations
  }
  const stats = new Map<string, { outgoing: number | null; incoming: number | null; traffic: number }>()
  for (const [id, a] of acc) {
    stats.set(id, {
      outgoing: a.outN ? a.outW / a.outN : null,
      incoming: a.inN ? a.inW / a.inN : null,
      traffic: a.outN + a.inN,
    })
  }
  return stats
}

/**
 * Order the stations. Numeric modes put the largest value first (worst delay build-up,
 * busiest); `reverse` flips that. Stations without data always go last.
 */
export function sortStations(
  ids: string[], cells: Map<string, Cell>, mode: SortMode, label: (id: string) => string, reverse = false,
) {
  if (mode === 'given') return reverse ? [...ids].reverse() : [...ids]
  const dir = reverse ? -1 : 1
  if (mode === 'name') return [...ids].sort((a, b) => dir * label(a).localeCompare(label(b)))
  const stats = stationStats(ids, cells)
  return [...ids].sort((a, b) => {
    const va = stats.get(a)![mode], vb = stats.get(b)![mode]
    if (va === null && vb === null) return 0
    if (va === null) return 1
    if (vb === null) return -1
    return dir * (vb - va)
  })
}

/* ------------------------------------------------------------------ *
 * 2. COMPONENT
 * ------------------------------------------------------------------ */

export interface HeatTableD3Props {
  edges: EdgeMetric[]
  stationIds?: string[]
  names?: Record<string, string>
  trainType?: string
  minObservations?: number
  /** How values become colours (range + shape + palette). Default: CLASSIC, the original ±max look. */
  colorModel?: ColorModel
  /** Shortcut: fixed colour range of ±maxAbs minutes. */
  maxAbs?: number
  /** Initial sort / numbers setting. Changing the prop later updates the table. */
  sort?: SortMode
  showValues?: boolean
  /** Show the sort dropdown and number toggle. */
  showControls?: boolean
  /** Pixel size of one cell. Default depends on station count. */
  cellSize?: number
  selected?: { fromId: string; toId: string } | null
  onSelect?: (fromId: string, toId: string) => void
  formatValue?: (minutes: number) => string
}

const NO_NAMES: Record<string, string> = {}
const defaultFormat = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`
const short = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)

interface Datum { from: string; to: string; i: number; j: number; value: number; observations: number }

const SORT_LABELS: Record<SortMode, string> = {
  given: 'As given',
  name: 'Name',
  traffic: 'Busiest',
  outgoing: 'Delay added when leaving',
  incoming: 'Delay on arrival',
}

export function HeatTableD3({
  edges, stationIds, names = NO_NAMES, trainType, minObservations = 1, maxAbs, colorModel = CLASSIC,
  sort = 'traffic', showValues: showValuesProp = false, showControls = true, cellSize,
  selected = null, onSelect, formatValue = defaultFormat,
}: HeatTableD3Props) {
  const [sortMode, setSortMode] = useState<SortMode>(sort)
  const [reverse, setReverse] = useState(false)
  const [showValues, setShowValues] = useState(showValuesProp)
  useEffect(() => setSortMode(sort), [sort])
  useEffect(() => setShowValues(showValuesProp), [showValuesProp])
  const [model, setModel] = useState<ColorModel>(colorModel)
  useEffect(() => setModel(colorModel), [colorModel])
  const modelKey = Object.keys(COLOR_MODELS).find((k) => COLOR_MODELS[k].model === model) ?? 'custom'

  const svgRef = useRef<SVGSVGElement>(null)
  const readoutRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Step 1: merge edges into one value per (from, to).
  const cells = useMemo(() => buildMatrix(edges, trainType, minObservations), [edges, trainType, minObservations])

  // Step 2: which stations, then in which order.
  const baseIds = useMemo(() => {
    if (stationIds) return stationIds
    const seen = new Set<string>()
    for (const e of edges) { seen.add(e.fromId); seen.add(e.toId) }
    return [...seen]
  }, [edges, stationIds])
  const label = (id: string) => names[id] ?? id
  const ids = useMemo(
    () => sortStations(baseIds, cells, sortMode, (id) => names[id] ?? id, reverse),
    [baseIds, cells, sortMode, names, reverse],
  )

  // Step 3: fit the colour model to the cells that are in view (rows x columns).
  const colors = useMemo(() => {
    const used: number[] = []
    for (const from of baseIds) for (const to of baseIds) {
      const c = from === to ? undefined : cells.get(cellKey(from, to))
      if (c) used.push(c.value)
    }
    const fitted = maxAbs ? model.with({ range: new FixedRange(maxAbs) }) : model
    return fitted.fit(used)
  }, [baseIds, cells, model, maxAbs])
  const color = colors.color

  // Step 4: layout. Cells shrink with more stations; turning numbers on makes them larger.
  const n = ids.length
  const base = cellSize ?? (n <= 12 ? 40 : n <= 30 ? 24 : 14)
  const cell = showValues ? Math.max(base, 32) : base
  const font = Math.max(8, Math.min(12, cell - 3))
  const longest = Math.max(1, ...ids.map((id) => short(label(id)).length))
  const margin = Math.min(150, Math.ceil(longest * font * 0.56) + 12)
  const size = n * cell
  const width = margin + size + 8
  const height = margin + size + 8

  // Step 5: draw with d3.
  useEffect(() => {
    if (!svgRef.current) return
    const svg = select(svgRef.current)
    svg.selectAll('*').remove()
    svg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`)
    const root = svg.append('g')

    root.append('rect').attr('class', 'hm-bg').attr('x', margin).attr('y', margin).attr('width', size).attr('height', size)

    // Column labels (stations you arrive at), rotated.
    root.selectAll('text.hm-col').data(ids).join('text')
      .attr('class', 'hm-label')
      .attr('font-size', font)
      .attr('transform', (_, j) => `translate(${margin + j * cell + cell / 2},${margin - 6}) rotate(-90)`)
      .attr('dy', '0.32em')
      .text((id) => short(label(id)))

    // Row labels (stations you depart from).
    root.selectAll('text.hm-row').data(ids).join('text')
      .attr('class', 'hm-label')
      .attr('font-size', font)
      .attr('text-anchor', 'end')
      .attr('x', margin - 6)
      .attr('y', (_, i) => margin + i * cell + cell / 2)
      .attr('dy', '0.32em')
      .text((id) => short(label(id)))

    const data: Datum[] = []
    ids.forEach((from, i) => ids.forEach((to, j) => {
      const c = i === j ? undefined : cells.get(cellKey(from, to))
      if (c) data.push({ from, to, i, j, value: c.value, observations: c.observations })
    }))

    // Hover helpers: a faint row + column band and an outline around the active cell.
    const rowBand = root.append('rect').attr('class', 'hm-band').attr('x', margin).attr('width', size).attr('height', cell).style('display', 'none')
    const colBand = root.append('rect').attr('class', 'hm-band').attr('y', margin).attr('width', cell).attr('height', size).style('display', 'none')

    root.selectAll('rect.hm-cell').data(data).join('rect')
      .attr('class', onSelect ? 'hm-cell clickable' : 'hm-cell')
      .attr('x', (d) => margin + d.j * cell)
      .attr('y', (d) => margin + d.i * cell)
      .attr('width', cell - 1)
      .attr('height', cell - 1)
      .attr('fill', (d) => color(d.value))
      .on('mouseenter', (_, d) => {
        rowBand.attr('y', margin + d.i * cell).style('display', null)
        colBand.attr('x', margin + d.j * cell).style('display', null)
        if (readoutRef.current) {
          readoutRef.current.textContent =
            `${label(d.from)} → ${label(d.to)}: ${formatValue(d.value)} min · ${d.observations} runs`
        }
      })
      .on('mouseleave', () => {
        rowBand.style('display', 'none')
        colBand.style('display', 'none')
        if (readoutRef.current) readoutRef.current.textContent = HINT
      })
      .on('click', (_, d) => onSelectRef.current?.(d.from, d.to))

    // Numbers only when asked for.
    if (showValues) {
      root.selectAll('text.hm-value').data(data).join('text')
        .attr('class', 'hm-value')
        .attr('font-size', Math.min(11, cell * 0.36))
        .attr('text-anchor', 'middle')
        .attr('x', (d) => margin + d.j * cell + (cell - 1) / 2)
        .attr('y', (d) => margin + d.i * cell + (cell - 1) / 2)
        .attr('dy', '0.35em')
        .attr('fill', (d) => textOn(color(d.value)))
        .text((d) => formatValue(d.value))
    }

    // Outline for the externally selected cell.
    if (selected) {
      const i = ids.indexOf(selected.fromId), j = ids.indexOf(selected.toId)
      if (i >= 0 && j >= 0) {
        root.append('rect').attr('class', 'hm-selected')
          .attr('x', margin + j * cell).attr('y', margin + i * cell)
          .attr('width', cell - 1).attr('height', cell - 1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, cells, color, cell, font, margin, size, width, height, showValues, selected, formatValue])


  return (
    <div className="hm-wrap">
      {showControls && (
        <div className="hm-controls">
          <label>
            <span>Sort by</span>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
              {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => <option key={m} value={m}>{SORT_LABELS[m]}</option>)}
            </select>
          </label>
          <label><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} /> Reverse</label>
          <label><input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} /> Show numbers</label>
          <label>
            <span>Colours</span>
            <select value={modelKey} onChange={(e) => setModel(COLOR_MODELS[e.target.value].model)}>
              {modelKey === 'custom' && <option value="custom" disabled>Custom</option>}
              {Object.entries(COLOR_MODELS).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
            </select>
          </label>
          <span className="hm-count">{n} stations</span>
        </div>
      )}

      <div className="hm-readout" ref={readoutRef} aria-live="polite">{HINT}</div>
      <div className="hm-scroll"><svg ref={svgRef} role="img" aria-label="Delay change between stations" /></div>

      <ColorLegend colors={colors} />
    </div>
  )
}

const HINT = 'Rows are the station you leave, columns the station you reach.'

export default HeatTableD3
