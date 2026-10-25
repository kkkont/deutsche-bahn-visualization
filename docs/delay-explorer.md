# Delay explorer MVP

Open the **Delay explorer** tab (`#/explorer`). This page is independent of the existing station map, clock, Marey chart and heatmap.

## Demo data

`frontend/src/data/delay-explorer-demo.json` is a committed, deterministic fixture for 1–28 July 2024 (four complete Monday–Sunday weeks). All delay values and observation counts are synthetic. Station names and coordinates come from the existing project aggregate; IDs use the first EVA identifier for each station, normalized to seven digits. Each station has one identity in the explorer; this is a demo mapping, not a general solution for station complexes or EVA aliases.

Each daily record has `stationId`, `date`, `totalDelayMinutes` and `delayObservations`. Station metadata is separate, so the same fixture can support the next PR's station-day scatterplot. Means use the sum of delay minutes divided by the sum of valid measurement counts, with rounding only for display. Dates are calendar dates in Europe/Berlin; they are not converted through the browser's timezone.

Regenerate from the repository root with `python3 frontend/scripts/generate-delay-explorer-demo.py`. The script reads the existing `demo.json` for station metadata and does not modify it. Changing that input's station list changes the generated fixture.

Deliberate scenarios include consistently low delays at Augsburg, consistently high delays at Frankfurt, an increasing trend at Hamburg, and a shared disruption on 17 July. Dortmund has no record for 10 July; Augsburg has a measured zero on 5 July. Karlsruhe has zero valid measurements throughout and appears hollow. These patterns do not describe actual station performance.

## Map behavior

One MapLibre circle represents one station. Its fill uses a fixed Tol YlOrBr scale from 0 to 20 minutes (20+ clips to the final colour); its radius depends only on zoom. A separate outer ring indicates selection without replacing the fill. Hover details include station name, mean, measurement count and period. Click to select or toggle off; the dropdown and clear button provide keyboard selection. Escape while focused in the map clears selection.

Map tiles require a network connection. The dropdown and station details remain usable if the map fails. Data, styles and components are separate from the existing views. No chart, train-type filtering, date brushing, or cross-view linking is included in this PR.

## Hexagonal comparison

A second map below the station map groups the same fixture into occupied hexagons. The grid has 50 km sides (about 86.6 km across flats), with approximately 6,495 km² per cell. It is constructed in a spherical Lambert azimuthal equal-area projection centred on 10°E, 52°N, using D3 and a mean Earth radius of 6,371,008.8 m. This is a spherical demo grid, not EPSG:3035. Grid placement and resolution are fixed; MapLibre's display zoom never changes cell membership.

Each cell sums raw daily delay minutes and measured observation counts within the fixture's period before dividing. Unmeasured stations do not contribute to the denominator. Occupied cells with no measurements have a hollow, dashed outline; cells without stations are omitted. Full cells are not clipped at Germany's border, so edge cells retain equal area. Polygon edges are densified before conversion back to geographic GeoJSON.

The fixture produces 17 occupied cells, including two with multiple stations. The Ruhr/Rhine cell groups Dortmund, Düsseldorf, Essen and Köln. Hover or click shows the weighted mean, measurement counts, period and included stations; a separate dropdown supports keyboard selection. Cell selection is independent of station selection. Both maps use the same fixed 0–20 minute colour scale.

## Time chart

A station-day scatterplot below both maps uses the same daily fixture. Daily mode is the default: one partially transparent dot represents one station's average on one date, with no horizontal jitter. Dot fill uses the same fixed Tol YlOrBr 0–20+ minute scale as the maps: pale yellow for lower delays and dark brown for higher delays. Values above 20 clip only in colour, not on the y-axis. Thin neutral outlines keep low-delay marks visible. The grey straight-segment line combines delay totals and valid measurement counts across all covered stations. Grey square marks identify its individual values. It is not an unweighted mean of station averages.

The Daily / Weekly buttons switch between calendar dates and Monday–Sunday calendar weeks. Weekly mode pools the raw totals and counts for each station-week and for the overall line; it does not average daily means. Weekly marks sit at the midpoint of the labelled date interval. Partial boundary weeks use their actual included date range. UTC arithmetic encodes calendar dates without converting them to the viewer's local timezone; the underlying fixture dates remain Europe/Berlin calendar dates.

The chart has an independent station selector. Selecting one station dims other station dots, adds a Tol Light blue outline to the selected station's marks and connects its measured values with a thin dashed blue line. Quantitative fill colours are preserved, so station identity and delay magnitude use separate visual channels. The grey all-station line and the y-axis domain are unchanged by highlighting. Selecting Karlsruhe explicitly reports its lack of valid measurements while retaining the overall comparison. Map selections are unaffected; shared selections and brushing remain for PR 3.

Every calendar bucket is retained, even if it has no valid measurements. Missing station values produce no dot and interrupt the selected trajectory; wholly unmeasured dates/weeks interrupt the grey line. Measured zero is a valid point at zero. The fixture produces 559 station-day dots, 80 station-week dots and four weekly aggregate marks.

Hover, tap or focus a mark to inspect its station, date interval, mean and measured-stop count. Squares expose the overall weighted mean with the same details. The chart has one keyboard tab stop for marks; arrow keys move between them, Home/End go to the first/last mark, and Escape dismisses details. Responsive SVG dimensions preserve readable text; tick density reduces on narrow screens. Chart styles are scoped to this component.

## Directly labelled line comparisons

Two simple line charts below the scatterplot follow the hand-drawn comparison idea without introducing hourly mock data:

- The weekday chart has seven Mon–Sun lines, with ISO calendar weeks on the x-axis. Each point is the all-station weighted mean on that particular date. The grey line is the observation-weighted mean for the entire calendar week.
- The week chart has four lines labelled Week 27–Week 30, with Mon–Sun on the x-axis. The grey line pools the measurements for each weekday across the four weeks.

Both use the same zero-based y-axis, Tol Light series colours and straight segments. Labels sit at line ends; short leader lines separate clustered labels without moving the measurements. Hover or keyboard focus highlights a series. Native point tooltips include the date, mean and measurement count. All means are formed from sums and counts, and missing values break lines.

Each line chart has its own station dropdown, defaulting to All stations, with every demo station available. Filtering recomputes both its coloured series and grey reference line for that station. The two line charts retain a shared y-axis domain that adjusts to the values in both scopes, so high-delay station values are never clipped. A station with no measurements displays an explicit message and keeps its selector available. Filters do not change the fixture, the other chart's data, the scatterplot's highlighted station or either map's selection.

## Verification

From `frontend/`:

```sh
npm run build
npm run lint
node --experimental-strip-types --test tests/delayExplorer.test.ts tests/delayHexagons.test.ts tests/delayTimeline.test.ts tests/delayProfiles.test.ts
```

The focused tests cover weighted daily/weekly aggregation, measured zero versus absent measurements, line gaps, calendar week boundaries, fixture identities and coverage, hexagon area, station containment, stable cell membership and observation conservation. The test command requires Node.js with TypeScript stripping support (Node 22.6+); Vite itself requires Node 20.19+ or 22.12+.
