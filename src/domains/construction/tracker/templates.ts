import type { ComponentCategory } from './types'

/** Starting points for common workbook items. Choosing one fills category, unit and a name pattern; nothing is added until saved. */
export interface MaterialTemplate { id: string; label: string; category: ComponentCategory; unit: string; name: string; specification: string }
export const MATERIAL_TEMPLATES: MaterialTemplate[] = [
  { id: 'anchor-bolt', label: 'Anchor bolt', category: 'bolt', unit: 'ea', name: 'Anchor bolt ', specification: 'ASTM F1554 Gr.36' },
  { id: 'nut', label: 'Nut', category: 'nut', unit: 'ea', name: 'Heavy hex nut ', specification: 'ASTM A563' },
  { id: 'washer', label: 'Washer', category: 'washer', unit: 'ea', name: 'Plate washer ', specification: 'ASTM F436' },
  { id: 'template', label: 'Plywood template', category: 'template', unit: 'ea', name: 'Plywood template', specification: '' },
  { id: 'sole-plate', label: 'Sole plate', category: 'sole-plate', unit: 'ea', name: 'Sole plate ', specification: '' },
  { id: 'embed-plate', label: 'Embed plate', category: 'embed-plate', unit: 'ea', name: 'Embed plate ', specification: '' },
]
export const UNITS = ['ea', 'set', 'pair', 'bag', 'm', 'kg', 'L', 'box']
