import { useState } from 'react'
import { AverageDelayMap } from './components/AverageDelayMap'
import { HexagonDelayMap } from './components/HexagonDelayMap'
import { DelayTimeline } from './components/DelayTimeline'
import { DelayProfileCharts } from './components/DelayProfileCharts'
import demo from './data/delay-explorer-demo.json'
import { DELAY_COLORS, summarizeStations } from './data/delayExplorer'
import { summarizeHexagons } from './data/delayHexagons'
import './delay-explorer.css'

const stations = summarizeStations(demo)
const cells = summarizeHexagons(demo)
const number = new Intl.NumberFormat('en-GB')
const EXPLORER_PERIOD = '1–28 July 2024'

export default function DelayExplorerPage() {
  const [selectedStationId, setSelectedStationId] = useState<string | null>(null)
  const selected = stations.find((station) => station.stationId === selectedStationId)

  return <main className="delay-explorer">
    <header className="explorer-heading">
      <div>
        <p className="explorer-eyebrow">DELAY EXPLORER</p>
        <h1>Where are trains delayed?</h1>
        <p>Compare average delays at individual stations over four weeks.</p>
      </div>
      <div className="explorer-source">
        <strong>Synthetic demo data</strong>
        <span>{EXPLORER_PERIOD} · Europe/Berlin</span>
      </div>
    </header>

    <div className="explorer-toolbar">
      <div className="explorer-station-control">
        <label htmlFor="explorer-station">Explore a station</label>
        <select id="explorer-station" value={selectedStationId ?? ''}
          onChange={(event) => setSelectedStationId(event.target.value || null)}>
          <option value="">Choose a station</option>
          {stations.map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName}</option>)}
        </select>
      </div>
      <p>{stations.length} stations · {stations.filter((station) => station.averageDelayMinutes !== null).length} with measurements</p>
      <button type="button" disabled={!selectedStationId} onClick={() => setSelectedStationId(null)}>Clear selection</button>
    </div>

    <div className="explorer-workspace">
      <AverageDelayMap stations={stations} period={EXPLORER_PERIOD} selectedStationId={selectedStationId}
        onSelectStation={(id) => setSelectedStationId((current) => current === id ? null : id)} />
      <aside className="explorer-details" aria-label="Station details">
        <div aria-live="polite" aria-atomic="true">
          {selected ? <>
            <p className="explorer-eyebrow">SELECTED STATION</p>
            <h2>{selected.stationName}</h2>
            <p className="explorer-value">{selected.averageDelayMinutes === null ? 'No measurements' : <>{selected.averageDelayMinutes.toFixed(1)} <span>min</span></>}</p>
            <p className="explorer-muted">Mean delay per observed train stop</p>
            <dl>
              <div><dt>Measured train stops</dt><dd>{number.format(selected.delayObservations)}</dd></div>
              <div><dt>Period</dt><dd>{EXPLORER_PERIOD}</dd></div>
              <div><dt>Station ID (EVA)</dt><dd>{selected.stationId}</dd></div>
            </dl>
          </> : <>
            <p className="explorer-eyebrow">STATION COMPARISON</p>
            <h2>Every dot is a station.</h2>
            <p>Select a circle on the map or choose a station above to see its average delay and observation count.</p>
          </>}
        </div>
        <div className="explorer-legend" aria-label="Delay colour legend">
          <h3>Mean delay per observed train stop · minutes</h3>
          <div className="explorer-ramp" style={{ background: `linear-gradient(to right, ${DELAY_COLORS.join(', ')})` }} />
          <div className="explorer-ticks"><span>0</span><span>5</span><span>10</span><span>15</span><span>20+</span></div>
          <p><span className="explorer-hollow" aria-hidden="true" />No measurements</p>
          <p><span className="explorer-selected-mark" aria-hidden="true" />Selected station</p>
          <p className="explorer-muted">Circle size is constant. Darker fill means higher delay; the scale stays fixed.</p>
        </div>
      </aside>
    </div>
    <HexagonDelayMap cells={cells} period={EXPLORER_PERIOD} />
    <DelayTimeline data={demo} />
    <DelayProfileCharts data={demo} />
    <footer className="explorer-footer">
      <p>All delay values and observation counts are synthetic scenarios, not claims about these stations. Averages are weighted by measured train-stop counts.</p>
      <p>Station coordinates: existing project dataset · Deutsche Bahn, CC BY 4.0. Colours: <a href="https://tol-colors.readthedocs.io/en/latest/colormaps.html#ylorbr" target="_blank" rel="noreferrer">Tol YlOrBr</a>.</p>
    </footer>
  </main>
}
