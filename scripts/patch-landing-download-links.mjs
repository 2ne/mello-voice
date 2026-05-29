/**
 * Pin the marketing site download buttons to a tagged GitHub Release.
 *
 * Updates landing/app.js (RELEASE_DOWNLOADS) and landing/index.html (#download-link href).
 *
 * Usage: node scripts/patch-landing-download-links.mjs <vX.Y.Z>
 *
 * Normally invoked by scripts/publish-release.mjs after installers are uploaded.
 * Requires: GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY (owner/repo)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const APP_JS = path.join(ROOT, 'landing', 'app.js')
const INDEX_HTML = path.join(ROOT, 'landing', 'index.html')

const tag = process.argv[2]
const repo = process.env.GITHUB_REPOSITORY ?? '2ne/mello-voice'
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Usage: GITHUB_TOKEN=… node scripts/patch-landing-download-links.mjs vX.Y.Z')
  process.exit(1)
}

/** @param {string} name */
function pickWindowsAsset(assets) {
  return assets.find((asset) => {
    const name = String(asset.name || '').toLowerCase()
    return name.endsWith('-setup.exe')
  })
}

/** @param {string} name */
function pickMacAsset(assets) {
  const dmgs = assets.filter((asset) => String(asset.name || '').toLowerCase().endsWith('.dmg'))
  if (dmgs.length === 0) return null
  const aarch64 = dmgs.find((asset) => asset.name.toLowerCase().includes('aarch64'))
  return aarch64 ?? dmgs[0]
}

function buildReleaseDownloadsBlock({ tag, releasePage, windows, mac }) {
  const lines = [
    '// @release-downloads-start',
    'const RELEASE_DOWNLOADS = {',
    `  tag: "${tag}",`,
    `  releasePage: "${releasePage}",`,
    `  windows: ${windows ? `"${windows}"` : '""'},`,
    `  mac: ${mac ? `"${mac}"` : '""'},`,
    '};',
    '// @release-downloads-end',
  ]
  return lines.join('\n')
}

function patchAppJs(block) {
  const source = fs.readFileSync(APP_JS, 'utf8').replace(/^\uFEFF/, '')
  const pattern = /\/\/ @release-downloads-start[\s\S]*?\/\/ @release-downloads-end/
  if (!pattern.test(source)) {
    console.error(`Missing @release-downloads markers in ${APP_JS}`)
    process.exit(1)
  }
  fs.writeFileSync(APP_JS, source.replace(pattern, block))
}

function patchIndexHtml(defaultHref) {
  const source = fs.readFileSync(INDEX_HTML, 'utf8').replace(/^\uFEFF/, '')
  const pattern = /(id="download-link"[\s\S]*?href=")([^"]+)(")/ 
  if (!pattern.test(source)) {
    console.error(`Missing #download-link href in ${INDEX_HTML}`)
    process.exit(1)
  }
  fs.writeFileSync(INDEX_HTML, source.replace(pattern, `$1${defaultHref}$3`))
}

const headers = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
}
if (token) headers.Authorization = `Bearer ${token}`

const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
const res = await fetch(apiUrl, { headers })

if (!res.ok) {
  console.error(`GET ${apiUrl} -> ${res.status}`)
  console.error(await res.text())
  process.exit(1)
}

/** @type {{ assets?: { name: string, browser_download_url: string }[] }} */
const release = await res.json()
const assets = release.assets ?? []
const windowsAsset = pickWindowsAsset(assets)
const macAsset = pickMacAsset(assets)

if (!windowsAsset?.browser_download_url) {
  console.error(`Release ${tag} has no Windows setup (.exe) asset; cannot patch landing downloads.`)
  process.exit(1)
}

const releasePage = `https://github.com/${repo}/releases/tag/${encodeURIComponent(tag)}`
const block = buildReleaseDownloadsBlock({
  tag,
  releasePage,
  windows: windowsAsset.browser_download_url,
  mac: macAsset?.browser_download_url ?? '',
})

patchAppJs(block)
patchIndexHtml(windowsAsset.browser_download_url)

console.log(`Updated landing download links for ${tag}:`)
console.log(`  Windows: ${windowsAsset.name}`)
if (macAsset?.browser_download_url) {
  console.log(`  macOS:   ${macAsset.name}`)
} else {
  console.warn(`  macOS:   no .dmg on ${tag}; mac button will open the release page.`)
}
