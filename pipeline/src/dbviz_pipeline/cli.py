"""Command line entry point for preparing and exporting dashboard data."""

from __future__ import annotations

import argparse
from datetime import datetime
from pathlib import Path
from typing import List, Optional, Sequence

import polars as pl

from .build import build_outputs, load_station_lookup, write_outputs
from .partials import cached_months, read_meta, read_months, summarize_month, summarize_weekdays, write_month
from .sources import HuggingFaceSource, LocalParquetSource
from .stations import download_db_stations, stations_geojson, write_geojson

ROOT = Path(__file__).resolve().parents[3]
RAW_DIR = ROOT / "data" / "raw"
PROCESSED_DIR = ROOT / "data" / "processed"
FRONTEND_DATA_DIR = ROOT / "frontend" / "public" / "data"
# The source grew from ~130 to ~5,300 stations in Nov 2025, so older months are not comparable.
DEFAULT_WINDOW_MONTHS = 12
DEFAULT_TOP_STATIONS = 1000
DEFAULT_SETUP_MONTHS = "2025-11..2026-10"


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
        if args.weekdays:
            if month not in done:
                raise SystemExit(f"{month}: ingest the monthly summaries first")
            directory = args.processed_dir / month
            weekday_files = [directory / f"weekday_{name}.parquet" for name in ("station_type", "station_hour")]
            if all(path.is_file() for path in weekday_files) and not args.force:
                print(f"{month}: weekdays already cached, skipping (use --force to redo)")
                continue
            path = source.fetch(month)
            for name, table in summarize_weekdays(pl.scan_parquet(path)).items():
                table.write_parquet(directory / f"weekday_{name}.parquet")
            print(f"{month}: cached weekday summaries from {path}")
            if source.disposable and not args.keep_raw:
                path.unlink()
            continue
        if month in done and not args.force:
            print(f"{month}: already cached, skipping (use --force to redo)")
            continue
        path = source.fetch(month)
        tables = summarize_month(pl.scan_parquet(path))
        rows = int(tables["station_type"]["delay_count"].sum() or 0)
        write_month(args.processed_dir, month, tables, {"source": source.name, "sourceUrl": source.url})
        print(f"{month}: cached {rows:,} measured stops from {path}")
        if source.disposable and not args.keep_raw:
            path.unlink()


def setup(args: argparse.Namespace) -> None:
    months = parse_months(args.months or [DEFAULT_SETUP_MONTHS])
    source = make_source(args)
    for month in months:
        directory = args.processed_dir / month
        needs_month = not (directory / "meta.json").is_file() or any(
            not (directory / f"{name}.parquet").is_file() for name in ("station_type", "station_hour"))
        needs_weekdays = needs_month or any(not (directory / f"weekday_{name}.parquet").is_file()
                             for name in ("station_type", "station_hour"))
        if not needs_month and not needs_weekdays:
            print(f"{month}: using cached summaries")
            continue
        existing_raw = isinstance(source, HuggingFaceSource) and (
            source.raw_dir / "monthly_processed_data" / f"data-{month}.parquet").is_file()
        path = source.fetch(month)
        frame = pl.scan_parquet(path)
        if needs_month:
            write_month(args.processed_dir, month, summarize_month(frame),
                        {"source": source.name, "sourceUrl": source.url})
        if needs_weekdays:
            for name, table in summarize_weekdays(frame).items():
                table.write_parquet(directory / f"weekday_{name}.parquet")
        print(f"{month}: cached monthly and weekday summaries")
        if source.disposable and not args.keep_raw and not existing_raw:
            path.unlink()

    station_path = args.out / "stations.geojson"
    stations(argparse.Namespace(months=months, processed_dir=args.processed_dir, out=station_path, top=args.top))
    for weekdays in (False, True):
        build(argparse.Namespace(months=months, processed_dir=args.processed_dir,
                                 stations=station_path, out=args.out, weekdays=weekdays))


