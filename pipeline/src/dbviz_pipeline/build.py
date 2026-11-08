"""Combine cached months into the small JSON files the frontend reads."""

from __future__ import annotations

import calendar
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import polars as pl

TIMEZONE = "Europe/Berlin"
STATION_COLUMNS = ["station_id", "station_name", "latitude", "longitude"]


def load_station_lookup(geojson_path: Path) -> pl.DataFrame:
    """One row per EVA ID; several EVAs can belong to the same mapped station."""
    collection = json.loads(geojson_path.read_text(encoding="utf-8"))
    rows = []
    for feature in collection["features"]:
        properties = feature["properties"]
        longitude, latitude = feature["geometry"]["coordinates"]
        for eva in properties.get("evas") or [properties["id"]]:
            rows.append({
                "eva": str(eva).lstrip("0"), "station_id": str(properties["id"]),
                "station_name": properties["name"], "latitude": latitude, "longitude": longitude,
            })
    schema = {"eva": pl.Utf8, "station_id": pl.Utf8, "station_name": pl.Utf8,
              "latitude": pl.Float64, "longitude": pl.Float64}
    return pl.DataFrame(rows, schema=schema).unique("eva", keep="first", maintain_order=True)


def _ratio(numerator: float, denominator: float, scale: float = 1, digits: int = 1) -> Optional[float]:
    return round(numerator / denominator * scale, digits) if denominator else None


def _period(months: Sequence[str]) -> Tuple[str, str]:
    year, month = map(int, months[-1].split("-"))
    return f"{months[0]}-01", f"{months[-1]}-{calendar.monthrange(year, month)[1]:02d}"


def build_outputs(
    tables: Dict[str, pl.DataFrame], stations: pl.DataFrame, months: Sequence[str], source_url: str,
) -> Tuple[Dict[str, dict], List[str]]:
    """Return ``{filename: json}`` and the EVA IDs that are not in ``stations``."""
    months = sorted(months)
    unmapped = sorted(set(tables["station_type"]["eva"].drop_nulls()) - set(stations["eva"]))
    meta = {
        "period": months[0] if len(months) == 1 else f"{months[0]}/{months[-1]}",
        "months": months,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": source_url,
    }
    sums = ["delay_count", "delay_sum"]

    def mapped(name: str) -> pl.DataFrame:
        return tables[name].join(stations, on="eva", how="inner")

    station_types = mapped("station_type").group_by(*STATION_COLUMNS, "train_type").agg(
        pl.col("eva").unique().sort().alias("evas"),
        pl.col("observations", *sums, "over_five_count", "cancelled_count").sum(),
    ).sort("station_name", "train_type")
    station_rows = [{
        "stationName": row["station_name"],
        "stationId": row["station_id"],
        "evas": row["evas"],
        "latitude": row["latitude"],
        "longitude": row["longitude"],
        "trainTypes": [row["train_type"]],
        "observations": row["observations"],
        "delayObservations": row["delay_count"],
        "totalDelayMinutes": row["delay_sum"] or 0,
        "averageDelayMinutes": _ratio(row["delay_sum"], row["delay_count"]) or 0,
        "delayedOverFivePercent": _ratio(row["over_five_count"], row["delay_count"], 100) or 0,
        "cancelledPercent": _ratio(row["cancelled_count"] or 0, row["observations"], 100) or 0,
    } for row in station_types.iter_rows(named=True)]

    station_hours = mapped("station_hour").filter(pl.col("hour").is_not_null()).group_by(
        "station_id", "train_type", "hour",
    ).agg(pl.col(*sums).sum()).sort("station_id", "train_type", "hour")
    hourly = [{
        "stationId": row["station_id"],
        "trainType": row["train_type"],
        "hour": row["hour"],
        "totalDelayMinutes": row["delay_sum"] or 0,
        "averageDelayMinutes": _ratio(row["delay_sum"], row["delay_count"]) or 0,
        "delayObservations": row["delay_count"],
    } for row in station_hours.iter_rows(named=True)]

    # The national clock also counts stations that have no coordinates.
    hours = {row["hour"]: row for row in tables["hour"].filter(pl.col("hour").is_not_null())
             .group_by("hour").agg(pl.col(*sums).sum()).iter_rows(named=True)}
    global_hourly = [{
        "hour": hour,
        "averageDelayMinutes": _ratio(hours[hour]["delay_sum"], hours[hour]["delay_count"], digits=2)
        if hour in hours else None,
        "delayObservations": hours[hour]["delay_count"] if hour in hours else 0,
    } for hour in range(24)]

    days = mapped("station_day").filter(pl.col("date").is_not_null()).group_by("station_id", "date").agg(
        pl.col(*sums).sum(),
    ).sort("station_id", "date")
    explorer_stations = station_types.select(STATION_COLUMNS).unique().sort("station_name")
    period_start, period_end = _period(months)

    return {
        "demo.json": {**meta, "stations": station_rows, "hourly": hourly, "globalHourly": global_hourly},
        "delay-clock.json": {**meta, "timezone": TIMEZONE, "hours": global_hourly},
        "delay-explorer.json": {
            "synthetic": False,
            **meta,
            "periodStart": period_start,
            "periodEnd": period_end,
            "timezone": TIMEZONE,
            "stations": [{
                "stationId": row["station_id"], "stationName": row["station_name"],
                "latitude": row["latitude"], "longitude": row["longitude"],
            } for row in explorer_stations.iter_rows(named=True)],
            "daily": [{
                "stationId": row["station_id"],
                "date": row["date"].isoformat(),
                "totalDelayMinutes": round(row["delay_sum"] or 0, 2),
                "delayObservations": row["delay_count"],
            } for row in days.iter_rows(named=True)],
        },
    }, unmapped


def write_outputs(outputs: Dict[str, dict], out_dir: Path) -> List[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written = []
    for filename, content in outputs.items():
        path = out_dir / filename
        path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
        written.append(path)
    return written
