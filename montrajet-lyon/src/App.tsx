import { defaultJourneySettings } from './services/favoriteJourney'
import { useEffect, useState } from 'react'
import { ArrowRight, Heart, Home, Navigation, Route, Clock3, TriangleAlert, TrainFront } from 'lucide-react'
import { JourneyForm } from './components/JourneyForm'
import { Timetable } from './components/Timetable'
import { Traffic } from './components/Traffic'
import { readFavoriteStore, writeFavoriteStore, clearFavoriteStore, emptyFavoriteStore, favoriteDraft, favoriteEndpoint, saveTrip, savedLocation } from './services/favorites'
import { FavoritesPanel } from './components/FavoritesPanel'
import type { FavoriteStore, FavoritePreferences, SavedLocation, FavoriteLaunch } from './types/favorites'
import type { JourneyPlace } from './types/mobility'
import type { JourneyDraft } from './types/journey'
import './App.css'

const pages = [{ id: 'accueil', label: 'Accueil', icon: Home }, { id: 'itineraires', label: 'Itinéraires', icon: Route }, { id: 'horaires', label: 'Horaires', icon: Clock3 }, { id: 'trafic', label: 'Trafic', icon: TriangleAlert }, { id: 'favoris', label: 'Favoris', icon: Heart }] as const
type Page = typeof pages[number]['id']
function pageFromUrl(): Page {
  const requested = new URL(window.location.href).searchParams.get('page')
  return pages.find(({ id }) => id === requested)?.id ?? 'accueil'
}
export default function App() {
  const [page, setPage] = useState<Page>(pageFromUrl)
  const [initial] = useState(readFavoriteStore)
  const [favorites, setFavorites] = useState(initial.data)
  const [notice, setNotice] = useState(initial.error)
  const [route, setRoute] = useState<JourneyDraft>({ departure: '', arrival: '' })
  const [settings,setSettings] = useState(defaultJourneySettings)
  const [launch, setLaunch] = useState<FavoriteLaunch|null>(null)
  useEffect(() => {
    const restore = () => { setLaunch(null); setPage(pageFromUrl()) }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [])
  function navigate(next: Page) {
    setLaunch(null)
    if (next !== pageFromUrl()) {
      const url = new URL(window.location.href)
      if (next === 'accueil') url.searchParams.delete('page')
      else url.searchParams.set('page', next)
      window.history.pushState(null, '', url)
    }
    setPage(next)
  }
  function save(items: FavoriteStore) {
    const result = writeFavoriteStore(items)
    if (result.error || !result.data) { setNotice(result.error); return false }
    setFavorites(result.data); setNotice('Favoris enregistrés sur cet appareil.'); return true
  }
  function addFavorite(departure: JourneyPlace, arrival: JourneyPlace, preferences: FavoritePreferences, name?: string) {
    try {
      const next = saveTrip(favorites,{ name: name?.trim() || `${departure.name} → ${arrival.name}`.slice(0,100), from: favoriteEndpoint(favorites,savedLocation(departure)), to: favoriteEndpoint(favorites,savedLocation(arrival)), preferences })
      return save(next) ? 'Trajet ajouté à vos favoris sur cet appareil.' : 'Enregistrement impossible : consultez le message dans Favoris.'
    } catch (error) { return error instanceof Error ? error.message : 'Favori invalide.' }
  }
  function useFavorite(from: SavedLocation, to: SavedLocation, preferences: FavoritePreferences, run: boolean) {
    if (from.kind === 'unresolved' || to.kind === 'unresolved') { setNotice('Ce favori ancien doit être complété : utilisez Modifier et sélectionnez les lieux exacts.'); return }
    setRoute(favoriteDraft(from,to)); navigate('itineraires'); setLaunch({ id: crypto.randomUUID(), preferences, run })
  }
  function usePlace(place: SavedLocation, side: 'departure'|'arrival') {
    if (place.kind === 'unresolved') { setNotice('Sélectionnez à nouveau la localisation dans Modifier.'); return }
    setRoute(current => ({ ...current, [side]: place.name, [side+'StopId']: place.kind === 'stop' ? place.id : undefined, [side+'Address']: place.kind === 'address' ? place : undefined }))
    navigate('itineraires'); setLaunch({ id: crypto.randomUUID(), preferences: {}, run: false })
  }
  function clearAll() { const error = clearFavoriteStore(); if (error) { setNotice(error); return false }; setFavorites(emptyFavoriteStore()); setNotice('Tous les favoris de cette application ont été supprimés.'); return true }
  return <div className="app-shell">
    <a className="skip-link" href="#contenu">Aller au contenu</a>
    <header><div className="header-inner"><a className="brand" href="#" onClick={() => navigate('accueil')} aria-label="MonTrajet Lyon, accueil"><span className="brand-icon"><Navigation size={24}/></span><span>MonTrajet <b>Lyon</b><small>LA VILLE, À VOTRE RYTHME</small></span></a><nav aria-label="Navigation principale">{pages.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => navigate(id)} aria-current={page === id ? 'page' : undefined}><Icon size={17}/><span>{label}</span></button>)}</nav><span className="free-label">Libre et gratuit</span></div></header>
    <main id="contenu">
      <section className="hero"><div className="hero-copy"><span className="eyebrow"><span/> VOS DÉPLACEMENTS DANS LA MÉTROPOLE</span><h1>Lyon vous attend.<br/><em>Trouvez votre chemin.</em></h1><p>Bus, métro, tramway… préparez vos trajets du quotidien,<br className="desktop-break"/> simplement et au même endroit.</p><div className="transport-chips"><span>Métro</span><span>Tramway</span><span>Bus</span><span>Funiculaire</span></div></div><div className="network-art" aria-hidden="true"><div className="network-line line-one"/><div className="network-line line-two"/><div className="network-line line-three"/><span className="station station-one"/><span className="station station-two"/><span className="station station-three"/><div className="train-badge"><TrainFront size={50}/></div><span className="art-caption">Chaque trajet commence ici.</span></div></section>
      <div className="workspace">
        <div hidden={page !== 'accueil' && page !== 'itineraires'} className="content-grid"><JourneyForm route={route} onRouteChange={setRoute} onSave={addFavorite} settings={settings} onSettingsChange={setSettings} active={page === 'accueil' || page === 'itineraires'} places={favorites.places} launch={launch} onOpenFavorites={() => navigate('favoris')}/><aside><section className="panel side-panel"><span className="section-kicker">AU FIL DU RÉSEAU</span><h2>Un départ bien préparé.</h2><p>Retrouvez les informations utiles pour vos déplacements.</p><button className="feature-link" onClick={() => navigate('horaires')}><span className="feature-icon"><Clock3 size={21}/></span><span><strong>Prochains passages</strong><small>Rechercher une ligne et un arrêt</small></span><ArrowRight size={18}/></button><button className="feature-link" onClick={() => navigate('trafic')}><span className="feature-icon amber"><TriangleAlert size={21}/></span><span><strong>Information trafic</strong><small>Consulter les annonces officielles</small></span><ArrowRight size={18}/></button><div className="source-note"><span className="status-dot"/> Horaires théoriques selon le GTFS importé. Estimations selon la disponibilité de la source officielle.</div></section><section className="privacy-card"><Heart size={22}/><div><h3>Vos habitudes, à portée de main.</h3><p>Enregistrez vos trajets favoris, sans compte. Ils restent sur cet appareil.</p><button className="text-button" onClick={() => navigate('favoris')}>Voir mes favoris <ArrowRight size={15}/></button></div></section></aside></div>
        <div hidden={page !== 'horaires'}><Timetable/></div>
        {page === 'trafic' && <Traffic/>}
        {page === 'favoris' && <FavoritesPanel store={favorites} notice={notice} onCommit={save} onClear={clearAll} onUse={useFavorite} onUsePlace={usePlace}/>}
        <div className="transparency"><span><span className="status-dot"/> Une première étape, en toute transparence</span><p>Interface V0.1 · Les données de transport sont identifiées par leur source et leur nature.</p></div>
      </div>
    </main><footer><span>© MonTrajet Lyon <span className="footer-separator">/</span> Se déplacer simplement.</span><span>Gratuit · Sans publicité · <strong>V0.1</strong></span></footer>
  </div>
}




