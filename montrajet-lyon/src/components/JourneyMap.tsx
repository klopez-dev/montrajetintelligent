import { useEffect, useRef, useState } from 'react'
import type { GeoJSONSource, Map as LibreMap, Marker } from 'maplibre-gl'
import type { TheoreticalJourney } from '../types/journey'
import type { DoorJourney } from '../types/mobility'
import type { MapStep, TransitMapResponse } from '../types/journeyMap'
import { mapSteps } from '../services/mapGeometry'
import { mapProvider, osmTiles } from '../services/mapProvider'
import 'maplibre-gl/dist/maplibre-gl.css'

export default function JourneyMap({journey,feedSha256,door}:{journey:TheoreticalJourney;feedSha256:string;door?:DoorJourney}){
  const container=useRef<HTMLDivElement>(null),map=useRef<LibreMap|null>(null),markers=useRef<Marker[]>([]),cache=useRef(new Map<string,TransitMapResponse>()),generation=useRef(0)
  const [steps,setSteps]=useState<MapStep[]>([]),[selected,setSelected]=useState(0),[ready,setReady]=useState(false),[error,setError]=useState(''),[tileError,setTileError]=useState(''),[loading,setLoading]=useState(true),[metrics,setMetrics]=useState({geometryMs:0,initMs:0,drawMs:0})
  const [loadedId,setLoadedId]=useState(''),[drawnId,setDrawnId]=useState('')
  const provider=mapProvider(import.meta.env.VITE_MAP_PROVIDER)
  useEffect(()=>{
    let disposed=false,instance:LibreMap|null=null
    const start=performance.now()
    void import('maplibre-gl').then(lib=>{
      if(disposed||!container.current)return
      try{
        instance=new lib.Map({container:container.current,center:[4.85,45.76],zoom:11,minZoom:8,maxZoom:18,maxBounds:[[3.5,44.5],[6.5,47]],cooperativeGestures:true,locale:{'NavigationControl.ZoomIn':'Zoomer','NavigationControl.ZoomOut':'Dézoomer','NavigationControl.ResetBearing':'Réinitialiser l’orientation','AttributionControl.ToggleAttribution':'Afficher les crédits','CooperativeGesturesHandler.WindowsHelpText':'Utilisez Ctrl et la molette pour zoomer','CooperativeGesturesHandler.MacHelpText':'Utilisez ⌘ et la molette pour zoomer','CooperativeGesturesHandler.MobileHelpText':'Utilisez deux doigts pour déplacer la carte','Map.Title':'Carte de l’itinéraire'},attributionControl:{compact:false},style:{version:8,sources:provider==='osm'?{basemap:{type:'raster',tiles:[osmTiles],tileSize:256,minzoom:0,maxzoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">contributeurs OpenStreetMap</a>'}}:{},layers:[{id:'background',type:'background',paint:{'background-color':'#edf2f5'}},...(provider==='osm'?[{id:'basemap',type:'raster' as const,source:'basemap'}]:[])]}})
        map.current=instance
        instance.addControl(new lib.NavigationControl({showCompass:false}),'top-right')
        instance.on('error',()=>setTileError('Le fond de carte ne peut pas être chargé complètement. Les arrêts, marches disponibles et détails textuels restent accessibles.'))
        instance.on('load',()=>{if(!disposed){setReady(true);setMetrics(m=>({...m,initMs:performance.now()-start}))}})
        instance.getCanvas().setAttribute('aria-label','Carte géographique : flèches pour déplacer, plus et moins pour zoomer')
      }catch{setError('Carte indisponible : WebGL non accessible. Consultez les résultats textuels.')}
    }).catch(()=>setError('Bibliothèque cartographique indisponible. Consultez les résultats textuels.'))
    return()=>{disposed=true;markers.current.forEach(m=>m.remove());markers.current=[];instance?.remove();map.current=null}
  },[provider])
  useEffect(()=>{
    const token=++generation.current,controller=new AbortController(),start=performance.now()
    setLoading(true);setError('');setSteps([]);setSelected(0);setLoadedId('');setDrawnId('')
    // Clear old geography immediately, including while a newer request is pending.
    markers.current.forEach(m=>m.remove());markers.current=[]
    const src=map.current?.getSource('walks') as GeoJSONSource|undefined;src?.setData({type:'FeatureCollection',features:[]})
    const body={feedSha256,legs:journey.legs.map(l=>({tripId:l.tripId,fromSequence:l.from.sequence,toSequence:l.to.sequence,fromStopId:l.from.id,toStopId:l.to.id}))},key=JSON.stringify(body)
    void(async()=>{
      try{
        let data=cache.current.get(key)
        if(!data){const response=await fetch('/api/maps',{method:'POST',headers:{'Content-Type':'application/json'},body:key,signal:controller.signal});if(!response.ok){const e=await response.json();throw new Error(e.error||`API carte HTTP ${response.status}`)}data=await response.json() as TransitMapResponse;if(controller.signal.aborted)return;if(cache.current.size>=20)cache.current.clear();cache.current.set(key,data)}
        if(controller.signal.aborted||generation.current!==token)return
        if(data.feedSha256!==feedSha256)throw new Error('Le GTFS cartographique ne correspond plus au trajet.')
        setSteps(mapSteps(journey,data,door));setLoadedId(journey.id);setMetrics(m=>({...m,geometryMs:performance.now()-start}))
      }catch(e){if(!controller.signal.aborted&&generation.current===token)setError(e instanceof Error?e.message:'Données cartographiques indisponibles.')}
      finally{if(!controller.signal.aborted&&generation.current===token)setLoading(false)}
    })()
    return()=>controller.abort()
  },[journey,feedSha256,door])
  function recenter(){
    const points=steps.flatMap(s=>[...s.points.map(p=>p.coordinate),...(s.geometry?.coordinates||[])])
    if(!map.current||!points.length)return
    map.current.fitBounds([[Math.min(...points.map(p=>p[0])),Math.min(...points.map(p=>p[1]))],[Math.max(...points.map(p=>p[0])),Math.max(...points.map(p=>p[1]))]],{padding:40,maxZoom:15,duration:0})
  }
  useEffect(()=>{
    if(!ready||!map.current)return
    const instance=map.current,start=performance.now();let disposed=false
    void import('maplibre-gl').then(lib=>{
      if(disposed||map.current!==instance)return
      markers.current.forEach(m=>m.remove());markers.current=[]
      const features=steps.flatMap((s,i)=>s.geometry?[{type:'Feature' as const,properties:{step:i},geometry:s.geometry}]:[])
      const source=instance.getSource('walks') as GeoJSONSource|undefined
      if(source)source.setData({type:'FeatureCollection',features})
      else{instance.addSource('walks',{type:'geojson',data:{type:'FeatureCollection',features}});instance.addLayer({id:'walks',type:'line',source:'walks',paint:{'line-color':'#18766d','line-width':4,'line-dasharray':[2,2]}})}
      instance.setPaintProperty('walks','line-width',['case',['==',['get','step'],selected],7,3])
      const counts=steps.flatMap(s=>s.points);let globalIndex=0
      steps.forEach((step,i)=>step.points.forEach((point,j)=>{
        const node=document.createElement('button');node.type='button';node.className='map-point'+(selected===i?' selected':'');node.style.borderColor=step.color
        const connection=step.kind==='transfer'||(step.kind==='ride'&&((j===0&&steps.slice(0,i).some(s=>s.kind==='ride'))||(j===step.points.length-1&&steps.slice(i+1).some(s=>s.kind==='ride'))))
        node.textContent=globalIndex===0?'D':globalIndex===counts.length-1?'A':connection?'C':String(i+1)
        node.setAttribute('aria-label',`${step.title} · ${point.label}`);node.title=`${step.title} · ${point.label}`;node.onclick=()=>setSelected(i)
        // The labels are plain text, including official stop names; no injected HTML.
        const marker=new lib.Marker({element:node,anchor:'center'}).setLngLat(point.coordinate).addTo(instance);markers.current.push(marker);globalIndex++
        if(j===0)node.dataset.step=String(i)
      }))
      if(steps.length)recenter()
      instance.once('render',()=>{if(!disposed){setMetrics(m=>({...m,drawMs:performance.now()-start}));setDrawnId(loadedId)}})
    })
    return()=>{disposed=true}
  // The displayed geography is rebuilt only for a selected proposal or step.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[steps,ready,selected,loadedId])
  const step=steps[selected]
  return <section className="journey-map" data-map-journey={drawnId} data-map-loading={loading} aria-label="Carte de la proposition sélectionnée">
    <h3>Carte de l’itinéraire sélectionné</h3>
    <p className="search-hint">Transports : arrêts officiels uniquement, tracés absents du GTFS. Marches : parcours IGN disponibles, en pointillés. D : départ représenté · A : arrivée représentée · C : correspondance. Les raccordements IGN au réseau ne sont pas dessinés.</p>
    <button type="button" className="secondary map-recenter" onClick={recenter} disabled={!steps.length}>Recentrer l’itinéraire</button>
    {loading&&<p role="status">Chargement des arrêts de cette proposition…</p>}
    {error&&<p className="message error map-error" role="alert">{error}</p>}
    {tileError&&<p className="message map-tile-error" role="status">{tileError}</p>}
    {provider==='none'&&<p>Fond distant désactivé : vue géographique sans rues ni repères de fond.</p>}
    <div ref={container} className="map-canvas"/>
    {step&&<div className="map-step-info" role="status"><strong>{step.title}</strong><p>{step.description}</p><small>{step.geometrySource}</small></div>}
    <ol className="map-steps">{steps.map((s,i)=><li key={s.id}><button type="button" aria-pressed={selected===i} onClick={()=>setSelected(i)}><strong>{i+1}. {s.title}</strong><span>{s.description}</span><small>{s.geometrySource}</small></button></li>)}</ol>
    <p className="search-hint">Carte complémentaire : tous les horaires et détails restent dans les résultats textuels. {provider==='osm'&&<a href="https://www.openstreetmap.org/fixthemap" target="_blank" rel="noreferrer">Signaler un problème de fond de carte</a>}</p>
    <details className="map-metrics"><summary>Mesures de la carte</summary><p>Arrêts/API : {metrics.geometryMs.toFixed(1)} ms · Initialisation : {metrics.initMs.toFixed(1)} ms · Premier rendu après mise à jour : {metrics.drawMs.toFixed(1)} ms.</p></details>
  </section>
}
