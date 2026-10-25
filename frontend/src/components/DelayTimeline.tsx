import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { line, scaleLinear, scaleUtc, utcFormat } from 'd3'
import type { ExplorerDataset } from '../data/delayExplorer'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import { calendarTimestamp, formatTimelinePeriod, summarizeTimeline } from '../data/delayTimeline'
import type { DelayTimePoint, TimeResolution } from '../data/delayTimeline'
import { scopeDataset } from '../data/explorerSelection'
import type { DateInterval } from '../data/explorerSelection'
import { TimelineBrush } from './TimelineBrush'
import '../delay-timeline.css'

const pointKey = (point: DelayTimePoint) => `${point.stationId ?? 'aggregate'}:${point.periodStart}`
const count = new Intl.NumberFormat('en-GB')
const STATION_COLORS = ['#77AADD', '#44BB99', '#FFAABB']
const delayColor = scaleLinear<string>().domain(DELAY_COLORS.map((_, i) => i * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1))).range(DELAY_COLORS).clamp(true)
const description = (point: DelayTimePoint) => `${point.stationName}, ${formatTimelinePeriod(point.periodStart, point.periodEnd)}: ${point.averageDelayMinutes!.toFixed(1)} minutes average delay, ${count.format(point.delayObservations)} measured train stops`
interface Props {
  data: ExplorerDataset; resolution: TimeResolution; onResolutionChange: (resolution: TimeResolution) => void
  selectedStationIds: string[]; onSelectStation: (id: string) => void; onClearStations: () => void
  hoveredStationId: string | null; onHoverStation: (id: string | null) => void
  dateRange: DateInterval | null; onDateRangeChange: (range: DateInterval | null) => void
  addToSelection: boolean; onAddModeChange: (enabled: boolean) => void
}