def build(args: argparse.Namespace) -> None:
    months = selected_months(args)
    if args.weekdays:
        missing = [month for month in months if any(
            not (args.processed_dir / month / f"weekday_{name}.parquet").is_file()
            for name in ("station_type", "station_hour"))]
        if missing:
            raise SystemExit(f"Weekday caches missing for {', '.join(missing)}. Run `dbviz ingest --weekdays` first.")
        stations = load_station_lookup(args.stations)
        for month in months:
            tables = {name: pl.read_parquet(args.processed_dir / month / f"weekday_{name}.parquet")
                      for name in ("station_type", "station_hour")}
            for weekday in range(1, 8):
                selected = {name: table.filter(pl.col("weekday") == weekday).drop("weekday")
                            for name, table in tables.items()}
                outputs, _ = build_outputs(selected, stations, [month], read_meta(args.processed_dir, month)["sourceUrl"])
                for path in write_outputs({f"weekdays/{month}/{weekday}.json": outputs["demo.json"]}, args.out):
                    print(f"Wrote {path}")
        return
    tables = read_months(args.processed_dir, months)
    stations = load_station_lookup(args.stations)
    source_url = read_meta(args.processed_dir, months[0])["sourceUrl"]
    outputs, unmapped = build_outputs(tables, stations, months, source_url)
    for month in months:
        monthly_tables = read_months(args.processed_dir, [month])
        monthly_source = read_meta(args.processed_dir, month)["sourceUrl"]
        monthly_outputs, _ = build_outputs(monthly_tables, stations, [month], monthly_source)
        outputs[f"months/{month}.json"] = monthly_outputs["demo.json"]
    print(f"Months {months[0]} to {months[-1]}")
    for path in write_outputs(outputs, args.out):
        print(f"Wrote {path}")
    if unmapped:
        print(f"{len(unmapped)} EVA IDs are not in {args.stations.name} (outside the busiest stations or without "
              "coordinates); they are omitted from the map and its linked charts")


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

    setup_parser = commands.add_parser("setup", help="Fetch and generate all dashboard data")
    setup_parser.add_argument("months", nargs="*", help=f"Defaults to {DEFAULT_SETUP_MONTHS}")
    setup_parser.add_argument("--source", choices=["huggingface", "local"], default="huggingface")
    setup_parser.add_argument("--local-dir", type=Path, help="Folder with data-YYYY-MM.parquet files")
    setup_parser.add_argument("--keep-raw", action="store_true", help="Keep newly downloaded Parquet")
    setup_parser.add_argument("--top", type=int, default=DEFAULT_TOP_STATIONS,
                              help="Busiest stations shown on the map (0 = all)")
    setup_parser.add_argument("--out", type=Path, default=FRONTEND_DATA_DIR)
    setup_parser.set_defaults(run=setup)

    ingest_parser = commands.add_parser("ingest", help="Fetch months and cache their summaries")
    ingest_parser.add_argument("months", nargs="+", help="YYYY-MM or YYYY-MM..YYYY-MM")
    ingest_parser.add_argument("--source", choices=["huggingface", "local"], default="huggingface")
    ingest_parser.add_argument("--local-dir", type=Path, help="Folder with data-YYYY-MM.parquet files")
    ingest_parser.add_argument("--keep-raw", action="store_true", help="Keep downloaded Parquet after caching")
    ingest_parser.add_argument("--force", action="store_true", help="Re-ingest months that are already cached")
    ingest_parser.add_argument("--weekdays", action="store_true", help="Cache weekday summaries separately")
    ingest_parser.set_defaults(run=ingest)

    build_parser = commands.add_parser("build", help="Write frontend JSON from cached months")
    build_parser.add_argument("months", nargs="*", help="Defaults to the latest 12 cached months")
    build_parser.add_argument("--stations", type=Path, default=FRONTEND_DATA_DIR / "stations.geojson",
                              help="Only stations in this file get detailed data")
    build_parser.add_argument("--out", type=Path, default=FRONTEND_DATA_DIR)
    build_parser.add_argument("--weekdays", action="store_true", help="Export local weekday summaries")
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
