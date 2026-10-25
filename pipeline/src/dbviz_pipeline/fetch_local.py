"""Download more months plus station coordinates into data/local/ (kept on your machine, git-ignored).

Produces:
  data/local/stations.csv   eva, name, lat, lon, weight   (~all DB stations with an EVA number)
  data/local/trains.parquet slim copy of the chosen months, only the columns the pages need

Example:
  uv run --with polars --with huggingface-hub python fetch_local.py --from 2026-03 --to 2026-08
"""

from __future__ import annotations

import argparse
import json
import urllib.request
from datetime import datetime
from pathlib import Path
from typing import Iterator

import polars as pl
from huggingface_hub import hf_hub_download

ROOT = Path(__file__).resolve().parents[3]  # same layout as aggregate.py
LOCAL = ROOT / "data" / "local"
RAW = ROOT / "data" / "raw"
REPO_ID = "piebro/deutsche-bahn-data"

# Station list computed from DB open data (CC BY 4.0): EVA number + WGS84 coordinates.
# Source: npm package "db-stations" (file data.ndjson). Try a CDN first; if offline, see the message below.
STATION_URLS = [
    "https://cdn.jsdelivr.net/npm/db-stations/data.ndjson",
    "https://unpkg.com/db-stations/data.ndjson",
]

KEEP = [
    "station_name", "eva", "train_type", "train_line_ride_id", "train_line_station_num",
    "arrival_planned_time", "arrival_change_time", "departure_planned_time", "departure_change_time",
    "time", "delay_in_min", "arrival_is_canceled", "departure_is_canceled",
]


def months(start: str, end: str) -> Iterator[str]:
    for value in (start, end):
        datetime.strptime(value, "%Y-%m")
    y, m = map(int, start.split("-"))
    ey, em = map(int, end.split("-"))
    while (y, m) <= (ey, em):
        yield f"{y}-{m:02d}"
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)


def build_stations() -> pl.DataFrame:
    ndjson = LOCAL / "stations.ndjson"
    if not ndjson.exists():
        for url in STATION_URLS:
            try:
                print(f"Downloading stations from {url}")
                with urllib.request.urlopen(url, timeout=120) as response:
                    ndjson.write_bytes(response.read())
                break
            except Exception as error:  # noqa: BLE001 - any network failure -> try next source
                print(f"  failed: {error}")
        else:
            raise SystemExit(
                "Could not download the station list. Offline fallback:\n"
                "  npm pack db-stations && tar -xzf db-stations-*.tgz\n"
                f"  then copy package/data.ndjson to {ndjson}\n"
                "and run this script again."
            )
    rows = []
    for line in ndjson.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        station = json.loads(line)
        location = station.get("location") or {}
        if location.get("latitude") is None or location.get("longitude") is None:
            continue
        rows.append({
            "eva": str(station["id"]),
            "name": station.get("name"),
            "lat": float(location["latitude"]),
            "lon": float(location["longitude"]),
            "weight": station.get("weight"),
        })
    frame = pl.DataFrame(rows, schema_overrides={"weight": pl.Float64})
    frame.write_csv(LOCAL / "stations.csv")
    print(f"Wrote {len(frame)} stations with coordinates to {LOCAL / 'stations.csv'}")
    return frame


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--from", dest="start", required=True, help="first month, YYYY-MM")
    parser.add_argument("--to", dest="end", required=True, help="last month, YYYY-MM")
    parser.add_argument("--all-stations", action="store_true", help="keep stations without known coordinates too")
    parser.add_argument("--output", type=Path, default=LOCAL / "trains.parquet")
    args = parser.parse_args()

    LOCAL.mkdir(parents=True, exist_ok=True)
    stations = build_stations()
    known = None if args.all_stations else stations["eva"].to_list()

    frames = []
    for month in months(args.start, args.end):
        try:
            path = hf_hub_download(
                repo_id=REPO_ID, repo_type="dataset",
                filename=f"monthly_processed_data/data-{month}.parquet", local_dir=RAW,
            )
        except Exception as error:  # noqa: BLE001 - month not published or network problem
            print(f"Skipping {month}: {error}")
            continue
        lf = pl.scan_parquet(path)
        columns = [c for c in KEEP if c in lf.collect_schema().names()]
        lf = lf.select(columns).with_columns(pl.col("eva").cast(pl.Utf8))
        if known is not None:
            lf = lf.filter(pl.col("eva").is_in(known))
        frames.append(lf)
        print(f"Added {month}")

    if not frames:
        raise SystemExit("No months could be downloaded.")
    pl.concat(frames, how="diagonal_relaxed").sink_parquet(args.output)
    print(f"Wrote {args.output} ({args.output.stat().st_size / 1e6:.0f} MB)")


if __name__ == "__main__":
    main()
