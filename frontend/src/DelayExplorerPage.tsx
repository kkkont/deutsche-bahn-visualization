import { useCallback, useMemo, useReducer } from 'react'
import { AverageDelayMap } from './components/AverageDelayMap'
import { HexagonDelayMap } from './components/HexagonDelayMap'
import { DelayTimeline } from './components/DelayTimeline'
import { DelayProfileCharts } from './components/DelayProfileCharts'
import demo from './data/delay-explorer-demo.json'
import { DELAY_COLORS, summarizeStations } from './data/delayExplorer'
import { summarizeHexagons } from './data/delayHexagons'
import { formatTimelinePeriod } from './data/delayTimeline'
import { explorationReducer, initialExploration, scopeDataset } from './data/explorerSelection'
import type { DateInterval } from './data/explorerSelection'
import type { TimeResolution } from './data/delayTimeline'
import './delay-explorer.css'

const number = new Intl.NumberFormat('en-GB')
const fullPeriod = { start: demo.periodStart, end: demo.periodEnd }

export default function DelayExplorerPage() {
  const [state, dispatch] = useReducer(explorationReducer, fullPeriod, initialExploration)
  const scoped = useMemo(() => scopeDataset(demo, state.dateRange), [state.dateRange])
  const stations = useMemo(() => summarizeStations(scoped), [scoped])
  const cells = useMemo(() => summarizeHexagons(scoped), [scoped])
  const selected = stations.filter((station) => state.selectedStationIds.includes(station.stationId))
  const groupRecords = useMemo(() => summarizeStations(scopeDataset(demo, state.dateRange, state.selectedStationIds)), [state.dateRange, state.selectedStationIds])
  const groupCount = groupRecords.reduce((sum, station) => sum + station.delayObservations, 0)
  // Sum raw observations instead of reconstructing sums from station means.
  const groupSum = scoped.daily.filter((row) => row.date >= scoped.periodStart && row.date <= scoped.periodEnd && row.delayObservations > 0
    && (!selected.length || state.selectedStationIds.includes(row.stationId)))
    .reduce((sum, row) => sum + row.totalDelayMinutes, 0)
  const period = `${formatTimelinePeriod(scoped.periodStart, scoped.periodEnd)} ${scoped.periodStart.slice(0, 4)}`
  const selectStation = useCallback((id: string, additive = false) => dispatch({ type: 'station', id, additive }), [])
  const selectStations = useCallback((ids: string[]) => dispatch(ids.length ? { type: 'stations', ids } : { type: 'clear-stations' }), [])
  const hoverStation = useCallback((id: string | null) => dispatch({ type: 'hover', id }), [])
  const changeDates = useCallback((range: DateInterval | null) => dispatch({ type: 'dates', range }), [])
  const changeResolution = useCallback((resolution: TimeResolution) => dispatch({ type: 'resolution', resolution }), [])
  const pickerValue = selected.length > 1 ? '__multiple' : selected[0]?.stationId ?? ''

  return <main className="delay-explorer">
    <header className="explorer-heading">
      <div><p className="explorer-eyebrow">DELAY EXPLORER</p><h1>Where are trains delayed?</h1>
        <p>Select stations, then brush the timeline to compare a chosen period.</p></div>
      <div className="explorer-source"><strong>Synthetic demo data</strong><span>{period} · Europe/Berlin</span></div>
    </header>
    <div className="explorer-scope" role="status" aria-live="polite">
      <strong>{selected.length ? `${selected.length} selected station${selected.length === 1 ? '' : 's'}` : 'All stations'} · {period} · {state.resolution === 'daily' ? 'Daily' : 'Weekly'}</strong>
      {selected.length > 0 && <span>{selected.map((station) => station.stationName).join(' · ')}</span>}
    </div>
    <div className="explorer-toolbar">
      <div className="explorer-station-control">
        <label htmlFor="explorer-station">Select a station</label>
        <select id="explorer-station" value={pickerValue} onChange={(event) => event.target.value ? selectStation(event.target.value) : dispatch({ type: 'clear-stations' })}>
          <option value="">All stations</option>
          {selected.length > 1 && <option value="__multiple" disabled>{selected.length} selected stations</option>}
          {stations.map((station) => <option key={station.stationId} value={station.stationId}>{station.stationName}</option>)}
        </select>
      </div>
      <label className="explorer-add-mode"><input type="checkbox" checked={state.addToSelection} onChange={(event) => dispatch({ type: 'add-mode', enabled: event.target.checked })} />Add to selection</label>
      <button type="button" disabled={!selected.length} onClick={() => dispatch({ type: 'clear-stations' })}>Clear stations</button>
      <button type="button" disabled={!state.dateRange} onClick={() => dispatch({ type: 'clear-dates' })}>Clear date range</button>
      <button type="button" onClick={() => dispatch({ type: 'reset' })}>Reset exploration</button>
    </div>
    <div className="explorer-workspace">
      <AverageDelayMap stations={stations} period={period} selectedStationIds={state.selectedStationIds} hoveredStationId={state.hoveredStationId}
        onSelectStation={selectStation} onHoverStation={hoverStation} />
      <aside className="explorer-details" aria-label="Station details">
        <div aria-live="polite" aria-atomic="true">
          <p className="explorer-eyebrow">{selected.length ? 'SELECTED STATIONS' : 'STATION COMPARISON'}</p>
          <h2>{selected.length === 1 ? selected[0].stationName : selected.length ? `${selected.length} stations selected` : 'Every dot is a station.'}</h2>
          {selected.length ? <>
            <p className={`explorer-value${!groupCount ? ' explorer-value-missing' : ''}`}>{groupCount ? <>{(groupSum / groupCount).toFixed(1)} <span>min</span></> : 'No measurements'}</p>
            <p className="explorer-muted">Observation-weighted mean for this selection</p>
            <dl><div><dt>Measured train stops</dt><dd>{number.format(groupCount)}</dd></div><div><dt>Period</dt><dd>{period}</dd></div></dl>
            <ul className="explorer-cell-stations">{selected.map((station) => <li key={station.stationId}>{station.stationName}{station.averageDelayMinutes === null ? ' · No measurements' : ''}</li>)}</ul>
          </> : <p>Click a station to select it. Enable Add to selection, or Shift-click, to compare several stations.</p>}
        </div>
        <div className="explorer-legend" aria-label="Delay colour legend">
          <h3>Mean delay per observed train stop · minutes</h3>
          <div className="explorer-ramp" style={{ background: `linear-gradient(to right, ${DELAY_COLORS.join(', ')})` }} />
          <div className="explorer-ticks"><span>0</span><span>5</span><span>10</span><span>15</span><span>20+</span></div>
          <p><span className="explorer-hollow" aria-hidden="true" />No measurements</p>
          <p><span className="explorer-selected-mark" aria-hidden="true" />Selected station</p>
          <p className="explorer-muted">Colours show all stations for the chosen dates. Outlines identify your selection; blue rings show temporary hover.</p>
        </div>
      </aside>
    </div>
    <HexagonDelayMap cells={cells} period={period} selectedStationIds={state.selectedStationIds} onSelectStations={selectStations} />
    <DelayTimeline data={demo} resolution={state.resolution} onResolutionChange={changeResolution}
      selectedStationIds={state.selectedStationIds} onSelectStation={selectStation} onClearStations={() => dispatch({ type: 'clear-stations' })}
      hoveredStationId={state.hoveredStationId} onHoverStation={hoverStation} dateRange={state.dateRange} onDateRangeChange={changeDates}
      addToSelection={state.addToSelection} onAddModeChange={(enabled) => dispatch({ type: 'add-mode', enabled })} />
    <DelayProfileCharts data={scoped} selectedStationIds={state.selectedStationIds} onSelectStation={selectStation} onClearStations={() => dispatch({ type: 'clear-stations' })} />
    <footer className="explorer-footer">
      <p>All delay values and observation counts are synthetic scenarios, not claims about these stations. Averages are weighted by measured train-stop counts.</p>
      <p>Station coordinates: existing project dataset · Deutsche Bahn, CC BY 4.0. Colours: <a href="https://tol-colors.readthedocs.io/en/latest/colormaps.html#ylorbr" target="_blank" rel="noreferrer">Tol YlOrBr</a>.</p>
    </footer>
  </main>
}
