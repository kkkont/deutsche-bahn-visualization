import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { line, scaleLinear } from 'd3'
import type { ExplorerDataset } from '../data/delayExplorer'
import { formatTimelinePeriod } from '../data/delayTimeline'
import { spreadProfileLabels, summarizeProfiles } from '../data/delayProfiles'
import type { ProfilePoint, ProfileSeries } from '../data/delayProfiles'
import '../delay-profiles.css'

// Tol Light: categorical identity; grey is reserved for the weighted average.
const COLORS = ['#77AADD', '#EE8866', '#EEDD88', '#FFAABB', '#99DDFF', '#44BB99', '#BBCC33']
const number = new Intl.NumberFormat('en-GB')

function ProfileChart({ title, subtitle, series, average, ticks, axisLabel, averageDescription, max,
  data, selectedId, selectedCount, onSelect, filterLabel }: {
  title: string; subtitle: string; series: ProfileSeries[]; average: ProfilePoint[];
  ticks: string[]; axisLabel: string; averageDescription: string; max: number;
  data: ExplorerDataset; selectedId: string; onSelect: (id: string) => void; filterLabel: string;
  selectedCount: number;
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const [hovered, setHovered] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  const active = focused ?? hovered
  const headingId = useId()
  const selectorId = useId()
  const scope = selectedCount > 1 ? `${selectedCount} selected stations` : selectedId ? data.stations.find((station) => station.stationId === selectedId)?.stationName ?? 'Selected station' : 'All stations'
  useEffect(() => {
    if (!frame.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(frame.current)
    return () => observer.disconnect()
  }, [])
  const height = 340, left = 44, right = 83, top = 25, bottom = 57
  const x = scaleLinear().domain([0, Math.max(1, ticks.length - 1)]).range([left, width - right])
  const y = scaleLinear().domain([0, max]).nice(5).range([height - bottom, top])
  const path = line<ProfilePoint>().defined((point) => point.averageDelayMinutes !== null)
    .x((point) => x(point.position)).y((point) => y(point.averageDelayMinutes!))
  const lines = [...series.map((item, index) => ({ ...item, color: COLORS[index % COLORS.length], average: false })),
    { label: 'Average', points: average, color: '#666666', average: true }]
  const ends = lines.flatMap((item) => {
    const point = item.points.findLast((value) => value.averageDelayMinutes !== null)
    return point ? [{ ...item, point }] : []
  })
  const labelYs = spreadProfileLabels(ends.map((item) => y(item.point.averageDelayMinutes!)), top + 8, height - bottom - 8)

  return <article className="delay-profile-chart" aria-labelledby={headingId}>
    <h3 id={headingId}>{title}</h3>
    <p className="profile-subtitle">{subtitle}</p>
    <div className="explorer-toolbar profile-toolbar">
      <div className="explorer-station-control">
        <label htmlFor={selectorId}>{filterLabel}</label>
        <select id={selectorId} value={selectedId} onChange={(event) => onSelect(event.target.value)}>
          <option value="">All stations</option>
          {selectedCount > 1 && <option value="__multiple" disabled>{selectedCount} selected stations</option>}
          {data.stations.map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName}</option>)}
        </select>
      </div>
      <p role="status" aria-live="polite">Scope: {scope}</p>
    </div>
    <div ref={frame}>
      {ends.length ? <>
      <svg width={width} height={height} className="profile-svg" role="group" aria-label={`${title}. ${axisLabel} on the horizontal axis; weighted average delay in minutes on the vertical axis. Lines are directly labelled at the right.`}>
        {y.ticks(5).map((tick) => <g key={tick}>
          <line className="profile-grid" x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} />
          <text className="profile-tick" x={left - 8} y={y(tick)} dy="0.35em" textAnchor="end">{tick}</text>
        </g>)}
        <text className="profile-axis" x={left} y={14}>Mean delay (min)</text>
        {ticks.map((tick, index) => <text key={`${tick}:${index}`} className="profile-tick" x={x(index)} y={height - bottom + 21} textAnchor="middle">{tick}</text>)}
        <text className="profile-axis" x={(left + width - right) / 2} y={height - 7} textAnchor="middle">{axisLabel}</text>
        {ends.map((item, index) => <g key={item.label} className="profile-series" tabIndex={0} role="group"
          aria-label={`${item.label}${item.average ? `: ${averageDescription}` : ''}. ${item.points.filter((point) => point.averageDelayMinutes !== null).length} measured points. ${scope}.`}
          style={{ opacity: active && active !== item.label ? 0.2 : 1 }}
          onPointerEnter={() => setHovered(item.label)} onPointerLeave={() => setHovered(null)}
          onFocus={() => setFocused(item.label)} onBlur={() => setFocused(null)}
          onClick={(event) => event.currentTarget.focus()}
          onKeyDown={(event) => { if (event.key === 'Escape') { setFocused(null); setHovered(null) } }}>
          <path d={path(item.points) ?? undefined} fill="none" stroke={item.color} strokeWidth={item.average ? 2.8 : 1.8} />
          {item.points.filter((point) => point.averageDelayMinutes !== null).map((point) => <circle key={point.position}
            cx={x(point.position)} cy={y(point.averageDelayMinutes!)} r={item.average ? 3 : 2.5}
            fill={item.color} stroke="var(--paper)" strokeWidth={0.8}>
            <title>{`${scope} · ${item.label} · ${ticks[point.position]} · ${formatTimelinePeriod(point.periodStart, point.periodEnd)}: ${point.averageDelayMinutes!.toFixed(2)} min · ${number.format(point.delayObservations)} measured train stops`}</title>
          </circle>)}
          <path className="profile-label-leader" d={`M${x(item.point.position) + 5},${y(item.point.averageDelayMinutes!)}L${width - right + 12},${labelYs[index]}H${width - right + 18}`} stroke={item.color} />
          <text className={`profile-direct-label${item.average ? ' profile-average-label' : ''}`} x={width - right + 23} y={labelYs[index]} dy="0.35em">{item.label}</text>
        </g>)}
      </svg>
      <p className="profile-average-note">Grey average for {scope}: {averageDescription}.</p>
      </> : <p className="profile-no-measurements" role="status">No measurements for {scope} during this period. Choose another station or All stations.</p>}
    </div>
  </article>
}

