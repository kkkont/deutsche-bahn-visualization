import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { calendarMonthGroups, toggleCalendarMonth } from '../data/dashboardFilters'

const servicePresets = [
  { label: 'filterLongDistance', types: ['ICE', 'IC', 'EC'] },
  { label: 'filterRegional', types: ['RE', 'RB'] },
  { label: 'filterSuburban', types: ['S'] },
  { label: 'filterBus', types: ['BUS'] },
]

export interface DashboardFiltersProps {
  stations: { stationId: string; stationName: string }[]
  stationId: string | null
  onStation: (id: string | null) => void
  services: string[]
  selectedServices: string[]
  onServices: (services: string[]) => void
  months: string[]
  selectedMonths: string[]
  onMonths: (months: string[]) => void
  weekday: number | null
  onWeekday: (weekday: number | null) => void
  loadingMonths: boolean
}

export function DashboardFilters({
  stations, stationId, onStation, services, selectedServices, onServices,
  months, selectedMonths, onMonths, weekday, onWeekday, loadingMonths,
}: DashboardFiltersProps) {
  const { t, i18n } = useTranslation('charts')
  const id = useId()
  const root = useRef<HTMLDivElement>(null)
  const [stationSearch, setStationSearch] = useState('')
  const [serviceSearch, setServiceSearch] = useState('')
  const matchingStations = useMemo(() => {
    const query = stationSearch.trim().toLocaleLowerCase(i18n.language)
    return stations.filter((station) =>
      `${station.stationName} ${station.stationId}`.toLocaleLowerCase(i18n.language).includes(query))
  }, [stations, stationSearch, i18n.language])
  const matchingServices = services.filter((service) =>
    service.toLocaleLowerCase(i18n.language).includes(serviceSearch.trim().toLocaleLowerCase(i18n.language)))
  const selectedStation = stations.find((station) => station.stationId === stationId)
  const activeMonths = months.filter((month) => selectedMonths.includes(month))
  const effectiveMonths = activeMonths.length ? activeMonths : months
  const allMonths = effectiveMonths.length === months.length
  const calendarMonths = useMemo(() => calendarMonthGroups(months), [months])
  const selectedCount = calendarMonths.filter((group) => group.months.length > 0
    && group.months.every((month) => effectiveMonths.includes(month))).length
  const monthFormatter = useMemo(() =>
    new Intl.DateTimeFormat(i18n.language, { month: 'short', timeZone: 'UTC' }),
  [i18n.language])

  useEffect(() => {
    function closeOutside(event: PointerEvent) {
      if (!(event.target instanceof Node)) return
      root.current?.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((details) => {
        if (!details.contains(event.target as Node)) details.open = false
      })
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])

  function chooseStation(value: string | null) {
    onStation(value)
    setStationSearch('')
    const details = root.current?.querySelector<HTMLDetailsElement>('.filter-station-picker')
    if (details) {
      details.open = false
      details.querySelector('summary')?.focus()
    }
  }

  function toggleService(service: string) {
    const next = selectedServices.includes(service)
      ? selectedServices.filter((value) => value !== service)
      : [...selectedServices, service]
    onServices(services.every((value) => next.includes(value)) ? [] : next)
  }

  function monthLabel(month: number) {
    return monthFormatter.format(new Date(Date.UTC(2024, month - 1, 1)))
  }

  return <div className="dashboard-filters" ref={root} onKeyDown={(event) => {
    if (event.key !== 'Escape' || !(event.target instanceof HTMLElement)) return
    const details = event.target.closest('details')
    if (details?.open) {
      event.preventDefault()
      details.open = false
      details.querySelector('summary')?.focus()
    }
  }}>
    <div className="dashboard-filter-controls">
      <div className="dashboard-filter-field">
        <span id={`${id}-station-label`} className="dashboard-filter-label">{t('filterStation')}</span>
        <details className="dashboard-filter-picker filter-station-picker">
          <summary aria-labelledby={`${id}-station-label ${id}-station-value`}>
            <span id={`${id}-station-value`}>{stationId === null ? t('filterAllStations') : selectedStation?.stationName ?? stationId}</span>
          </summary>
          <div className="dashboard-filter-popover">
            <label className="dashboard-filter-search-label" htmlFor={`${id}-station-search`}>{t('filterSearchStations')}</label>
            <div className="dashboard-filter-search">
              <input id={`${id}-station-search`} type="search" autoComplete="off"
                placeholder={t('filterStationPlaceholder')} value={stationSearch}
                onChange={(event) => setStationSearch(event.target.value)} />
              {stationSearch && <button type="button" onClick={() => setStationSearch('')}>{t('filterClearSearch')}</button>}
            </div>
            <button type="button" className="dashboard-filter-reset" onClick={() => chooseStation(null)}>{t('filterAllStations')}</button>
            <div className="dashboard-filter-results" aria-label={t('filterStation')}>
              {matchingStations.slice(0, 100).map((station) =>
                <button type="button" key={station.stationId} className="dashboard-station-option"
                  aria-pressed={stationId === station.stationId} onClick={() => chooseStation(station.stationId)}>
                  <span>{station.stationName}</span><small>{station.stationId}</small>
                </button>)}
            </div>
            <p className="dashboard-filter-note" role="status">
              {matchingStations.length === 0 ? t('filterNoStations')
                : matchingStations.length > 100 ? t('filterRefineStations', { count: matchingStations.length })
                  : t('filterStationResults', { count: matchingStations.length })}
            </p>
          </div>
        </details>
      </div>

      <div className="dashboard-filter-field">
        <span id={`${id}-service-label`} className="dashboard-filter-label">{t('filterServices')}</span>
        <details className="dashboard-filter-picker">
          <summary aria-labelledby={`${id}-service-label ${id}-service-value`}>
            <span id={`${id}-service-value`}>{selectedServices.length
              ? selectedServices.join(', ') : t('filterAllServices')}</span>
          </summary>
          <div className="dashboard-filter-popover">
            <label className="dashboard-filter-search-label" htmlFor={`${id}-service-search`}>{t('filterSearchServices')}</label>
            <div className="dashboard-filter-search">
              <input id={`${id}-service-search`} type="search" autoComplete="off" value={serviceSearch}
                onChange={(event) => setServiceSearch(event.target.value)} />
              {serviceSearch && <button type="button" onClick={() => setServiceSearch('')}>{t('filterClearSearch')}</button>}
            </div>
            <button type="button" className="dashboard-filter-reset" onClick={() => onServices([])}>
              {t('filterClearServices')}
            </button>
            <fieldset className="dashboard-service-presets">
              <legend>{t('filterServicePresets')}</legend>
              <div>
                {servicePresets.map((preset) => {
                  const values = services.filter((service) => preset.types.includes(service.trim().toUpperCase()))
                  return <button type="button" key={preset.label} disabled={values.length === 0}
                    aria-pressed={selectedServices.length > 0 && selectedServices.length === values.length
                      && values.every((value) => selectedServices.includes(value))}
                    onClick={() => {
                      onServices(values.length === services.length ? [] : values)
                      setServiceSearch('')
                    }}>{t(preset.label)}</button>
                })}
              </div>
              <p className="dashboard-filter-note">{t('filterServicePresetsHint')}</p>
            </fieldset>
            <p className="dashboard-filter-note">{t('filterServicesHint')}</p>
            <div className="dashboard-filter-results">
              {matchingServices.map((service) => <label key={service} className="dashboard-service-option">
                <input type="checkbox" checked={selectedServices.includes(service)}
                  onChange={() => toggleService(service)} />
                <span>{service}</span>
              </label>)}
            </div>
            {matchingServices.length === 0 && <p className="dashboard-filter-note" role="status">{t('filterNoServices')}</p>}
          </div>
        </details>
      </div>

    </div>

    <fieldset className="dashboard-month-filter" aria-busy={loadingMonths} disabled={loadingMonths || months.length === 0}>
      <legend>{t('filterMonths')}</legend>
      <div className="dashboard-month-buttons">
        <button type="button" className="dashboard-month-reset" aria-pressed={allMonths}
          onClick={() => onMonths([...months])}>{t('filterAllMonths')}</button>
        {calendarMonths.map((group) => {
          const selected = group.months.length > 0 && group.months.every((month) => effectiveMonths.includes(month))
          const keepOne = selected && selectedCount === 1
          return <button type="button" key={group.number} aria-pressed={selected && !allMonths}
            disabled={!group.months.length || keepOne}
            title={!group.months.length ? t('filterMonthUnavailable') : keepOne ? t('filterKeepOneMonth') : undefined}
            onClick={() => onMonths(toggleCalendarMonth(months, effectiveMonths, group.number))}>
            {monthLabel(group.number)}
          </button>
        })}
      </div>
    </fieldset>
    <p className="dashboard-filter-note dashboard-month-status" role="status">
      {loadingMonths ? t('filterLoadingMonths') : months.length === 0 ? t('filterNoMonths')
        : t('filterMonthSelection', { count: selectedCount })}
    </p>
    <fieldset className="dashboard-month-filter" aria-busy={loadingMonths} disabled={loadingMonths || months.length === 0}>
      <legend>{t('filterWeekday')}</legend>
      <div className="dashboard-month-buttons">
        <button type="button" className="dashboard-month-reset" aria-pressed={weekday === null}
          onClick={() => onWeekday(null)}>{t('filterAllWeekdays')}</button>
        {Array.from({ length: 7 }, (_, index) => {
          const value = index + 1
          const label = new Intl.DateTimeFormat(i18n.language, { weekday: 'short', timeZone: 'UTC' })
            .format(new Date(Date.UTC(2024, 0, value)))
          return <button type="button" key={value} aria-pressed={weekday === value}
            onClick={() => onWeekday(value)}>{label}</button>
        })}
      </div>
    </fieldset>
  </div>
}
