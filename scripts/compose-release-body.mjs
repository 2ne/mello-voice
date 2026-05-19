/**
 * Print the GitHub Release body for a version (used by CI).
 *
 * Usage:
 *   node scripts/compose-release-body.mjs v1.0.1 [path/to/built-installers]
 *
 * When an assets directory is passed (CI: release-assets), appends a
 * "## Direct downloads" section with links to each installer on this release.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const tag = process.argv[2]
const assetsDir = process.argv[3]
const version = tag?.replace(/^v/, '')
const repo = process.env.GITHUB_REPOSITORY

if (!version) {
  console.error('Usage: node scripts/compose-release-body.mjs <vX.Y.Z> [assets-dir]')
  process.exit(1)
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const notesPath = path.join(root, 'releases', `v${version}.md`)
if (!fs.existsSync(notesPath)) {
  console.error(`Missing release notes: ${notesPath}`)
  console.error('Add releases/v' + version + '.md before tagging (see .cursor/skills/mello-voice-release/SKILL.md).')
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

/** @param {string} dir */
function collectFiles(dir) {
  /** @type {string[]} */
  const out = []
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) out.push(...collectFiles(full))
    else if (ent.isFile()) out.push(full)
  }
  return out
}

/**
 * @param {string} repository owner/repo
 * @param {string} releaseTag e.g. v1.0.1
 * @param {string} fileName basename only
 */
function releaseDownloadUrl(repository, releaseTag, fileName) {
  return `https://github.com/${repository}/releases/download/${releaseTag}/${encodeURIComponent(fileName)}`
}

function buildDownloadsSection() {
  if (!assetsDir || !fs.existsSync(assetsDir)) return ''
  if (!repo || !tag) return ''

  const files = collectFiles(path.resolve(assetsDir))
    .map((full) => ({ full, name: path.basename(full) }))
    .sort((a, b) => sortRank(a.name) - sortRank(b.name) || a.name.localeCompare(b.name))

  if (files.length === 0) return ''

  const lines = ['## Direct downloads', '']
  for (const { name } of files) {
    const url = releaseDownloadUrl(repo, tag, name)
    lines.push(`- [${downloadLabel(name)}](${url})`)
  }
  lines.push('')
  return lines.join('\n')
}

function injectDownloads(notes, downloads) {
  if (!downloads) return notes

  const normalized = notes.replace(/\r\n/g, '\n')
  const match = normalized.match(/\n## Install\n/)
  if (match && match.index !== undefined) {
    const idx = match.index
    return normalized.slice(0, idx) + '\n' + downloads + normalized.slice(idx)
  }

  return `${normalized.trimEnd()}\n\n${downloads}`
}

let body = fs.readFileSync(notesPath, 'utf8')
body = injectDownloads(body, buildDownloadsSection())
process.stdout.write(body)
