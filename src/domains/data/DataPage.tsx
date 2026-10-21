import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { PageHeader } from '@/components/ui/PageHeader'
import { Section } from '@/components/ui/Section'
import { api, ApiError } from '@/lib/api'
import { reloadAll, useBackend, useSyncStatus } from '@/lib/dataSource'
import { formatDate } from '@/lib/format'
import type { Backup, IntegrityReport } from '@/worker/service'
import type { MigrationBundle, MigrationReport } from '@/worker/migrate'
import { clearBrowserCopy, download, fullBrowserBackup, migrationBundle, summarizeLocal } from './localExport'

const LAST_BACKUP = 'nexus.lastServerBackup'
const readLast = () => { try { return localStorage.getItem(LAST_BACKUP) } catch { return null } }
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('')
const days = (iso: string) => Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)

export function DataPage() {
  const backend = useBackend()
  const sync = useSyncStatus()
  const server = backend.mode === 'server'
  return (
    <>
      <PageHeader title="Data & backups" description="Where your records are stored, how to back them up, and how to bring over anything entered before saving was switched on." />
      <dl className="grid grid-cols-2 gap-6 border-y border-line py-6 lg:grid-cols-4">
        <div><dt className="t-label">Storing records in</dt><dd className="mt-1 text-[15px]">{server ? 'Server database' : 'This browser only'}</dd></div>
        <div><dt className="t-label">Environment</dt><dd className="mt-1 text-[15px]">{server ? backend.environment ?? 'unknown' : backend.mode === 'demo' ? 'Demonstration' : '—'}</dd></div>
        <div><dt className="t-label">Signed in as</dt><dd className="mt-1 break-all text-[15px]">{server ? backend.user ?? '—' : '—'}</dd></div>
        <div><dt className="t-label">Last saved</dt><dd className="mt-1 text-[15px]">{sync.lastSavedAt ? new Date(sync.lastSavedAt).toLocaleTimeString('en-CA') : '—'}</dd></div>
      </dl>
      {!server && <p className="mt-4 max-w-2xl text-[13px] text-muted">{backend.reason ?? 'The app is showing demonstration data.'} Nothing entered now is saved to a server or visible on other devices.</p>}
      {server && <ServerBackup />}
      <BrowserData server={server} />
      {server && <Migration />}
      <Section title="Recovery">
        <ul className="max-w-2xl list-disc space-y-1.5 pl-5 text-[13px] text-muted">
          <li>Download a backup before any large change (importing a workbook, bulk edits) and at least weekly while you rely on Nexus.</li>
          <li>The database also keeps point-in-time history (Cloudflare D1 Time Travel). Use it for “undo the last hour” recovery; use a downloaded backup for anything older or to keep a copy outside Cloudflare.</li>
          <li>Restoring is an operator step by design (it replaces data). The exact commands are in <code className="text-xs">docs/OPERATIONS.md</code>.</li>
        </ul>
      </Section>
    </>
  )
}

function ServerBackup() {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null)
  const [last, setLast] = useState(readLast())
  const backup = async () => {
    setBusy(true); setMsg(null)
    try {
      const b = await api<Backup>('GET', '/api/backup')
      download(`nexus-backup-${b.createdAt.slice(0, 10)}.json`, b)
      localStorage.setItem(LAST_BACKUP, b.createdAt); setLast(b.createdAt)
      setMsg(`Backup downloaded: ${Object.values(b.counts).reduce((s, n) => s + n, 0).toLocaleString('en-CA')} records. Keep the file somewhere safe.`)
    } catch (e) { setMsg(e instanceof Error ? `The backup failed: ${e.message}` : 'The backup failed.') } finally { setBusy(false) }
  }
  const check = async () => { setBusy(true); try { setIntegrity(await api<IntegrityReport>('GET', '/api/integrity')) } catch (e) { setMsg(e instanceof Error ? e.message : 'The check failed.') } finally { setBusy(false) } }
  const stale = !last || days(last) >= 7
  return (
    <Section title="Server backup" description="A complete, checksummed copy of every saved record and its history (JSON).">
      <p className={`mb-3 text-[13px] ${stale ? 'text-warn' : 'text-muted'}`}>{last ? `Last backup downloaded from this browser: ${formatDate(last.slice(0, 10))}${stale ? ' — a new one is due.' : '.'}` : 'No backup has been downloaded from this browser yet.'}</p>
      <div className="flex flex-wrap gap-2"><Button variant="primary" disabled={busy} onClick={backup}>Download backup</Button><Button disabled={busy} onClick={check}>Check data integrity</Button></div>
      {msg && <p className="mt-3 text-[13px]" role="status">{msg}</p>}
      {integrity && (
        <ul className="mt-4 max-w-2xl border-t border-line text-[13px]">
          {integrity.checks.map((c) => <li key={c.name} className="flex justify-between gap-4 border-b border-line py-2"><span>{c.name}</span><span className={c.ok ? 'text-muted' : 'text-bad'}>{c.ok ? 'OK' : 'Problem'} · {c.detail}</span></li>)}
        </ul>
      )}
    </Section>
  )
}

