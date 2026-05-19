/**
 * After softprops uploads release assets, rewrite the GitHub Release body so
 * "Direct downloads" uses each asset's browser_download_url (exact names GitHub stored).
 *
 * Usage: node scripts/patch-release-download-links.mjs <vX.Y.Z> [body-file]
 *
 * Requires: GITHUB_TOKEN or GH_TOKEN, GITHUB_REPOSITORY (owner/repo)
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = process.argv[2]
const bodyFile = process.argv[3]
const repo = process.env.GITHUB_REPOSITORY
const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN

if (!tag || !repo || !token) {
  console.error('Usage: GITHUB_TOKEN=… GITHUB_REPOSITORY=owner/repo node scripts/patch-release-download-links.mjs <vX.Y.Z> [body-file]')
  process.exit(1)
}

/** @param {string} name */
function downloadLabel(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('-setup.exe')) return 'Windows setup (.exe) — recommended'
  if (lower.endsWith('.msi')) return 'Windows installer (.msi)'
  if (lower.endsWith('.dmg')) return 'macOS disk image (.dmg)'
  if (lower.endsWith('.app.tar.gz')) return 'macOS app archive (.tar.gz)'
  return name
}

/** @param {string} name */
function sortRank(name) {
  const lower = name.toLowerCase()
  if (lower.endsWith('-setup.exe')) return 0
  if (lower.endsWith('.msi')) return 1
  if (lower.endsWith('.dmg')) return 2
  if (lower.endsWith('.app.tar.gz')) return 3
  return 9
}

/** @param {{ name: string, browser_download_url: string }[]} assets */
function buildDownloadsSection(assets) {
  const sorted = [...assets].sort(
    (a, b) => sortRank(a.name) - sortRank(b.name) || a.name.localeCompare(b.name),
  )
  if (sorted.length === 0) return ''

  const lines = ['## Direct downloads', '']
  for (const asset of sorted) {
    lines.push(`- [${downloadLabel(asset.name)}](${asset.browser_download_url})`)
  }
  lines.push('')
  return lines.join('\n')
}

function injectDownloads(notes, downloads) {
  if (!downloads) return notes

  const normalized = notes.replace(/\r\n/g, '\n')
  const withoutOld = normalized.replace(/\n## Direct downloads\n[\s\S]*?(?=\n## )/g, '\n')

  const match = withoutOld.match(/\n## Install\n/)
  if (match && match.index !== undefined) {
    const idx = match.index
    return withoutOld.slice(0, idx) + '\n' + downloads + withoutOld.slice(idx)
  }

  return `${withoutOld.trimEnd()}\n\n${downloads}`
}

const apiUrl = `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`
const res = await fetch(apiUrl, {
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  },
})

if (!res.ok) {
  console.error(`GET ${apiUrl} -> ${res.status}`)
  console.error(await res.text())
  process.exit(1)
}

/** @type {{ id: number, body?: string, assets?: { name: string, browser_download_url: string }[] }} */
const release = await res.json()
const assets = release.assets ?? []
if (assets.length === 0) {
  console.error('Release has no uploaded assets yet; cannot build download links.')
  process.exit(1)
}

let body = bodyFile && fs.existsSync(bodyFile)
  ? fs.readFileSync(bodyFile, 'utf8').replace(/^\uFEFF/, '')
  : (release.body ?? '')

body = injectDownloads(body, buildDownloadsSection(assets))

const patchRes = await fetch(`https://api.github.com/repos/${repo}/releases/${release.id}`, {
  method: 'PATCH',
  headers: {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ body }),
})

if (!patchRes.ok) {
  console.error(`PATCH release ${release.id} -> ${patchRes.status}`)
  console.error(await patchRes.text())
  process.exit(1)
}

console.log(`Updated release ${tag} with ${assets.length} download link(s):`)
for (const asset of assets) {
  console.log(`  - ${asset.name}`)
}