export function DelayTimeline({ data, resolution, onResolutionChange, selectedStationIds, onSelectStation, onClearStations,
  hoveredStationId, onHoverStation, dateRange, onDateRangeChange, addToSelection, onAddModeChange }: Props) {
  const [inspectedKey, setInspectedKey] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [width, setWidth] = useState(600)
  const [announcement, setAnnouncement] = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const marks = useRef(new Map<string, SVGElement>())
  const tooltipId = useId(), titleId = useId(), summaryId = useId(), selectorId = useId()
  const startId = useId(), endId = useId()
  const { stationPoints } = useMemo(() => summarizeTimeline(data, resolution), [data, resolution])
  const group = useMemo(() => summarizeTimeline(scopeDataset(data, null, selectedStationIds), resolution), [data, resolution, selectedStationIds])
  const selected = data.stations.filter((station) => selectedStationIds.includes(station.stationId))
  const aggregateLabel = selected.length === 1 ? `${selected[0].stationName} weighted mean` : selected.length ? `${selected.length} selected stations weighted mean` : 'All-station weighted mean'
  const aggregatePoints = group.aggregatePoints.map((point) => ({ ...point, stationName: aggregateLabel }))
  const measuredPoints = stationPoints.filter((point) => point.averageDelayMinutes !== null)
  const isSelected = (point: DelayTimePoint) => point.stationId !== null && selectedStationIds.includes(point.stationId)
  const visiblePoints = [...measuredPoints.filter((point) => !isSelected(point)),
    ...aggregatePoints.filter((point) => point.averageDelayMinutes !== null), ...measuredPoints.filter(isSelected)]
  const inspected = visiblePoints.find((point) => pointKey(point) === inspectedKey)
  const chosenRange = dateRange ?? { start: data.periodStart, end: data.periodEnd }
  const inRange = (point: DelayTimePoint) => point.periodEnd >= chosenRange.start && point.periodStart <= chosenRange.end
  const stationColor = (id: string) => selected.length <= 3 ? STATION_COLORS[Math.max(0, selectedStationIds.indexOf(id)) % 3] : STATION_COLORS[0]

  useEffect(() => {
    if (!frame.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  const height = 380
  const margin = { left: 52, right: 18, top: 26, bottom: resolution === 'weekly' ? 80 : 62 }
  const x = scaleUtc().domain([calendarTimestamp(data.periodStart) - 43_200_000, calendarTimestamp(data.periodEnd) + 43_200_000]).range([margin.left, width - margin.right])
  const values = measuredPoints.map((point) => point.averageDelayMinutes!)
  const y = scaleLinear().domain([Math.min(0, ...values), Math.max(1, ...values)]).nice(5).range([height - margin.bottom, margin.top])
  const path = line<DelayTimePoint>().defined((point) => point.averageDelayMinutes !== null).x((point) => x(point.timestamp)).y((point) => y(point.averageDelayMinutes!))
  const ticks = resolution === 'daily'
    ? x.ticks(Math.max(2, Math.floor((width - margin.left - margin.right) / 85))).map((date) => ({ timestamp: date.valueOf(), label: utcFormat('%d %b')(date) }))
    : aggregatePoints.filter((_, i) => i % (width < 460 ? 2 : 1) === 0).map((point) => ({ timestamp: point.timestamp, label: formatTimelinePeriod(point.periodStart, point.periodEnd) }))
  const tickLabel = (label: string) => resolution === 'weekly' && width < 750 ? label.replace('–', '–\n').split('\n') : [label]
  const inspect = (point: DelayTimePoint, index: number, announce: boolean) => {
    setInspectedKey(pointKey(point)); setActiveIndex(index); onHoverStation(point.stationId)
    if (announce) setAnnouncement(description(point))
  }
  const changeResolution = (next: TimeResolution) => {
    onResolutionChange(next); setInspectedKey(null); setActiveIndex(0); setAnnouncement(`${next === 'daily' ? 'Daily' : 'Weekly'} view`)
  }
  const changeStation = (id: string) => {
    if (id) onSelectStation(id); else onClearStations()
    setInspectedKey(null); setActiveIndex(0)
  }

  return <section className="delay-timeline" aria-labelledby={titleId}>
    <header className="explorer-heading">
      <div><p className="explorer-eyebrow">DELAYS OVER TIME</p><h2 id={titleId}>A shared trend, different station experiences.</h2>
        <p>The full timeline stays visible. Brush dates below to update the maps and line comparisons.</p></div>
      <div className="explorer-source"><strong>Synthetic demo data · full timeline</strong><span>{formatTimelinePeriod(data.periodStart, data.periodEnd)} {data.periodStart.slice(0, 4)} · {data.timezone}</span></div>
    </header>
    <div className="explorer-toolbar timeline-toolbar">
      <div className="timeline-resolution" role="group" aria-label="Time resolution">
        <button type="button" aria-pressed={resolution === 'daily'} onClick={() => changeResolution('daily')}>Daily</button>
        <button type="button" aria-pressed={resolution === 'weekly'} onClick={() => changeResolution('weekly')}>Weekly</button>
      </div>
      <div className="explorer-station-control">
        <label htmlFor={selectorId}>Shared station selection</label>
        <select id={selectorId} value={selected.length > 1 ? '__multiple' : selected[0]?.stationId ?? ''} onChange={(event) => changeStation(event.target.value)}>
          <option value="">All stations</option>
          {selected.length > 1 && <option value="__multiple" disabled>{selected.length} selected stations</option>}
          {data.stations.map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName}</option>)}
        </select>
      </div>
      <label className="explorer-add-mode"><input type="checkbox" checked={addToSelection} onChange={(event) => onAddModeChange(event.target.checked)} />Add to selection</label>
      <button type="button" disabled={!selected.length} onClick={onClearStations}>Clear stations</button>
    </div>
    <div className="timeline-date-controls">
      <label htmlFor={startId}>Start date<input id={startId} type="date" min={data.periodStart} max={data.periodEnd} value={chosenRange.start}
        onChange={(event) => { if (event.target.value) onDateRangeChange({ start: event.target.value, end: event.target.value > chosenRange.end ? event.target.value : chosenRange.end }) }} /></label>
      <label htmlFor={endId}>End date<input id={endId} type="date" min={data.periodStart} max={data.periodEnd} value={chosenRange.end}
        onChange={(event) => { if (event.target.value) onDateRangeChange({ start: event.target.value < chosenRange.start ? event.target.value : chosenRange.start, end: event.target.value }) }} /></label>
      <button type="button" disabled={!dateRange} onClick={() => onDateRangeChange(null)}>Clear date range</button>
      <p role="status">Active dates: {formatTimelinePeriod(chosenRange.start, chosenRange.end)} · {selected.length ? `${selected.length} selected stations` : 'All stations'}</p>
    </div>
    <ul className="timeline-legend" aria-label="Chart legend">
      <li>Dot fill: mean delay (min)<span className="timeline-delay-ramp" aria-hidden="true" style={{ background: `linear-gradient(to right, ${DELAY_COLORS.join(', ')})` }} /><span>0 → 20+</span></li>
      <li><span className="timeline-line-swatch" aria-hidden="true" />{aggregateLabel}</li>
      {selected.length <= 3 && selected.map((station) => <li key={station.stationId}><span className="timeline-selected-swatch" style={{ borderColor: stationColor(station.stationId) }} aria-hidden="true" />{station.stationName}</li>)}
    </ul>
    <div className="timeline-frame" ref={frame}>
      <svg className="timeline-chart" width={width} height={height} role="group" aria-labelledby={`${titleId} ${summaryId}`}>
        <desc id={summaryId}>Calendar {resolution === 'daily' ? 'dates' : 'weeks'} and average delay in minutes. Dot fill uses YlOrBr. Grey line: {aggregateLabel}. The shaded interval filters map values; the full timeline remains for context. Use arrow keys to inspect observations.</desc>
        {dateRange && <rect className="timeline-date-shade" x={x(calendarTimestamp(dateRange.start) - 43_200_000)} y={margin.top}
          width={x(calendarTimestamp(dateRange.end) + 43_200_000) - x(calendarTimestamp(dateRange.start) - 43_200_000)} height={height - margin.bottom - margin.top} />}
        {y.ticks(5).map((tick) => <g key={tick}><line className="timeline-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} /><text className="timeline-tick" x={margin.left - 9} y={y(tick)} dy="0.35em" textAnchor="end">{tick}</text></g>)}
        <text className="timeline-axis-title" x={margin.left} y={14}>Mean delay (min)</text>
        {ticks.map((tick) => <g key={tick.timestamp}><line className="timeline-axis-tick" x1={x(tick.timestamp)} x2={x(tick.timestamp)} y1={height - margin.bottom} y2={height - margin.bottom + 5} />
          <text className="timeline-tick" x={x(tick.timestamp)} y={height - margin.bottom + 22} textAnchor="middle">{tickLabel(tick.label).map((part, index) => <tspan key={part} x={x(tick.timestamp)} dy={index ? 16 : 0}>{part}</tspan>)}</text></g>)}
        <text className="timeline-axis-title" x={(margin.left + width - margin.right) / 2} y={height - 5} textAnchor="middle">{resolution === 'daily' ? 'Calendar date' : 'Calendar week (Monday–Sunday)'}</text>
        <path className="timeline-average" d={path(aggregatePoints) ?? undefined} />
        {selected.length <= 3 && selected.map((station) => <path key={station.stationId} className="timeline-selected-line" style={{ stroke: stationColor(station.stationId) }} d={path(stationPoints.filter((point) => point.stationId === station.stationId)) ?? undefined} />)}
        {visiblePoints.map((point, index) => {
          const key = pointKey(point), aggregate = point.stationId === null, highlighted = isSelected(point)
          const className = `timeline-mark ${aggregate ? 'timeline-aggregate-mark' : highlighted ? 'timeline-selected-dot' : selected.length ? 'timeline-dot timeline-dimmed' : 'timeline-dot'}${hoveredStationId && point.stationId === hoveredStationId ? ' timeline-linked-hover' : ''}`
          const props = {
            ref: (element: SVGElement | null) => { if (element) marks.current.set(key, element); else marks.current.delete(key) },
            tabIndex: index === Math.min(activeIndex, visiblePoints.length - 1) ? 0 : -1, role: 'button', 'aria-label': description(point),
            'aria-describedby': inspectedKey === key ? tooltipId : undefined, className,
            style: { opacity: inRange(point) ? 1 : 0.2, ...(highlighted ? { stroke: stationColor(point.stationId!) } : {}) },
            onPointerEnter: () => inspect(point, index, false),
            onPointerLeave: (event: React.PointerEvent<SVGElement>) => { onHoverStation(null); if (document.activeElement !== event.currentTarget) setInspectedKey(null) },
            onFocus: () => inspect(point, index, true), onBlur: () => { setInspectedKey(null); onHoverStation(null) },
            onClick: (event: React.MouseEvent<SVGElement>) => { event.currentTarget.focus(); inspect(point, index, true) },
            onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
              if (event.key === 'Escape') { setInspectedKey(null); onHoverStation(null); return }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(point, index, true); return }
              const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
              if (!offset && event.key !== 'Home' && event.key !== 'End') return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? visiblePoints.length - 1 : (index + offset + visiblePoints.length) % visiblePoints.length
              marks.current.get(pointKey(visiblePoints[next]))?.focus({ preventScroll: true })
            },
          }
          return aggregate ? <rect key={key} {...props} x={x(point.timestamp) - 3} y={y(point.averageDelayMinutes!) - 3} width={6} height={6} />
            : <circle key={key} {...props} fill={delayColor(point.averageDelayMinutes!)} cx={x(point.timestamp)} cy={y(point.averageDelayMinutes!)} r={highlighted ? 4.5 : 3.5} />
        })}
      </svg>
      {inspected && <div id={tooltipId} className="timeline-tooltip" role="tooltip" style={{ left: Math.max(8, Math.min(x(inspected.timestamp) + 12, width - Math.min(260, width - 16) - 8)), top: Math.max(4, y(inspected.averageDelayMinutes!) - 112), width: Math.min(260, width - 16) }}>
        <strong>{inspected.stationName}</strong><span>{formatTimelinePeriod(inspected.periodStart, inspected.periodEnd)} {inspected.periodStart.slice(0, 4)}</span><span>{inspected.averageDelayMinutes!.toFixed(1)} min mean delay</span><span>{count.format(inspected.delayObservations)} measured train stops</span>
      </div>}
      <TimelineBrush width={width} bounds={{ start: data.periodStart, end: data.periodEnd }} range={dateRange} resolution={resolution} onChange={onDateRangeChange} />
    </div>
    <div className="timeline-status" role="status" aria-live="polite"><p>{selected.length ? `${selected.map((station) => station.stationName).join(' · ')}. ` : ''}{selected.length > 3 ? 'Only the selected-group average is connected for selections above three stations. ' : ''}Grey line: {aggregateLabel}. Dots outside the selected dates are faded, but remain available for context.</p></div>
    <p className="timeline-help">YlOrBr fill shows delay on the fixed 0–20+ minute map scale. Coloured outlines identify selected stations. Hover a dot to temporarily emphasize its station on the map. Drag the date brush or use the date inputs; only dates are filtered, never delay values. Missing measurements create gaps. Keyboard: Tab into the chart and use arrow keys to inspect marks.</p>
    <span className="timeline-sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>
}
