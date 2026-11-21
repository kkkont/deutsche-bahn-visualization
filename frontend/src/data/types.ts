export interface StationLocation {
  stationId: string
  stationName: string
  latitude: number
  longitude: number
}

export interface StationMetric extends StationLocation {
  evas: string[]
  trainTypes: string[]
  observations: number
  delayObservations: number
  totalDelayMinutes?: number
  averageDelayMinutes: number
  delayedOverFivePercent: number
  cancelledPercent: number
}

export interface HourPoint {
  totalDelayMinutes?: number
  stationId: string
  trainType: string
  hour: number
  averageDelayMinutes: number
  delayObservations: number
}

export interface Dataset {
  period: string
  months?: string[]
  generatedAt: string
  source: string
  stations: StationMetric[]
  hourly: HourPoint[]
}
