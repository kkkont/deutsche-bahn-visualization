import type { FittedColors } from './colorModel.ts'
import './ColorLegend.css'

interface ColorLegendProps {
  colors: FittedColors
  left?: string
  right?: string
  unit?: string
}

const fmt = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

/** Gradient bar in VALUE space, so equalized or asymmetric scales show what they really do. */
export default function ColorLegend({ colors, left = 'Time made up', right = 'Time lost', unit = 'min' }: ColorLegendProps) {
  const showZero = colors.zeroPct > 8 && colors.zeroPct < 92
  return (
    <div className="color-legend" aria-hidden="true">
      <span>{left}</span>
      <div className="cl-bar" style={{ background: colors.gradient }} />
      <span>{right}</span>
      <div className="cl-ticks">
        <span style={{ left: 0 }}>{fmt(colors.low)} {unit}</span>
        {showZero && <span className="cl-mid" style={{ left: `${colors.zeroPct}%` }}>0</span>}
        <span style={{ right: 0 }}>{fmt(colors.high)} {unit}</span>
      </div>
    </div>
  )
}
