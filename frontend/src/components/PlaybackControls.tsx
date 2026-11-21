import { useTranslation } from 'react-i18next'

export interface PlaybackProps {
  playing: boolean; speed: number;
  onPlaying: () => void; onSpeed: (speed: number) => void;
}
export function PlaybackControls({ playing, speed, onPlaying, onSpeed }: PlaybackProps) {
  const { t } = useTranslation('charts')
  return <div className="linked-playback">
    <button type="button" onClick={onPlaying} aria-pressed={playing}>{t(playing ? 'pauseDay' : 'playDay')}</button>
    <label>{t('playSpeed')}<select aria-label={t('playSpeed')} value={speed} onChange={(event) => onSpeed(Number(event.target.value))}>
      {[0.5, 1, 2, 4].map((value) => <option key={value} value={value}>{value} {t('hoursPerSecond')}</option>)}
    </select></label>
  </div>
}
