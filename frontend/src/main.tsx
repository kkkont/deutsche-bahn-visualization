import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import './i18n'
import './index.css'
import './pagenav.css'
import App from './App.tsx'
import MareyPage from './MareyPage.tsx'
import HeatmapPage from './HeatmapPage.tsx'

const PAGES = [
  { id: 'map', label: 'Station map', Page: App },
  { id: 'marey', label: 'Marey chart', Page: MareyPage },
  { id: 'heatmap', label: 'Delay heatmap', Page: HeatmapPage },
] as const

const fromHash = () => PAGES.find((p) => location.hash === `#/${p.id}`)?.id ?? PAGES[0].id

function Shell() {
  const { t } = useTranslation('common')
  const [route, setRoute] = useState<string>(fromHash)

  useEffect(() => {
    const onHash = () => { setRoute(fromHash()); window.scrollTo(0, 0) }
    addEventListener('hashchange', onHash)
    return () => removeEventListener('hashchange', onHash)
  }, [])

  const { Page } = PAGES.find((p) => p.id === route)!
  return (
    <>
      <nav className="pagenav" aria-label={t('pages', { defaultValue: 'Pages' })}>
        {PAGES.map((p) => (
          <a key={p.id} href={`#/${p.id}`} aria-current={p.id === route ? 'page' : undefined}>
            {t(`pageNav.${p.id}`, { defaultValue: p.label })}
          </a>
        ))}
      </nav>
      <Page />
    </>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
)
