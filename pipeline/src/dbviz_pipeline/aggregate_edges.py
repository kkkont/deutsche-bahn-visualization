"""Build station-to-station delay-change edges for the HeatTable.

For every train run we look at the stops in order and, for each pair of
neighbouring stops, compute:

    delay_change = delay at the later stop - delay at the earlier stop

Positive  -> the train lost time on that hop.
Negative  -> the train made time up (recovery).

Pass --stations to restrict the analysis to a chosen set. The hops are then
"neighbouring among the chosen stations", so Berlin -> Hannover is one hop if
no other chosen station lies between them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional, Sequence

import polars as pl

REQUIRED = {
    "station_name", "train_type", "delay_in_min",
    "train_line_ride_id", "train_line_station_num",
}


def aggregate_edges(
    frame: pl.DataFrame,
    stations: Optional[Sequence[str]] = None,
    min_observations: int = 1,
) -> list[dict]:
    missing = REQUIRED - set(frame.columns)
    if missing:
        raise ValueError(f"Source data is missing expected columns: {', '.join(sorted(missing))}")

    # Step 1: keep only the chosen stations and rows that actually have a delay value.
    data = frame.filter(pl.col("delay_in_min").is_not_null())
    if stations:
        data = data.filter(pl.col("station_name").is_in(list(stations)))

    # Step 2: one row per (run, stop). If the source holds separate arrival and
    # departure rows for the same stop, they are averaged into one value.
    per_stop = data.group_by(
        ["train_line_ride_id", "train_line_station_num", "station_name", "train_type"]
    ).agg(pl.col("delay_in_min").mean().alias("delay"))

    # Step 3: within each run, put stops in route order and look one stop ahead.
    ride = pl.col("train_line_ride_id")
    pairs = (
        per_stop.sort(["train_line_ride_id", "train_line_station_num"])
        .with_columns(
            pl.col("station_name").shift(-1).over(ride).alias("to_station"),
            pl.col("delay").shift(-1).over(ride).alias("to_delay"),
        )
        .drop_nulls("to_station")
        .filter(pl.col("station_name") != pl.col("to_station"))
        .with_columns((pl.col("to_delay") - pl.col("delay")).alias("change"))
    )

    # Step 4: average over all runs, per hop and train type.
    grouped = (
        pairs.group_by(["station_name", "to_station", "train_type"])
        .agg(
            pl.len().alias("observations"),
            pl.col("change").mean().round(2).alias("average_change"),
        )
        .filter(pl.col("observations") >= min_observations)
        .sort(["station_name", "to_station", "train_type"])
    )

    return [
        {
            "fromId": row["station_name"],
            "toId": row["to_station"],
            "trainType": row["train_type"] or "Other",
            "observations": row["observations"],
            "averageDelayChange": row["average_change"],
        }
        for row in grouped.iter_rows(named=True)
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("parquet", type=Path, help="Monthly parquet file")
    parser.add_argument("--stations", nargs="*", help="Station names to keep (default: all)")
    parser.add_argument("--min-observations", type=int, default=1)
    parser.add_argument("--output", type=Path, default=Path("edges.json"))
    args = parser.parse_args()

    edges = aggregate_edges(pl.read_parquet(args.parquet), args.stations, args.min_observations)
    args.output.write_text(json.dumps(edges, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {len(edges)} edges to {args.output}")


if __name__ == "__main__":
    main()
