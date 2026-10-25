import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { isoWeekLabel, spreadProfileLabels, summarizeProfiles } from '../src/data/delayProfiles.ts'
import type { ExplorerDataset } from '../src/data/delayExplorer.ts'

const fixture: ExplorerDataset = JSON.parse(readFileSync(new URL('../src/data/delay-explorer-demo.json', import.meta.url), 'utf8'))

test('weekday and week profiles share daily means and pool counts for their grey averages', () => {
  const station = fixture.stations[0]
  const data: ExplorerDataset = { ...fixture, stations: [station], periodEnd: '2024-07-14', daily: [
    { stationId: station.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: station.stationId, date: '2024-07-02', totalDelayMinutes: 0, delayObservations: 10 },
    { stationId: station.stationId, date: '2024-07-08', totalDelayMinutes: 90, delayObservations: 90 },
  ] }
  const { weekdays, weeks } = summarizeProfiles(data)
  assert.deepEqual(weekdays.ticks, ['Week 27', 'Week 28'])
  assert.deepEqual(weekdays.series[0].points.map((point) => point.averageDelayMinutes), [10, 1])
  assert.equal(weekdays.average[0].averageDelayMinutes, 10 / 11)
  assert.equal(weeks.average[0].averageDelayMinutes, 100 / 91)
  assert.equal(weeks.series[0].points[1].averageDelayMinutes, 0)
  assert.equal(weeks.series[1].points[1].averageDelayMinutes, null)
  assert.equal(weeks.average[2].averageDelayMinutes, null)
  for (let week = 0; week < 2; week++) {
    for (let day = 0; day < 7; day++) {
      assert.equal(weekdays.series[day].points[week].averageDelayMinutes, weeks.series[week].points[day].averageDelayMinutes)
    }
  }
})

test('ISO week numbers use the week year across December and January', () => {
  assert.deepEqual(isoWeekLabel('2024-07-01'), { label: 'Week 27', year: 2024 })
  assert.deepEqual(isoWeekLabel('2024-12-30'), { label: 'Week 1', year: 2025 })
  assert.deepEqual(isoWeekLabel('2021-01-01'), { label: 'Week 53', year: 2020 })
  const profiles = summarizeProfiles(fixture)
  assert.equal(profiles.weekdays.series.length, 7)
  assert.equal(profiles.weeks.series.length, 4)
  assert.deepEqual(profiles.weeks.series.map((series) => series.label), ['Week 27', 'Week 28', 'Week 29', 'Week 30'])
})

test('station filtering changes profile data and reference means without changing the fixture', () => {
  const a = fixture.stations[0], b = fixture.stations[1]
  const data: ExplorerDataset = { ...fixture, stations: [a, b], periodEnd: '2024-07-07', daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: b.stationId, date: '2024-07-01', totalDelayMinutes: 90, delayObservations: 90 },
  ] }
  const all = summarizeProfiles(data)
  const first = summarizeProfiles(data, a.stationId)
  const second = summarizeProfiles(data, b.stationId)
  assert.equal(all.weekdays.series[0].points[0].averageDelayMinutes, 100 / 91)
  assert.equal(first.weekdays.series[0].points[0].averageDelayMinutes, 10)
  assert.equal(second.weekdays.series[0].points[0].averageDelayMinutes, 1)
  assert.equal(first.weekdays.average[0].averageDelayMinutes, 10)
  assert.equal(second.weeks.average[0].averageDelayMinutes, 1)
  assert.equal(data.stations.length, 2)
  assert.equal(data.daily.length, 2)
  const unmeasured = fixture.stations.find((station) => station.stationName === 'Karlsruhe Hbf')!
  const missing = summarizeProfiles(fixture, unmeasured.stationId)
  assert.ok(missing.weekdays.series.every((series) => series.points.every((point) => point.averageDelayMinutes === null)))
})

test('direct end labels stay separated and inside the plot with clustered endpoints', () => {
  const desired = [260, 260, 258, 261, 259, 260, 260, 260]
  const positions = spreadProfileLabels(desired, 33, 275)
  const sorted = [...positions].sort((a, b) => a - b)
  assert.ok(sorted[0] >= 33)
  assert.ok(sorted.at(-1)! <= 275)
  assert.ok(sorted.slice(1).every((position, index) => position - sorted[index] >= 18))
  assert.deepEqual(desired, [260, 260, 258, 261, 259, 260, 260, 260])
})
