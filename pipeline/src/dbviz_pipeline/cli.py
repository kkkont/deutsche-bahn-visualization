"""Command line entry point: ``dbviz ingest``, ``dbviz stations``, ``dbviz build``, ``dbviz list``."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Sequence

import polars as pl

from .build import build_outputs, load_station_lookup, write_outputs
from .partials import cached_months, read_meta, read_months, summarize_month, write_month
from .sources import HuggingFaceSource, LocalParquetSource
from .stations import download_db_stations, stations_geojson, write_geojson

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
FRONTEND_DATA_DIR = ROOT / "frontend" / "public" / "data"
# The source grew from ~130 to ~5,300 stations in Nov 2025, so older months are not comparable.
DEFAULT_WINDOW_MONTHS = 12
DEFAULT_TOP_STATIONS = 200


def parse_months(specs: Sequence[str]) -> List[str]:
    """Accept ``2024-07`` and inclusive ranges like ``2024-01..2024-06``."""
    months = set()
    for spec in specs:
        start, _, end = spec.partition("..")
        try:
            first = datetime.strptime(start, "%Y-%m")
            last = datetime.strptime(end or start, "%Y-%m")
        except ValueError as error:
            raise SystemExit(f"Invalid month {spec!r}; use YYYY-MM or YYYY-MM..YYYY-MM") from error
        if last < first:
            raise SystemExit(f"Range {spec!r} ends before it starts")
        index = first.year * 12 + first.month - 1
        while index <= last.year * 12 + last.month - 1:
            months.add(f"{index // 12}-{index % 12 + 1:02d}")
            index += 1
    return sorted(months)


def selected_months(args: argparse.Namespace) -> List[str]:
    months = parse_months(args.months) if args.months else cached_months(args.processed_dir)[-DEFAULT_WINDOW_MONTHS:]
    if not months:
        raise SystemExit("No cached months. Run `dbviz ingest <month>` first.")
    return months


def make_source(args: argparse.Namespace):
    if args.source == "local":
        if not args.local_dir:
            raise SystemExit("--local-dir is required with --source local")
        return LocalParquetSource(args.local_dir)
    return HuggingFaceSource(RAW_DIR)


def ingest(args: argparse.Namespace) -> None:
    source = make_source(args)
    done = set(cached_months(args.processed_dir))
    for month in parse_months(args.months):
        if month in done and not args.force:
            print(f"{month}: already cached, skipping (use --force to redo)")
            continue
        path = source.fetch(month)
        tables = summarize_month(pl.scan_parquet(path))
        rows = int(tables["hour"]["delay_count"].sum() or 0)
        write_month(args.processed_dir, month, tables, {"source": source.name, "sourceUrl": source.url})
        print(f"{month}: cached {rows:,} measured stops from {path}")
        if source.disposable and not args.keep_raw:
            path.unlink()


def build(args: argparse.Namespace) -> None:
    months = selected_months(args)
    tables = read_months(args.processed_dir, months)
    stations = load_station_lookup(args.stations)
    source_url = read_meta(args.processed_dir, months[0])["sourceUrl"]
    outputs, unmapped = build_outputs(tables, stations, months, source_url)
    print(f"Months {months[0]} to {months[-1]}")
    for path in write_outputs(outputs, args.out):
        print(f"Wrote {path}")
    if unmapped:
        print(f"{len(unmapped)} EVA IDs are not in {args.stations.name} (outside the busiest stations or without "
              "coordinates); they only count towards the delay clock")


def stations(args: argparse.Namespace) -> None:
    months = selected_months(args)
    counts = read_months(args.processed_dir, months)["station_type"].drop_nulls("eva").group_by("eva").agg(
        pl.col("observations").sum())
    observations = dict(zip(counts["eva"], counts["observations"]))
    source_url = read_meta(args.processed_dir, months[0])["sourceUrl"]
    collection, unmatched = stations_geojson(download_db_stations(), observations, months, source_url, args.top or None)
    write_geojson(collection, args.out)
    print(f"Wrote {len(collection['features'])} stations to {args.out}; {len(unmatched)} EVA IDs have no coordinates")


def list_months(args: argparse.Namespace) -> None:
    for month in cached_months(args.processed_dir):
        meta = read_meta(args.processed_dir, month)
        print(f"{month}  {meta['source']}  {meta['createdAt']}")


def main(argv: Optional[Sequence[str]] = None) -> None:
    parser = argparse.ArgumentParser(prog="dbviz", description=__doc__)
    parser.add_argument("--processed-dir", type=Path, default=PROCESSED_DIR)
    commands = parser.add_subparsers(dest="command", required=True)

    ingest_parser = commands.add_parser("ingest", help="Fetch months and cache their summaries")
    ingest_parser.add_argument("months", nargs="+", help="YYYY-MM or YYYY-MM..YYYY-MM")
    ingest_parser.add_argument("--source", choices=["huggingface", "local"], default="huggingface")
    ingest_parser.add_argument("--local-dir", type=Path, help="Folder with data-YYYY-MM.parquet files")
    ingest_parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded Parquet after caching")
    ingest_parser.add_argument("--force", action="store_true", help="Re-ingest months that are already cached")
    ingest_parser.set_defaults(run=ingest)

    build_parser = commands.add_parser("build", help="Write frontend JSON from cached months")
    build_parser.add_argument("months", nargs="*", help="Defaults to the latest 12 cached months")
    build_parser.add_argument("--stations", type=Path, default=FRONTEND_DATA_DIR / "stations.geojson",
                              help="Only stations in this file get detailed data")
    build_parser.add_argument("--out", type=Path, default=FRONTEND_DATA_DIR)
    build_parser.set_defaults(run=build)

    stations_parser = commands.add_parser("stations", help="Regenerate stations.geojson for cached months")
    stations_parser.add_argument("months", nargs="*", help="Defaults to the latest 12 cached months")
    stations_parser.add_argument("--out", type=Path, default=FRONTEND_DATA_DIR / "stations.geojson")
    stations_parser.add_argument("--top", type=int, default=DEFAULT_TOP_STATIONS,
                                 help="Busiest stations shown on the map (0 = all)")
    stations_parser.set_defaults(run=stations)

    list_parser = commands.add_parser("list", help="Show cached months")
    list_parser.set_defaults(run=list_months)

    args = parser.parse_args(argv)
    args.run(args)


if __name__ == "__main__":
    main()
