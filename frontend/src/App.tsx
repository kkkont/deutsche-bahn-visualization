import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { RailMap } from './components/RailMap'
import { DelayClock } from './components/DelayClock'

function App() {
  const { t, i18n } = useTranslation('common')

  useEffect(() => {
    document.documentElement.lang = i18n.resolvedLanguage?.slice(0, 2) ?? 'en'
    document.title = t('common:pageTitle')
  }, [i18n.resolvedLanguage, t])

  const changeLanguage = () => {
    const next = i18n.resolvedLanguage?.startsWith('de') ? 'en' : 'de'
    localStorage.setItem('language', next)
    void i18n.changeLanguage(next)
  }

  return (
    <main className="app-shell station-map-page">
      <header className="topbar">
        <a className="brand" href="#top" aria-label={t('common:brand')}>
          <span className="brand-mark">DB</span><span className="brand-name">{t('common:brand')}</span>
        </a>
        <div className="topbar-right">
          <button className="language-toggle" onClick={changeLanguage} aria-label={t('common:switchLanguage')}>
            {i18n.resolvedLanguage?.startsWith('de') ? 'EN' : 'DE'}
          </button>
        </div>
      </header>

      <section className="intro-row" id="top">
        <div>
          <h1>{t('common:title')}</h1>
        </div>
      </section>

      <section aria-label={t('common:title')}>
        <RailMap />
      </section>
      <DelayClock />
    </main>
  )
}

export default App
