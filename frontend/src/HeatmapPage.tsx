import { useEffect, useMemo, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { area, curveMonotoneX, line } from 'd3-shape'
import { useTranslation } from 'react-i18next'
import './heatmap.css'

/* Expected file: /data/heatmap.json
   { period: "2026-08",
     stations: [{ stationId, stationName, lat, lon }],
     hourly:   [{ stationId, hour (0-23, Europe/Berlin), averageDelayMinutes, delayObservations }] }
   Without it the page falls back to generated demo data. */
type Station = { stationId: string; stationName: string; lat: number; lon: number }
type Hourly = { stationId: string; hour: number; averageDelayMinutes: number; delayObservations: number; weekday?: number }
type Segment = { fromId: string; toId: string; hour: number; averageDeltaMinutes: number; trips: number; weekday?: number }
type Data = { period: string; stations: Station[]; hourly: Hourly[]; segments?: Segment[]; demo?: boolean }
type Mode = 'delay' | 'delta'
type Flow = { a: Station; b: Station; d: number; trips: number }

const LON0 = 5.8, LON1 = 15.1, LAT0 = 47.2, LAT1 = 55.1
const W = 520
const H = Math.round((W * (LAT1 - LAT0)) / ((LON1 - LON0) * 0.628))
const GW = 84, GH = Math.round(GW * (H / W))
const pad = (n: number) => String(n).padStart(2, '0')
const clock = (h: number) => `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`
const px = (lon: number, lat: number): [number, number] => [((lon - LON0) / (LON1 - LON0)) * W, ((LAT1 - lat) / (LAT1 - LAT0)) * H]

// Simplified outline of Germany (lon, lat) – good enough for a backdrop, not for cartography.
const OUTLINE: [number, number][] = [[7.2, 53.25], [8.1, 53.55], [8.55, 53.55], [8.9, 53.9], [8.65, 54.0], [8.6, 54.5], [8.7, 54.9], [9.5, 54.85], [9.9, 54.8], [10.0, 54.45], [11.1, 54.45], [10.9, 53.95], [11.5, 54.0], [12.1, 54.2], [12.45, 54.4], [13.1, 54.65], [13.6, 54.55], [13.9, 54.0], [14.2, 53.93], [14.35, 53.2], [14.6, 52.6], [14.7, 52.1], [14.75, 51.5], [15.0, 51.0], [14.65, 50.85], [13.9, 50.7], [13.0, 50.4], [12.5, 50.3], [12.2, 50.25], [12.4, 50.0], [12.9, 49.5], [13.4, 49.1], [13.85, 48.75], [13.8, 48.55], [13.0, 47.85], [13.05, 47.5], [12.7, 47.65], [11.4, 47.45], [10.45, 47.55], [10.1, 47.3], [9.6, 47.55], [9.2, 47.65], [8.55, 47.6], [7.58, 47.6], [7.6, 48.0], [7.8, 48.6], [8.2, 49.0], [7.0, 49.15], [6.4, 49.45], [6.35, 49.8], [6.1, 50.1], [6.0, 50.5], [6.0, 50.75], [6.1, 51.0], [6.0, 51.5], [6.2, 51.85], [7.0, 52.05], [7.05, 52.4]]
const outlinePath = () => new Path2D('M' + OUTLINE.map(([lo, la]) => px(lo, la).join(',')).join('L') + 'Z')

// Colour guidelines (Paul Tol, https://tol-colors.readthedocs.io):
//  - delay level            -> sequential "YlOrBr"
//  - change in delay        -> diverging "nightfall" (teal = recovered, red = built up; never reversed)
//  - weekdays               -> qualitative "light" set; grey is reserved for averages
const YLORBR = ['#FFFFE5', '#FFF7BC', '#FEE391', '#FEC44F', '#FB9A29', '#EC7014', '#CC4C02', '#993404', '#662506']
const NIGHTFALL = ['#125A56', '#00767B', '#238F9D', '#42A7C6', '#60BCE9', '#9DCCEF', '#C6DBED', '#DEE6E7', '#ECEADA',
  '#F0E6B2', '#F9D576', '#FFB954', '#FD9A44', '#F57634', '#E94C1F', '#D11807', '#A01813']
const DAY_COLORS = ['#77AADD', '#99DDFF', '#44BB99', '#BBCC33', '#EEDD88', '#EE8866', '#FFAABB'] // Mon … Sun
const GREY_FILL = '#DDDDDD' // "light" pale grey
const ramp = scaleLinear<string>().domain(YLORBR.map((_, i) => i / (YLORBR.length - 1))).range(YLORBR).clamp(true)
const LUT = Array.from({ length: 256 }, (_, i) => ramp(i / 255).match(/\d+/g)!.map(Number))
const smooth = (t: number) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c) }

