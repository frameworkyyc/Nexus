import { useMemo } from 'react'
import { buildCatalog, type Catalog } from '../catalog'
import { useConstruction } from '../../store'
import type { SupplierRecord } from '../suppliers'
import { useTracker } from '../store'
import type { ComponentCategory } from '../types'

export interface MaterialRefs {
  catalog: Catalog
  suppliers: SupplierRecord[]
  /** Suppliers that can be chosen for new entries (not archived). */
  activeSuppliers: SupplierRecord[]
  preferred: Partial<Record<ComponentCategory, string>>
  /** Preferred supplier id for a category, or '' when none is configured. */
  preferredFor: (c: ComponentCategory) => string
}

/** The project's areas, foundations, anchorage types and suppliers, read from the records they already live in. */
export function useMaterialRefs(projectId?: string): MaterialRefs {
  const { state: construction } = useConstruction()
  const { state: tracker } = useTracker()
  return useMemo(() => {
    const suppliers = tracker.suppliers ?? []
    const preferred = tracker.preferredSuppliers ?? {}
    const usable = (id?: string) => (id && suppliers.some((s) => s.id === id && !s.archived) ? id : '')
    return {
      catalog: buildCatalog(construction, tracker, projectId), suppliers, activeSuppliers: suppliers.filter((s) => !s.archived), preferred,
      preferredFor: (c) => usable(preferred[c]),
    }
  }, [construction, tracker, projectId])
}
