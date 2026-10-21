// Refuses a manual production deploy from any branch except main.
// Cloudflare builds set WORKERS_CI_BRANCH; locally we ask git.
import { execSync } from 'node:child_process'

const branch = process.env.WORKERS_CI_BRANCH || execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
if (branch !== 'main') {
  console.error(`Refusing to deploy to production from "${branch}". Production deploys come only from main. Use "npm run preview:staging" for staging.`)
  process.exit(1)
}
