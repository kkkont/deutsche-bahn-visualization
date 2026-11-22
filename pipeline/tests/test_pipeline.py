import json
from datetime import datetime

import polars as pl
import pytest

from dbviz_pipeline.build import build_outputs, load_station_lookup
from dbviz_pipeline.cli import main, parse_months
from dbviz_pipeline.partials import summarize_month
from dbviz_pipeline.stations import stations_geojson

STATIONS = {
    "type": "FeatureCollection",
    "features": [
        {"type": "Feature", "id": "8011160", "geometry": {"type": "Point", "coordinates": [13.3694, 52.5251]},
         "properties": {"id": "8011160", "evas": ["8011160", "8098160"], "name": "Berlin Hbf"}},
        {"type": "Feature", "id": "8000261", "geometry": {"type": "Point", "coordinates": [11.5586, 48.1402]},
         "properties": {"id": "8000261", "evas": ["8000261"], "name": "München Hbf"}},
    ],
}


@pytest.fixture
def stations(tmp_path):
    path = tmp_path / "stations.geojson"
    path.write_text(json.dumps(STATIONS), encoding="utf-8")
    return load_station_lookup(path)


def rows(eva, delays, times, train_type="ICE", departure_cancelled=None):
    return pl.DataFrame({
        "eva": [eva] * len(delays),
        "train_type": [train_type] * len(delays),
        "delay_in_min": delays,
        "time": times,
        "arrival_is_canceled": [False] * len(delays),
        "departure_is_canceled": departure_cancelled or [False] * len(delays),
    }, schema_overrides={"delay_in_min": pl.Int32})


def build(frames, stations, months=("2024-07",)):
    tables = [summarize_month(frame.lazy()) for frame in frames]
    combined = {name: pl.concat([table[name] for table in tables]) for name in tables[0]}
    return build_outputs(combined, stations, list(months), "https://example.test")


def test_summarizes_station_and_hour(stations):
    frame = rows("08011160", [2, 12], [datetime(2024, 7, 1, 8), datetime(2024, 7, 1, 9)],
                 departure_cancelled=[False, True])
    outputs, _ = build([frame], stations)
    assert set(outputs) == {"demo.json"}
    result = outputs["demo.json"]
    assert set(result) == {"period", "months", "generatedAt", "source", "stations", "hourly"}

    assert len(result["stations"]) == 1
    station = result["stations"][0]
    assert station["stationName"] == "Berlin Hbf"
    assert station["stationId"] == "8011160"
    assert station["observations"] == 2
    assert station["delayObservations"] == 2
    assert station["averageDelayMinutes"] == 7
    assert station["totalDelayMinutes"] == 14
    assert station["delayedOverFivePercent"] == 50
    assert station["cancelledPercent"] == 50
    assert [point["hour"] for point in result["hourly"]] == [8, 9]
    assert [point["delayObservations"] for point in result["hourly"]] == [1, 1]
    assert [point["totalDelayMinutes"] for point in result["hourly"]] == [2, 12]


def test_alias_evas_merge_into_one_station(stations):
    frame = pl.concat([
        rows("8011160", [10], [datetime(2024, 7, 1, 8)]),
        rows("08098160", [0], [datetime(2024, 7, 1, 8)]),
    ])
    station, = build([frame], stations)[0]["demo.json"]["stations"]

    assert station["evas"] == ["8011160", "8098160"]
    assert station["averageDelayMinutes"] == 5


def test_reports_and_omits_stations_without_coordinates(stations):
    frame = rows("0000001", [1], [datetime(2024, 7, 1, 8)])
    outputs, unmapped = build([frame], stations)

    assert outputs["demo.json"]["stations"] == []
    assert outputs["demo.json"]["hourly"] == []
    assert unmapped == ["1"]


def test_months_combine_by_observation_weight_not_by_monthly_means(stations):
    june = rows("8011160", [10], [datetime(2024, 6, 30, 8)])
    july = rows("8011160", [0, 0, 0, 2], [datetime(2024, 7, 1, 8)] * 4)
    outputs, _ = build([june, july], stations, months=["2024-07", "2024-06"])

    assert outputs["demo.json"]["stations"][0]["averageDelayMinutes"] == 2.4
    assert outputs["demo.json"]["stations"][0]["totalDelayMinutes"] == 12
    assert outputs["demo.json"]["months"] == ["2024-06", "2024-07"]
    assert outputs["demo.json"]["period"] == "2024-06/2024-07"
    assert outputs["demo.json"]["hourly"][0]["averageDelayMinutes"] == 2.4
    assert outputs["demo.json"]["hourly"][0]["totalDelayMinutes"] == 12


