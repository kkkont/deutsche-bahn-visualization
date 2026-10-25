import { useEffect, useRef } from 'react'
import { brushX, scaleUtc, select } from 'd3'
import { calendarTimestamp } from '../data/delayTimeline'
import type { TimeResolution } from '../data/delayTimeline'
import type { DateInterval } from '../data/explorerSelection'
import { intervalFromBrush } from '../data/explorerSelection'

export function TimelineBrush({ width, bounds, range, resolution, onChange }: {
  width: number; bounds: DateInterval; range: DateInterval | null; resolution: TimeResolution;
  onChange: (range: DateInterval | null) => void;
}) {
  const node = useRef<SVGGElement>(null)
  const { start, end } = bounds
  useEffect(() => {
    if (!node.current) return
    const x = scaleUtc().domain([calendarTimestamp(start) - 43_200_000, calendarTimestamp(end) + 43_200_000]).range([52, width - 18])
    const brush = brushX().extent([[52, 5], [width - 18, 39]]).touchable(() => true)
      .on('end', (event) => {
        // Controlled moves (including snapping/resizing) must never dispatch again.
        if (!event.sourceEvent) return
        if (!event.selection) { onChange(null); return }
        const [a, b] = event.selection as [number, number]
        onChange(intervalFromBrush(x.invert(a).valueOf(), x.invert(b).valueOf(), { start, end }, resolution))
      })
    const group = select(node.current).call(brush)
    group.call(brush.move, range ? [x(calendarTimestamp(range.start) - 43_200_000), x(calendarTimestamp(range.end) + 43_200_000)] : null)
    return () => { group.on('.brush', null) }
  }, [width, start, end, range, resolution, onChange])
  return <div className="timeline-brush-area">
    <p>Drag horizontally below to select dates. {resolution === 'daily' ? 'Snaps to whole dates.' : 'Snaps to Monday–Sunday weeks.'}</p>
    <svg className="timeline-brush" width={width} height={45} role="img" aria-label="Horizontal date brush. The start and end date inputs provide the same filtering by keyboard.">
      <rect x={52} y={5} width={Math.max(0, width - 70)} height={34} className="timeline-brush-track" />
      <g ref={node} />
    </svg>
  </div>
}
