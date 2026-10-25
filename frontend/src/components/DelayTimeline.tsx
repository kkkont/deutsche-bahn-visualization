import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { line, scaleLinear, scaleUtc, utcFormat } from 'd3'
import type { ExplorerDataset } from '../data/delayExplorer'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import { calendarTimestamp, formatTimelinePeriod, summarizeTimeline } from '../data/delayTimeline'
import type { DelayTimePoint, TimeResolution } from '../data/delayTimeline'
import '../delay-timeline.css'

const pointKey = (point: DelayTimePoint) => `${point.stationId ?? 'aggregate'}:${point.periodStart}`
const count = new Intl.NumberFormat('en-GB')
const delayColor = scaleLinear<string>()
  .domain(DELAY_COLORS.map((_, index) => index * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1)))
  .range(DELAY_COLORS).clamp(true)
const description = (point: DelayTimePoint) => `${point.stationName}, ${formatTimelinePeriod(point.periodStart, point.periodEnd)}: ${point.averageDelayMinutes!.toFixed(1)} minutes average delay, ${count.format(point.delayObservations)} measured train stops`

export function DelayTimeline({ data }: { data: ExplorerDataset }) {
  const [resolution, setResolution] = useState<TimeResolution>('daily')
  const [selectedId, setSelectedId] = useState('')
  const [inspectedKey, setInspectedKey] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [width, setWidth] = useState(600)
  const [announcement, setAnnouncement] = useState('')
  const frame = useRef<HTMLDivElement>(null)
  const marks = useRef(new Map<string, SVGElement>())
  const tooltipId = useId()
  const titleId = useId()
  const summaryId = useId()
  const selectorId = useId()
  const { stationPoints, aggregatePoints } = useMemo(() => summarizeTimeline(data, resolution), [data, resolution])
  const selected = data.stations.find((station) => station.stationId === selectedId)
  const selectedPoints = stationPoints.filter((point) => point.stationId === selectedId)
  const measuredPoints = stationPoints.filter((point) => point.averageDelayMinutes !== null)
  // Draw selected marks last so overlapping station dots cannot cover them.
  const visiblePoints = [...measuredPoints.filter((point) => point.stationId !== selectedId),
    ...aggregatePoints.filter((point) => point.averageDelayMinutes !== null),
    ...measuredPoints.filter((point) => point.stationId === selectedId)]
  const inspected = visiblePoints.find((point) => pointKey(point) === inspectedKey)

  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const height = 380
  const margin = { left: 52, right: 18, top: 26, bottom: resolution === 'weekly' ? 80 : 62 }
  const x = scaleUtc().domain([calendarTimestamp(data.periodStart) - 43_200_000, calendarTimestamp(data.periodEnd) + 43_200_000])
    .range([margin.left, width - margin.right])
  const values = measuredPoints.map((point) => point.averageDelayMinutes!)
  const y = scaleLinear().domain([Math.min(0, ...values), Math.max(1, ...values)]).nice(5)
    .range([height - margin.bottom, margin.top])
  const path = line<DelayTimePoint>().defined((point) => point.averageDelayMinutes !== null)
    .x((point) => x(point.timestamp)).y((point) => y(point.averageDelayMinutes!))
  const dailyTicks = x.ticks(Math.max(2, Math.floor((width - margin.left - margin.right) / 85)))
  const weekStep = width < 460 ? 2 : 1
  const weeklyTicks = aggregatePoints.filter((_, index) => index % weekStep === 0)
  const ticks = resolution === 'daily'
    ? dailyTicks.map((date) => ({ timestamp: date.valueOf(), label: utcFormat('%d %b')(date) }))
    : weeklyTicks.map((point) => ({ timestamp: point.timestamp, label: formatTimelinePeriod(point.periodStart, point.periodEnd) }))
  const tickLabel = (label: string) => resolution === 'weekly' && width < 750 ? label.replace('–', '–\n').split('\n') : [label]
  const inspect = (point: DelayTimePoint, index: number, announce: boolean) => {
    setInspectedKey(pointKey(point))
    setActiveIndex(index)
    if (announce) setAnnouncement(description(point))
  }
  const changeResolution = (next: TimeResolution) => {
    setResolution(next)
    setInspectedKey(null)
    setActiveIndex(0)
    setAnnouncement(`${next === 'daily' ? 'Daily' : 'Weekly'} view`)
  }

  return <section className="delay-timeline" aria-labelledby={titleId}>
    <header className="explorer-heading">
      <div>
        <p className="explorer-eyebrow">DELAYS OVER TIME</p>
        <h2 id={titleId}>A shared trend, different station experiences.</h2>
        <p>Compare station averages on each date with the observation-weighted average across all stations.</p>
      </div>
      <div className="explorer-source"><strong>Synthetic demo data</strong>
        <span>{formatTimelinePeriod(data.periodStart, data.periodEnd)} {data.periodStart.slice(0, 4)} · {data.timezone}</span>
      </div>
    </header>

    <div className="explorer-toolbar timeline-toolbar">
      <div className="timeline-resolution" role="group" aria-label="Time resolution">
        <button type="button" aria-pressed={resolution === 'daily'} onClick={() => changeResolution('daily')}>Daily</button>
        <button type="button" aria-pressed={resolution === 'weekly'} onClick={() => changeResolution('weekly')}>Weekly</button>
      </div>
      <div className="explorer-station-control">
        <label htmlFor={selectorId}>Highlight a station in the chart</label>
        <select id={selectorId} value={selectedId} onChange={(event) => {
          setSelectedId(event.target.value)
          setInspectedKey(null)
          setActiveIndex(0)
          setAnnouncement(event.target.value ? 'Station highlighted; the grey overall average is unchanged.' : 'Showing all stations')
        }}>
          <option value="">All stations</option>
          {data.stations.map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName}</option>)}
        </select>
      </div>
      <p>{measuredPoints.length} station-{resolution === 'daily' ? 'day' : 'week'} averages</p>
    </div>

    <ul className="timeline-legend" aria-label="Chart legend">
      <li>Dot fill: mean delay (min)
        <span className="timeline-delay-ramp" aria-hidden="true" style={{ background: `linear-gradient(to right, ${DELAY_COLORS.join(', ')})` }} />
        <span>0 → 20+</span>
      </li>
      <li><span className="timeline-line-swatch" aria-hidden="true" />All-station weighted mean</li>
      {selected && <li><span className="timeline-selected-swatch" aria-hidden="true" />{selected.stationName}</li>}
    </ul>

    <div className="timeline-frame" ref={frame}>
      <svg className="timeline-chart" width={width} height={height} role="group" aria-labelledby={`${titleId} ${summaryId}`}>
        <desc id={summaryId}>Calendar {resolution === 'daily' ? 'dates' : 'weeks'} on the horizontal axis; average delay in minutes on the vertical axis. Each dot is one station mean. Its fill uses the fixed YlOrBr scale: pale yellow for lower delay, dark brown for higher delay. A blue outline identifies the selected station. The grey line is weighted by measured train-stop counts. Missing measurements leave gaps. Use arrow keys to inspect observations.</desc>
        {y.ticks(5).map((tick) => <g key={tick}>
          <line className="timeline-grid" x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />
          <text className="timeline-tick" x={margin.left - 9} y={y(tick)} dy="0.35em" textAnchor="end">{tick}</text>
        </g>)}
        <text className="timeline-axis-title" x={margin.left} y={14}>Mean delay (min)</text>
        {ticks.map((tick) => <g key={tick.timestamp}>
          <line className="timeline-axis-tick" x1={x(tick.timestamp)} x2={x(tick.timestamp)} y1={height - margin.bottom} y2={height - margin.bottom + 5} />
          <text className="timeline-tick" x={x(tick.timestamp)} y={height - margin.bottom + 22} textAnchor="middle">
            {tickLabel(tick.label).map((part, index) => <tspan key={part} x={x(tick.timestamp)} dy={index ? 16 : 0}>{part}</tspan>)}
          </text>
        </g>)}
        <text className="timeline-axis-title" x={(margin.left + width - margin.right) / 2} y={height - 5} textAnchor="middle">{resolution === 'daily' ? 'Calendar date' : 'Calendar week (Monday–Sunday)'}</text>
        <path className="timeline-average" d={path(aggregatePoints) ?? undefined} />
        {selected && <path className="timeline-selected-line" d={path(selectedPoints) ?? undefined} />}
        {visiblePoints.map((point, index) => {
          const key = pointKey(point)
          const aggregate = point.stationId === null
          const highlighted = point.stationId === selectedId
          const className = `timeline-mark ${aggregate ? 'timeline-aggregate-mark' : highlighted ? 'timeline-selected-dot' : selected ? 'timeline-dot timeline-dimmed' : 'timeline-dot'}`
          const props = {
            ref: (element: SVGElement | null) => { if (element) marks.current.set(key, element); else marks.current.delete(key) },
            tabIndex: index === Math.min(activeIndex, visiblePoints.length - 1) ? 0 : -1,
            role: 'button',
            'aria-label': description(point),
            'aria-describedby': inspectedKey === key ? tooltipId : undefined,
            className,
            onPointerEnter: () => inspect(point, index, false),
            onPointerLeave: (event: React.PointerEvent<SVGElement>) => { if (document.activeElement !== event.currentTarget) setInspectedKey(null) },
            onFocus: () => inspect(point, index, true),
            onBlur: () => setInspectedKey(null),
            onClick: (event: React.MouseEvent<SVGElement>) => { event.currentTarget.focus(); inspect(point, index, true) },
            onKeyDown: (event: React.KeyboardEvent<SVGElement>) => {
              if (event.key === 'Escape') { setInspectedKey(null); return }
              if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect(point, index, true); return }
              const offset = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
              if (!offset && event.key !== 'Home' && event.key !== 'End') return
              event.preventDefault()
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? visiblePoints.length - 1 : (index + offset + visiblePoints.length) % visiblePoints.length
              marks.current.get(pointKey(visiblePoints[next]))?.focus({ preventScroll: true })
            },
          }
          return aggregate
            ? <rect key={key} {...props} x={x(point.timestamp) - 3} y={y(point.averageDelayMinutes!) - 3} width={6} height={6} />
            : <circle key={key} {...props} fill={delayColor(point.averageDelayMinutes!)} cx={x(point.timestamp)} cy={y(point.averageDelayMinutes!)} r={highlighted ? 4.5 : 3.5} />
        })}
      </svg>
      {inspected && <div id={tooltipId} className="timeline-tooltip" role="tooltip" style={{
        left: Math.max(8, Math.min(x(inspected.timestamp) + 12, width - Math.min(260, width - 16) - 8)),
        top: Math.max(4, y(inspected.averageDelayMinutes!) - 112),
        width: Math.min(260, width - 16),
      }}>
        <strong>{inspected.stationName}</strong>
        <span>{formatTimelinePeriod(inspected.periodStart, inspected.periodEnd)} {inspected.periodStart.slice(0, 4)}</span>
        <span>{inspected.averageDelayMinutes!.toFixed(1)} min mean delay</span>
        <span>{count.format(inspected.delayObservations)} measured train stops</span>
      </div>}
    </div>
    <div className="timeline-status" role="status" aria-live="polite">
      {selected ? <p><strong>{selected.stationName}</strong> · {selectedPoints.filter((point) => point.averageDelayMinutes !== null).length} of {aggregatePoints.length} {resolution === 'daily' ? 'days' : 'weeks'} with measurements. {selectedPoints.every((point) => point.averageDelayMinutes === null) ? 'No measured dots or trajectory for this station.' : 'Its outlined dots and thin line are highlighted.'}</p>
        : <p>Each dot represents one station-{resolution === 'daily' ? 'day' : 'week'} average. The grey line combines all measured train stops, rather than averaging the dots.</p>}
    </div>
    <p className="timeline-help">YlOrBr fill encodes absolute delay using the same fixed 0–20+ minute scale as the maps. The Tol Light blue outline and dashed trajectory identify the highlighted station; grey squares and line show the overall average. Hover or tap a mark for details. Keyboard: Tab into the chart, then use arrow keys to inspect marks. Missing measurements create gaps; measured zero remains at zero. Chart selection is independent of the maps.</p>
    <span className="timeline-sr-only" role="status" aria-live="polite">{announcement}</span>
  </section>
}