def test_stations_geojson_keeps_observed_evas_and_merges_aliases():
    records = [
        {"id": "8011160", "additionalIds": ["8098160"], "name": "Berlin Hbf",
         "location": {"latitude": 52.5, "longitude": 13.4}},
        {"id": "8000261", "additionalIds": [], "name": "München Hbf",
         "location": {"latitude": 48.1, "longitude": 11.6}},
    ]
    collection, unmatched = stations_geojson(records, {"8011160": 5, "8098160": 1, "8000261": 4, "42": 9},
                                             ["2024-07"], "x", top=1)

    assert [feature["properties"] for feature in collection["features"]] == [
        {"id": "8011160", "evas": ["8011160", "8098160"], "name": "Berlin Hbf"},
    ]
    assert collection["features"][0]["geometry"]["coordinates"] == [13.4, 52.5]
    assert unmatched == ["42"]
    all_stations, _ = stations_geojson(records, {"8011160": 5, "8000261": 4}, ["2024-07"], "x")
    assert len(all_stations["features"]) == 2
    assert all_stations["coverage"].startswith("All observed")


def test_parse_months_expands_ranges_across_years():
    assert parse_months(["2023-11..2024-02", "2024-01"]) == ["2023-11", "2023-12", "2024-01", "2024-02"]
    with pytest.raises(SystemExit):
        parse_months(["2024-13"])


