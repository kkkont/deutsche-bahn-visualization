import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './index.css'
import App from './App.tsx'

// Old bookmarks and a bare URL all open the single retained view.
if (location.hash !== '#/map' && location.hash !== '#top') {
  history.replaceState(history.state, '', `${location.pathname}${location.search}#/map`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
