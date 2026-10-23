import { useEffect } from 'react'

/**
 * Phone tables become stacked cards (CSS in index.css, `table.card-table`). A card needs each value to say which column it belongs to, so
 * this labels every cell from its column header. It only adds `data-label` attributes: nothing is removed, so every column, record, link,
 * input and click handler keeps working and the desktop table is untouched.
 */
export function labelCardTables(root: ParentNode = document) {
  for (const table of root.querySelectorAll<HTMLTableElement>('table.card-table')) {
    const heads = [...table.querySelectorAll<HTMLTableCellElement>(':scope > thead th')]
    if (!heads.length) continue
    const labels: string[] = []
    heads.forEach((th) => { const span = th.colSpan || 1; const text = (th.textContent ?? '').replace(/\s+/g, ' ').replace(/[↑↓]/g, '').trim(); for (let i = 0; i < span; i++) labels.push(text) })
    for (const row of table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr')) {
      const cells = [...row.children] as HTMLTableCellElement[]
      if (cells.some((c) => c.colSpan > 1)) { row.setAttribute('data-wide', ''); continue } // an expanded detail row
      cells.forEach((c, i) => {
        const l = labels[i] ?? ''
        if (l) c.setAttribute('data-label', l); else c.removeAttribute('data-label')
        if (!(c.textContent ?? '').trim() && !c.querySelector('input,select,button,a,svg,[role=progressbar]')) c.setAttribute('data-empty', '')
        else c.removeAttribute('data-empty')
      })
    }
  }
}

/** Keeps card-table labels current as React renders and re-renders tables (sorting, filtering, expanding, opening a sheet). */
export function useCardTableLabels(active: boolean) {
  useEffect(() => {
    if (!active) return
    let frame = 0
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => labelCardTables()) }
    run()
    const obs = new MutationObserver(run)
    obs.observe(document.body, { childList: true, subtree: true })
    return () => { obs.disconnect(); cancelAnimationFrame(frame) }
  }, [active])
}