// Delay change per segment, -1 … +1 of the colour-scale limit.
const dramp = scaleLinear<string>().domain(NIGHTFALL.map((_, i) => i / 8 - 1)).range(NIGHTFALL).clamp(true)
const sgn = (v: number) => `${v > 0.05 ? '+' : v < -0.05 ? '−' : ''}${Math.abs(v).toFixed(1)}`
const short = (n: string) => n.replace(/ Hbf$/, '')

// Curved path A→B (bends to the right of travel, so A→B and B→A never overlap) plus an arrowhead.
function flow(a: [number, number], b: [number, number]) {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1
  const k = len * 0.16
  const c: [number, number] = [(a[0] + b[0]) / 2 - (dy / len) * k, (a[1] + b[1]) / 2 + (dx / len) * k]
  const ex = b[0] - c[0], ey = b[1] - c[1], el = Math.hypot(ex, ey) || 1
  const ux = ex / el, uy = ey / el, tx = b[0] - ux * 4, ty = b[1] - uy * 4
  return {
    d: `M${a[0]},${a[1]}Q${c[0]},${c[1]} ${b[0]},${b[1]}`,
    head: `${tx},${ty} ${tx - ux * 8 - uy * 4},${ty - uy * 8 + ux * 4} ${tx - ux * 8 + uy * 4},${ty - uy * 8 - ux * 4}`,
  }
}

/* weekday: 0 = Monday … 6 = Sunday. Rows without a weekday count for every day. */
function aggregate(data: Data, day: number | null) {
  const hv = new Map<string, { w: number[]; o: number[] }>()
  const nw: number[] = Array(24).fill(0), no: number[] = Array(24).fill(0)
  for (const r of data.hourly) {
    if (day !== null && r.weekday !== undefined && r.weekday !== day) continue
    const wt = r.delayObservations || 1
    if (!hv.has(r.stationId)) hv.set(r.stationId, { w: Array(24).fill(0), o: Array(24).fill(0) })
    const e = hv.get(r.stationId)!
    e.w[r.hour] += r.averageDelayMinutes * wt; e.o[r.hour] += wt
    nw[r.hour] += r.averageDelayMinutes * wt; no[r.hour] += wt
  }
  const vals = new Map<string, (number | null)[]>()
  for (const [id, e] of hv) vals.set(id, e.w.map((w, i) => (e.o[i] ? w / e.o[i] : null)))
  const national = nw.map((w, i) => (no[i] ? w / no[i] : 0))

  const sg = new Map<string, { from: string; to: string; w: number[]; o: number[]; t: number[] }>()
  const dw: number[] = Array(24).fill(0), dt: number[] = Array(24).fill(0)
  for (const r of data.segments ?? []) {
    if (day !== null && r.weekday !== undefined && r.weekday !== day) continue
    const wt = r.trips || 1, k = `${r.fromId}|${r.toId}`
    if (!sg.has(k)) sg.set(k, { from: r.fromId, to: r.toId, w: Array(24).fill(0), o: Array(24).fill(0), t: Array(24).fill(0) })
    const e = sg.get(k)!
    e.w[r.hour] += r.averageDeltaMinutes * wt; e.o[r.hour] += wt; e.t[r.hour] += r.trips
    dw[r.hour] += r.averageDeltaMinutes * wt; dt[r.hour] += wt
  }
  const seg = new Map<string, { from: string; to: string; delta: (number | null)[]; trips: number[] }>()
  for (const [k, e] of sg) seg.set(k, { from: e.from, to: e.to, delta: e.w.map((w, i) => (e.o[i] ? w / e.o[i] : null)), trips: e.t })
  const nationalDelta = dw.map((w, i) => (dt[i] ? w / dt[i] : 0))
  return { vals, national, seg, nationalDelta }
}

// One colour scale for every weekday, so Monday and Friday are directly comparable.
function scaleOf(data: Data) {
  const v = data.hourly.map((r) => r.averageDelayMinutes).sort((a, b) => a - b)
  const m = (data.segments ?? []).map((r) => Math.abs(r.averageDeltaMinutes)).sort((a, b) => a - b)
  return {
    vmax: Math.max(3, Math.ceil(v[Math.floor(v.length * 0.95)] ?? 5)),
    dmax: Math.max(0.5, Math.ceil((m[Math.floor(m.length * 0.95)] ?? 1) * 2) / 2),
  }
}

