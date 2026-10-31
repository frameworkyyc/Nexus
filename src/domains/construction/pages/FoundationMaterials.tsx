import { displayName, specText } from '../tracker/consolidate'
import { StageBadge } from '../tracker/manage/MaterialsByArea'
import { materialsModel } from '../tracker/model'
import { CATEGORY_ORDER } from '../tracker/selectors'
import type { Index } from '../selectors'

const fmt = (n: number) => n.toLocaleString('en-CA')

/**
 * The materials one foundation needs, from the unified materials model (the same rows as Materials and Procurement): what this foundation needs of each
 * requirement, how much of it has been allocated to this foundation, and where the whole requirement stands (pending, ordered, delivered, installed).
 */
export function FoundationMaterials({ idx, foundationId }: { idx: Index; foundationId: string }) {
  const byCategory = idx.tracker ? materialsModel(idx.tracker, idx.state).forFoundation(foundationId) : {}
  const cats = CATEGORY_ORDER.filter((c) => byCategory[c])
  if (cats.length === 0) return <p className="text-[13px] text-muted">No materials are required for this foundation yet. They appear once an anchorage type is assigned to it, or bolts or plates are added to it.</p>
  return (
    <table className="card-table w-full text-left text-[13px]" aria-label="Materials for this foundation">
      <thead><tr className="border-b border-line">
        <th scope="col" className="t-label font-medium">Material</th><th scope="col" className="t-label text-right font-medium">Needed here</th>
        <th scope="col" className="t-label text-right font-medium">Allocated here</th><th scope="col" className="t-label font-medium">Requirement status</th>
      </tr></thead>
      <tbody>
        {cats.flatMap((c) => byCategory[c]!.rows.map(({ row, needed, allocated }) => (
          <tr key={row.key} className="border-b border-line">
            <td data-wrap><span className="font-medium">{displayName(row)}</span><span className="block text-xs text-muted">{specText(row) || row.unit}</span></td>
            <td className="text-right">{fmt(needed)}</td>
            <td className="text-right">{fmt(allocated)}</td>
            <td><StageBadge stage={row.stage} /></td>
          </tr>
        )))}
      </tbody>
    </table>
  )
}