function BrowserData({ server }: { server: boolean }) {
  const local = useMemo(() => summarizeLocal(), [])
  return (
    <Section title="Data held in this browser" description="Records saved here before the server was connected (or demonstration data). They are not on the server and other devices cannot see them.">
      {local.hasData ? (
        <dl className="max-w-xl border-t border-line text-[13px]">
          {[['Fleet', `${local.fleet.vehicles} vehicles · ${local.fleet.odometer} odometer readings · ${local.fleet.inspections} inspections · ${local.fleet.tireSets} tire sets · ${local.fleet.accessories} accessories`],
            ['Materials tracker', local.tracker.fileName ? `${local.tracker.lines} lines from ${local.tracker.fileName} · ${local.tracker.receipts} receipts` : 'No workbook imported in this browser']].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[9rem_1fr] gap-4 border-b border-line py-2.5"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>))}
        </dl>
      ) : <p className="text-[13px] text-muted">Nothing is stored in this browser.</p>}
      <div className="mt-4 flex flex-wrap gap-2"><Button onClick={() => download(`nexus-browser-backup-${new Date().toISOString().slice(0, 10)}.json`, fullBrowserBackup())}>Download browser backup</Button></div>
      {server && <p className="mt-2 max-w-2xl text-xs text-muted">Download this backup before importing anything. It also includes the fictional demonstration data, which is never imported.</p>}
    </Section>
  )
}

function Migration() {
  const local = useMemo(() => summarizeLocal(), [])
  const [include, setInclude] = useState({ fleet: true, materials: !!local.tracker.fileName })
  const [bundle, setBundle] = useState<MigrationBundle | null>(null)
  const [report, setReport] = useState<MigrationReport | null>(null)
  const [overwrite, setOverwrite] = useState<string[]>([])
  const [real, setReal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ report: MigrationReport; integrity: IntegrityReport } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState(false)

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong.')
  const preview = async () => {
    setBusy(true); setError(null); setResult(null); setOverwrite([]); setReal(false)
    try { const b = migrationBundle(include); setBundle(b); setReport((await api<{ report: MigrationReport }>('POST', '/api/migrate/preview', { bundle: b })).report) } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const apply = async () => {
    if (!bundle) return
    setBusy(true); setError(null)
    try {
      // The same data and choices always produce the same request id, so retrying after a dropped connection can never import twice.
      const requestId = `mig-${(await sha(JSON.stringify([bundle, [...overwrite].sort()]))).slice(0, 40)}`
      setResult(await api('POST', '/api/migrate/apply', { bundle, overwrite, confirmedReal: real, requestId }))
      await reloadAll()
    } catch (e) { fail(e); if (e instanceof ApiError && !e.outcomeUnknown) setReport(null) } finally { setBusy(false) }
  }
  const table = (r: MigrationReport) => Object.entries(r.modules).flatMap(([m, tables]) => (tables ?? []).map((t) => ({ module: m, ...t })))
  const conflicts = report ? table(report).flatMap((t) => t.conflicts) : []
  return (
    <Section title="Move browser data to the server" description="Preview first. Nothing is written until you confirm, nothing on the server is replaced without your say-so, and running it again is safe.">
      {!local.hasData ? <p className="text-[13px] text-muted">There is no browser data to move.</p> : (
        <>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-[13px]">
            <label className="flex items-center gap-2"><input type="checkbox" checked={include.fleet} onChange={(e) => setInclude({ ...include, fleet: e.target.checked })} />Fleet records</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={!local.tracker.fileName} checked={include.materials} onChange={(e) => setInclude({ ...include, materials: e.target.checked })} />Materials tracker{!local.tracker.fileName && ' (none in this browser)'}</label>
          </div>
          <div className="mt-3"><Button disabled={busy || (!include.fleet && !include.materials)} onClick={preview}>Preview import</Button></div>
        </>
      )}
      {error && <p role="alert" className="mt-3 border-l-2 border-bad pl-3 text-[13px]">{error}</p>}
      {report && !result && (
        <div className="mt-5">
          <p className="text-[13px]">Would add <b>{report.imported}</b> records · <b>{report.identical}</b> already on the server · <b>{report.conflicts}</b> differ · <b>{report.blocked}</b> cannot be added.</p>
          <div className="mt-3 overflow-x-auto"><table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
            <thead><tr className="border-b border-line">{['Records', 'In browser', 'Add', 'Same', 'Differ', 'Skipped'].map((h) => <th key={h} className="t-label py-2 pr-4 font-medium">{h}</th>)}</tr></thead>
            <tbody>{table(report).map((t) => <tr key={`${t.module}-${t.table}`} className="border-b border-line"><td className="py-2 pr-4">{t.table.replace(/_/g, ' ')}</td><td className="py-2 pr-4 tabular-nums">{t.incoming}</td><td className="py-2 pr-4 tabular-nums">{t.imported}</td><td className="py-2 pr-4 tabular-nums text-muted">{t.identical}</td><td className="py-2 pr-4 tabular-nums">{t.conflicts.length}</td><td className="py-2 pr-4 tabular-nums">{t.blocked.length}</td></tr>)}</tbody>
          </table></div>
          {report && table(report).some((t) => t.blocked.length) && (
            <details className="mt-3 text-[13px]"><summary className="cursor-pointer">Records that cannot be added</summary>
              <ul className="mt-2 space-y-1 text-muted">{table(report).flatMap((t) => t.blocked.map((b) => <li key={`${b.table}${b.id}`}>{b.table} {b.id}: {b.reason}</li>))}</ul></details>
          )}
          {conflicts.length > 0 && (
            <div className="mt-4 text-[13px]">
              <p className="font-medium">Records that differ from the server’s</p>
              <p className="text-xs text-muted">The server copy is kept unless you tick a record to replace it with the browser’s version.</p>
              <ul className="mt-2 space-y-1">{conflicts.map((c) => { const id = `${c.table}:${c.id}`; return (
                <li key={id}><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={overwrite.includes(id)} onChange={(e) => setOverwrite((o) => (e.target.checked ? [...o, id] : o.filter((x) => x !== id)))} /><span>{c.table.replace(/_/g, ' ')} · {c.id} <span className="text-muted">(differs in {c.differing.join(', ')})</span></span></label></li>) })}</ul>
            </div>
          )}
          <label className="mt-4 flex items-start gap-2 text-[13px]"><input type="checkbox" className="mt-0.5" checked={real} onChange={(e) => setReal(e.target.checked)} />This browser data is real project data, not demonstration data.</label>
          <div className="mt-3"><Button variant="primary" disabled={busy || !real} onClick={apply}>{busy ? 'Importing…' : 'Import to server'}</Button></div>
        </div>
      )}
      {result && (
        <div className="mt-5 text-[13px]" role="status">
          <p>Imported <b>{result.report.imported}</b> · replaced <b>{result.report.replaced}</b> · already there <b>{result.report.identical}</b> · differing, kept on server <b>{result.report.conflicts}</b> · skipped <b>{result.report.blocked}</b>.</p>
          <p className={result.integrity.ok ? 'text-muted' : 'text-bad'}>Integrity check: {result.integrity.ok ? 'all checks passed.' : result.integrity.checks.filter((c) => !c.ok).map((c) => c.detail).join('; ')}</p>
          <div className="mt-4 border-t border-line pt-4">
            <p className="text-muted">Your browser copy has <b>not</b> been removed. Look through the server records (Fleet, Materials) on another device. When you are satisfied they are correct, you can remove the browser copy.</p>
            <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => setChecked(e.target.checked)} />I have checked the migrated records on the server and downloaded a browser backup.</label>
            <div className="mt-2"><Button disabled={!checked} onClick={() => { if (window.confirm('Remove the browser copy of the migrated records? The server copy is not affected.')) { clearBrowserCopy(include); setBundle(null); setReport(null); setResult(null) } }}>Remove browser copy</Button></div>
          </div>
        </div>
      )}
    </Section>
  )
}
