# Deutsche Bahn Visualization

A single-page dashboard for exploring delays at German stations over the last 12 months. It combines a binned station map, hourly playback, a linked delay pulse and a 24-hour clock. The browser receives compact JSON aggregates, never the source Parquet files.

## Run the App

Requirements: Node.js 20.19+, npm and Python 3.9+. From the repository root, install the pipeline and generate the data once:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -e "pipeline[test]"
.venv/bin/dbviz setup
```

Setup downloads source data and station coordinates, then generates all dashboard files locally. It may take several minutes and requires several GB of free disk space. Generated data is ignored by Git. Run it again to restore missing files or refresh station coordinates; cached summaries are reused.

Then start the app:

```sh
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173/#/map`. The Station map is the only page. Bare URLs and older bookmarked routes open the map. No backend is needed; map tiles and fonts require a network connection.

For deployment, run data setup before the frontend build and publish the generated files with the app; Git ignoring them does not make a deployed copy private.

## Dashboard

- **Binned map:** Tol YlOrBr represents mean delay on a fixed 0–20+ minute scale. Blue markers identify station locations. Select a bin or station to inspect its details and update both linked charts.
- **Filters:** Search for a station or select one or more service codes; service presets cover the exact codes shown in their labels. Each calendar month combines that month across all available years. Click a month to start a selection, click additional months to add or remove them, and use **All months** to reset. Select a weekday to pool that weekday across the selected months. All three views update together.
- **Zoom-driven bins:** wheel/pinch zoom or the map’s +/− controls change the grid automatically: 50 km sides below zoom 6.5, 10 km from zoom 6.5 to below 9, and 2 km at zoom 9 and above. The active size is always shown above the map and in the legend. Clicking a bin, marker or station-list entry opens details without zooming. **Back to Germany** resets the camera and clears the selection.
- **Playback:** Play day loops through 00–23 at 0.5, 1, 2 or 4 hours per second. Map colours, hourly tooltips and detail counts update without resetting the camera. Changing the hour manually pauses playback; hiding the page also pauses it. The default hour is 12:00. There is one shared playback control; its hour state is visible in the map header, chart cursor and clock.
- **Hourly pulse:** the grey line shows the observation-weighted mean for the map selection. Hover shows only the hour range and delay, to two decimal places. Click, drag, or use arrow/Home/End keys to choose an hour. Missing observations break the line.
- **24-hour clock:** a circular view of the same selected hourly profile, beside the map and below the linear chart. Selecting a clock hour updates the map and pulse.

On desktop, the map occupies the left half of the visualization area. The linear chart and 24-hour clock stack on the right, each occupying one quarter. A common filter band above them holds the filters and playback controls; choose the active hour in either chart. Tablet and phone layouts rearrange the cards. Station details appear as an overlay inside the map. Longer instructions, coverage notes and provenance are available under **Map guidance & data**. English and German labels are supported. Returning to Germany eases over 750 ms; reduced-motion preferences disable that animation and the pulse ring.

### Geographic and temporal limits

Playback is a **typical-day hourly profile pooled across the exported period**, in Europe/Berlin local time. It is not a recorded day or live feed. With no selection, both charts describe the mapped network; selecting a station or bin restricts them to exactly its station IDs.

The grids are independent full-network grids in a spherical Lambert azimuthal equal-area projection centred on 10°E, 52°N. They do not nest and are not clipped to previously selected bins. Full cells have areas of about 6,495 km² at 50 km sides, 260 km² at 10 km sides and 10.4 km² at 2 km sides. Every resolution includes each mapped station exactly once. Empty areas are omitted; hollow bins mean no measured delays, while measured zero remains a valid low-colour value.

Zooming changes geographic grouping, not data coverage or the colour scale. A selected bin retains its geographic area, outline, size label, details and linked hourly profile across zoom levels. When filters change, its station membership updates to match the filtered population. Its stations stay highlighted; the sidebar explains when its selection resolution differs from the visible grid. New bin colours describe all stations in each current cell, while the charts continue to describe the selected group. Click another bin or clear the selection to change that population. Station selections are also preserved when zooming or panning.

Smaller bins do not add observations. Dense cities can still have several stations per 2 km cell; the station list and marker details provide individual values. Panning and zooming alone never filter the linked charts by viewport. The map keeps its Germany viewport constraints at every resolution.

## Data Coverage and Metrics

**Time window:** setup defaults to November 2025–October 2026. The source expanded from about 130 major stations to about 5,300 stations in November 2025. The default window avoids mixing those two networks. A different window can be specified, for example `dbviz setup 2024-11..2025-10`.

**Stations:** setup selects the busiest 1,000 observed stations with known coordinates. The dashboard displays at most 1,000 stations with observations for the active filters, ranked by observed stops. `stations.geojson` defines their canonical EVA identities and positions; `demo.json` contains station/service-type and station/service-type/hour aggregates for that same set. Despite its legacy filename, `demo.json` contains real source data. The linked clock and pulse use the same mapped population rather than a separate national aggregate.

Averages combine delay totals and measured-stop counts across service types, stations and months. Exports include `totalDelayMinutes` in station and station-hour summaries for exact delay aggregation. Full-period observed-stop counts and cancellation/over-five-minute percentages are labelled separately from hourly delay measurements; pooled percentages remain approximate when reconstructed from rounded percentages.

## Refresh the Data

From the repository root, rerun `.venv/bin/dbviz setup` or specify a range such as `.venv/bin/dbviz setup 2025-11..2026-10`. It reuses cached summaries, fetches missing data and rebuilds all exports for the selected window. It does not update cached months automatically if the upstream source changes; use `dbviz ingest --force` and `dbviz ingest --weekdays --force` for those months before running setup again.

The Python pipeline separates ingestion from export:

1. `setup` fetches each month's Parquet and caches monthly and weekday sums and counts under ignored `data/processed/YYYY-MM/` directories.
2. `stations` chooses the busiest stations and writes `frontend/public/data/stations.geojson`.
3. `build` combines the selected cached months into `frontend/public/data/demo.json` and writes each selected month to `frontend/public/data/months/YYYY-MM.json`, without rereading the raw Parquet. Each monthly file has the same dataset shape, with its exact month in `period` and a one-element `months` array. The aggregate's `months` array lists the files for that build; older files from other builds are not removed.

Setup removes newly downloaded source Parquet after caching unless `--keep-raw` is supplied; existing raw files are preserved. `dbviz list` shows cached months. `dbviz setup --source local --local-dir <folder> <months>` uses existing local `data-YYYY-MM.parquet` files without deleting them. Refresh the browser after rebuilding.

Stations outside the configured coverage, or without coordinates, are omitted from the dashboard. See [data sources and metric notes](docs/data-sources.md) for schema, attribution and coverage details.

Weekday files are written to `frontend/public/data/weekdays/` and can be large. Weekdays use the source's local timestamps; rows without a timestamp are excluded.

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
