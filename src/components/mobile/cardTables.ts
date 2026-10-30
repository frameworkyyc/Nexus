import { useEffect } from 'react'

/**
 * Phone tables become stacked cards (CSS in index.css, `table.card-table`). A card needs each value to say which column it belongs to, so
 * this labels every cell from its column header. It only adds `data-label` attributes: nothing is removed, so every column, record, link,
 * input and click handler keeps working and the desktop table is untouched.
 */
/** A cell that is only a number (optionally with a unit, %, currency) or an empty-value dash. */
const NUMERIC = /^[−–-]?\s*\$?\d[\d,]*(\.\d+)?\s*(%|ea|m|m²|m³|mm|in|ft|kg|t|h|hrs?|km|l|days?|d)?$/i
const DASH = /^[—–-]$/
/** True when every non-empty value in a column is a number (with a unit or %) or an empty-value dash, and at least one is a real number. */
export function isNumericColumn(texts: string[]): boolean {
  const t = texts.map((x) => x.replace(/\s+/g, ' ').trim()).filter((x) => x !== '')
  return t.length > 0 && t.some((x) => !DASH.test(x)) && t.every((x) => DASH.test(x) || NUMERIC.test(x))
}

/**
 * The Nexus table standard (CSS: `.nx-t` in index.css). Every table inside <main> follows it automatically; a table opts out with
 * data-table="free" (the crew calendar grid). This adds what CSS cannot know: which columns are numeric (right-aligned, header and cells
 * together) and a title on every cell whose text is cut off, so the full value is always one hover away.
 */
export function standardizeTables(root: ParentNode = document) {
  for (const table of root.querySelectorAll<HTMLTableElement>('main table:not([data-table="free"])')) {
    table.classList.add('nx-t')
    const heads = [...table.querySelectorAll<HTMLTableCellElement>(':scope > thead th')]
    const rows = [...table.querySelectorAll<HTMLTableRowElement>(':scope > tbody > tr')].filter((r) => ![...r.children].some((c) => (c as HTMLTableCellElement).colSpan > 1))
    heads.forEach((th, i) => {
      if (/\btext-(right|center)\b/.test(th.className)) return
      const numeric = isNumericColumn(rows.map((r) => (r.children[i] as HTMLElement | undefined)?.textContent ?? ''))
      th.toggleAttribute('data-num', numeric)
      for (const r of rows) { const c = r.children[i] as HTMLElement | undefined; if (c && !/\btext-(right|center)\b/.test(c.className)) c.toggleAttribute('data-num', numeric) }
    })
    for (const cell of table.querySelectorAll<HTMLElement>(':scope > tbody > tr > td')) {
      const cut = cell.scrollWidth > cell.clientWidth + 1
      const text = (cell.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (cut && text && !cell.hasAttribute('title') ) cell.setAttribute('title', text)
      else if (!cut && cell.getAttribute('data-auto-title') !== null && cell.getAttribute('title') === text) cell.removeAttribute('title')
      if (cut) cell.setAttribute('data-auto-title', ''); else cell.removeAttribute('data-auto-title')
    }
  }
}

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

/** Keeps the table standard (every screen size) and card-table labels (phones) current as React renders and re-renders tables. */
export function useCardTableLabels(phone: boolean) {
  useEffect(() => {
    let frame = 0
    const run = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { standardizeTables(); if (phone) labelCardTables() }) }
    run()
    const obs = new MutationObserver(run)
    obs.observe(document.body, { childList: true, subtree: true })
    window.addEventListener('resize', run)
    return () => { obs.disconnect(); window.removeEventListener('resize', run); cancelAnimationFrame(frame) }
  }, [phone])
}
