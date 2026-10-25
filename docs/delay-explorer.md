# Delay explorer MVP

Open the **Delay explorer** tab (`#/explorer`). This page is independent of the original station map, clock, Marey chart and heatmap. Brushing and linking are included on the same branch as the time charts.

## Demo data

`frontend/src/data/delay-explorer-demo.json` is a committed, deterministic fixture for 1–28 July 2024 (four complete Monday–Sunday weeks). All delay values and observation counts are synthetic. Station names and coordinates come from the existing project aggregate; IDs use the first EVA identifier for each station, normalized to seven digits. This is a demo mapping, not a general solution for station complexes or EVA aliases.

Each daily record contains `stationId`, `date`, `totalDelayMinutes` and `delayObservations`. Means use total delay minutes divided by the valid measurement count; rounding happens only for display. Calendar dates are Europe/Berlin dates. UTC arithmetic encodes them without shifting dates into the viewer's timezone.

Regenerate from the repository root with `python3 frontend/scripts/generate-delay-explorer-demo.py`. The script reads the existing `demo.json` for station metadata without modifying it. Changing its station list changes the generated fixture.

Scenarios include low delays at Augsburg, high delays at Frankfurt, an increasing trend at Hamburg, and a shared disruption on 17 July. Dortmund lacks a record for 10 July; Augsburg has a measured zero on 5 July. Karlsruhe has no valid measurements. These patterns do not describe actual station performance.

## Shared state and controls

`DelayExplorerPage` owns selected station IDs, date range, daily/weekly resolution, temporary hovered station and Add to selection mode. `explorationReducer` handles selection, date snapping and resets. `scopeDataset` changes only metadata and the station scope; the fixture and its daily records remain unchanged.

- Clicking a station replaces selection; clicking the sole selected station again clears it.
- Add to selection allows multiple stations and toggles existing members. Shift-, Ctrl- or Meta-click also adds/removes stations.
- Every station dropdown follows the same selection. All stations clears station selection. Several selected stations appear as a combined scope.
- Selecting a hexagon selects its member stations. Cell outlines reflect any selected station in that cell.
- Clear stations preserves dates and resolution. Clear date range preserves stations and resolution. Reset exploration restores all dates, all stations, daily resolution and normal replacement mode.
- The scope summary names selected stations, the active date interval and resolution.

Hover is separate from persistent selection. Hovering a scatter mark gives its station a temporary blue map ring. Leaving the mark removes hover without losing selected outlines. Map hover similarly emphasizes that station's chart marks. Keyboard focus on a chart mark also exposes its details and map emphasis.

## Date brushing

A horizontal D3 brush band below the scatterplot selects calendar dates. On release it snaps to whole dates in daily mode and Monday–Sunday weeks in weekly mode, clipped to available dataset bounds. Start/end date inputs provide the same filtering by keyboard. The brush never filters by delay value. Controlled snapping/resizing does not dispatch further brush events.

Switching daily to weekly expands an existing date interval to its containing weeks. Choosing the entire available period is equivalent to clearing the date filter. The selected interval shades the main chart; outside dates fade but remain visible and inspectable. The chart retains the full calendar timeline and fixed delay-colour domain.

The date interval recomputes all station and hexagon averages, their measurement counts and tooltips, the selection's summary mean, and both simple line comparisons. The timeline is explicitly labelled as full-period context. Map GeoJSON sources update in place so date changes preserve map instances, zoom and pan.

## Station map and hexagons

One circle represents one station, with a fixed Tol YlOrBr 0–20+ minute fill scale and radius determined only by zoom. Hollow circles mean no measurements; measured zero uses the lowest valid fill. Black rings indicate selection, and blue rings temporary hover. Hover and persistent details include the date scope and measured-stop count. Background map colours continue to describe all covered stations for the selected dates, while rings identify the selected population.

The second map has occupied equal-area hexagons with 50 km sides (about 86.6 km across flats), approximately 6,495 km² per cell. The spherical Lambert azimuthal equal-area projection is centred on 10°E, 52°N with mean Earth radius 6,371,008.8 m; this demo grid is not EPSG:3035. Resolution and placement are independent of display zoom. Edges are densified before conversion to GeoJSON. Full cells may extend outside Germany; empty cells are omitted. Hollow dashed cells have no valid measurements. The fixture has 17 occupied cells, two containing multiple stations.

Map tiles need a network connection. Dropdowns, summaries and charts remain usable if tiles fail.

## Scatterplot and aggregate line

Daily mode shows one station-day dot; weekly mode pools raw totals/counts into station-week dots. The fixture has 559 valid daily dots and 80 weekly dots. Dot fill uses YlOrBr, selected outlines and up to three trajectories use Tol Light colours, and grey squares plus a straight-segment line show the weighted group mean.

With no station selection, the grey line combines all measured stations. With selected stations, it combines only those IDs, using raw sums/counts rather than averaging station means. The legend names its scope. Other station dots remain as faded context. At most three station trajectories are connected; larger selections retain highlighted dots and only the selected-group aggregate line.

Missing dates/weeks have explicit null values: no dot and a gap in the corresponding line. Measured zero stays at zero. Weekly marks sit at the midpoint of labelled calendar intervals. No smoothing or jitter is applied.

Hover, tap or focus a mark to inspect its name, period, mean and count. Marks have one keyboard tab stop; arrows move between marks, Home/End go to first/last and Escape dismisses hover details. Axis tick density reduces on narrow screens.

## Directly labelled line comparisons

The weekday chart has seven Mon–Sun lines across ISO week numbers; its grey line pools each calendar week's observations. The week chart has a line for each ISO week across Mon–Sun; its grey line pools each weekday's observations in the selected period.

Both now follow the shared date and station selections. Their dropdowns update the shared selection instead of independently overriding it. Each retains a shared zero-based vertical scale, straight segments, Tol Light series colours and direct end labels. Leader lines separate labels without moving measurements. Missing values break lines; wholly unmeasured selections show a message with controls still available.

## Verification

From `frontend/`:

```sh
npm run build
npm run lint
node --experimental-strip-types --test tests/*.test.ts
```

Tests cover raw-count weighting, missing versus zero, ISO calendar boundaries, line gaps, hexagon geometry, station containment, profile filtering, label spacing, and the complete select/add/brush/change-resolution/clear/reset state sequence. Cross-view tests check that scoped station, hexagon and line-summary counts agree while the scatter timeline retains its full calendar extent. Brush tests prevent inclusive end dates gaining a day after controlled moves.

The test command requires Node.js TypeScript stripping support (22.6+); Vite requires Node 20.19+ or 22.12+.
