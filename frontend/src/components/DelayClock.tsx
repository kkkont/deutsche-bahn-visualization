import { useId, useRef } from 'react'
import { arc, lineRadial, scaleLinear } from 'd3'
import { useTranslation } from 'react-i18next'

import type { ClockData, ClockHour } from '../data/linkedHourly'
import { DELAY_COLORS as delayColors, DELAY_MAX_MINUTES } from '../data/delayColors'
import { formatMonths } from '../data/dashboardFilters'

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const hourAngle = (hour: number) => hour * Math.PI / 12

export function DelayClock({ data, selectedHour, onHour, scopeLabel, playing, approximate }: {
  data: ClockData; selectedHour: number; onHour: (hour: number) => void; scopeLabel: string; playing: boolean; approximate: boolean;
}) {
  const { t, i18n } = useTranslation('charts')
  const titleId = useId()
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const locale = i18n.resolvedLanguage ?? 'en'
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const count = new Intl.NumberFormat(locale)
  const measured = data?.hours.filter((point) => point.averageDelayMinutes !== null) ?? []
  const delayColor = scaleLinear<string>()
    .domain(delayColors.map((_, index) => index * DELAY_MAX_MINUTES / (delayColors.length - 1)))
    .range(delayColors)
    .clamp(true)
  const radius = scaleLinear()
    .domain([
      Math.min(0, ...measured.map((point) => point.averageDelayMinutes!)),
      Math.max(1, ...measured.map((point) => point.averageDelayMinutes!)),
    ])
    .nice(4)
    .range([40, 104])
  const ticks = radius.ticks(3)
  const radialLine = lineRadial<ClockHour>()
    .defined((point) => point.averageDelayMinutes !== null)
    .angle((point) => hourAngle(point.hour))
    .radius((point) => radius(point.averageDelayMinutes ?? 0))
  const segments = data?.hours.flatMap((point, index, hours) => {
    const next = hours[(index + 1) % hours.length]
    if (point.averageDelayMinutes === null || next.averageDelayMinutes === null) return []
    return [{
      hour: point.hour,
      path: radialLine([point, next]) ?? undefined,
      startColor: delayColor(point.averageDelayMinutes),
      endColor: delayColor(next.averageDelayMinutes),
      startX: Math.sin(hourAngle(point.hour)) * radius(point.averageDelayMinutes),
      startY: -Math.cos(hourAngle(point.hour)) * radius(point.averageDelayMinutes),
      endX: Math.sin(hourAngle(next.hour)) * radius(next.averageDelayMinutes),
      endY: -Math.cos(hourAngle(next.hour)) * radius(next.averageDelayMinutes),
    }]
  }) ?? []
  const selected = data?.hours[selectedHour]
  const formatDelay = (value: number | null) => value === null
    ? t('clockNoData')
    : t('clockDelayValue', { value: number.format(value) })
  const selectedDelay = formatDelay(selected?.averageDelayMinutes ?? null)
  const months = data?.months?.length ? data.months : data ? [data.period] : []
  const periodLabel = formatMonths(months, locale)

  return (
    <section className="delay-clock-section" aria-labelledby={titleId}>
      <header className="delay-clock-heading">
        <div>
          <h2 id={titleId}>{t('clockTitle')}</h2>
        </div>
        <span className="chart-scope">{scopeLabel}</span>
      </header>
        <div className="delay-clock-layout">
          <svg ref={svgRef} className="delay-clock-chart" viewBox="0 0 300 300"
            role="radiogroup" aria-labelledby={titleId}>
            <defs>
              {segments.map((segment) => (
                <linearGradient key={segment.hour} id={`${gradientId}-${segment.hour}`} gradientUnits="userSpaceOnUse"
                  x1={segment.startX} y1={segment.startY} x2={segment.endX} y2={segment.endY}>
                  <stop offset="0%" stopColor={segment.startColor} />
                  <stop offset="100%" stopColor={segment.endColor} />
                </linearGradient>
              ))}
            </defs>
            <g transform="translate(150,150)">
              {ticks.map((tick) => (
                <g key={tick} aria-hidden="true">
                  <circle r={radius(tick)} className="delay-clock-ring" />
                  <text x={6} y={-radius(tick) - 5} className="delay-clock-tick">
                    {t('clockDelayValue', { value: number.format(tick) })}
                  </text>
                </g>
              ))}
              {data.hours.filter((point) => point.hour % 3 === 0).map((point) => (
                <line key={point.hour} x1={Math.sin(hourAngle(point.hour)) * 40}
                  y1={-Math.cos(hourAngle(point.hour)) * 40}
                  x2={Math.sin(hourAngle(point.hour)) * 104}
                  y2={-Math.cos(hourAngle(point.hour)) * 104}
                  className="delay-clock-spoke" aria-hidden="true" />
              ))}
              {segments.map((segment) => <path key={segment.hour} d={segment.path}
                className="delay-clock-line-outline" aria-hidden="true" />)}
              {segments.map((segment) => <path key={segment.hour} d={segment.path}
                stroke={`url(#${gradientId}-${segment.hour})`} className="delay-clock-line" aria-hidden="true" />)}
              {data.hours.map((point) => {
                const angle = hourAngle(point.hour)
                const isSelected = point.hour === selectedHour
                const hitArea = arc()({ innerRadius: 36, outerRadius: 145,
                  startAngle: angle - Math.PI / 24, endAngle: angle + Math.PI / 24 })
                const valueRadius = radius(point.averageDelayMinutes ?? 0)
                return (
                  <g key={point.hour} data-hour={point.hour} className="delay-clock-hour"
                    role="radio" aria-checked={isSelected} tabIndex={isSelected ? 0 : -1}
                    aria-label={t('clockHourLabel', { hour: hourLabel(point.hour), delay: formatDelay(point.averageDelayMinutes) })}
                    onClick={() => onHour(point.hour)}
                    onKeyDown={(event) => {
                      let next = point.hour
                      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (next + 1) % 24
                      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (next + 23) % 24
                      else if (event.key === 'Home') next = 0
                      else if (event.key === 'End') next = 23
                      else if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      onHour(next)
                      svgRef.current?.querySelector<SVGGElement>(`[data-hour="${next}"]`)?.focus()
                    }}>
                    <path d={hitArea ?? undefined} className={isSelected ? 'delay-clock-sector selected' : 'delay-clock-sector'} />
                    <text x={Math.sin(angle) * 132} y={-Math.cos(angle) * 132}
                      textAnchor="middle" dominantBaseline="middle" className="delay-clock-hour-label">
                      {String(point.hour).padStart(2, '0')}
                    </text>
                    {point.averageDelayMinutes !== null && <circle cx={Math.sin(angle) * valueRadius}
                      cy={-Math.cos(angle) * valueRadius} r={isSelected ? 6 : 3}
                      fill={delayColor(point.averageDelayMinutes)}
                      className={isSelected ? 'delay-clock-point selected' : 'delay-clock-point'} />}
                  </g>
                )
              })}
              <text textAnchor="middle" y={-8} className="delay-clock-center-hour" aria-hidden="true">{hourLabel(selectedHour)}</text>
              <text textAnchor="middle" y={16} className="delay-clock-center-value" aria-hidden="true">{selectedDelay}</text>
            </g>
          </svg>
          <div className="delay-clock-details">
            <div className="delay-clock-selected-hour">{hourLabel(selectedHour)}–{hourLabel((selectedHour + 1) % 24)}</div>
            <div className="delay-clock-readout" aria-live={playing ? 'off' : 'polite'} aria-atomic="true">
              <span>{t('clockMeanDelay')}</span>
              <strong>{approximate && selected?.averageDelayMinutes !== null ? '≈ ' : ''}{selectedDelay}</strong>
              <span>{t('clockObservationCount', { count: selected?.delayObservations ?? 0,
                value: count.format(selected?.delayObservations ?? 0) })}</span>
            </div>
            <p className="clock-interaction-hint">{t('clockInteract')}</p>
            <details className="clock-metadata"><summary>{t('profileDetails')}</summary>
              <p>{periodLabel} · {data.timezone}</p>
              <p>{t('typicalDayNote')} {approximate && t('approximateHourly')}</p>
              <a href={data.source} target="_blank" rel="noreferrer">{t('clockSourceName')}</a>
            </details>
          </div>
        </div>
    </section>
  )
}