import { useEffect, useId, useRef, useState } from 'react'
import { arc, lineRadial, scaleLinear } from 'd3'
import { useTranslation } from 'react-i18next'

interface ClockHour {
  hour: number
  averageDelayMinutes: number | null
  delayObservations: number
}

interface ClockData {
  period: string
  source: string
  timezone: string
  hours: ClockHour[]
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, '0')}:00`
const hourAngle = (hour: number) => hour * Math.PI / 12
const delayColors = ['#FFFFE5', '#FFF7BC', '#FEE391', '#FEC44F', '#FB9A29', '#EC7014', '#CC4C02', '#993404', '#662506']

export function DelayClock() {
  const { t, i18n } = useTranslation('charts')
  const titleId = useId()
  const sliderId = useId()
  const gradientId = useId()
  const svgRef = useRef<SVGSVGElement>(null)
  const [data, setData] = useState<ClockData | null>(null)
  const [failed, setFailed] = useState(false)
  const [selectedHour, setSelectedHour] = useState(12)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${import.meta.env.BASE_URL}data/delay-clock.json`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Clock data unavailable')
        return response.json() as Promise<ClockData>
      })
      .then((result) => {
        if (result.hours.length !== 24 || result.hours.some((point, index) =>
          point.hour !== index || !Number.isFinite(point.delayObservations) ||
          (point.averageDelayMinutes !== null && !Number.isFinite(point.averageDelayMinutes)))) {
          throw new Error('Invalid clock data')
        }
        if (!controller.signal.aborted) setData(result)
      })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [])

  const locale = i18n.resolvedLanguage ?? 'en'
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 })
  const count = new Intl.NumberFormat(locale)
  const measured = data?.hours.filter((point) => point.averageDelayMinutes !== null) ?? []
  const maximumDelay = Math.max(0, ...measured.map((point) => point.averageDelayMinutes!))
  const delayColor = scaleLinear<string>()
    .domain(delayColors.map((_, index) => index * (maximumDelay || 1) / (delayColors.length - 1)))
    .range(delayColors)
    .clamp(true)
  const legendTicks = maximumDelay > 0
    ? [0, maximumDelay / 3, maximumDelay * 2 / 3, maximumDelay]
    : [0]
  const radius = scaleLinear()
    .domain([
      Math.min(0, ...measured.map((point) => point.averageDelayMinutes!)),
      Math.max(1, ...measured.map((point) => point.averageDelayMinutes!)),
    ])
    .nice(4)
    .range([60, 158])
  const ticks = radius.ticks(4)
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

  return (
    <section className="delay-clock-section" aria-labelledby={titleId}>
      <header className="delay-clock-heading">
        <div>
          <p className="delay-clock-eyebrow">{t('clockOverview')}</p>
          <h2 id={titleId}>{t('clockTitle')}</h2>
        </div>
        {data && <span className="delay-clock-period">{new Intl.DateTimeFormat(locale, {
          month: 'long', year: 'numeric', timeZone: 'UTC',
        }).format(new Date(`${data.period}-01T12:00:00Z`))}</span>}
      </header>
      {failed ? <p role="alert">{t('clockError')}</p> : !data ? (
        <p role="status">{t('clockLoading')}</p>
      ) : (
        <div className="delay-clock-layout">
          <svg ref={svgRef} className="delay-clock-chart" viewBox="0 0 440 440"
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
            <g transform="translate(220,220)">
              {ticks.map((tick) => (
                <g key={tick} aria-hidden="true">
                  <circle r={radius(tick)} className="delay-clock-ring" />
                  <text x={6} y={-radius(tick) - 5} className="delay-clock-tick">
                    {t('clockDelayValue', { value: number.format(tick) })}
                  </text>
                </g>
              ))}
              {data.hours.filter((point) => point.hour % 3 === 0).map((point) => (
                <line key={point.hour} x1={Math.sin(hourAngle(point.hour)) * 60}
                  y1={-Math.cos(hourAngle(point.hour)) * 60}
                  x2={Math.sin(hourAngle(point.hour)) * 158}
                  y2={-Math.cos(hourAngle(point.hour)) * 158}
                  className="delay-clock-spoke" aria-hidden="true" />
              ))}
              {segments.map((segment) => <path key={segment.hour} d={segment.path}
                className="delay-clock-line-outline" aria-hidden="true" />)}
              {segments.map((segment) => <path key={segment.hour} d={segment.path}
                stroke={`url(#${gradientId}-${segment.hour})`} className="delay-clock-line" aria-hidden="true" />)}
              {data.hours.map((point) => {
                const angle = hourAngle(point.hour)
                const isSelected = point.hour === selectedHour
                const hitArea = arc()({ innerRadius: 59, outerRadius: 205,
                  startAngle: angle - Math.PI / 24, endAngle: angle + Math.PI / 24 })
                const valueRadius = radius(point.averageDelayMinutes ?? 0)
                return (
                  <g key={point.hour} data-hour={point.hour} className="delay-clock-hour"
                    role="radio" aria-checked={isSelected} tabIndex={isSelected ? 0 : -1}
                    aria-label={t('clockHourLabel', { hour: hourLabel(point.hour), delay: formatDelay(point.averageDelayMinutes) })}
                    onClick={() => setSelectedHour(point.hour)}
                    onKeyDown={(event) => {
                      let next = point.hour
                      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (next + 1) % 24
                      else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (next + 23) % 24
                      else if (event.key === 'Home') next = 0
                      else if (event.key === 'End') next = 23
                      else if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      setSelectedHour(next)
                      svgRef.current?.querySelector<SVGGElement>(`[data-hour="${next}"]`)?.focus()
                    }}>
                    <path d={hitArea ?? undefined} className={isSelected ? 'delay-clock-sector selected' : 'delay-clock-sector'} />
                    <text x={Math.sin(angle) * 187} y={-Math.cos(angle) * 187}
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
            <p className="delay-clock-scope">{t('clockScope')}</p>
            <div className="delay-clock-legend">
              <span>{t('clockMeanDelay')}</span>
              <div className="delay-clock-legend-ramp" aria-hidden="true"
                style={maximumDelay === 0 ? { background: measured.length ? delayColors[0] : 'var(--line)' } : undefined} />
              <div className="delay-clock-legend-ticks">
                {measured.length ? legendTicks.map((value) => <span key={value}>
                  {t('clockDelayValue', { value: number.format(value) })}
                </span>) : <span>{t('clockNoData')}</span>}
              </div>
            </div>
            <label htmlFor={sliderId}>{t('clockSelectedHour')}</label>
            <div className="delay-clock-selected-hour">{hourLabel(selectedHour)}–{hourLabel((selectedHour + 1) % 24)}</div>
            <input id={sliderId} type="range" min="0" max="23" step="1" value={selectedHour}
              aria-valuetext={hourLabel(selectedHour)} onChange={(event) => setSelectedHour(Number(event.target.value))} />
            <div className="delay-clock-readout" aria-live="polite" aria-atomic="true">
              <span>{t('clockMeanDelay')}</span>
              <strong>{selectedDelay}</strong>
              <span>{t('clockObservationCount', { count: selected?.delayObservations ?? 0,
                value: count.format(selected?.delayObservations ?? 0) })}</span>
            </div>
            <dl className="delay-clock-metadata">
              <div><dt>{t('clockTimezone')}</dt><dd>{data.timezone}</dd></div>
              <div><dt>{t('clockSource')}</dt><dd><a href={data.source} target="_blank" rel="noreferrer">{t('clockSourceName')}</a></dd></div>
            </dl>
          </div>
        </div>
      )}
    </section>
  )
}