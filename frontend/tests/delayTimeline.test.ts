import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { line } from 'd3'
import { calendarTimestamp, formatTimelinePeriod, summarizeTimeline } from '../src/data/delayTimeline.ts'
import type { ExplorerDataset } from '../src/data/delayExplorer.ts'

const fixture: ExplorerDataset = JSON.parse(readFileSync(new URL('../src/data/delay-explorer-demo.json', import.meta.url), 'utf8'))
const a = fixture.stations[0], b = fixture.stations[1]

test('daily aggregate weights observations and retains station identity and a measured zero', () => {
  const data: ExplorerDataset = { ...fixture, periodEnd: '2024-07-02', stations: [a, b], daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: b.stationId, date: '2024-07-01', totalDelayMinutes: 90, delayObservations: 90 },
    { stationId: a.stationId, date: '2024-07-02', totalDelayMinutes: 0, delayObservations: 10 },
    { stationId: b.stationId, date: '2024-07-02', totalDelayMinutes: 0, delayObservations: 0 },
    { stationId: 'unknown', date: '2024-07-01', totalDelayMinutes: 999, delayObservations: 1 },
    { stationId: a.stationId, date: '2024-08-01', totalDelayMinutes: 999, delayObservations: 1 },
  ] }
  const { aggregatePoints, stationPoints } = summarizeTimeline(data, 'daily')
  assert.equal(aggregatePoints[0].averageDelayMinutes, 100 / 91)
  assert.equal(aggregatePoints[0].delayObservations, 91)
  assert.equal(aggregatePoints[1].averageDelayMinutes, 0)
  const zero = stationPoints.find((point) => point.stationId === a.stationId && point.periodStart === '2024-07-02')!
  assert.equal(zero.stationName, a.stationName)
  assert.equal(zero.averageDelayMinutes, 0)
  assert.equal(stationPoints.at(-1)!.averageDelayMinutes, null)
})

test('weekly station means and overall means pool raw counts, with Monday–Sunday buckets', () => {
  const data: ExplorerDataset = { ...fixture, periodEnd: '2024-07-14', stations: [a, b], daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: a.stationId, date: '2024-07-07', totalDelayMinutes: 90, delayObservations: 90 },
    { stationId: b.stationId, date: '2024-07-01', totalDelayMinutes: 40, delayObservations: 2 },
    { stationId: a.stationId, date: '2024-07-08', totalDelayMinutes: 300, delayObservations: 10 },
  ] }
  const { stationPoints, aggregatePoints } = summarizeTimeline(data, 'weekly')
  assert.equal(stationPoints[0].averageDelayMinutes, 100 / 91)
  assert.equal(aggregatePoints[0].averageDelayMinutes, 140 / 93)
  assert.equal(aggregatePoints[0].periodStart, '2024-07-01')
  assert.equal(aggregatePoints[0].periodEnd, '2024-07-07')
  assert.equal(aggregatePoints[1].periodStart, '2024-07-08')
  assert.equal(aggregatePoints[1].periodEnd, '2024-07-14')
  assert.equal(aggregatePoints[1].averageDelayMinutes, 30)
})

test('missing calendar dates are explicit nulls and produce breaks in line paths', () => {
  const data: ExplorerDataset = { ...fixture, periodEnd: '2024-07-03', stations: [a], daily: [
    { stationId: a.stationId, date: '2024-07-01', totalDelayMinutes: 10, delayObservations: 1 },
    { stationId: a.stationId, date: '2024-07-03', totalDelayMinutes: 0, delayObservations: 1 },
  ] }
  const { aggregatePoints, stationPoints } = summarizeTimeline(data, 'daily')
  assert.equal(aggregatePoints.length, 3)
  assert.equal(aggregatePoints[1].averageDelayMinutes, null)
  assert.equal(aggregatePoints[1].timestamp - aggregatePoints[0].timestamp, 86_400_000)
  const path = line<(typeof stationPoints)[number]>().defined((point) => point.averageDelayMinutes !== null)
    .x((point) => point.timestamp).y((point) => point.averageDelayMinutes!)
  assert.equal((path(aggregatePoints)!.match(/M/g) ?? []).length, 2)
  assert.equal((path(stationPoints)!.match(/M/g) ?? []).length, 2)
  const empty = summarizeTimeline({ ...data, daily: [] }, 'daily')
  assert.equal(path(empty.aggregatePoints), null)
})

test('partial weeks, month/year boundaries, and calendar labels stay explicit', () => {
  const data: ExplorerDataset = { ...fixture, periodStart: '2024-12-29', periodEnd: '2025-01-07', stations: [a], daily: [] }
  const { aggregatePoints } = summarizeTimeline(data, 'weekly')
  assert.deepEqual(aggregatePoints.map((point) => [point.periodStart, point.periodEnd]), [
    ['2024-12-29', '2024-12-29'], ['2024-12-30', '2025-01-05'], ['2025-01-06', '2025-01-07'],
  ])
  assert.equal(formatTimelinePeriod('2024-07-01', '2024-07-07'), '1 Jul–7 Jul')
  assert.equal(calendarTimestamp('2024-07-01'), Date.UTC(2024, 6, 1))
})

test('demo yields 559 daily dots and 80 weekly dots with unchanged observation totals', () => {
  const daily = summarizeTimeline(fixture, 'daily'), weekly = summarizeTimeline(fixture, 'weekly')
  assert.equal(daily.stationPoints.filter((point) => point.averageDelayMinutes !== null).length, 559)
  assert.equal(weekly.stationPoints.filter((point) => point.averageDelayMinutes !== null).length, 80)
  assert.equal(weekly.aggregatePoints.length, 4)
  assert.equal(daily.aggregatePoints.reduce((sum, point) => sum + point.delayObservations, 0),
    weekly.aggregatePoints.reduce((sum, point) => sum + point.delayObservations, 0))
})
