import { useMemo, useState } from 'react'
import HeatTableD3 from './components/HeatTableD3.tsx'
import { CLASSIC } from './components/colorModel.ts'
import { useEdges } from './components/useEdges.ts'

export default function HeatTablePage() {
  const [months, setMonths] = useState(['2609']) //['2603', '2604', '2605', '2609']
  const { edges, loading, error, failed } = useEdges(months)
  const [trainType, setTrainType] = useState('all')
  const [chosen, setChosen] = useState<string[] | null>(null)
  // ...trainTypes / allStations / stationIds stay exactly as they are...

  if (error) return <main className="app-shell"><p role="alert">No edge file could be loaded.</p></main>


  // Zugtypen und Stationen kommen direkt aus den Daten
  const trainTypes = useMemo(
    () => [...new Set(edges.map((e) => e.trainType ?? 'Other'))].sort(),
    [edges],
  )
  const allStations = useMemo(() => {
    const traffic = new Map<string, number>()
    for (const e of edges) {
      traffic.set(e.fromId, (traffic.get(e.fromId) ?? 0) + e.observations)
      traffic.set(e.toId, (traffic.get(e.toId) ?? 0) + e.observations)
    }
    return [...traffic.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)
  }, [edges])

  // Standard: die 15 meistbefahrenen Stationen
  const stationIds = chosen ?? allStations.slice(0, 15)
  const toggle = (id: string) =>
    setChosen(stationIds.includes(id) ? stationIds.filter((s) => s !== id) : [...stationIds, id])

  if (error) return <main className="app-shell"><p role="alert">edges.json konnte nicht geladen werden.</p></main>

  return (
    <main className="app-shell">
      <h1>Delay Heat Table</h1>

      <label className="control-field">
        <span>Train type</span>
        <select value={trainType} onChange={(e) => setTrainType(e.target.value)}>
          <option value="all">All trains</option>
          {trainTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
      </label>

      <fieldset>
        <legend>Stations</legend>
        {allStations.map((id) => (
          <label key={id} style={{ marginRight: '1rem' }}>
            <input type="checkbox" checked={stationIds.includes(id)} onChange={() => toggle(id)} /> {id}
          </label>
        ))}
      </fieldset>

      <HeatTableD3
            edges={edges}
            stationIds={stationIds}
            trainType={trainType}
            colorModel={CLASSIC}     // ['CLASSIC (±max) , MIN_MAX, EQUALIZED, MIN_MAX_EQUALIZED
            showControls={false}   // same sort and no numbers in all four, so only the colours differ
            sort="outgoing"
      />

    </main>
  )
}