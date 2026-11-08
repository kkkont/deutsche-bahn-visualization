import { useEffect, useId, useRef, useState } from 'react'
import { line, scaleLinear } from 'd3'
import { useTranslation } from 'react-i18next'
import { DELAY_COLORS, DELAY_MAX_MINUTES } from '../data/delayExplorer'
import type { ClockHour } from '../data/linkedHourly'

export function HourlyPulse({ hours, hour, playing, onHour, compact = false, approximate = false }: { approximate?: boolean; compact?: boolean; hours: ClockHour[]; hour: number; playing: boolean; onHour: (hour: number) => void }) {
  const { t, i18n } = useTranslation('charts')
  const titleId = useId()
  const tooltipId = useId()
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const container = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(960)
  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])
  const height = compact ? 88 : 230, left = 54, right = 24, top = compact ? 10 : 28, bottom = compact ? 20 : 38
  const x = scaleLinear().domain([0, 24]).range([left, width - right])
  const y = scaleLinear().domain([Math.min(0, ...hours.map((point) => point.averageDelayMinutes ?? 0)), Math.max(1, ...hours.map((point) => point.averageDelayMinutes ?? 0)) * 1.15]).nice(4).range([height - bottom, top])
  const path = line<ClockHour>().defined((point) => point.averageDelayMinutes !== null).x((point) => x(point.hour + 0.5)).y((point) => y(point.averageDelayMinutes ?? 0))(hours)
  const color = scaleLinear<string>().domain(DELAY_COLORS.map((_, i) => i * DELAY_MAX_MINUTES / (DELAY_COLORS.length - 1))).range(DELAY_COLORS).clamp(true)
  const selected = hours[hour]
  const inspectedHour = hoveredHour ?? (focused ? hour : null)
  const inspected = inspectedHour === null ? null : hours[inspectedHour]
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? 'en', { maximumFractionDigits: 2 })
  const label = (value: number) => `${String(value).padStart(2, '0')}:00`
  const scrub = (event: React.PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect()
    onHour(Math.min(23, Math.max(0, Math.floor(x.invert((event.clientX - bounds.left) / bounds.width * width)))))
  }
  return <section ref={container} className={compact ? 'linked-pulse compact' : 'linked-pulse'} aria-labelledby={titleId}>
    <h3 id={titleId}>{t('pulseTitle')}</h3><p>{t('pulseHint')}</p>
    {inspected && <div className="pulse-tooltip" id={tooltipId} role="tooltip" style={{
      left: `${Math.max(12, Math.min(88, x(inspected.hour + 0.5) / width * 100))}%`,
    }}>
      <strong>{label(inspected.hour)}–{label((inspected.hour + 1) % 24)}</strong>
      <span>{inspected.averageDelayMinutes === null ? t('clockNoData') : `${approximate ? '≈ ' : ''}${t('clockDelayValue', { value: number.format(inspected.averageDelayMinutes) })}`}</span>
    </div>}
    <svg viewBox={`0 0 ${width} ${height}`} role="slider" aria-label={t('pulseTime')} aria-valuemin={0} aria-valuemax={23} aria-valuenow={hour}
      aria-valuetext={`${String(hour).padStart(2, '0')}:00`} aria-describedby={inspected ? tooltipId : undefined} tabIndex={0}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} onPointerLeave={() => setHoveredHour(null)}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); scrub(event) }}
      onPointerMove={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect()
        setHoveredHour(Math.min(23, Math.max(0, Math.floor(x.invert((event.clientX - bounds.left) / bounds.width * width)))))
        if (event.currentTarget.hasPointerCapture(event.pointerId)) scrub(event)
      }}
      onKeyDown={(event) => {
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? 23 : event.key === 'ArrowRight' ? (hour + 1) % 24 : event.key === 'ArrowLeft' ? (hour + 23) % 24 : null
        if (next !== null) { event.preventDefault(); onHour(next) }
      }}>
      {y.ticks(compact ? 2 : 4).map((tick) => <g key={tick}><line x1={left} x2={width - right} y1={y(tick)} y2={y(tick)} className="pulse-grid" /><text x={left - 8} y={y(tick) + 4} textAnchor="end">{tick}m</text></g>)}
      {(width < 560 ? [0, 6, 12, 18, 24] : [0, 3, 6, 9, 12, 15, 18, 21, 24]).map((tick) => <text key={tick} x={x(tick)} y={height - (compact ? 2 : 10)} textAnchor="middle">{String(tick).padStart(2, '0')}:00</text>)}
      <rect x={x(hour)} y={top} width={x(hour + 1) - x(hour)} height={height - bottom - top} className="pulse-hour-band" />
      <path d={path ?? undefined} className="pulse-mean" />
      {hours.filter((point) => point.averageDelayMinutes !== null).map((point) => <circle key={point.hour} cx={x(point.hour + 0.5)} cy={y(point.averageDelayMinutes!)} r={point.hour === hour ? 5 : 3} fill={color(point.averageDelayMinutes!)} stroke="#333333" />)}
      {inspected && inspected.averageDelayMinutes !== null && <circle cx={x(inspected.hour + 0.5)} cy={y(inspected.averageDelayMinutes)} r={6} fill="none" stroke="#333333" strokeWidth={2} pointerEvents="none" />}
      <line x1={x(hour + 0.5)} x2={x(hour + 0.5)} y1={top} y2={height - bottom} className="pulse-cursor" />
      {selected.averageDelayMinutes !== null && <circle key={hour} cx={x(hour + 0.5)} cy={y(selected.averageDelayMinutes)} r={7} className={playing ? 'pulse-heartbeat playing' : 'pulse-heartbeat'} />}
    </svg>
  </section>
}
