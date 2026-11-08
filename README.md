# Deutsche Bahn Visualization

An interactive map for exploring train delays and cancellations at German stations over the last 12 months. The browser receives compact JSON aggregates, never the source Parquet files.

## Run the App

Requirements: Node.js 20.19+ and npm.

```sh
cd frontend
npm install
npm run dev
```

Vite prints the local URL (normally `http://localhost:5173`). The JSON files in `frontend/public/data/` are generated from real source data and committed, so the app does not need a backend or a data download to start.

## Which Data Is Shown

**Time window: the last 12 months (currently November 2025 – October 2026).** The source changed its coverage in November 2025: before that it recorded about 130 major stations (~2 million measured stops per month), afterwards about 5,300 stations (~15 million per month). Averages that span that change would mix two different station networks and are not comparable, so `build` and `stations` use the 12 most recent cached months by default. Older months can still be built explicitly, e.g. `dbviz build 2024-11..2025-10`.

**Stations: the busiest 200.** The source records ~5,400 stations, but showing all of them crowds the map and makes the detailed files too large for a browser (about 175 MB for daily station values and 46 MB for station × train type × hour). Most of them are small stops with few trains. So:

- `stations.geojson` (map) contains only the 200 stations with the most observations. `build` writes detailed data only for the stations in that file, so `demo.json` and `delay-explorer.json` cover the same 200 (about 3 MB and 7 MB, under 1 MB gzipped).
- `delay-clock.json` still includes every observation, so the national daily rhythm is not biased towards big stations.
- Change the number with `dbviz stations --top N` and then run `dbviz build`; `--top 0` keeps every station.

## Refresh the Data

The source has over 230 million rows and several GB of Parquet (60–380 MB per month), so the pipeline works in two steps:

1. **`ingest`** fetches one month at a time from a *source* and caches small per-month summary tables (sums and counts, under 2 MB per month) in ignored `data/processed/<YYYY-MM>/`.
2. **`build`** combines any set of cached months into the JSON files in `frontend/public/data/`, without touching the raw Parquet again.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e "pipeline[test]"

dbviz ingest 2025-11..2026-10   # download and summarise the last 12 months
dbviz stations                  # update station locations
dbviz build                     # write the JSON files for the app
```

Each downloaded month (60–380 MB) is deleted once its summary is cached, because only the summary is used afterwards; pass `--keep-raw` to keep it. To add a new month later, run `dbviz ingest 2026-11` and then `stations` and `build` again. `dbviz list` shows cached months, and `--source local --local-dir <folder>` ingests Parquet files you already have.

`build` writes `demo.json` (station × train type summaries), `delay-clock.json` (national hourly profile) and `delay-explorer.json` (real station-day totals in the Delay Explorer format). Means are recomputed from summed counts, so combining months is exact. Restart or refresh Vite to see the new data. Source timestamps are German local time (`Europe/Berlin`) and are kept as provided.

Stations are placed by EVA ID using `frontend/public/data/stations.geojson`; stations that are not in it (outside the busiest 200, or without known coordinates) are left off the map rather than given an approximate location. Station and hourly summaries are grouped by train type; filters and station details are computed client-side from those small aggregates.


## Checks

```sh
cd frontend && npm run build
cd .. && .venv/bin/python -m pytest pipeline/tests
```

## Stack

- React and TypeScript with Vite
- MapLibre GL JS for the basemap, OpenRailwayMap tile overlay, and selectable station markers
- D3 scales and shapes for the station's hourly delay profile
- Tailwind CSS and a small project stylesheet
- i18next / react-i18next with English and German resource files
- Python and Polars to turn monthly Parquet into browser-ready JSON

The current view displays 200 stations as a MapLibre GeoJSON circle layer. For a future view with many thousands of geometries, a deck.gl overlay can be added as a separately validated rendering layer.

## Data and Attribution

Train observations come from [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data), published on [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data). The dataset is provided under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by Deutsche Bahn. The GitHub project requests citation in academic work; see [docs/data-sources.md](docs/data-sources.md).

Rail infrastructure tiles are from [OpenRailwayMap](https://www.openrailwaymap.org/) and [OpenStreetMap](https://www.openstreetmap.org/copyright). A network connection is required for map tiles and fonts.

The [Statista punctuality page](https://www.statista.com/statistics/935040/deutsche-bahn-train-punctuality-germany/) is a cited comparison source only. It is a premium statistic, and its notes say the underlying source has not provided values since January 2024; no values are copied into this project. Its punctuality definition also uses different delay thresholds for local and long-distance services, so it should not be directly equated with the station-level metrics here.

This is an independent university project and is not affiliated with Deutsche Bahn.