/** A tiny channel so code outside React (the data stores) can show a message in the toast. */
type Listener = (message: string) => void
const listeners = new Set<Listener>()
export const notify: Listener = (m) => listeners.forEach((l) => l(m))
export const onNotify = (l: Listener) => { listeners.add(l); return () => { listeners.delete(l) } }
