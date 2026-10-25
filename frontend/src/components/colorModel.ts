import { scaleLinear } from 'd3-scale'

/* ================================================================== *
 * COLOUR MODEL
 *
 * A colour model turns "minutes of delay change" into a colour in 3
 * independent steps. Each step is a small class you can swap:
 *
 *   value --[RANGE stage]--> unit u in [-1, 1] --[SHAPE stage]--> u' --[PALETTE]--> colour
 *
 *   RANGE   decides which values get the two end colours
 *           (SymmetricMaxRange, DataRange, FixedRange)
 *   SHAPE   decides how values are spread between the end colours
 *           (LinearShape, EqualizeShape)
 *   PALETTE the colours themselves. The middle colour always sits on 0.
 *
 * Because the steps do not know about each other, any range can be
 * combined with any shape.
 * ================================================================== */

/** Tol "nightfall": diverging, blue = recovery, light middle = no change, red = delay builds up. */
export const NIGHTFALL = [
  '#125A56', '#00767B', '#238F9D', '#42A7C6', '#60BCE9', '#9DCCEF',
  '#C6DBED', '#DEE6E7', '#ECEADA', '#F0E6B2', '#F9D576', '#FFB954',
  '#FD9A44', '#F57634', '#E94C1F', '#D11807', '#A01813',
]

/* ------------------------------------------------------------------ *
 * Step 1: RANGE
 * ------------------------------------------------------------------ */

export interface Range {
  low: number // <= 0, value that gets the first colour
  high: number // >= 0, value that gets the last colour
  /** true when low = -high, so +x and -x are meant to look equally strong. */
  symmetric: boolean
}

export interface RangeStage {
  fit(values: number[]): Range
}

function extent(values: number[]) {
  let min = 0, max = 0
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { min, max } // always includes 0
}

/** The original behaviour: ±(largest absolute value, rounded up to whole minutes, at least 1). */
export class SymmetricMaxRange implements RangeStage {
  fit(values: number[]): Range {
    const { min, max } = extent(values)
    const m = Math.max(1, Math.ceil(Math.max(-min, max)))
    return { low: -m, high: m, symmetric: true }
  }
}

/** The real minimum and maximum of the data in view. Each side of 0 uses its own range. */
export class DataRange implements RangeStage {
  fit(values: number[]): Range {
    let { min, max } = extent(values)
    if (min === 0 && max === 0) { min = -1; max = 1 } // no data or all zero
    return { low: min, high: max, symmetric: false }
  }
}

/** Always ±limit minutes, whatever the data. Use it to compare two tables. */
export class FixedRange implements RangeStage {
  readonly limit: number
  constructor(limit: number) { this.limit = limit }
  fit(): Range { return { low: -this.limit, high: this.limit, symmetric: true } }
}

/** value -> [-1, 1]; 0 stays 0, anything outside the range is clamped. */
function toUnit(v: number, range: Range) {
  if (v === 0) return 0
  return v > 0 ? Math.min(1, v / range.high) : -Math.min(1, v / range.low)
}

/* ------------------------------------------------------------------ *
 * Step 2: SHAPE
 * ------------------------------------------------------------------ */

/** A monotone curve on [-1, 1] with shape(0) = 0. */
export type Shape = (u: number) => number

export interface ShapeStage {
  fit(units: number[], range: Range): Shape
}

/** Colour is proportional to the value. */
export class LinearShape implements ShapeStage {
  fit(): Shape { return (u) => u }
}

/** Empirical CDF of positive numbers (mid-rank for ties), scaled so the largest value maps to 1. */
function makeCdf(values: number[]): (x: number) => number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  if (!n) return (x) => x
  const bound = (x: number, upper: boolean) => {
    let lo = 0, hi = n
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (sorted[mid] < x || (upper && sorted[mid] === x)) lo = mid + 1
      else hi = mid
    }
    return lo
  }
  const raw = (x: number) => (bound(x, false) + bound(x, true)) / (2 * n)
  const top = raw(sorted[n - 1])
  return (x) => Math.min(1, raw(x) / top)
}

export interface EqualizeOptions {
  /** 0 = linear, 1 = full histogram equalization. Values in between blend the two. */
  amount?: number
}

/**
 * Histogram equalization: every colour step of the palette is used by about the same number
 * of cells. Dense value ranges get stretched, empty ones are squeezed.
 *
 * It respects the range stage:
 *  - symmetric range -> ONE ranking of |value|, so +3 and -3 get the same colour strength
 *  - asymmetric range -> negatives and positives are ranked separately, each side uses its full palette half
 * In both cases 0 stays the neutral middle colour.
 */