def test_ingest_local_files_then_build(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    rows("08000261", [4], [datetime(2024, 7, 2, 10)]).write_parquet(raw / "data-2024-07.parquet")
    (tmp_path / "stations.geojson").write_text(json.dumps(STATIONS), encoding="utf-8")
    processed, out = tmp_path / "processed", tmp_path / "out"

    main(["--processed-dir", str(processed), "ingest", "2024-07", "--source", "local", "--local-dir", str(raw)])
    assert {path.stem for path in (processed / "2024-07").glob("*.parquet")} == {"station_type", "station_hour"}
    # Existing caches may have additional tables; rebuilding must not require reading them.
    (processed / "2024-07" / "obsolete.parquet").write_bytes(b"old unused cache table")
    main(["--processed-dir", str(processed), "build", "--stations", str(tmp_path / "stations.geojson"), "--out", str(out)])

    assert (raw / "data-2024-07.parquet").exists()
    result = json.loads((out / "demo.json").read_text(encoding="utf-8"))
    assert result["hourly"] == [{"stationId": "8000261", "trainType": "ICE", "hour": 10,
                                  "totalDelayMinutes": 4, "averageDelayMinutes": 4, "delayObservations": 1}]
    assert result["stations"][0]["stationName"] == "München Hbf"
    month = json.loads((out / "months" / "2024-07.json").read_text(encoding="utf-8"))
    assert month.pop("generatedAt")
    assert result.pop("generatedAt")
    assert month == result


def test_build_exports_individual_months_and_weighted_default(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    rows("8011160", [10], [datetime(2024, 6, 1, 8)]).write_parquet(raw / "data-2024-06.parquet")
    rows("8011160", [0, 0, 0], [datetime(2024, 7, 1, 8)] * 3).write_parquet(raw / "data-2024-07.parquet")
    station_path = tmp_path / "stations.geojson"
    station_path.write_text(json.dumps(STATIONS), encoding="utf-8")
    processed, out = tmp_path / "processed", tmp_path / "out"
    main(["--processed-dir", str(processed), "ingest", "2024-06..2024-07",
          "--source", "local", "--local-dir", str(raw)])
    meta_path = processed / "2024-07" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    meta["sourceUrl"] = "https://example.test/july"
    meta_path.write_text(json.dumps(meta), encoding="utf-8")
    main(["--processed-dir", str(processed), "build", "2024-06..2024-07",
          "--stations", str(station_path), "--out", str(out)])

    default = json.loads((out / "demo.json").read_text(encoding="utf-8"))
    june = json.loads((out / "months" / "2024-06.json").read_text(encoding="utf-8"))
    july = json.loads((out / "months" / "2024-07.json").read_text(encoding="utf-8"))
    assert default["months"] == ["2024-06", "2024-07"]
    assert default["stations"][0]["averageDelayMinutes"] == 2.5
    for data, month, delay, count in [(june, "2024-06", 10, 1), (july, "2024-07", 0, 3)]:
        assert set(data) == {"period", "months", "generatedAt", "source", "stations", "hourly"}
        assert data["period"] == month
        assert data["months"] == [month]
        assert data["stations"][0]["averageDelayMinutes"] == delay
        assert data["hourly"][0]["delayObservations"] == count
    assert july["source"] == "https://example.test/july"


def test_weekday_exports_preserve_service_hour_and_month(tmp_path):
    raw = tmp_path / "raw"
    raw.mkdir()
    frame = pl.concat([
        rows("8011160", [10, 0], [datetime(2024, 7, 1, 8), datetime(2024, 7, 8, 8)]),
        rows("8011160", [30], [datetime(2024, 7, 2, 8)], train_type="RE"),
    ])
    frame.write_parquet(raw / "data-2024-07.parquet")
    station_path = tmp_path / "stations.geojson"
    station_path.write_text(json.dumps(STATIONS), encoding="utf-8")
    processed, out = tmp_path / "processed", tmp_path / "out"
    base = ["--processed-dir", str(processed)]
    ingest = ["ingest", "2024-07", "--source", "local", "--local-dir", str(raw)]
    main(base + ingest)
    with pytest.raises(SystemExit, match="Weekday caches missing"):
        main(base + ["build", "2024-07", "--stations", str(station_path), "--out", str(out), "--weekdays"])
    main(base + ingest + ["--weekdays"])
    main(base + ["build", "2024-07", "--stations", str(station_path), "--out", str(out), "--weekdays"])
    monday = json.loads((out / "weekdays" / "2024-07" / "1.json").read_text())
    tuesday = json.loads((out / "weekdays" / "2024-07" / "2.json").read_text())
    sunday = json.loads((out / "weekdays" / "2024-07" / "7.json").read_text())
    assert monday["stations"][0]["trainTypes"] == ["ICE"]
    assert monday["stations"][0]["observations"] == 2
    assert monday["hourly"][0]["totalDelayMinutes"] == 10
    assert monday["hourly"][0]["delayObservations"] == 2
    assert tuesday["stations"][0]["trainTypes"] == ["RE"]
    assert tuesday["hourly"][0]["totalDelayMinutes"] == 30
    assert sunday["stations"] == sunday["hourly"] == []


def test_setup_builds_all_dashboard_files_from_fresh_local_source(tmp_path, monkeypatch):
    raw = tmp_path / "raw"
    raw.mkdir()
    rows("8011160", [10, 0], [datetime(2024, 7, 1, 8), datetime(2024, 7, 2, 8)]).write_parquet(
        raw / "data-2024-07.parquet")
    monkeypatch.setattr("dbviz_pipeline.cli.download_db_stations", lambda: [
        {"id": "8011160", "additionalIds": [], "name": "Berlin Hbf",
         "location": {"latitude": 52.5, "longitude": 13.4}},
    ])
    processed, out = tmp_path / "processed", tmp_path / "out"
    args = ["--processed-dir", str(processed), "setup", "2024-07", "--source", "local",
            "--local-dir", str(raw), "--out", str(out)]
    main(args)
    assert (raw / "data-2024-07.parquet").exists()
    assert (out / "stations.geojson").exists()
    assert json.loads((out / "demo.json").read_text())["months"] == ["2024-07"]
    assert json.loads((out / "months" / "2024-07.json").read_text())["stations"][0]["observations"] == 2
    monday = json.loads((out / "weekdays" / "2024-07" / "1.json").read_text())
    assert monday["stations"][0]["observations"] == 1
    assert monday["hourly"][0]["totalDelayMinutes"] == 10
    assert len(list((out / "weekdays" / "2024-07").glob("*.json"))) == 7
    (raw / "data-2024-07.parquet").unlink()
    main(args)
