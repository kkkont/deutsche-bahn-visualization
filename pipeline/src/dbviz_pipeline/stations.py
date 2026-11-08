"""Build ``stations.geojson`` for the busiest stations seen in the cached months."""

from __future__ import annotations

import io
import json
import tarfile
import urllib.request
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

DB_STATIONS_TARBALL = "https://registry.npmjs.org/db-stations/-/db-stations-5.0.2.tgz"
DB_STATIONS_URL = "https://github.com/derhuerst/db-stations"


def download_db_stations(url: str = DB_STATIONS_TARBALL) -> List[dict]:
    with urllib.request.urlopen(url, timeout=60) as response:
        archive = tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:gz")
    lines = archive.extractfile("package/full.ndjson").read().decode("utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def stations_geojson(records: Iterable[dict], observations: Dict[str, int], months: List[str],
                     observations_source: str, top: Optional[int] = None) -> Tuple[dict, List[str]]:
    """Keep stations whose EVA IDs were observed (only the ``top`` busiest, if set); return unmatched IDs too."""
    by_eva: Dict[str, dict] = {}
    for record in records:
        if record.get("location"):
            for eva in [record["id"], *record.get("additionalIds", [])]:
                by_eva.setdefault(str(eva).lstrip("0"), record)

    evas_by_station: Dict[str, List[str]] = {}
    for eva in sorted(observations):
        if eva in by_eva:
            evas_by_station.setdefault(by_eva[eva]["id"], []).append(eva)
    if top:
        busiest = sorted(evas_by_station, key=lambda station_id: (
            -sum(observations[eva] for eva in evas_by_station[station_id]), station_id))[:top]
        evas_by_station = {station_id: evas_by_station[station_id] for station_id in busiest}
    records_by_id = {record["id"]: record for record in by_eva.values()}
    features = [{
        "type": "Feature",
        "id": station_id,
        "properties": {"id": station_id, "evas": evas, "name": records_by_id[station_id]["name"]},
        "geometry": {"type": "Point", "coordinates": [
            records_by_id[station_id]["location"]["longitude"], records_by_id[station_id]["location"]["latitude"],
        ]},
    } for station_id, evas in sorted(evas_by_station.items(), key=lambda item: records_by_id[item[0]]["name"])]
    unmatched = sorted(set(observations) - set(by_eva))
    return {
        "type": "FeatureCollection",
        "source": DB_STATIONS_URL,
        "observationsSource": observations_source,
        "months": months,
        "topStations": top,
        "datasetStationCount": len(observations),
        "mappedStationIdCount": len(observations) - len(unmatched),
        "unmatchedStationIds": unmatched,
        "attribution": "Deutsche Bahn (DB), CC BY 4.0",
        "license": "https://creativecommons.org/licenses/by/4.0/",
        "coverage": "Only the busiest observed stations (topStations) with known coordinates are displayed.",
        "features": features,
    }, unmatched


def write_geojson(collection: dict, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(collection, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
