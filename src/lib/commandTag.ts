/**
 * Action creators in each domain return plain reducers. Tagging records which creator and arguments produced a reducer, so
 * the same call can be run locally (demonstration mode) or sent to the server as a command (saved-data mode) — one set of
 * business rules, one call site.
 */
export interface CommandMeta { module: string; name: string; args: unknown[] }

const tags = new WeakMap<object, CommandMeta>()

export const commandOf = (reducer: unknown): CommandMeta | undefined => (typeof reducer === 'function' ? tags.get(reducer) : undefined)

type AnyFn = (...args: never[]) => unknown

export function tagModule<T extends Record<string, unknown>>(module: string, mod: T): T {
  const out: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== 'function') { out[name] = value; continue }
    out[name] = (...args: unknown[]) => {
      const reducer = (value as (...a: unknown[]) => unknown)(...args)
      if (typeof reducer === 'function') tags.set(reducer, { module, name, args })
      return reducer
    }
  }
  return out as T
}

export type { AnyFn }