export function HeatmapPage() {
  const { t: rawT, i18n } = useTranslation('heatmap')
  const t = (k: string, d: string) => rawT(k, { defaultValue: d })
  const dayName = (d: number, w: 'short' | 'long' = 'short') => new Intl.DateTimeFormat(i18n.language || 'en', { weekday: w }).format(new Date(2024, 0, 1 + d))
  const [local, setLocal] = useState<Data | null | undefined>(undefined) // undefined = loading, null = file missing
  const [source, setSource] = useState<'local' | 'demo'>('local')
  const demo = useMemo(() => (source === 'demo' ? demoData() : null), [source])
  const data: Data | null = source === 'demo' ? demo : local ?? null
  const [hour, setHour] = useState(7.5)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(2)
  const [mode, setMode] = useState<Mode>('delay')
  const [day, setDay] = useState<number | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const small = useRef<HTMLCanvasElement | null>(null)
  const shape = useMemo(outlinePath, [])

  useEffect(() => {
    fetch('/data/heatmap.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() as Promise<Data> })
      .then(setLocal)
      .catch(() => { setLocal(null); setSource('demo') })
  }, [])

  useEffect(() => {
    if (!playing) return
    let last = performance.now(), id = 0
    const tick = (now: number) => { const dt = (now - last) / 1000; last = now; setHour((h) => (h + dt * speed) % 24); id = requestAnimationFrame(tick) }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [playing, speed])

  const scale = useMemo(() => (data ? scaleOf(data) : null), [data])
  const model = useMemo(() => (data && scale ? { ...aggregate(data, day), ...scale } : null), [data, scale, day])
  const hasWeekdays = useMemo(() => !!data && data.hourly.some((r) => r.weekday !== undefined), [data])
  const week = useMemo(
    () => (data && hasWeekdays ? Array.from({ length: 7 }, (_, d) => { const a = aggregate(data, d); return { national: a.national, delta: a.nationalDelta } }) : null),
    [data, hasWeekdays],
  )
  const allAvg = useMemo(() => (data && hasWeekdays ? aggregate(data, null) : null), [data, hasWeekdays])

  const at = (arr: (number | null)[], h: number) => {
    const h0 = Math.floor(h) % 24, f = h - Math.floor(h), a = arr[h0], b = arr[(h0 + 1) % 24]
    return a === null ? null : b === null ? a : a + (b - a) * f
  }
  const live = useMemo(() => {
    if (!data || !model) return []
    return data.stations.flatMap((s) => {
      const arr = model.vals.get(s.stationId); const v = arr ? at(arr, hour) : null
      return v === null ? [] : [{ ...s, v }]
    })
  }, [data, model, hour])
  const nationalNow = model ? at(model.national, hour) ?? 0 : 0
  const worst = [...live].sort((a, b) => b.v - a.v).slice(0, 5)
  const byId = useMemo(() => new Map((data?.stations ?? []).map((s) => [s.stationId, s])), [data])
  const flows: Flow[] = useMemo(() => {
    if (!model) return []
    const h0 = Math.floor(hour) % 24, f = hour - Math.floor(hour)
    return [...model.seg.values()].flatMap((e) => {
      const a = byId.get(e.from), b = byId.get(e.to), d = at(e.delta, hour)
      if (!a || !b || d === null) return []
      return [{ a, b, d, trips: e.trips[h0] + (e.trips[(h0 + 1) % 24] - e.trips[h0]) * f }]
    }).sort((p, q) => Math.abs(p.d) - Math.abs(q.d)) // strongest drawn last
  }, [model, byId, hour])
  const gains = flows.filter((f) => f.d > 0).slice(-4).reverse()
  const recovers = flows.filter((f) => f.d < 0).slice(-3).reverse()
  const maxTrips = Math.max(1, ...flows.map((f) => f.trips))
  const deltaNow = model ? at(model.nationalDelta, hour) ?? 0 : 0

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !model) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr }
    const sc = (small.current ??= Object.assign(document.createElement('canvas'), { width: GW, height: GH }))
    const sctx = sc.getContext('2d')!, img = sctx.createImageData(GW, GH)
    for (let gy = 0; gy < GH; gy++) {
      const lat = LAT1 - ((gy + 0.5) / GH) * (LAT1 - LAT0)
      for (let gx = 0; gx < GW; gx++) {
        const lon = LON0 + ((gx + 0.5) / GW) * (LON1 - LON0)
        let sw = 0, sv = 0, dmin = 1e9
        for (const s of mode === 'delay' ? live : []) {
          const dx = (lon - s.lon) * 70, dy = (lat - s.lat) * 111, d2 = dx * dx + dy * dy
          const w = 1 / (d2 + 900); sw += w; sv += w * s.v; if (d2 < dmin) dmin = d2
        }
        if (!sw) continue
        const c = LUT[Math.min(255, Math.max(0, Math.round((sv / sw / model.vmax) * 255)))]
        const i = (gy * GW + gx) * 4
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]
        img.data[i + 3] = 235 * (1 - smooth((Math.sqrt(dmin) - 50) / 110))
      }
    }
    sctx.putImageData(img, 0, 0)
    const ctx = cv.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = '#e4e8e6'; ctx.fill(shape)
    ctx.save(); ctx.clip(shape); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(sc, 0, 0, W, H); ctx.restore()
    ctx.strokeStyle = 'rgba(29,38,35,.45)'; ctx.lineWidth = 1; ctx.stroke(shape)
  }, [live, model, shape, mode])

  if (!data || !model) return <main className="heat"><p className="heat-note">{t('loading', 'Loading…')}</p></main>

  const series = mode === 'delay' ? model.national : model.nationalDelta
  const weekSeries = week ? week.map((w) => (mode === 'delay' ? w.national : w.delta)) : null
  const avgSeries = allAvg ? (mode === 'delay' ? allAvg.national : allAvg.nationalDelta) : null
  const wAll = [...(weekSeries?.flat() ?? [0]), ...(avgSeries ?? [])]
  const wy: [number, number] = mode === 'delay'
    ? [0, Math.max(...wAll) * 1.15]
    : [Math.min(-0.5, Math.min(...wAll) * 1.15), Math.max(0.5, Math.max(...wAll) * 1.15)]
  const peak = series.indexOf(Math.max(...series))
  let calm = 6
  for (let h = 6; h <= 22; h++) if (series[h] < series[calm]) calm = h

  return (
    <main className="heat">
      <header className="heat-head">
        <div>
          <h1>{t('title', 'When is the network late?')}</h1>
          <p>{mode === 'delay'
            ? t('subtitle', 'Average delay across Germany by time of day. Press play or drag along the pulse line.')
            : t('subtitleDelta', 'Where trains pick up or lose delay between two stops. Press play or drag along the pulse line.')}</p>
        </div>
        <span className="heat-date">{data.period}{data.demo ? ` · ${t('demo', 'demo data')}` : ''}</span>
      </header>

      <section className="heat-controls">
        <div className="heat-mode" role="group" aria-label={t('source', 'Data source')}>
          <button aria-pressed={source === 'local'} disabled={local === null} onClick={() => { setSource('local'); setDay(null) }}
            title={local === null ? t('noLocal', 'No /data/heatmap.json found. Run aggregate_heatmap.py first.') : undefined}>{t('srcLocal', 'Local data')}</button>
          <button aria-pressed={source === 'demo'} onClick={() => { setSource('demo'); setDay(null) }}>{t('srcDemo', 'Demo data')}</button>
        </div>
        <div className="heat-mode" role="group" aria-label={t('mode', 'Map mode')}>
          <button aria-pressed={mode === 'delay'} onClick={() => setMode('delay')}>{t('modeDelay', 'Delay level')}</button>
          <button aria-pressed={mode === 'delta'} onClick={() => setMode('delta')}>{t('modeDelta', 'Delay change per trip')}</button>
        </div>
        {week && (
          <div className="heat-mode heat-days" role="group" aria-label={t('day', 'Weekday')}>
            <button aria-pressed={day === null} onClick={() => setDay(null)}>{t('allDays', 'All days')}</button>
            {Array.from({ length: 7 }, (_, d) => <button key={d} aria-pressed={day === d} onClick={() => setDay(d)}><i className="chip" style={{ background: DAY_COLORS[d] }} />{dayName(d)}</button>)}
          </div>
        )}
        <button className="heat-play" onClick={() => setPlaying((p) => !p)} aria-pressed={playing}>
          {playing ? t('pause', 'Pause') : t('play', 'Play day')}
        </button>
        <label>{t('speed', 'Speed')}
          <select value={speed} onChange={(e) => setSpeed(+e.target.value)}>
            <option value={1}>1 h/s</option><option value={2}>2 h/s</option><option value={4}>4 h/s</option>
          </select>
        </label>
        <button onClick={() => { setPlaying(false); setHour(peak) }}>{mode === 'delay' ? t('jumpPeak', 'Jump to worst hour') : t('jumpBuild', 'Jump to biggest build-up')} ({pad(peak)}:00)</button>
        <button onClick={() => { setPlaying(false); setHour(calm) }}>{mode === 'delay' ? t('jumpCalm', 'Jump to calmest daytime hour') : t('jumpRecover', 'Jump to best recovery')} ({pad(calm)}:00)</button>
      </section>

      <div className="heat-monitor">
        <section className="heat-map">
          <div className="heat-mapwrap">
            <canvas ref={canvasRef} style={{ aspectRatio: `${W} / ${H}` }} aria-label={t('mapLabel', 'Delay heatmap of Germany')} role="img" />
            <svg viewBox={`0 0 ${W} ${H}`} className="heat-dots">
              {mode === 'delta' && (
                <g className="heat-flows">
                  {flows.map((f) => {
                    const g = flow(px(f.a.lon, f.a.lat), px(f.b.lon, f.b.lat)), n = f.d / model.dmax, col = dramp(n)
                    return (
                      <g key={`${f.a.stationId}-${f.b.stationId}`} opacity={0.6 + 0.4 * Math.min(1, Math.abs(n))}>
                        <title>{short(f.a.stationName)} → {short(f.b.stationName)}: {sgn(f.d)} min · ~{Math.round(f.trips)} {t('trips', 'trips')}</title>
                        <path className="hit" d={g.d} />
                        <path className="line halo" d={g.d} strokeWidth={2.4 + 2.8 * Math.sqrt(f.trips / maxTrips)} />
                        <path className="line" d={g.d} stroke={col} strokeWidth={1.2 + 2.8 * Math.sqrt(f.trips / maxTrips)} />
                        <polygon points={g.head} fill={col} stroke="rgba(29,38,35,.45)" strokeWidth={0.6} />
                      </g>
                    )
                  })}
                </g>
              )}
              {mode === 'delay'
                ? live.map((s) => { const [x, y] = px(s.lon, s.lat); return <circle key={s.stationId} cx={x} cy={y} r={2.2}><title>{s.stationName}: {s.v.toFixed(1)} min</title></circle> })
                : data.stations.map((s) => { const [x, y] = px(s.lon, s.lat); return <circle key={s.stationId} cx={x} cy={y} r={2}><title>{s.stationName}</title></circle> })}
              {(mode === 'delay' ? worst.slice(0, 3) : gains.slice(0, 3).map((f) => f.b)).map((s) => {
                const [x, y] = px(s.lon, s.lat); return <text key={s.stationId} x={x + 6} y={y - 6}>{short(s.stationName)}</text>
              })}
            </svg>
          </div>
          <div className="heat-legend">
            {mode === 'delay' ? (
              <><span className="lg-title">{t('lgDelay', 'Average delay')}</span><span>0 min</span><i style={{ background: `linear-gradient(90deg, ${YLORBR.join(',')})` }} /><span>{model.vmax}+ min</span></>
            ) : (
              <><span className="lg-title">{t('lgDelta', 'Change in delay')}</span><span>−{model.dmax} min {t('recovered', 'recovered')}</span><i style={{ background: `linear-gradient(90deg, ${NIGHTFALL.join(',')})` }} /><span>+{model.dmax} min {t('builtUp', 'built up')}</span></>
            )}
          </div>
        </section>

        <aside className="heat-side" aria-live="polite">
          <div className="heat-clock">{clock(hour)}</div>
          <div className="heat-day">{day === null ? t('allDays', 'All days') : dayName(day, 'long')}</div>
          <div className="heat-nat">
            <strong>{mode === 'delay' ? nationalNow.toFixed(1) : sgn(deltaNow)}</strong>{' '}
            {mode === 'delay' ? t('natAvg', 'min average delay, all stations') : t('natDelta', 'min delay change per stop-to-stop trip, all trains')}
          </div>
          {mode === 'delay' ? <>
          <h2>{t('worstNow', 'Most delayed right now')}</h2>
          {worst.map((s) => (
            <div className="heat-bar" key={s.stationId}>
              <span>{s.stationName}</span>
              <b>{s.v.toFixed(1)} min</b>
              <i style={{ width: `${Math.min(100, (s.v / model.vmax) * 100)}%`, background: ramp(s.v / model.vmax) }} />
            </div>
          ))}
          </> : model.seg.size === 0 ? (
            <p className="heat-empty">{t('noSegments', 'This dataset has no segment data yet. Add a "segments" list to heatmap.json.')}</p>
          ) : <>
            <h2>{t('gainNow', 'Delay builds up on')}</h2>
            {gains.map((f) => <FlowRow key={`${f.a.stationId}-${f.b.stationId}`} f={f} dmax={model.dmax} />)}
            <h2>{t('recoverNow', 'Delay is recovered on')}</h2>
            {recovers.map((f) => <FlowRow key={`${f.a.stationId}-${f.b.stationId}`} f={f} dmax={model.dmax} />)}
          </>}
        </aside>

        <Pulse series={series} signed={mode === 'delta'} areaColor={day === null ? GREY_FILL : DAY_COLORS[day]} avg={day === null ? null : avgSeries} isAverage={day === null} hour={hour} onScrub={(h) => { setPlaying(false); setHour(h) }} peak={peak} calm={calm} t={t}
          peakLabel={mode === 'delay' ? t('peak', 'peak') : t('buildUp', 'build-up')} calmLabel={mode === 'delay' ? t('calm', 'calm') : t('recovery', 'recovery')} />
        {weekSeries && (
          <section className="heat-week" aria-label={t('weekLabel', 'Every weekday')}>
            {weekSeries.map((ws, d) => {
              const pk = ws.indexOf(Math.max(...ws))
              return (
                <MiniPulse key={d} series={ws} domain={wy} color={DAY_COLORS[d]} avg={avgSeries} hour={hour} selected={day === d} name={dayName(d)}
                  peakText={`${pad(pk)}:00 · ${mode === 'delay' ? ws[pk].toFixed(1) : sgn(ws[pk])} min`}
                  onPick={(h) => { setPlaying(false); setDay(d); setHour(h) }} />
              )
            })}
          </section>
        )}
      </div>
      <p className="heat-note">{mode === 'delay'
        ? t('hint', 'Colours between stations are interpolated and fade out far from any station. Times are Europe/Berlin.')
        : t('hintDelta', 'Each arrow runs from one stop to the next. Colour is the change in delay between the two, line width is the number of trains. Times are Europe/Berlin.')}</p>
    </main>
  )
}