export class EqualizeShape implements ShapeStage {
  readonly amount: number
  constructor({ amount = 1 }: EqualizeOptions = {}) { this.amount = amount }

  fit(units: number[], range: Range): Shape {
    let eq: Shape
    if (range.symmetric) {
      const f = makeCdf(units.filter((u) => u !== 0).map(Math.abs))
      eq = (u) => (u === 0 ? 0 : Math.sign(u) * f(Math.abs(u)))
    } else {
      const neg = makeCdf(units.filter((u) => u < 0).map((u) => -u))
      const pos = makeCdf(units.filter((u) => u > 0))
      eq = (u) => (u === 0 ? 0 : u < 0 ? -neg(-u) : pos(u))
    }
    const a = this.amount
    return (u) => (1 - a) * u + a * eq(u)
  }
}

/* ------------------------------------------------------------------ *
 * Step 3: put it together
 * ------------------------------------------------------------------ */

export interface ColorModelOptions {
  range?: RangeStage
  shape?: ShapeStage
  palette?: string[]
}

/** What `fit()` returns: everything a table or legend needs. */
export interface FittedColors {
  /** minutes -> CSS colour */
  color: (value: number) => string
  /** Values that get the first and last colour. */
  low: number
  high: number
  /** CSS gradient that shows the real value -> colour mapping from low to high (not the raw palette). */
  gradient: string
  /** Where 0 sits on that gradient, 0–100. */
  zeroPct: number
}

export class ColorModel {
  readonly range: RangeStage
  readonly shape: ShapeStage
  readonly palette: string[]

  constructor({ range = new SymmetricMaxRange(), shape = new LinearShape(), palette = NIGHTFALL }: ColorModelOptions = {}) {
    this.range = range
    this.shape = shape
    this.palette = palette
  }

  /** A copy with one or more parts replaced, e.g. `CLASSIC.with({ shape: new EqualizeShape() })`. */
  with(options: ColorModelOptions): ColorModel {
    return new ColorModel({ range: this.range, shape: this.shape, palette: this.palette, ...options })
  }

  /** Fit the model to the values that are currently in view. Call again when filters change. */
  fit(values: number[]): FittedColors {
    const finite = values.filter(Number.isFinite)
    const range = this.range.fit(finite)
    const shape = this.shape.fit(finite.map((v) => toUnit(v, range)), range)

    const last = this.palette.length - 1
    const paletteScale = scaleLinear<string>()
      .domain(this.palette.map((_, i) => i / last))
      .range(this.palette)
      .clamp(true)

    const color = (v: number) => paletteScale(0.5 + 0.5 * shape(toUnit(v, range)))

    const steps = 32
    const stops = Array.from({ length: steps + 1 }, (_, k) => {
      const value = range.low + ((range.high - range.low) * k) / steps
      return `${color(value)} ${((k / steps) * 100).toFixed(2)}%`
    })
    const span = range.high - range.low

    return {
      color,
      low: range.low,
      high: range.high,
      gradient: `linear-gradient(90deg, ${stops.join(', ')})`,
      zeroPct: span ? Math.min(100, Math.max(0, (-range.low / span) * 100)) : 50,
    }
  }
}

/* ------------------------------------------------------------------ *
 * Ready-made combinations
 * ------------------------------------------------------------------ */

/** The original look: ±max, linear. */
export const CLASSIC = new ColorModel()
/** Min/max of the data in view: blue side ends at the real minimum, red side at the real maximum. */
export const MIN_MAX = new ColorModel({ range: new DataRange() })
/** Histogram equalized, +x and -x equally strong. */
export const EQUALIZED = new ColorModel({ shape: new EqualizeShape() })
/** Both: min/max range AND histogram equalization (each side of 0 ranked on its own). */
export const MIN_MAX_EQUALIZED = new ColorModel({ range: new DataRange(), shape: new EqualizeShape() })

export const COLOR_MODELS: Record<string, { label: string; model: ColorModel }> = {
  classic: { label: 'Classic (±max)', model: CLASSIC },
  minMax: { label: 'Min / max of data', model: MIN_MAX },
  equalized: { label: 'Histogram equalized', model: EQUALIZED },
  both: { label: 'Min / max + equalized', model: MIN_MAX_EQUALIZED },
}
