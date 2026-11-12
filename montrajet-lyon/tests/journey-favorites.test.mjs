import { test,beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFavorites,writeFavorites } from '../src/services/favorites.ts'
let values
beforeEach(()=>{values=new Map();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)}})})
test('Les favoris anciens sans quai restent conservés et réutilisables comme saisie',()=>{
  const data=[{id:'old',departure:'Place Henri',arrival:'Vaulx-en-Velin La Soie'}]
  assert.equal(writeFavorites(data),'');assert.deepEqual(readFavorites().items,data)
})
test('Les nouveaux favoris conservent exactement les quais sélectionnés',()=>{
  const data=[{id:'new',departure:'Place Henri',arrival:'Vaulx-en-Velin La Soie',departureStopId:'2397',arrivalStopId:'36394'}]
  writeFavorites(data);assert.deepEqual(readFavorites().items,data)
})
test('Un identifiant de quai illisible ne plante pas React et ne détruit pas le stockage',()=>{
  const raw=JSON.stringify([{id:'bad',departure:'A',arrival:'B',departureStopId:{invalid:true}}])
  values.set('montrajet-lyon:favorites:v1',raw)
  assert.ok(readFavorites().error);assert.deepEqual(readFavorites().items,[])
  assert.equal(values.get('montrajet-lyon:favorites:v1'),raw)
})
