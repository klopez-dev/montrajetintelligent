import type { KeyboardEvent } from 'react'

/** Edge headless does not always activate <summary> with Enter; Space remains native. */
export function toggleSummaryOnEnter(event:KeyboardEvent<HTMLElement>){
 if(event.key!=='Enter')return
 const details=event.currentTarget.parentElement
 if(!(details instanceof HTMLDetailsElement))return
 event.preventDefault()
 details.open=!details.open
}
