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
    result = outputs["demo.json"]

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
    assert outputs["delay-explorer.json"]["daily"] == []
    assert unmapped == ["1"]


def test_months_combine_by_observation_weight_not_by_monthly_means(stations):
    june = rows("8011160", [10], [datetime(2024, 6, 30, 8)])
    july = rows("8011160", [0, 0, 0, 2], [datetime(2024, 7, 1, 8)] * 4)
    outputs, _ = build([june, july], stations, months=["2024-07", "2024-06"])

    assert outputs["demo.json"]["stations"][0]["averageDelayMinutes"] == 2.4
    assert outputs["demo.json"]["stations"][0]["totalDelayMinutes"] == 12
    assert outputs["delay-clock.json"]["months"] == ["2024-06", "2024-07"]
    assert outputs["delay-clock.json"]["period"] == "2024-06/2024-07"
    explorer = outputs["delay-explorer.json"]
    assert (explorer["periodStart"], explorer["periodEnd"]) == ("2024-06-01", "2024-07-31")
    assert explorer["daily"] == [
        {"stationId": "8011160", "date": "2024-06-30", "totalDelayMinutes": 10, "delayObservations": 1},
        {"stationId": "8011160", "date": "2024-07-01", "totalDelayMinutes": 2, "delayObservations": 4},
    ]


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
    main(["--processed-dir", str(processed), "build", "--stations", str(tmp_path / "stations.geojson"), "--out", str(out)])

    assert (raw / "data-2024-07.parquet").exists()
    clock = json.loads((out / "delay-clock.json").read_text(encoding="utf-8"))
    assert clock["hours"][10] == {"hour": 10, "averageDelayMinutes": 4, "delayObservations": 1}
    explorer = json.loads((out / "delay-explorer.json").read_text(encoding="utf-8"))
    assert explorer["stations"][0]["stationName"] == "München Hbf"


def test_global_hourly_includes_unmapped_stations_and_weights_each_measured_stop(stations):
    frame = pl.concat([
        rows("8011160", [12], [datetime(2024, 7, 1, 8)]),
        rows("1", [0, 0, None], [datetime(2024, 7, 1, 8)] * 3, train_type="RE"),
        rows("1", [None], [datetime(2024, 7, 1, 9)], train_type="RE"),
    ])

    hours = build([frame], stations)[0]["delay-clock.json"]["hours"]

    assert [point["hour"] for point in hours] == list(range(24))
    assert hours[8] == {"hour": 8, "averageDelayMinutes": 4, "delayObservations": 3}
    assert hours[9] == {"hour": 9, "averageDelayMinutes": None, "delayObservations": 0}
    assert hours[0] == {"hour": 0, "averageDelayMinutes": None, "delayObservations": 0}