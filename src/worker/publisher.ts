import { refreshIfStale, type SnapshotWriter } from './snapshot'
import { systemClock } from './service'
import type { D1 } from './db'

/**
 * The publisher Worker (`nexus-publisher`): the scheduled fallback that keeps the public snapshot current if an update was missed. It has no
 * public address (no route, no workers.dev, no preview URLs) and answers every request with 404. Its only jobs are to read the database (SELECT
 * only) and write the one snapshot object.
 */
interface PublisherEnv { DB?: D1; PUBLIC_SNAPSHOT?: SnapshotWriter }

export default {
  async fetch(): Promise<Response> { return new Response('Not found.', { status: 404 }) },
  async scheduled(_event: unknown, env: PublisherEnv, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(refreshIfStale(env, systemClock).then((r) => { if (r === 'published') console.log('Public snapshot refreshed by the scheduled check') }).catch((e) => console.error('Scheduled snapshot refresh failed', e instanceof Error ? e.message : e)))
  },
}
