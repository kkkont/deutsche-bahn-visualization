"""Regenerate the deterministic explorer fixture; delay values are entirely synthetic."""
import json
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = json.loads((ROOT / 'public/data/demo.json').read_text())
unique = {row['stationId']: row for row in source['stations']}
stations = [dict(stationId=str(int(row['evas'][0])), stationName=row['stationName'],
                 latitude=row['latitude'], longitude=row['longitude'])
            for row in sorted(unique.values(), key=lambda row: row['stationName'])]
records = []
for index, station in enumerate(stations):
    for day in range(28):
        if index == 3 and day == 9:  # Missing station-day, distinct from measured zero.
            continue
        count = 100 + (index * 71 + day * 29) % 500
        mean = 2 + (index * 7 % 12) + ((day * 3 + index) % 7 - 3) * 0.25
        if index == 0:
            mean = 0 if day == 4 else 0.5 + day % 3 * 0.25
        if index == 8:
            mean = 16 + day % 4 * 0.5
        if index == 10:
            mean = 2 + day * 0.45
        if day == 16 and index in (2, 3, 5, 7, 8):
            mean += 7
        if index == 12:  # A station with no valid measurements over the entire period.
            count = 0
        records.append(dict(stationId=station['stationId'],
                            date=(date(2024, 7, 1) + timedelta(days=day)).isoformat(),
                            totalDelayMinutes=round(mean * count, 2),
                            delayObservations=count))
fixture = dict(synthetic=True, periodStart='2024-07-01', periodEnd='2024-07-28',
               timezone='Europe/Berlin', stations=stations, daily=records)
(ROOT / 'src/data/delay-explorer-demo.json').write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + '\n')