function Pulse({ series, signed, areaColor, avg, isAverage, hour, onScrub, peak, calm, peakLabel, calmLabel, t }: {
  series: number[]; signed: boolean; areaColor: string; avg: number[] | null; isAverage: boolean
  hour: number; onScrub: (h: number) => void; peak: number; calm: number
  peakLabel: string; calmLabel: string; t: (k: string, d: string) => string
}) {
  const CW = 960, CH = 150, m = { l: 40, r: 20, t: 18, b: 26 }
  const x = scaleLinear().domain([0, 24]).range([m.l, CW - m.r])
  const both = [...series, ...(avg ?? [])]
  const ymax = Math.max(signed ? 0.5 : 0, Math.max(...both) * 1.2)
  const ymin = signed ? Math.min(-0.5, Math.min(...both) * 1.2) : 0
  const y = scaleLinear().domain([ymin, ymax]).range([CH - m.b, m.t])
  const pts = series.map((v, i) => [i + 0.5, v] as [number, number])
  const path = line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(pts)!
  const fill = area<[number, number]>().x((p) => x(p[0])).y0(y(0)).y1((p) => y(p[1])).curve(curveMonotoneX)(pts)!
  const avgPath = avg ? line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(avg.map((v, i) => [i + 0.5, v])) : null
  const h0 = Math.floor(hour) % 24, f = hour - Math.floor(hour)
  const nowV = series[h0] + (series[(h0 + 1) % 24] - series[h0]) * f
  const scrub = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onScrub(Math.min(23.99, Math.max(0, x.invert(((e.clientX - r.left) / r.width) * CW))))
  }
  return (
    <section className="heat-pulse">
      <svg viewBox={`0 0 ${CW} ${CH}`} role="slider" aria-label={t('timeSlider', 'Time of day')} aria-valuemin={0} aria-valuemax={24} aria-valuenow={Math.round(hour)}
        tabIndex={0} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e) }}
        onPointerMove={(e) => { if (e.buttons) scrub(e) }}
        onKeyDown={(e) => { if (e.key === 'ArrowRight') onScrub((hour + 0.5) % 24); if (e.key === 'ArrowLeft') onScrub((hour + 23.5) % 24) }}>
        {y.ticks(3).map((v) => <g key={v}><line x1={m.l} x2={CW - m.r} y1={y(v)} y2={y(v)} className="pgrid" /><text x={m.l - 6} y={y(v) + 3} textAnchor="end" className="ptick">{v}m</text></g>)}
        {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => <text key={h} x={x(h)} y={CH - 8} textAnchor="middle" className="ptick">{pad(h % 24)}:00</text>)}
        <path d={fill} className="parea" style={{ fill: areaColor }} />
        {avgPath && <path d={avgPath} className="pavg" />}
        <path d={path} className={isAverage ? 'pline avg' : 'pline'} />
        <text x={x(peak + 0.5)} y={y(series[peak]) - 8} textAnchor="middle" className="plabel">{peakLabel}</text>
        <text x={x(calm + 0.5)} y={y(series[calm]) - 8} textAnchor="middle" className="plabel">{calmLabel}</text>
        <line x1={x(hour)} x2={x(hour)} y1={m.t - 6} y2={CH - m.b} className="phead" />
        <circle cx={x(hour)} cy={y(nowV)} r={5} className="pdot" />
        <circle cx={x(hour)} cy={y(nowV)} r={5} className="pring" />
      </svg>
    </section>
  )
}

