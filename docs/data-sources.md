# Data Sources and Metric Notes

## Deutsche Bahn Train Data

- Project: [piebro/deutsche-bahn-data](https://github.com/piebro/deutsche-bahn-data)
- Monthly Parquet dataset: [Hugging Face](https://huggingface.co/datasets/piebro/deutsche-bahn-data)
- Dataset attribution: Deutsche Bahn, CC BY 4.0
- Processed schema includes station, EVA identifier, train type, delay in minutes, timestamps, and separate arrival/departure cancellation flags.
- Timestamps are German local time. The source project notes some missing collection hours in selected months; inspect its changelog before comparing periods.

The pipeline reports mean delay over rows with a non-null `delay_in_min`, the share of those measured delays above five minutes, and the share of observed train-stop rows with either arrival or departure marked cancelled. `observations` counts all rows; `delayObservations` counts rows with a measured delay.

## Station Coordinates and Rail Geometry

Station coordinates are an explicit curated lookup for mapped major hubs. They are not included in the train-stop Parquet schema. Rail geometry is displayed from OpenRailwayMap tiles based on OpenStreetMap data; it is a visual network overlay, not a route-delay measurement. Tile attribution is displayed on the map.

## Statista Comparison

The [Statista series](https://www.statista.com/statistics/935040/deutsche-bahn-train-punctuality-germany/) describes the share of punctual passenger trains from January 2019 to October 2025. The page's supplementary note says the source has not supplied values since January 2024, and the chart is premium content. Therefore, this project does not bundle, infer, or scrape that series. The stated definition treats a stop as punctual under a six-minute threshold for local services or a sixteen-minute threshold for long-distance services; this differs from the project's station-level delay summaries.