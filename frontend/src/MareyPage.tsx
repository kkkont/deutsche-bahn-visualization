import { useEffect, useMemo, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { useTranslation } from 'react-i18next'
import './marey.css'

/* One row = one train stop, using the processed-dataset column names.
   Expected file: /data/marey.json -> { date: string, stops: Stop[] } (one day, one region).
   Without that file the page falls back to generated demo data. */
export type Stop = {
  train_line_ride_id: string
  train_line_station_num: number
  station_name: string
  eva: string
  train_type: string
  train_number: string | number
  arrival_planned_time: string | null
  arrival_change_time: string | null
  departure_planned_time: string | null
  departure_change_time: string | null
  arrival_is_canceled: boolean
  departure_is_canceled: boolean
  is_additional_stop: boolean
  is_replacement_train: boolean
  replaced_train_number: string | number | null
}
type Pt = { y: number; plan: number | null; act: number | null; canceled: boolean; additional: boolean }
type Ride = {
  id: string; label: string; type: string; pts: Pt[]; stops: Stop[]
  allCanceled: boolean; anyCanceled: boolean; replaces: string | number | null; endDelay: number | null
}
type Corridor = { key: string; name: string; stations: { eva: string; name: string }[] }

const M = { top: 34, right: 40, bottom: 12 }
const ROW = 58
const pad = (n: number) => String(n).padStart(2, '0')
const toMin = (s?: string | null) => (s ? new Date(s).getTime() / 60000 : null)
const fmt = (m: number | null) => {
  if (m === null) return '–'
  const d = new Date(m * 60000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const delayColor = (d: number) => (d <= 5 ? '#1f7a6d' : d <= 15 ? '#d89a1b' : '#6a3d9a')

function groupRides(stops: Stop[]) {
  const map = new Map<string, Stop[]>()
  for (const s of stops) map.set(s.train_line_ride_id, [...(map.get(s.train_line_ride_id) ?? []), s])
  for (const list of map.values()) list.sort((a, b) => a.train_line_station_num - b.train_line_station_num)
  return map
}

function buildCorridors(stops: Stop[]): Corridor[] {
  const best = new Map<string, Stop[]>()
  for (const list of groupRides(stops).values()) {
    if (list.length < 2) continue
    const key = [list[0].eva, list[list.length - 1].eva].sort().join('|')
    if (list.length > (best.get(key)?.length ?? 0)) best.set(key, list)
  }
  return [...best.entries()].map(([key, list]) => ({
    key,
    name: `${list[0].station_name} – ${list[list.length - 1].station_name}`,
    stations: list.map((s) => ({ eva: s.eva, name: s.station_name })),
  }))
}

function buildRides(stops: Stop[], corridor: Corridor, type: string): Ride[] {
  const yOf = new Map(corridor.stations.map((s, i) => [s.eva, i]))
  const rides: Ride[] = []
  for (const [id, list] of groupRides(stops)) {
    if (type !== 'all' && list[0].train_type !== type) continue
    const pts: Pt[] = []
    for (const s of list) {
      const y = yOf.get(s.eva)
      if (y === undefined) continue
      const add = s.is_additional_stop
      const mk = (planned: string | null, change: string | null, canceled: boolean) => {
        if (!planned && !change) return
        pts.push({ y, plan: add ? null : toMin(planned), act: canceled ? null : toMin(change ?? planned), canceled, additional: add })
      }
      mk(s.arrival_planned_time, s.arrival_change_time, s.arrival_is_canceled)
      mk(s.departure_planned_time, s.departure_change_time, s.departure_is_canceled)
    }
    if (new Set(pts.map((p) => p.y)).size < 2) continue
    const last = [...pts].reverse().find((p) => p.act !== null && p.plan !== null)
    const rep = list.find((s) => s.is_replacement_train)
    rides.push({
      id, type: list[0].train_type, pts, stops: list,
      label: `${list[0].train_type} ${list[0].train_number}`,
      allCanceled: pts.every((p) => p.canceled),
      anyCanceled: pts.some((p) => p.canceled),
      replaces: rep ? rep.replaced_train_number : null,
      endDelay: last ? last.act! - last.plan! : null,
    })
  }
  return rides
}

function stopStatus(s: Stop, t: (k: string, d: string) => string) {
  if (s.arrival_is_canceled && s.departure_is_canceled) return t('stopCancelled', 'Stop cancelled')
  if (s.arrival_is_canceled) return t('arrCancelled', 'Arrival cancelled')
  if (s.departure_is_canceled) return t('depCancelled', 'Departure cancelled')
  return s.is_additional_stop ? t('additional', 'Additional stop') : ''
}

export function MareyPage() {
  const { t: rawT } = useTranslation('marey')
  const t = (k: string, d: string) => rawT(k, { defaultValue: d })
  const [data, setData] = useState<{ date: string; stops: Stop[]; demo: boolean } | null>(null)
  const [corridorKey, setCorridorKey] = useState('')
  const [type, setType] = useState('all')
  const [showPlanned, setShowPlanned] = useState(true)
  const [pxPerHour, setPxPerHour] = useState(220)
  const [selected, setSelected] = useState('')

  useEffect(() => {
    fetch('/data/marey.json')
      .then((r) => { if (!r.ok) throw new Error(); return r.json() })
      .then((d) => setData({ date: d.date, stops: d.stops, demo: false }))
      .catch(() => setData({ date: '2026-09-14', stops: demoStops(), demo: true }))
  }, [])

  const corridors = useMemo(() => buildCorridors(data?.stops ?? []), [data])
  const corridor = corridors.find((c) => c.key === corridorKey) ?? corridors[0]
  const types = useMemo(() => [...new Set((data?.stops ?? []).map((s) => s.train_type))].sort(), [data])
  const rides = useMemo(() => (data && corridor ? buildRides(data.stops, corridor, type) : []), [data, corridor, type])
  const ride = rides.find((r) => r.id === selected)

  if (!data || !corridor) return <main className="marey"><p className="marey-note">{t('loading', 'Loading…')}</p></main>

  const all = rides.flatMap((r) => r.pts.flatMap((p) => [p.plan, p.act])).filter((v): v is number => v !== null)
  const t0 = Math.floor(Math.min(...all) / 30) * 30
  const t1 = Math.ceil(Math.max(...all) / 30) * 30
  const width = Math.max(600, ((t1 - t0) / 60) * pxPerHour) + M.right
  const height = M.top + (corridor.stations.length - 1) * ROW + M.bottom
  const x = scaleLinear().domain([t0, t1]).range([0, width - M.right])
  const y = (i: number) => M.top + i * ROW
  const ticks: number[] = []
  for (let m = t0; m <= t1; m += 30) ticks.push(m)

  const stats = {
    trains: rides.length,
    cancelled: rides.filter((r) => r.allCanceled).length,
    partial: rides.filter((r) => r.anyCanceled && !r.allCanceled).length,
    extra: rides.filter((r) => r.pts.some((p) => p.additional)).length,
  }

  return (
    <main className="marey">
      <header className="marey-head">
        <div>
          <h1>{t('title', 'Time–distance chart')}</h1>
          <p>{t('subtitle', 'Every line is one train: dashed grey is the timetable, solid is what happened.')}</p>
        </div>
        <span className="marey-date">{data.date}{data.demo ? ` · ${t('demo', 'demo data')}` : ''}</span>
      </header>

      <section className="marey-controls">
        <label>{t('corridor', 'Route')}
          <select value={corridor.key} onChange={(e) => { setCorridorKey(e.target.value); setSelected('') }}>
            {corridors.map((c) => <option key={c.key} value={c.key}>{c.name}</option>)}
          </select>
        </label>
        <label>{t('trainType', 'Train type')}
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="all">{t('all', 'All trains')}</option>
            {types.map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label>{t('zoom', 'Time zoom')}
          <input type="range" min={100} max={600} value={pxPerHour} onChange={(e) => setPxPerHour(+e.target.value)} />
        </label>
        <label className="marey-check">
          <input type="checkbox" checked={showPlanned} onChange={(e) => setShowPlanned(e.target.checked)} />
          {t('showPlanned', 'Show timetable')}
        </label>
      </section>

      <section className="marey-stats">
        <span><strong>{stats.trains}</strong> {t('trains', 'trains')}</span>
        <span className="bad"><strong>{stats.cancelled}</strong> {t('fullCancel', 'fully cancelled')}</span>
        <span className="bad"><strong>{stats.partial}</strong> {t('partCancel', 'with cancelled stops')}</span>
        <span><strong>{stats.extra}</strong> {t('extra', 'with additional stops')}</span>
      </section>

      <div className="marey-legend">
        <span><i className="sw plan" />{t('lgPlan', 'Timetable')}</span>
        <span><i className="sw" style={{ background: delayColor(0) }} />≤ 5 min</span>
        <span><i className="sw" style={{ background: delayColor(10) }} />5–15 min</span>
        <span><i className="sw" style={{ background: delayColor(20) }} />&gt; 15 min</span>
        <span><i className="sw cancel" />{t('lgCancel', 'Cancelled')} ✕</span>
        <span>◆ {t('lgExtra', 'Additional stop')}</span>
        <span>↻ {t('lgReplace', 'Replacement train')}</span>
      </div>

      <div className="marey-scroll">
        <div className="marey-row">
          <svg className="marey-labels" width={170} height={height} role="img" aria-label={t('stations', 'Stations')}>
            {corridor.stations.map((s, i) => (
              <text key={s.eva} x={160} y={y(i) + 4} textAnchor="end">{s.name}</text>
            ))}
          </svg>
          <svg className="marey-plot" width={width} height={height} onClick={() => setSelected('')}>
            {corridor.stations.map((s, i) => <line key={s.eva} className="grid" x1={0} x2={width - M.right} y1={y(i)} y2={y(i)} />)}
            {ticks.map((m) => (
              <g key={m}>
                <line className="grid v" x1={x(m)} x2={x(m)} y1={M.top - 8} y2={height - M.bottom} />
                <text className="tick" x={x(m)} y={M.top - 16} textAnchor="middle">{fmt(m)}</text>
              </g>
            ))}

            {rides.map((r) => {
              const planned = r.pts.filter((p) => p.plan !== null)
              const dim = selected && selected !== r.id
              const first = r.allCanceled ? planned[0] : r.pts.find((p) => p.act !== null)
              const midPt = planned[Math.floor(planned.length / 2)]
              return (
                <g key={r.id} className={dim ? 'ride dim' : 'ride'} onClick={(e) => { e.stopPropagation(); setSelected(r.id === selected ? '' : r.id) }}>
                  <title>{r.label}{r.allCanceled ? ` – ${t('cancelled', 'cancelled')}` : r.endDelay !== null ? ` · ${r.endDelay > 0 ? '+' : ''}${Math.round(r.endDelay)} min` : ''}</title>
                  <polyline className="hit" points={r.pts.map((p) => `${x((p.act ?? p.plan)!)},${y(p.y)}`).join(' ')} />
                  {showPlanned && planned.slice(1).map((b, i) => {
                    const a = planned[i]
                    const cx = a.canceled || b.canceled
                    return <line key={i} className={cx ? 'seg cancel' : 'seg plan'} x1={x(a.plan!)} y1={y(a.y)} x2={x(b.plan!)} y2={y(b.y)} />
                  })}
                  {!showPlanned && r.pts.slice(1).map((b, i) => {
                    const a = r.pts[i]
                    return a.plan !== null && b.plan !== null && (a.canceled || b.canceled) &&
                      <line key={i} className="seg cancel" x1={x(a.plan)} y1={y(a.y)} x2={x(b.plan)} y2={y(b.y)} />
                  })}
                  {r.pts.slice(1).map((b, i) => {
                    const a = r.pts[i]
                    if (a.act === null || b.act === null) return null
                    const d = b.plan !== null ? b.act - b.plan : 0
                    return <line key={i} className="seg act" stroke={delayColor(d)} x1={x(a.act)} y1={y(a.y)} x2={x(b.act)} y2={y(b.y)} />
                  })}
                  {r.pts.map((p, i) => p.canceled && p.plan !== null && (
                    <text key={i} className="x-mark" x={x(p.plan)} y={y(p.y) + 4} textAnchor="middle">✕</text>
                  ))}
                  {r.pts.map((p, i) => p.additional && p.act !== null && (
                    <rect key={i} className="diamond" x={x(p.act) - 4} y={y(p.y) - 4} width={8} height={8} transform={`rotate(45 ${x(p.act)} ${y(p.y)})`} />
                  ))}
                  {first && (first.act ?? first.plan) !== null && (
                    <text className={r.allCanceled ? 'tlabel cancel' : 'tlabel'} x={x((first.act ?? first.plan)!) + 5} y={y(first.y) + (first.y === 0 ? 14 : -7)}>
                      {r.replaces ? '↻ ' : ''}{r.label}{r.allCanceled ? ' ✕' : ''}
                    </text>
                  )}
                  {r.allCanceled && midPt && (
                    <text className="tlabel cancel big" x={x(midPt.plan!) + 6} y={y(midPt.y) - 6}>{t('cancelled', 'cancelled')}</text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      </div>
      <p className="marey-note">{t('hint', 'Station rows are evenly spaced, not to scale. Click a train for its stops.')}</p>

      {ride && (
        <section className="marey-detail">
          <h2>{ride.label}{ride.allCanceled ? ` – ${t('cancelled', 'cancelled')}` : ''}</h2>
          {ride.replaces && <p className="marey-note">↻ {t('replaces', 'Replaces train')} {ride.replaces}</p>}
          <table>
            <thead><tr><th>{t('station', 'Station')}</th><th>{t('arr', 'Arrival')}</th><th>{t('dep', 'Departure')}</th><th>{t('delay', 'Delay')}</th><th /></tr></thead>
            <tbody>
              {ride.stops.map((s) => {
                const ap = toMin(s.arrival_planned_time), aa = toMin(s.arrival_change_time ?? s.arrival_planned_time)
                const dp = toMin(s.departure_planned_time), da = toMin(s.departure_change_time ?? s.departure_planned_time)
                const dl = s.arrival_is_canceled || ap === null || aa === null ? (dp !== null && da !== null && !s.departure_is_canceled ? da - dp : null) : aa - ap
                const st = stopStatus(s, t)
                return (
                  <tr key={s.train_line_station_num} className={st.includes('ancel') ? 'bad' : ''}>
                    <td>{s.station_name}</td>
                    <td>{fmt(ap)}{!s.arrival_is_canceled && aa !== ap && ap !== null ? ` → ${fmt(aa)}` : ''}</td>
                    <td>{fmt(dp)}{!s.departure_is_canceled && da !== dp && dp !== null ? ` → ${fmt(da)}` : ''}</td>
                    <td>{dl === null ? '–' : `${dl > 0 ? '+' : ''}${Math.round(dl)} min`}</td>
                    <td>{st}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </section>
      )}
    </main>
  )
}

/* ---------- demo data (only used when /data/marey.json is missing) ---------- */
const DEMO = [['Hamburg Hbf', '8002549', 0], ['Hannover Hbf', '8000152', 75], ['Göttingen', '8000128', 130],
  ['Kassel-Wilhelmshöhe', '8003200', 160], ['Fulda', '8000115', 200], ['Frankfurt(Main)Hbf', '8000105', 250]] as const

function demoStops(): Stop[] {
  let seed = 7
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647
  const iso = (m: number) => `2026-09-14T${pad(Math.floor(m / 60))}:${pad(m % 60)}:00`
  const out: Stop[] = []
  const specs = Array.from({ length: 15 }, (_, i) => ({ i, south: i % 2 === 0 && i < 14, start: 360 + Math.floor(i / 2) * 60 + (i % 2 ? 25 : 0) }))
  specs[14] = { i: 14, south: false, start: 457 } // replacement for train 593
  for (const { i, south, start } of specs) {
    const seq = south ? [...DEMO] : [...DEMO].reverse()
    const num = south ? 700 + i : 590 + i
    const type = i === 2 ? 'IC' : 'ICE'
    const cancelAll = i === 3
    const termAt = i === 6 ? '8000128' : ''
    let d = Math.floor(rnd() * 4), n = 0, dead = false
    seq.forEach(([name, eva, off], k) => {
      d = Math.max(0, d + Math.round(rnd() * 5 - 2) + (i === 8 && k === 2 ? 22 : 0))
      const o = south ? off : 250 - off
      const planned = !(i === 2 && eva === '8000128') && !(i === 2 && eva === '8003200')
      const add = i === 2 && eva === '8000128'
      if (!planned && !add) return
      const arrC = cancelAll || dead
      const depC = cancelAll || dead || eva === termAt
      if (eva === termAt) dead = true
      const first = k === 0, lastK = k === seq.length - 1
      const arr = start + o, dep = arr + 2
      out.push({
        train_line_ride_id: `r${i}`, train_line_station_num: n++, station_name: name, eva,
        train_type: type, train_number: num,
        arrival_planned_time: first || add ? null : iso(arr),
        arrival_change_time: first || arrC ? null : iso(arr + d),
        departure_planned_time: lastK || add ? null : iso(dep),
        departure_change_time: lastK || depC ? null : iso(dep + d),
        arrival_is_canceled: arrC && !first, departure_is_canceled: depC && !lastK,
        is_additional_stop: add, is_replacement_train: i === 14,
        replaced_train_number: i === 14 ? 593 : null,
      })
      if (add) { const last = out[out.length - 1]; last.arrival_change_time = iso(arr + d); last.departure_change_time = iso(dep + d) }
    })
  }
  return out
}

export default MareyPage