function MiniPulse({ series, domain, color, avg, hour, selected, name, peakText, onPick }: {
  series: number[]; domain: [number, number]; color: string; avg: number[] | null; hour: number; selected: boolean; name: string; peakText: string; onPick: (h: number) => void
}) {
  const CW = 220, CH = 84, m = { l: 4, r: 4, t: 8, b: 6 }
  const x = scaleLinear().domain([0, 24]).range([m.l, CW - m.r])
  const y = scaleLinear().domain(domain).range([CH - m.b, m.t])
  const path = line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(series.map((v, i) => [i + 0.5, v]))!
  const base = y(Math.max(domain[0], Math.min(0, domain[1])))
  const fillPath = area<[number, number]>().x((p) => x(p[0])).y0(base).y1((p) => y(p[1])).curve(curveMonotoneX)(series.map((v, i) => [i + 0.5, v]))!
  const avgPath = avg ? line<[number, number]>().x((p) => x(p[0])).y((p) => y(p[1])).curve(curveMonotoneX)(avg.map((v, i) => [i + 0.5, v])) : null
  const h0 = Math.floor(hour) % 24, f = hour - Math.floor(hour)
  const nowV = series[h0] + (series[(h0 + 1) % 24] - series[h0]) * f
  const pick = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    onPick(Math.min(23.99, Math.max(0, x.invert(((e.clientX - r.left) / r.width) * CW))))
  }
  return (
    <figure className={selected ? 'mini on' : 'mini'}>
      <figcaption><b>{name}</b><span>{peakText}</span></figcaption>
      <svg viewBox={`0 0 ${CW} ${CH}`} onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); pick(e) }} onPointerMove={(e) => { if (e.buttons) pick(e) }}>
        {domain[0] < 0 && <line className="pgrid" x1={m.l} x2={CW - m.r} y1={y(0)} y2={y(0)} />}
        <path className="parea" d={fillPath} style={{ fill: color }} />
        {avgPath && <path className="pavg" d={avgPath} />}
        <path className="pline" d={path} />
        <line className="phead" x1={x(hour)} x2={x(hour)} y1={m.t - 4} y2={CH - m.b} />
        <circle className="pdot" cx={x(hour)} cy={y(nowV)} r={3} />
      </svg>
    </figure>
  )
}

