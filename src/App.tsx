import { useState } from 'react'
import { ArrowDownUp, ArrowRight, Bell, BusFront, Clock3, Heart, MapPin, Navigation, Route, Search, TrainFront, TriangleAlert } from 'lucide-react'
import './App.css'

type Tab = 'trajets' | 'horaires' | 'trafic' | 'favoris'

const tabs: { id: Tab; label: string; icon: typeof Route }[] = [
  { id: 'trajets', label: 'Itinéraires', icon: Route },
  { id: 'horaires', label: 'Horaires', icon: Clock3 },
  { id: 'trafic', label: 'Trafic', icon: TriangleAlert },
  { id: 'favoris', label: 'Favoris', icon: Heart },
]

function App() {
  const [tab, setTab] = useState<Tab>('trajets')
  const [departure, setDeparture] = useState('')
  const [arrival, setArrival] = useState('')
  const [when, setWhen] = useState('now')
  const [dateTime, setDateTime] = useState('')
  const [message, setMessage] = useState('')

  function searchJourney(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!departure.trim() || !arrival.trim()) {
      setMessage('Renseigne un point de départ et une destination.')
      return
    }
    setMessage('Recherche enregistrée dans le formulaire. Le calculateur d’itinéraires sera connecté aux données TCL lors de la prochaine étape.')
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Navigation size={22} /></div><div><strong>MonTrajet <span>Lyon</span></strong><small>Vos déplacements, simplifiés.</small></div></div>
        <span className="header-status"><span className="status-dot" /> Version de démonstration</span>
      </header>

      <main className="page-content">
        <section className="hero">
          <div className="hero-copy"><div className="eyebrow"><span className="eyebrow-dot" /> Mobilité dans la métropole de Lyon</div><h1>La ville à portée<br /><em>de trajet.</em></h1><p>Préparez vos déplacements en bus, métro et tramway depuis une seule interface.</p></div>
          <div className="hero-decoration" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="transport-icon"><TrainFront size={54}/></div></div>
        </section>

        <nav className="tabs" aria-label="Navigation principale">{tabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => { setTab(id); setMessage('') }}><Icon size={18} />{label}</button>)}</nav>

        {tab === 'trajets' ? <section className="content-grid"><div className="panel journey-panel"><div className="section-heading"><div><span className="section-kicker">PLANIFIER</span><h2>Où allons-nous ?</h2></div><div className="section-icon"><Route size={22}/></div></div><form onSubmit={searchJourney}><div className="route-fields"><label className="field"><span>Départ</span><div className="input-wrap"><MapPin size={18}/><input value={departure} onChange={event => setDeparture(event.target.value)} placeholder="Adresse ou arrêt de départ" aria-label="Départ" /></div></label><button type="button" className="swap-button" title="Inverser départ et arrivée" aria-label="Inverser départ et arrivée" onClick={() => {setDeparture(arrival); setArrival(departure)}}><ArrowDownUp size={17}/></button><label className="field"><span>Destination</span><div className="input-wrap"><Navigation size={18}/><input value={arrival} onChange={event => setArrival(event.target.value)} placeholder="Adresse ou arrêt d’arrivée" aria-label="Destination" /></div></label></div><div className="when-row"><label className="field"><span>Quand partir ?</span><select value={when} onChange={event => setWhen(event.target.value)}><option value="now">Dès que possible</option><option value="departure">Partir à…</option><option value="arrival">Arriver à…</option></select></label>{when !== 'now' && <label className="field"><span>Date et heure</span><input className="date-input" type="datetime-local" value={dateTime} onChange={event => setDateTime(event.target.value)} required /></label>}</div><button className="primary-button" type="submit"><Search size={19}/> Rechercher un itinéraire <ArrowRight size={18}/></button>{message && <p className="form-message" role="status">{message}</p>}</form></div><aside className="side-stack"><div className="panel info-panel"><div className="side-title"><BusFront size={20}/><h3>Prochains passages</h3></div><p>Les horaires officiels seront disponibles après la connexion aux données TCL.</p><span className="soft-tag"><Clock3 size={14}/> Connexion à venir</span></div><div className="panel info-panel"><div className="side-title"><TriangleAlert size={20}/><h3>État du trafic</h3></div><p>Les perturbations seront affichées ici dès l’intégration d’une source vérifiée.</p><span className="soft-tag"><Bell size={14}/> Données non connectées</span></div></aside></section> : <section className="panel placeholder-panel"><div className="placeholder-icon">{tab === 'horaires' ? <Clock3 size={28}/> : tab === 'trafic' ? <TriangleAlert size={28}/> : <Heart size={28}/>}</div><h2>{tab === 'horaires' ? 'Horaires des lignes TCL' : tab === 'trafic' ? 'Perturbations du réseau' : 'Mes trajets favoris'}</h2><p>{tab === 'horaires' ? 'Recherche de lignes et d’arrêts à connecter aux données officielles.' : tab === 'trafic' ? 'Les alertes seront affichées ici une fois leur source officielle intégrée.' : 'Vous pourrez bientôt retrouver vos trajets préférés en un clic.'}</p><span className="soft-tag">Module en préparation</span></section>}

        <div className="footnote"><span><span className="footnote-dot"/> Interface de démonstration — aucune donnée de transport en direct</span><span>MonTrajet Lyon · V0.1</span></div>
      </main>
    </div>
  )
}

export default App
