import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import commonEn from './locales/en/common.json'
import mapEn from './locales/en/map.json'
import stationsEn from './locales/en/stations.json'
import chartsEn from './locales/en/charts.json'
import commonDe from './locales/de/common.json'
import mapDe from './locales/de/map.json'
import stationsDe from './locales/de/stations.json'
import chartsDe from './locales/de/charts.json'

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: commonEn, map: mapEn, stations: stationsEn, charts: chartsEn },
    de: { common: commonDe, map: mapDe, stations: stationsDe, charts: chartsDe },
  },
  lng: localStorage.getItem('language') ?? navigator.language,
  fallbackLng: 'en',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export default i18n