function FlowRow({ f, dmax }: { f: Flow; dmax: number }) {
  return (
    <div className="heat-bar">
      <span>{short(f.a.stationName)} → {short(f.b.stationName)}</span>
      <b>{sgn(f.d)} min</b>
      <i style={{ width: `${Math.min(100, (Math.abs(f.d) / dmax) * 100)}%`, background: dramp(f.d / dmax) }} />
    </div>
  )
}

/* ---------- demo data (only used when /data/heatmap.json is missing) ---------- */
function demoData(): Data {
  const S: [string, number, number, number][] = [['Hamburg Hbf', 10.0, 53.55, 1.2], ['Bremen Hbf', 8.81, 53.08, 1], ['Hannover Hbf', 9.74, 52.38, 1.1], ['Berlin Hbf', 13.37, 52.52, 1], ['Leipzig Hbf', 12.38, 51.34, 0.9], ['Dresden Hbf', 13.73, 51.04, 0.8], ['Magdeburg Hbf', 11.63, 52.13, 0.8], ['Rostock Hbf', 12.13, 54.08, 0.7], ['Kiel Hbf', 10.13, 54.32, 0.8], ['Schwerin Hbf', 11.41, 53.63, 0.7], ['Dortmund Hbf', 7.46, 51.52, 1.5], ['Essen Hbf', 7.01, 51.45, 1.5], ['Düsseldorf Hbf', 6.79, 51.22, 1.5], ['Köln Hbf', 6.96, 50.94, 1.7], ['Bonn Hbf', 7.1, 50.73, 1.3], ['Aachen Hbf', 6.09, 50.77, 1.2], ['Münster Hbf', 7.63, 51.96, 1.1], ['Bielefeld Hbf', 8.53, 52.03, 1.2], ['Kassel-Wilhelmshöhe', 9.45, 51.32, 1.1], ['Göttingen', 9.93, 51.54, 1], ['Erfurt Hbf', 11.04, 50.97, 0.9], ['Jena Paradies', 11.58, 50.93, 0.8], ['Fulda', 9.68, 50.55, 1.1], ['Frankfurt(Main)Hbf', 8.66, 50.1, 1.8], ['Mainz Hbf', 8.26, 50.0, 1.3], ['Koblenz Hbf', 7.59, 50.35, 1.2], ['Trier Hbf', 6.65, 49.76, 0.9], ['Saarbrücken Hbf', 7.0, 49.24, 1], ['Mannheim Hbf', 8.47, 49.48, 1.5], ['Karlsruhe Hbf', 8.4, 48.99, 1.3], ['Stuttgart Hbf', 9.18, 48.78, 1.4], ['Freiburg Hbf', 7.84, 47.99, 1], ['Ulm Hbf', 9.98, 48.4, 1.1], ['Augsburg Hbf', 10.88, 48.37, 1], ['München Hbf', 11.56, 48.14, 1.2], ['Nürnberg Hbf', 11.08, 49.45, 1.2], ['Würzburg Hbf', 9.93, 49.8, 1.1], ['Regensburg Hbf', 12.1, 49.01, 0.9], ['Passau Hbf', 13.45, 48.57, 0.8], ['Hof Hbf', 11.92, 50.31, 0.7], ['Konstanz', 9.18, 47.66, 0.7], ['Flensburg', 9.43, 54.77, 0.6], ['Osnabrück Hbf', 8.06, 52.27, 1], ['Oldenburg Hbf', 8.22, 53.14, 0.8], ['Cottbus Hbf', 14.33, 51.76, 0.7], ['Stralsund Hbf', 13.07, 54.31, 0.6], ['Chemnitz Hbf', 12.92, 50.84, 0.7], ['Kaiserslautern Hbf', 7.77, 49.44, 0.9]]
  const profile = [1.5, 1.5, 1, 0.8, 1.2, 2.2, 3, 4.2, 4, 3.2, 3, 3.4, 3.8, 4.2, 4.8, 5.6, 6.5, 7.2, 6.8, 5.8, 5, 4.6, 3.6, 2.4]
  let seed = 11
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const stations = S.map(([stationName, lon, lat], i) => ({ stationId: String(i), stationName, lon, lat }))
  // Friday is the worst day, Saturday the calmest; weekends have a weaker morning rush and Sunday a strong evening return peak.
  const dayMul = (d: number, h: number) => [1, 0.95, 1, 1.1, 1.35, 0.7, 0.9][d] * (d >= 5 && h >= 6 && h <= 9 ? 0.6 : 1) * (d === 6 && h >= 16 && h <= 20 ? 1.3 : 1)
  const hourly = S.flatMap(([, , , f], i) => [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => profile.map((p, hour) => ({
    stationId: String(i), hour, weekday, averageDelayMinutes: p * f * dayMul(weekday, hour) * (0.85 + rnd() * 0.3), delayObservations: Math.round((40 + 120 * f * (hour > 5 ? 1 : 0.2)) / 4),
  }))))
  // Stop-to-stop links; third value = typical delay build-up (min) at the busiest hour, negative = recovery.
  const E: [string, string, number?][] = [['Hamburg', 'Hannover', 0.6], ['Hamburg', 'Bremen', 0.3], ['Hamburg', 'Kiel', 0.1], ['Hamburg', 'Schwerin'], ['Schwerin', 'Rostock'], ['Hamburg', 'Flensburg'],
    ['Bremen', 'Hannover'], ['Bremen', 'Osnabrück'], ['Osnabrück', 'Münster'], ['Münster', 'Dortmund', 0.9], ['Dortmund', 'Essen', 0.8], ['Essen', 'Düsseldorf', 0.9], ['Düsseldorf', 'Köln', 1.1],
    ['Köln', 'Aachen'], ['Köln', 'Bonn'], ['Köln', 'Koblenz', 0.8], ['Koblenz', 'Mainz'], ['Mainz', 'Frankfurt', 0.9], ['Dortmund', 'Bielefeld'], ['Bielefeld', 'Hannover', 0.7],
    ['Hannover', 'Göttingen', 1.3], ['Göttingen', 'Kassel', 0.4], ['Kassel', 'Fulda', -0.5], ['Fulda', 'Frankfurt', 1.2], ['Frankfurt', 'Mannheim', 0.6], ['Mannheim', 'Karlsruhe'],
    ['Karlsruhe', 'Freiburg', -0.3], ['Mannheim', 'Stuttgart', 0.5], ['Stuttgart', 'Ulm', -0.5], ['Ulm', 'Augsburg', 0.2], ['Augsburg', 'München', -0.6], ['Würzburg', 'Nürnberg', 0.3],
    ['Fulda', 'Würzburg', 0.2], ['Nürnberg', 'München', -0.4], ['Nürnberg', 'Regensburg'], ['Regensburg', 'Passau'], ['Hannover', 'Magdeburg', 0.3], ['Magdeburg', 'Berlin', -0.6],
    ['Leipzig', 'Berlin', -0.3], ['Leipzig', 'Magdeburg'], ['Leipzig', 'Dresden', 0.3], ['Leipzig', 'Erfurt', -0.2], ['Erfurt', 'Fulda', 0.4], ['Berlin', 'Cottbus'], ['Hamburg', 'Berlin', -0.4]]
  const idx = (n: string) => String(S.findIndex(([s]) => s.startsWith(n)))
  const segments: Segment[] = []
  for (const [a, b, ef] of E) {
    for (const rev of [false, true]) {
      const base = (ef ?? rnd() * 2 - 0.6) * (rev ? 0.6 : 1) + (rev ? rnd() * 0.4 - 0.2 : 0)
      for (let weekday = 0; weekday < 7; weekday++) for (let hour = 0; hour < 24; hour++) {
        segments.push({
          fromId: idx(rev ? b : a), toId: idx(rev ? a : b), hour, weekday,
          averageDeltaMinutes: base * (profile[hour] / 3.5) * dayMul(weekday, hour) + (rnd() - 0.5) * 0.3,
          trips: Math.round((hour > 4 ? 30 + rnd() * 50 : 4 + rnd() * 8) / 4),
        })
      }
    }
  }
  return { period: '2026-08', stations, hourly, segments, demo: true }
}

export default HeatmapPage
