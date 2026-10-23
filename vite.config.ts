import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolveBundle } from './scripts/bundle-mode.mjs'
import { DEMO_FORBIDDEN, findForbidden } from './scripts/demo-forbidden.mjs'

const identityOf = (id: string) => /[\\/]src[\\/]app[\\/]identity\.ts$/.test(id)

/** In the demo bundle the real identity module is replaced by the fictional one, so real names never enter the build graph. */
const demoIdentity = (): Plugin => ({
  name: 'nexus-demo-identity',
  enforce: 'pre',
  async resolveId(source, importer, options) {
    if (!/identity$/.test(source)) return null
    const r = await this.resolve(source, importer, { ...options, skipSelf: true })
    return r && identityOf(r.id) ? r.id.replace(/identity\.ts$/, 'identity.demo.ts') : null
  },
})

/** Fails the build if anything that identifies the real organization, project or fleet reached a public bundle. */
const demoGuard = (): Plugin => ({
  name: 'nexus-demo-guard',
  generateBundle(_, bundle) {
    const hits: string[] = []
    for (const [file, out] of Object.entries(bundle)) {
      const text = out.type === 'chunk' ? out.code : typeof out.source === 'string' ? out.source : Buffer.from(out.source).toString('utf8')
      for (const f of findForbidden(text)) {
        const m = new RegExp(f.slice(1, f.lastIndexOf('/')), f.slice(f.lastIndexOf('/') + 1)).exec(text)
        hits.push(`${file}: ${f}  …${m ? text.slice(Math.max(0, m.index - 60), m.index + 60).replace(/\s+/g, ' ') : ''}…`)
      }
    }
    if (hits.length) this.error(`The public demo bundle contains real identifying data (${DEMO_FORBIDDEN.length} patterns checked):\n  ${hits.slice(0, 20).join('\n  ')}`)
  },
})

export default defineConfig(() => {
  const bundle = resolveBundle(process.env)
  return {
    plugins: [...(bundle === 'demo' ? [demoIdentity()] : []), react(), tailwindcss(), ...(bundle === 'demo' ? [demoGuard()] : [])],
    define: { __NEXUS_BUNDLE__: JSON.stringify(bundle) },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  }
})
