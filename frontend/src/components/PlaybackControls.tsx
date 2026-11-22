import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'

export interface PlaybackProps {
  playing: boolean; speed: number;
  onPlaying: () => void; onSpeed: (speed: number) => void;
}
export function PlaybackControls({ playing, speed, onPlaying, onSpeed }: PlaybackProps) {
  const { t } = useTranslation('charts')
  const id = useId()
  const picker = useRef<HTMLDetailsElement>(null)

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && picker.current && !picker.current.contains(event.target)) {
        picker.current.open = false
      }
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  function closePicker() {
    if (picker.current) {
      picker.current.open = false
      picker.current.querySelector('summary')?.focus()
    }
  }

  return <div className="linked-playback">
    <button type="button" onClick={onPlaying} aria-pressed={playing}>{t(playing ? 'pauseDay' : 'playDay')}</button>
    <div className="dashboard-filter-field playback-speed-field">
      <span id={`${id}-label`} className="dashboard-filter-label">{t('playSpeed')}</span>
      <details className="dashboard-filter-picker" ref={picker} onKeyDown={(event) => {
        if (event.key === 'Escape' && picker.current?.open) {
          event.preventDefault()
          closePicker()
        }
      }}>
        <summary aria-labelledby={`${id}-label ${id}-value`}>
          <span id={`${id}-value`}>{speed} {t('hoursPerSecond')}</span>
        </summary>
        <div className="dashboard-filter-popover">
          {[0.5, 1, 2, 4].map((value) =>
            <button type="button" key={value} className="dashboard-station-option" aria-pressed={speed === value}
              onClick={() => { onSpeed(value); closePicker() }}>
              {value} {t('hoursPerSecond')}
            </button>)}
        </div>
      </details>
    </div>
  </div>
}
