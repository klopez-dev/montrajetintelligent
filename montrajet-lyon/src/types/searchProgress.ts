export type SearchStage = 'addresses' | 'stops' | 'walking' | 'connections' | 'ranking' | 'reuse'
export interface SearchProgress { stage: SearchStage; at: string }
export type ProgressObserver = (event: SearchProgress) => void
export const searchStageLabels: Record<SearchStage, string> = {
  addresses: 'Recherche des adresses', stops: 'Identification des arrêts accessibles', walking: 'Calcul des parcours piétons', connections: 'Recherche des correspondances', ranking: 'Classement des itinéraires', reuse: 'Réutilisation d’un calcul valide',
}
