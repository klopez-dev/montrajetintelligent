import { Component, lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import type { TheoreticalJourney } from '../types/journey'
import type { DoorJourney } from '../types/mobility'
const JourneyMap=lazy(()=>import('./JourneyMap'))
class MapBoundary extends Component<{children:ReactNode},{failed:boolean}> {
  state={failed:false}
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<p className="message error" role="alert">La carte n’a pas pu être chargée. Les résultats textuels restent disponibles.</p>:this.props.children}
}
export function JourneyMapSlot(props:{journey:TheoreticalJourney;feedSha256:string;door?:DoorJourney}){
  return <MapBoundary><Suspense fallback={<p role="status">Chargement de la bibliothèque cartographique…</p>}><JourneyMap {...props}/></Suspense></MapBoundary>
}
