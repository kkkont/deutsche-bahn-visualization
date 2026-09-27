from datetime import datetime

import polars as pl

from dbviz_pipeline.aggregate import aggregate_frame


def test_aggregate_frame_summarizes_station_and_hour():
    frame = pl.DataFrame({
        "station_name": ["Berlin Hbf", "Berlin Hbf"],
        "eva": ["8011160", "8011160"],
        "train_type": ["ICE", "ICE"],
        "delay_in_min": [2, 12],
        "time": [datetime(2024, 7, 1, 8), datetime(2024, 7, 1, 9)],
        "arrival_is_canceled": [False, False],
        "departure_is_canceled": [False, True],
    })
    result = aggregate_frame(frame, "2024-07")

    assert len(result["stations"]) == 1
    station = result["stations"][0]
    assert station["stationName"] == "Berlin Hbf"
    assert station["observations"] == 2
    assert station["delayObservations"] == 2
    assert station["averageDelayMinutes"] == 7
    assert station["delayedOverFivePercent"] == 50
    assert station["cancelledPercent"] == 50
    assert [point["hour"] for point in result["hourly"]] == [8, 9]
    assert [point["delayObservations"] for point in result["hourly"]] == [1, 1]


def test_aggregate_frame_omits_stations_without_known_coordinates():
    frame = pl.DataFrame({
        "station_name": ["Unknown Station", None],
        "eva": ["0000000", "0000001"],
        "train_type": [None, "ICE"],
        "delay_in_min": [None, 1],
        "time": [datetime(2024, 7, 1, 8), datetime(2024, 7, 1, 8)],
        "arrival_is_canceled": [False, False],
        "departure_is_canceled": [False, False],
    })
    result = aggregate_frame(frame, "2024-07")

    assert result["stations"] == []
    assert result["hourly"] == []