export type Metric = 'delay' | 'late' | 'cancelled'

export interface StationMetric {
  stationId: string
  stationName: string
  evas: string[]
  latitude: number
  longitude: number
  trainTypes: string[]
  observations: number
  delayObservations: number
  averageDelayMinutes: number
  delayedOverFivePercent: number
  cancelledPercent: number
  metricValue?: number
}

export interface HourPoint {
  stationId: string
  trainType: string
  hour: number
  averageDelayMinutes: number
  delayObservations: number
}

export interface Dataset {
  period: string
  generatedAt: string
  source: string
  stations: StationMetric[]
  hourly: HourPoint[]
}