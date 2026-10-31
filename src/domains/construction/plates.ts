import type { AnchorageComponent, FoundationEmbed, LibraryEmbedPlate, PlateSpec } from './types'

/** Embed plates created in the foundation form: a plate size and optional headed studs, with no anchorage type behind them. */
const n = (v: number) => String(Number(v.toFixed(4)))
export const plateSize = (p: PlateSpec) => `${n(p.thickness)} × ${n(p.width)} × ${n(p.length)} ${p.unit}`
export const plateStuds = (p: PlateSpec) => (p.studCount && p.studDiameter && p.studLength ? `w/ ${p.studCount} headed stud${p.studCount === 1 ? '' : 's'} Ø${n(p.studDiameter)} × ${n(p.studLength)} ${p.unit} long` : '')
/** "16 × 300 × 300 mm w/ 4 headed studs Ø19 × 150 mm long". */
export const plateText = (p: PlateSpec) => [plateSize(p), plateStuds(p)].filter(Boolean).join(' ')
export const samePlate = (a: PlateSpec, b: PlateSpec) => plateText(a) === plateText(b)

/** The plate as the anchorage component it is equivalent to (no anchorage type), so quantities, specifications and consolidation work like any other embed plate. */
export const plateAsComponent = (p: PlateSpec, id: string): AnchorageComponent => ({
  id, anchorageTypeId: '', kind: 'embed-plate', qty: 1, label: '', spec: '', size: plateText(p), diameter: '', length: null, lengthUnit: p.unit, thread: null, topThread: null, bottomThread: null,
  nutsPerBolt: 0, washersPerBolt: 0, nutSize: '', washerSize: '',
})

/** What a foundation's embed plate entry refers to: a library embed plate (an anchorage type's, or one saved to the library), or its own specification. */
export function embedComponent(e: FoundationEmbed, byId: Map<string, AnchorageComponent>): AnchorageComponent | undefined {
  if (e.componentId) return byId.get(e.componentId)
  return e.plate ? plateAsComponent(e.plate, `fe:${e.id}`) : undefined
}

/** Every embed plate component a foundation or individual foundation can refer to: anchorage types' embed plates and plates saved to the library. */
export function componentMap(c: { anchorageComponents?: AnchorageComponent[]; libraryEmbedPlates?: LibraryEmbedPlate[] }): Map<string, AnchorageComponent> {
  const m = new Map<string, AnchorageComponent>()
  for (const x of c.anchorageComponents ?? []) m.set(x.id, x)
  for (const p of c.libraryEmbedPlates ?? []) m.set(p.id, plateAsComponent(p, p.id))
  return m
}
