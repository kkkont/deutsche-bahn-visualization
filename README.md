# Deutsche Bahn Visualization

An interactive map for exploring train delays and cancellations at major German stations. The browser receives a compact monthly JSON aggregate, never the source Parquet files.

## Run the App

Requirements: Node.js 20.19+ and npm.

```sh
cd frontend
npm install
npm run dev
```

Vite prints the local URL (normally `http://localhost:5173`). The bundled `frontend/public/data/demo.json` is generated from a single real source month and is small enough to commit, so the app does not need a backend or a data download to start.

## Refresh the Data

The source has over 230 million rows and about 70 GB of Parquet. Download one month at a time; the default is July 2024, a roughly 108 MB file.

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -e "pipeline[test]"
python -m dbviz_pipeline.aggregate --month 2024-07
```

The command downloads only `monthly_processed_data/data-YYYY-MM.parquet` into ignored `data/raw/`, aggregates it with Polars, and writes the small result to `frontend/public/data/demo.json`. Restart or refresh Vite to see the new month. Other available months can be passed in `YYYY-MM` format. Source timestamps are German local time (`Europe/Berlin`) and are kept as provided.

The first version includes mapped coordinates for a curated set of major hubs. Stations without a known coordinate are deliberately omitted rather than assigned an approximate location. The station and hourly summaries are grouped by train type; filters and station details are computed client-side from those small aggregates.

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

The current view displays a few dozen major stations, so it uses MapLibre markers directly. For a future view with many thousands of geometries, a deck.gl overlay can be added as a separately validated rendering layer.

## Data and Attribution

Train observations come from [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data), published on [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data). The dataset is provided under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) by Deutsche Bahn. The GitHub project requests citation in academic work; see [docs/data-sources.md](docs/data-sources.md).

Rail infrastructure tiles are from [OpenRailwayMap](https://www.openrailwaymap.org/) and [OpenStreetMap](https://www.openstreetmap.org/copyright). A network connection is required for map tiles and fonts.

The [Statista punctuality page](https://www.statista.com/statistics/935040/deutsche-bahn-train-punctuality-germany/) is a cited comparison source only. It is a premium statistic, and its notes say the underlying source has not provided values since January 2024; no values are copied into this project. Its punctuality definition also uses different delay thresholds for local and long-distance services, so it should not be directly equated with the station-level metrics here.

This is an independent university project and is not affiliated with Deutsche Bahn.