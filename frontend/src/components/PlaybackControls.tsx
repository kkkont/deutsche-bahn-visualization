import { useId } from 'react'
import { useTranslation } from 'react-i18next'

export interface PlaybackProps {
  hour: number; playing: boolean; speed: number;
  onHour: (hour: number) => void; onPlaying: () => void; onSpeed: (speed: number) => void;
}
export function PlaybackControls({ hour, playing, speed, onHour, onPlaying, onSpeed }: PlaybackProps) {
  const { t } = useTranslation('charts')
  const id = useId()
  return <div className="linked-playback">
    <button type="button" onClick={onPlaying} aria-pressed={playing}>{t(playing ? 'pauseDay' : 'playDay')}</button>
    <label>{t('playSpeed')}<select aria-label={t('playSpeed')} value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
      {[0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value} {t('hoursPerSecond')}</option>)}
    </select></label>
    <label htmlFor={id}>{t('playbackHour')}</label>
    <input id={id} type="range" min={0} max={23} step={1} value={hour} onChange={(event) => onHour(Number(event.target.value))} />
    <output htmlFor={id}>{String(hour).padStart(2, '0')}:00–{String((hour + 1) % 24).padStart(2, '0')}:00</output>
  </div>
}
