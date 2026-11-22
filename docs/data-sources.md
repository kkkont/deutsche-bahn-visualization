# Data Sources and Metric Notes

## Deutsche Bahn Train Data

- Project: [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data)
- Monthly Parquet dataset: [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data)
- Dataset attribution: Deutsche Bahn, CC BY 4.0
- Processed schema includes station, EVA identifier, train type, delay in minutes, timestamps, and separate arrival/departure cancellation flags.
- Timestamps are German local time. The source project notes some missing collection hours in selected months; inspect its changelog before comparing periods.

The pipeline reports mean delay over rows with a non-null `delay_in_min`, the share of those measured delays above five minutes, and the share of observed train-stop rows with either arrival or departure marked cancelled. `observations` counts all rows; `delayObservations` counts rows with a measured delay.

The source covered about 130 EVA IDs (major stations) until October 2025 and about 5,300 from November 2025. The default export therefore uses the last 12 cached months; see the README section "Data Coverage and Metrics". Covering stations the source does not record would need a different source, such as a collector built on the DB Timetables API.

## Pipeline Structure

```
source (Hugging Face | local Parquet | future API)   pipeline/src/dbviz_pipeline/sources.py
  -> data/raw/                 raw monthly Parquet, ignored, deleted after caching unless --keep-raw
  -> data/processed/YYYY-MM/   summary tables with sums and counts, ignored  (partials.py)
  -> frontend/public/data/     combined JSON for any set of months           (build.py)
```

A source only has to produce a Parquet file per month with the columns in `REQUIRED_COLUMNS` (`eva`, `train_type`, `delay_in_min`, `time`, `arrival_is_canceled`, `departure_is_canceled`). An API-based source would collect responses for a month, map them to those columns, write `data/raw/<source>/data-YYYY-MM.parquet` and return its path; caching and building then work unchanged. Each cached month records its source in `meta.json`.

The cache retains station/service-type and station/service-type/hour sums and counts. `build` writes the selected period aggregate to `demo.json` and a Dataset-shaped file for each selected month to `months/YYYY-MM.json`. Monthly files contain only that month's observations, `period: "YYYY-MM"`, and `months: ["YYYY-MM"]`; the aggregate's `months` lists the selection. Old monthly files outside the selection are left intact and are not listed in the aggregate. `stations` writes `stations.geojson`. The map, pulse and clock use these same mapped-station aggregates. Existing cached months can be reused; extra tables from older pipeline versions are ignored. Only the frontend JSON and GeoJSON are meant to be committed.

## Station Coordinates and Rail Geometry

Station coordinates come from `frontend/public/data/stations.geojson` (derived from [derhuerst/db-stations](https://github.com/derhuerst/db-stations)) and are joined by EVA ID; aliases of the same station are merged. They are not included in the train-stop Parquet schema. `dbviz stations` keeps the busiest 1,000 stations by observations across the selected months; `--top 0` retains all matched stations. EVA IDs outside that set or without coordinates are omitted. The committed November 2025–October 2026 export contains 1,000 mapped stations; 32 of 5,447 observed EVA IDs had no coordinate match, and 4,402 EVA IDs were omitted in total after the station limit. The CARTO Positron basemap uses OpenStreetMap data; it is geographic context, not a route-delay measurement. Attribution is displayed on the map.
