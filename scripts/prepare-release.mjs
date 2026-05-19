/**
 * Bump semver and scaffold user-facing release notes for the agent to edit.
 *
 * Usage: node scripts/prepare-release.mjs patch|minor|major|x.y.z
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const TEMPLATE = path.join(ROOT, 'releases', 'TEMPLATE.md')

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/prepare-release.mjs <patch|minor|major|x.y.z>')
  process.exit(1)
}

const bump = spawnSync(process.execPath, [path.join(__dirname, 'bump-version.mjs'), arg], {
  cwd: ROOT,
  encoding: 'utf8',
})
process.stdout.write(bump.stdout ?? '')
process.stderr.write(bump.stderr ?? '')
if (bump.status !== 0) process.exit(bump.status ?? 1)

const versionLine = (bump.stdout ?? '').match(/Version .+ → (.+)/)
const version = versionLine?.[1]
if (!version) {
  console.error('Could not read new version from bump-version output.')
  process.exit(1)
}

const notesPath = path.join(ROOT, 'releases', `v${version}.md`)
try {
  await fs.access(notesPath)
  console.log(`Release notes already exist: releases/v${version}.md`)
} catch {
  const template = await fs.readFile(TEMPLATE, 'utf8')
  await fs.writeFile(notesPath, template.replaceAll('{{VERSION}}', version), 'utf8')
  console.log(`Created releases/v${version}.md — edit “What’s new” before commit/tag.`)
}
