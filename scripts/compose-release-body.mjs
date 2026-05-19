/**
 * Print user-facing release notes for a version (CI: before download links are patched).
 *
 * Usage: node scripts/compose-release-body.mjs v1.0.1
 *
 * Download links are added after upload by scripts/patch-release-download-links.mjs
 * using each asset's browser_download_url from the GitHub API.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]?.replace(/^v/, '')
if (!version) {
  console.error('Usage: node scripts/compose-release-body.mjs <vX.Y.Z>')
  process.exit(1)
}

const notesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases', `v${version}.md`)
if (!fs.existsSync(notesPath)) {
  console.error(`Missing release notes: ${notesPath}`)
  console.error('Add releases/v' + version + '.md before tagging (see .cursor/skills/mello-voice-release/SKILL.md).')
  process.exit(1)
}

process.stdout.write(fs.readFileSync(notesPath, 'utf8'))
