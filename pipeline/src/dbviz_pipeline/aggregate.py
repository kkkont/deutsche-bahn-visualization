"""Download one monthly source file and produce compact station summaries."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple

import polars as pl
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3]
REPO_ID = "piebro/deutsche-bahn-data"
SOURCE_URL = "https://huggingface.co/datasets/piebro/deutsche-bahn-data"

# Coordinates are explicit: unsupported station labels are omitted rather than guessed.
STATION_COORDINATES = {
    "Berlin Hbf": (52.5251, 13.3694),
    "Hamburg Hbf": (53.5527, 10.0067),
    "München Hbf": (48.1402, 11.5586),
    "Köln Hbf": (50.9430, 6.9589),
    "Frankfurt(Main)Hbf": (50.1071, 8.6638),
    "Frankfurt (Main) Hbf": (50.1071, 8.6638),
    "Hannover Hbf": (52.3765, 9.7412),
    "Leipzig Hbf": (51.3453, 12.3821),
    "Dresden Hbf": (51.0402, 13.7327),
    "Nürnberg Hbf": (49.4455, 11.0827),
    "Stuttgart Hbf": (48.7837, 9.1821),
    "Dortmund Hbf": (51.5178, 7.4592),
    "Düsseldorf Hbf": (51.2194, 6.7941),
    "Bremen Hbf": (53.0830, 8.8130),
    "Bielefeld Hbf": (52.0293, 8.5320),
    "Karlsruhe Hbf": (48.9933, 8.4010),
    "Freiburg(Breisgau) Hbf": (47.9978, 7.8414),
    "Erfurt Hbf": (50.9787, 11.0386),
    "Mannheim Hbf": (49.4796, 8.4698),
    "Essen Hbf": (51.4516, 7.0148),
    "Mainz Hbf": (50.0012, 8.2590),
    "Augsburg Hbf": (48.3655, 10.8863),
    "Kassel-Wilhelmshöhe": (51.3127, 9.4921),
}


def _coordinate_for(name: Optional[str]) -> Optional[Tuple[float, float]]:
    if not name:
        return None
    normalized = name.casefold().replace(" ", "")
    for station, coordinates in STATION_COORDINATES.items():
        if station.casefold().replace(" ", "") in normalized:
            return coordinates
    return None


def aggregate_frame(frame: pl.DataFrame, period: str) -> dict:
    """Aggregate rows with the source schema into the frontend's compact data contract."""
    required = {
        "station_name", "eva", "train_type", "delay_in_min", "time",
        "arrival_is_canceled", "departure_is_canceled",
    }
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Source data is missing expected columns: {', '.join(sorted(missing))}")

    prepared = frame.with_columns(
        pl.col("train_type").fill_null("Other").alias("train_type"),
        (pl.col("arrival_is_canceled") | pl.col("departure_is_canceled")).alias("is_cancelled"),
        pl.col("time").dt.hour().alias("hour"),
    )
    grouped = prepared.group_by(["station_name", "train_type"]).agg(
        pl.len().alias("observations"),
        pl.col("delay_in_min").count().alias("delay_observations"),
        pl.col("delay_in_min").mean().fill_null(0).round(1).alias("average_delay"),
        (pl.col("delay_in_min") > 5).mean().fill_null(0).mul(100).round(1).alias("delayed_over_five"),
        pl.col("is_cancelled").cast(pl.Float64).mean().mul(100).round(1).alias("cancelled_percent"),
        pl.col("eva").drop_nulls().unique().sort().alias("evas"),
    ).sort(["station_name", "train_type"])

    stations = []
    for row in grouped.iter_rows(named=True):
        coordinates = _coordinate_for(row["station_name"])
        if coordinates is None:
            continue
        stations.append({
            "stationName": row["station_name"],
            "stationId": row["station_name"],
            "evas": [str(eva) for eva in row["evas"]],
            "latitude": coordinates[0],
            "longitude": coordinates[1],
            "trainTypes": [row["train_type"]],
            "observations": row["observations"],
            "delayObservations": row["delay_observations"],
            "averageDelayMinutes": row["average_delay"],
            "delayedOverFivePercent": row["delayed_over_five"],
            "cancelledPercent": row["cancelled_percent"] or 0,
        })

    supported_names = list(STATION_COORDINATES)
    hourly_frame = prepared.filter(pl.col("station_name").is_in(supported_names)).group_by(
        ["station_name", "train_type", "hour"]
    ).agg(
        pl.col("delay_in_min").mean().fill_null(0).round(1).alias("averageDelayMinutes"),
        pl.col("delay_in_min").count().alias("delayObservations"),
    ).sort(["station_name", "train_type", "hour"])
    supported_stations = {station["stationId"] for station in stations}
    hourly = [
        {
            "stationId": row["station_name"],
            "trainType": row["train_type"],
            "hour": row["hour"],
            "averageDelayMinutes": row["averageDelayMinutes"],
            "delayObservations": row["delayObservations"],
        }
        for row in hourly_frame.iter_rows(named=True)
        if row["station_name"] in supported_stations and row["hour"] is not None
    ]

    return {
        "period": period,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": SOURCE_URL,
        "stations": stations,
        "hourly": hourly,
    }


def download_and_aggregate(month: str, output: Optional[Path] = None) -> Path:
    try:
        datetime.strptime(month, "%Y-%m")
    except ValueError as error:
        raise ValueError("Month must use YYYY-MM format, for example 2024-07") from error
    source = hf_hub_download(
        repo_id=REPO_ID,
        repo_type="dataset",
        filename=f"monthly_processed_data/data-{month}.parquet",
        local_dir=ROOT / "data" / "raw",
    )
    result = aggregate_frame(pl.read_parquet(source), month)
    if not result["stations"]:
        raise ValueError("No supported major-station rows were found in the selected month")
    destination = output or ROOT / "frontend" / "public" / "data" / "demo.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--month", default="2024-07", help="One source month in YYYY-MM format")
    parser.add_argument("--output", type=Path, help="Optional output JSON path")
    args = parser.parse_args()
    destination = download_and_aggregate(args.month, args.output)
    print(f"Wrote {destination}")


if __name__ == "__main__":
    main()