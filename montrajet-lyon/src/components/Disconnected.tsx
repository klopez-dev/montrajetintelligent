import { Unplug } from 'lucide-react'
import type { ReactNode } from 'react'
export function Disconnected({ title, children }: { title: string; children: ReactNode }) {
  return <div className="disconnected"><Unplug size={24}/><div><h3>{title}</h3><p>{children}</p></div></div>
}
