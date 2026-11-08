"""Per-month summary tables cached in ``data/processed/<YYYY-MM>/``.

Tables hold sums and counts rather than means, so any set of months can be
combined exactly later without re-reading the raw Parquet.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Iterable, List

import polars as pl

from .sources import REQUIRED_COLUMNS

TABLES = ("station_type", "station_hour", "station_day", "hour")


def normalize_eva(column: pl.Expr) -> pl.Expr:
    """EVA IDs appear both as ``08000013`` and ``8000013`` depending on the source."""
    return column.cast(pl.Utf8).str.strip_chars_start("0")


def summarize_month(frame: pl.LazyFrame) -> Dict[str, pl.DataFrame]:
    missing = set(REQUIRED_COLUMNS) - set(frame.collect_schema().names())
    if missing:
        raise ValueError(f"Source data is missing expected columns: {', '.join(sorted(missing))}")

    prepared = frame.select(
        normalize_eva(pl.col("eva")).alias("eva"),
        pl.col("train_type").fill_null("Other"),
        pl.col("delay_in_min").cast(pl.Float64).alias("delay"),
        (pl.col("arrival_is_canceled") | pl.col("departure_is_canceled")).alias("cancelled"),
        pl.col("time").dt.hour().alias("hour"),
        pl.col("time").dt.date().alias("date"),
    )
    delay = [pl.col("delay").count().alias("delay_count"), pl.col("delay").sum().alias("delay_sum")]
    queries = [
        prepared.group_by("eva", "train_type").agg(
            pl.len().alias("observations"),
            *delay,
            (pl.col("delay") > 5).sum().alias("over_five_count"),
            pl.col("cancelled").sum().alias("cancelled_count"),
        ),
        prepared.group_by("eva", "train_type", "hour").agg(*delay),
        prepared.group_by("eva", "date").agg(*delay),
        prepared.group_by("hour").agg(*delay),
    ]
    return dict(zip(TABLES, pl.collect_all(queries)))


def write_month(processed_dir: Path, month: str, tables: Dict[str, pl.DataFrame], source: dict) -> Path:
    directory = processed_dir / month
    directory.mkdir(parents=True, exist_ok=True)
    for name, table in tables.items():
        table.write_parquet(directory / f"{name}.parquet")
    meta = {"month": month, "createdAt": datetime.now(timezone.utc).isoformat(), **source}
    (directory / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return directory


def cached_months(processed_dir: Path) -> List[str]:
    if not processed_dir.is_dir():
        return []
    return sorted(path.parent.name for path in processed_dir.glob("*/meta.json"))


def read_months(processed_dir: Path, months: Iterable[str]) -> Dict[str, pl.DataFrame]:
    months = list(months)
    missing = [month for month in months if not (processed_dir / month / "meta.json").is_file()]
    if missing:
        raise FileNotFoundError(f"Months not ingested yet: {', '.join(missing)}. Run `dbviz ingest` first.")
    return {
        name: pl.concat([pl.read_parquet(processed_dir / month / f"{name}.parquet") for month in months])
        for name in TABLES
    }


def read_meta(processed_dir: Path, month: str) -> dict:
    return json.loads((processed_dir / month / "meta.json").read_text(encoding="utf-8"))
