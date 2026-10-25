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

## Verification

From `frontend/`:

```sh
npm run build
npm run lint
node --experimental-strip-types --test tests/delayExplorer.test.ts tests/delayHexagons.test.ts
```

The focused tests cover weighted aggregation, measured zero versus absent measurements, period bounds, fixture identities and coverage, hexagon area, station containment, stable cell membership and observation conservation. The test command requires Node.js with TypeScript stripping support (Node 22.6+); Vite itself requires Node 20.19+ or 22.12+.
