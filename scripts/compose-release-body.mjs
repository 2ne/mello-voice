/**
 * Print the GitHub Release body for a version (used by CI).
 *
 * Usage: node scripts/compose-release-body.mjs 1.0.1
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const version = process.argv[2]?.replace(/^v/, '')
if (!version) {
  console.error('Usage: node scripts/compose-release-body.mjs <x.y.z>')
  process.exit(1)
}

const notesPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'releases', `v${version}.md`)
if (!fs.existsSync(notesPath)) {
  console.error(`Missing release notes: ${notesPath}`)
  console.error('Add releases/v' + version + '.md before tagging (see .cursor/skills/mello-voice-release/SKILL.md).')
  process.exit(1)
}

process.stdout.write(fs.readFileSync(notesPath, 'utf8'))
