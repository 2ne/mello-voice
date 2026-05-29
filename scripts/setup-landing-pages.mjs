/**
 * Diagnose GitHub Pages setup for the landing/ marketing site and print next steps.
 *
 * Usage: node scripts/setup-landing-pages.mjs
 *
 * Requires: gh CLI authenticated (gh auth status)
 */
import { spawnSync } from 'node:child_process'

function gh(args) {
  const result = spawnSync('gh', args, { encoding: 'utf8' })
  return {
    ok: result.status === 0,
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
    status: result.status ?? 1,
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

const repoView = gh(['repo', 'view', '--json', 'nameWithOwner,visibility,isPrivate,url'])
if (!repoView.ok) {
  console.error('Could not read current repo. Run from the mello-voice checkout with gh authenticated.')
  console.error(repoView.stderr)
  process.exit(1)
}

const repo = parseJson(repoView.stdout)
const slug = repo?.nameWithOwner ?? 'owner/mello-voice'
const [owner, name] = slug.split('/')
const isPrivate = repo?.isPrivate === true

console.log(`Repository: ${slug}`)
console.log(`Visibility: ${repo?.visibility ?? 'unknown'}`)
console.log('')

const pages = gh(['api', `repos/${slug}/pages`])
const externalRepo = process.env.LANDING_PAGES_REPO ?? ''

if (pages.ok) {
  const site = parseJson(pages.stdout)
  console.log('GitHub Pages is enabled on this repository.')
  console.log(`Site URL: ${site?.html_url ?? `https://${owner}.github.io/${name}/`}`)
  console.log(`Build type: ${site?.build_type ?? 'unknown'}`)
  console.log('')
  console.log('Landing deploys automatically when landing/ changes on main.')
  console.log('Manual deploy: gh workflow run deploy-landing.yml')
  process.exit(0)
}

if (pages.status === 404) {
  console.log('GitHub Pages is not enabled yet on this repository.')
} else if (pages.stderr.includes('does not support GitHub Pages')) {
  console.log('GitHub Pages is not available on this repository with the current plan.')
} else {
  console.log(`GitHub Pages check failed (${pages.status}).`)
  if (pages.stderr) console.log(pages.stderr)
}

console.log('')

if (isPrivate) {
  console.log('This repo is private. On GitHub Free, Pages only works for public repositories.')
  console.log('')
  console.log('Recommended (keeps app source private):')
  console.log('  1. Create a public site-only repo:')
  console.log(`     gh repo create ${owner}/mello-voice-landing --public --description "Mello Voice marketing site"`)
  console.log('  2. After the first deploy workflow run (creates gh-pages), enable Pages on that repo:')
  console.log(`     gh api --method POST repos/${owner}/mello-voice-landing/pages -f build_type=legacy -f source[branch]=gh-pages -f source[path]=/`)
  console.log('  3. Create a fine-grained PAT with Contents read/write on mello-voice-landing only.')
  console.log('  4. Add repo settings on mello-voice:')
  console.log(`     - Variable LANDING_PAGES_REPO = ${owner}/mello-voice-landing`)
  console.log('     - Secret  LANDING_PAGES_TOKEN = <PAT>')
  console.log(`  5. Site URL: https://${owner}.github.io/mello-voice-landing/`)
  console.log('')
  console.log('Alternative: GitHub Pro on this account enables Pages on private repos.')
  console.log(`Alternative: make ${slug} public and enable Pages here:`)
  console.log(`  gh api --method POST repos/${slug}/pages -f build_type=workflow`)
  console.log(`  Site URL: https://${owner}.github.io/${name}/`)
} else {
  console.log('Enable GitHub Pages with GitHub Actions as the source:')
  console.log(`  gh api --method POST repos/${slug}/pages -f build_type=workflow`)
  console.log('')
  console.log(`Then push landing/ to main or run: gh workflow run deploy-landing.yml`)
  console.log(`Site URL: https://${owner}.github.io/${name}/`)
}

if (externalRepo) {
  console.log('')
  console.log(`LANDING_PAGES_REPO is set locally to ${externalRepo} (configure the same on GitHub).`)
}

process.exit(pages.ok ? 0 : 1)
