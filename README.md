# Deutsche Bahn Visualization

A single-page dashboard for exploring delays at German stations over the last 12 months. It combines a binned station map, hourly playback, a linked delay pulse and a 24-hour clock. The browser receives compact JSON aggregates, never the source Parquet files.

## Run the App

Requirements: Node.js 20.19+ and npm.

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173/#/map`. The Station map is the only page. Bare URLs and older bookmarked routes open the map. The generated JSON files are committed, so starting the app does not require a backend or a new data download. Map tiles and fonts require a network connection.

## Dashboard

- **Binned map:** Tol YlOrBr represents mean delay on a fixed 0–20+ minute scale. Blue markers identify station locations. Select a bin or station to inspect its details and update both linked charts.
- **Drill-down:** click through 50 km, 10 km and 2 km hexagons, then inspect individual stations. The right-hand panel provides **Area summary**, **Back one level** and **Back to Germany**. Area summaries frame occupied child bins with padding; their parent boundary can extend beyond the viewport. Zooming alone never changes the bin resolution.
- **Playback:** Play day loops through 00–23 at 0.5, 1, 2 or 4 hours per second. Map colours, hourly tooltips and detail counts update without resetting the camera. Changing the hour manually pauses playback; hiding the page also pauses it. The default hour is 12:00.
- **Hourly pulse:** the grey line shows the observation-weighted mean for the map selection. Hover shows only the hour range and delay, to two decimal places. Click, drag, or use arrow/Home/End keys to choose an hour. Missing observations break the line.
- **24-hour clock:** a circular view of the same selected hourly profile, below the compact map-and-pulse dashboard. Selecting a clock hour updates the map and pulse.

The map, selectors, playback and pulse fit together at 1280 × 720. Smaller or shorter screens use a stacked layout. Longer instructions, coverage notes and provenance are available under **Map guidance & data**. English and German labels are supported. Camera transitions ease over 750 ms; reduced-motion preferences disable those animations and the pulse ring.

### Geographic and temporal limits

Playback is a **typical-day hourly profile pooled across the exported period**, in Europe/Berlin local time. It is not a recorded day or live feed. With no selection, both charts describe the mapped network; selecting a station or bin restricts them to exactly its station IDs.

The three hexagonal grids do not nest. Local cells are clipped to their parent in a spherical Lambert azimuthal equal-area projection centred on 10°E, 52°N. Boundary pieces therefore have smaller areas than full cells (about 6,495 km² at 50 km sides, 260 km² at 10 km sides, and 10.4 km² at 2 km sides). Only the parent's mapped stations contribute. Empty areas are omitted; hollow bins mean no measured delays, while measured zero remains a valid low-colour value.

Smaller bins do not add stations or observations. Dense cities can still have several stations per 2 km cell; station zoom and the station list provide further detail. The map keeps its Germany viewport constraints at every level.

## Data Coverage and Metrics

**Time window:** the last 12 cached months, currently November 2025–October 2026. The source expanded from about 130 major stations to about 5,300 stations in November 2025. The default window avoids mixing those two networks. Older windows can be built explicitly, for example `dbviz build 2024-11..2025-10`.

**Stations:** the busiest 200 observed stations with known coordinates. `stations.geojson` defines their canonical EVA identities and positions; `demo.json` contains station/service-type and station/service-type/hour aggregates for that same set. Despite its legacy filename, `demo.json` contains real source data. The linked clock and pulse use the same mapped population rather than a separate national aggregate. Change coverage with `dbviz stations --top N` followed by `dbviz build`; `--top 0` keeps all matched stations.

Averages combine delay totals and measured-stop counts across service types, stations and months. New exports include `totalDelayMinutes` in station and station-hour summaries. The current committed export predates that field, so the app weights its rounded service-type means and marks the result approximate. A subsequent `dbviz build` supplies exact delay totals. Full-period observed-stop counts and cancellation/over-five-minute percentages are labelled separately from hourly delay measurements; pooled percentages remain approximate when reconstructed from rounded percentages.

## Refresh the Data

The Python pipeline separates ingestion from export:

1. `ingest` fetches one month's Parquet and caches station/service-type and station/service-type/hour sums and counts under ignored `data/processed/YYYY-MM/` directories.
2. `stations` chooses the busiest stations and writes `frontend/public/data/stations.geojson`.
3. `build` combines the selected cached months and writes `frontend/public/data/demo.json`, without rereading the raw Parquet.

Requirements: Python 3.9+. Set up the environment once from the repository root:

```sh
# Option A: uv
uv venv .venv
uv pip install --python .venv/bin/python -e "pipeline[test]"

# Option B: venv + pip
python3 -m venv .venv
.venv/bin/python -m pip install -e "pipeline[test]"
```

An environment created by uv has no pip; use the uv command for that environment. Then run:

```sh
source .venv/bin/activate
dbviz ingest 2025-11..2026-10
dbviz stations
dbviz build
```

Downloaded months are deleted after caching unless `--keep-raw` is supplied. To add another month, ingest it and rerun `stations` and `build`. `dbviz list` shows cached months. `--source local --local-dir <folder>` ingests local `data-YYYY-MM.parquet` files. Existing caches remain usable: only `station_type.parquet` and `station_hour.parquet` are read; extra historical tables are ignored. Refresh the browser after rebuilding.

Stations outside the configured coverage, or without coordinates, are omitted from the dashboard. See [data sources and metric notes](docs/data-sources.md) for schema, attribution and coverage details.

## Checks

From the repository root:

```sh
npm --prefix frontend run build
npm --prefix frontend run lint
node --experimental-strip-types --test frontend/tests/*.test.ts
.venv/bin/python -m pytest pipeline/tests
```

The frontend tests require Node.js with type stripping enabled, such as Node.js 22.12+.

## Stack and Attribution

- React and TypeScript with Vite
- MapLibre GL JS with a CARTO Positron basemap
- D3 for equal-area binning and linked charts
- Tailwind CSS and component styles
- i18next / react-i18next for English and German
- Python and Polars for aggregation

Train observations come from [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data), published on [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data), under CC BY 4.0 by Deutsche Bahn. Station coordinates are derived from [derhuerst/db-stations](https://github.com/derhuerst/db-stations). Basemap attribution is shown on the map. Cite the dataset in academic work as requested by its author.

This is an independent university project and is not affiliated with Deutsche Bahn.
