// Production pre-flight: checks a running Nexus (a Version URL before cutover, or the live site after) from the outside, with no credentials.
// Usage: node scripts/preflight.mjs https://<version-or-live-host>
// Passes only if the API reports production + WorkOS, every protected endpoint refuses an unauthenticated request, and the WorkOS login redirects correctly.
const base = (process.argv[2] ?? '').replace(/\/+$/, '')
if (!/^https?:\/\//.test(base)) { console.error('Usage: node scripts/preflight.mjs https://host'); process.exit(2) }
const CLIENT = 'client_01M6BZ6XSCEHJM3P69FW4C2T9S'
const CALLBACK = 'https://nexus.frameworktools.ca/api/auth/callback'
let failed = 0
const check = (ok, label, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : detail ? `  (${detail})` : ''}`); if (!ok) failed++ }
const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, redirect: 'manual', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers }
}

const health = await call('GET', '/api/health')
check(health.status === 200 && health.json?.ok === true, 'GET /api/health answers', `status ${health.status}`)
check(health.json?.environment === 'production', 'environment is production', String(health.json?.environment))
check(health.json?.auth === 'workos', 'sign-in is WorkOS only', String(health.json?.auth))
check(health.json?.database === true, 'database is bound', String(health.json?.database))
check(health.json?.access === true, 'sign-in is fully configured (client id, API key, pepper, base URL)', String(health.json?.access))
check(JSON.stringify(Object.keys(health.json ?? {}).sort()) === JSON.stringify(['access', 'auth', 'database', 'environment', 'ok']), 'health reveals configuration only, never data')

for (const [method, path] of [['GET', '/api/session'], ['GET', '/api/state/construction'], ['GET', '/api/state/materials'], ['GET', '/api/state/fleet'], ['POST', '/api/commands'], ['GET', '/api/members'], ['POST', '/api/members/invite'], ['POST', '/api/members/revoke'], ['GET', '/api/roles'], ['POST', '/api/roles'], ['GET', '/api/backup'], ['GET', '/api/integrity'], ['POST', '/api/migrate/preview'], ['POST', '/api/migrate/apply']]) {
  const r = await call(method, path, method === 'POST' ? {} : undefined)
  check(r.status === 401 && !r.json?.state && !r.json?.members && !r.json?.roles, `${method} ${path} refuses an unauthenticated request`, `status ${r.status}`)
}

const login = await call('GET', '/api/auth/login')
const loc = login.headers.get('location') ?? ''
const u = (() => { try { return new URL(loc) } catch { return null } })()
check(login.status === 302 && !!u, 'GET /api/auth/login redirects', `status ${login.status}`)
check(u?.origin === 'https://api.workos.com' && u?.pathname === '/user_management/authorize', 'redirects to WorkOS AuthKit', loc.slice(0, 60))
check(u?.searchParams.get('client_id') === CLIENT, 'uses the Nexus Production client id', u?.searchParams.get('client_id') ?? '')
check(u?.searchParams.get('redirect_uri') === CALLBACK, 'callback is https://nexus.frameworktools.ca/api/auth/callback', u?.searchParams.get('redirect_uri') ?? '')
check(u?.searchParams.get('response_type') === 'code' && u?.searchParams.get('provider') === 'authkit' && u?.searchParams.get('code_challenge_method') === 'S256' && (u?.searchParams.get('state') ?? '').length > 20, 'authorization-code flow with PKCE (S256) and a state value')
const cookie = login.headers.get('set-cookie') ?? ''
check(/^__Host-nx_auth=/.test(cookie) && /HttpOnly/.test(cookie) && /Secure/.test(cookie) && /SameSite=Lax/.test(cookie), 'sign-in state cookie is __Host-, HttpOnly, Secure, SameSite=Lax')

const cb = await call('GET', '/api/auth/callback?code=abc&state=forged')
check(cb.status === 400 && !/__Host-nx_session=[^;]/.test(cb.headers.get('set-cookie') ?? ''), 'a forged callback is refused and starts no session', `status ${cb.status}`)

const shell = await call('GET', '/')
check(shell.status === 200 && /<div id="root"/.test(shell.text), 'the application shell loads (static, no data)', `status ${shell.status}`)
check(!/"projects"\s*:\s*\[\s*\{/.test(shell.text), 'the page carries no project data')

console.log(failed ? `\n${failed} check(s) FAILED: do not release.` : '\nAll pre-flight checks passed.')
process.exit(failed ? 1 : 0)
