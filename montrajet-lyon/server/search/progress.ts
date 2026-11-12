import type { ProgressObserver, SearchStage } from '../../src/types/searchProgress.ts'
export async function reportStage(observer: ProgressObserver | undefined, stage: SearchStage) {
  if (!observer) return
  observer({ stage, at: new Date().toISOString() })
  // Flush actual state before synchronous SQLite/CPU work; no simulated delay.
  await new Promise(resolve => setTimeout(resolve, 0))
}
