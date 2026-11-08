# Data Sources and Metric Notes

## Deutsche Bahn Train Data

- Project: [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data)
- Monthly Parquet dataset: [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data)
- Dataset attribution: Deutsche Bahn, CC BY 4.0
- Processed schema includes station, EVA identifier, train type, delay in minutes, timestamps, and separate arrival/departure cancellation flags.
- Timestamps are German local time. The source project notes some missing collection hours in selected months; inspect its changelog before comparing periods.

The pipeline reports mean delay over rows with a non-null `delay_in_min`, the share of those measured delays above five minutes, and the share of observed train-stop rows with either arrival or departure marked cancelled. `observations` counts all rows; `delayObservations` counts rows with a measured delay.

The source covered about 130 EVA IDs (major stations) until October 2025 and about 5,300 from November 2025. The app therefore uses only the last 12 months; see the README section "Which Data Is Shown". Covering stations the source does not record would need a different source, such as a collector built on the DB Timetables API.

## Pipeline Structure

```
source (Hugging Face | local Parquet | future API)   pipeline/src/dbviz_pipeline/sources.py
  -> data/raw/                 raw monthly Parquet, ignored, deleted after caching unless --keep-raw
  -> data/processed/YYYY-MM/   summary tables with sums and counts, ignored  (partials.py)
  -> frontend/public/data/     combined JSON for any set of months           (build.py)
```

A source only has to produce a Parquet file per month with the columns in `REQUIRED_COLUMNS` (`eva`, `train_type`, `delay_in_min`, `time`, `arrival_is_canceled`, `departure_is_canceled`). An API-based source would collect responses for a month, map them to those columns, write `data/raw/<source>/data-YYYY-MM.parquet` and return its path; caching and building then work unchanged. Each cached month records its source in `meta.json`.

Cached summaries are small (under 2 MB per month), so a full year can be rebuilt in seconds. Only the frontend JSON is meant to be committed.

## Station Coordinates and Rail Geometry

Station coordinates come from `frontend/public/data/stations.geojson` (derived from [derhuerst/db-stations](https://github.com/derhuerst/db-stations)) and are joined by EVA ID; aliases of the same station are merged. They are not included in the train-stop Parquet schema. `dbviz stations` keeps the busiest 200 stations (`--top`); EVA IDs outside that set or without coordinates are omitted. Rail geometry is displayed from OpenRailwayMap tiles based on OpenStreetMap data; it is a visual network overlay, not a route-delay measurement. Tile attribution is displayed on the map.

## Statista Comparison

The [Statista series](https://www.statista.com/statistics/935040/deutsche-bahn-train-punctuality-germany/) describes the share of punctual passenger trains from January 2019 to October 2025. The page's supplementary note says the source has not supplied values since January 2024, and the chart is premium content. Therefore, this project does not bundle, infer, or scrape that series. The stated definition treats a stop as punctual under a six-minute threshold for local services or a sixteen-minute threshold for long-distance services; this differs from the project's station-level delay summaries.