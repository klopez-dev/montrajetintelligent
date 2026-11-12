import { useEffect, useState } from 'react'

/** Only local expiry and temporal labels. Never triggers a provider request. */
export function useTrafficClock() {
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer) }, [])
  return now
}
