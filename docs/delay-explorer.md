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

## Verification

From `frontend/`:

```sh
npm run build
npm run lint
node --experimental-strip-types --test tests/delayExplorer.test.ts
```

The focused tests cover weighted aggregation, measured zero versus absent measurements, period bounds, fixture identities and coverage. The test command requires Node.js with TypeScript stripping support (Node 22.6+); Vite itself requires Node 20.19+ or 22.12+.