export function DelayProfileCharts({ data, selectedStationIds, onSelectStation, onClearStations }: {
  data: ExplorerDataset; selectedStationIds: string[]; onSelectStation: (id: string) => void; onClearStations: () => void;
}) {
  const weekdayProfiles = useMemo(() => summarizeProfiles(data, selectedStationIds), [data, selectedStationIds])
  const weekProfiles = weekdayProfiles
  const selectedId = selectedStationIds.length > 1 ? '__multiple' : selectedStationIds[0] ?? ''
  const select = (id: string) => id ? onSelectStation(id) : onClearStations()
  const max = Math.max(1, ...[...weekdayProfiles.weekdays.series, ...weekProfiles.weeks.series]
    .flatMap((series) => series.points.map((point) => point.averageDelayMinutes ?? 0)))
  return <section className="delay-profiles" aria-labelledby="delay-profiles-title">
    <header className="explorer-heading">
      <div>
        <p className="explorer-eyebrow">SIMPLE LINE COMPARISONS</p>
        <h2 id="delay-profiles-title">Compare weekdays and weeks.</h2>
        <p>Both line charts follow the shared station selection and brushed date interval.</p>
      </div>
      <div className="explorer-source"><strong>Synthetic demo data</strong><span>{formatTimelinePeriod(data.periodStart, data.periodEnd)} {data.periodStart.slice(0, 4)} · {data.timezone}</span></div>
    </header>
    <ProfileChart title="How does each weekday change across weeks?" subtitle="One line per weekday, Mon–Sun. Each point is that date’s weighted mean for the chosen station scope."
      data={data} selectedId={selectedId} selectedCount={selectedStationIds.length} onSelect={select} filterLabel="Shared stations · weekday chart"
      series={weekdayProfiles.weekdays.series} average={weekdayProfiles.weekdays.average} ticks={weekdayProfiles.weekdays.ticks}
      axisLabel="ISO calendar week" averageDescription="all measured train stops in each calendar week" max={max} />
    <ProfileChart title="How does each week unfold from Monday to Sunday?" subtitle="One line per ISO calendar week, showing its daily mean delays from Mon to Sun."
      data={data} selectedId={selectedId} selectedCount={selectedStationIds.length} onSelect={select} filterLabel="Shared stations · week chart"
      series={weekProfiles.weeks.series} average={weekProfiles.weeks.average} ticks={weekProfiles.weeks.ticks}
      axisLabel="Day of week" averageDescription="all measured train stops for each weekday in the selected period" max={max} />
    <p className="profile-help">Station and date filters are shared with the map and scatterplot. All averages use delay totals and measurement counts for that scope. The shared zero-based vertical scale adjusts to both charts’ values. Missing dates break lines. Hover or focus a line or its end label to highlight it; hover a point for its date, delay and count.</p>
  </section>
}
