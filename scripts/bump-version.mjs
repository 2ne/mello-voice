/**
 * Bump Mello Voice semver in every place the shipped app reads it.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch|minor|major
 *   node scripts/bump-version.mjs 1.2.3
 *
 * Source of truth: src-tauri/tauri.conf.json → package.json + Cargo.toml
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const TAURI_CONF = path.join(ROOT, 'src-tauri', 'tauri.conf.json')
const PACKAGE_JSON = path.join(ROOT, 'package.json')
const CARGO_TOML = path.join(ROOT, 'src-tauri', 'Cargo.toml')

const BUMP_KINDS = new Set(['patch', 'minor', 'major'])
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([\w.-]+))?(?:\+([\w.-]+))?$/

function parseSemver(version) {
  const m = version.match(SEMVER_RE)
  if (!m) throw new Error(`Not a semver version: ${version}`)
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? '',
    build: m[5] ?? '',
  }
}

function formatSemver({ major, minor, patch, prerelease, build }) {
  let v = `${major}.${minor}.${patch}`
  if (prerelease) v += `-${prerelease}`
  if (build) v += `+${build}`
  return v
}

function bumpSemver(version, kind) {
  const parts = parseSemver(version)
  parts.prerelease = ''
  parts.build = ''
  if (kind === 'major') {
    parts.major += 1
    parts.minor = 0
    parts.patch = 0
  } else if (kind === 'minor') {
    parts.minor += 1
    parts.patch = 0
  } else if (kind === 'patch') {
    parts.patch += 1
  } else {
    throw new Error(`Unknown bump kind: ${kind}`)
  }
  return formatSemver(parts)
}

async function readCurrentVersion() {
  const conf = JSON.parse(await fs.readFile(TAURI_CONF, 'utf8'))
  if (typeof conf.version !== 'string' || !conf.version) {
    throw new Error(`Missing version in ${TAURI_CONF}`)
  }
  return conf.version
}

async function writeVersion(next) {
  if (!SEMVER_RE.test(next)) throw new Error(`Refusing to write invalid semver: ${next}`)

  const conf = JSON.parse(await fs.readFile(TAURI_CONF, 'utf8'))
  conf.version = next
  await fs.writeFile(TAURI_CONF, `${JSON.stringify(conf, null, 2)}\n`, 'utf8')

  const pkg = JSON.parse(await fs.readFile(PACKAGE_JSON, 'utf8'))
  pkg.version = next
  await fs.writeFile(PACKAGE_JSON, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')

  let cargo = await fs.readFile(CARGO_TOML, 'utf8')
  if (!/^version = "/m.test(cargo)) {
    throw new Error(`Could not find [package] version in ${CARGO_TOML}`)
  }
  cargo = cargo.replace(/^version = ".*"$/m, `version = "${next}"`)
  await fs.writeFile(CARGO_TOML, cargo, 'utf8')
}

const arg = process.argv[2]
if (!arg) {
  console.error('Usage: node scripts/bump-version.mjs <patch|minor|major|x.y.z>')
  process.exit(1)
}

const current = await readCurrentVersion()
const next = BUMP_KINDS.has(arg) ? bumpSemver(current, arg) : arg

if (!SEMVER_RE.test(next)) {
  console.error(`Invalid target version: ${next}`)
  process.exit(1)
}

if (next === current) {
  console.error(`Version unchanged (${current}).`)
  process.exit(1)
}

await writeVersion(next)
console.log(`Version ${current} → ${next}`)
console.log('')
console.log('Next steps (agent: see .cursor/skills/mello-voice-release/SKILL.md):')
console.log(`  1. Edit releases/v${next}.md (user-facing; tone: releases/v1.0.0.md)`)
console.log(`  2. Update CHANGELOG.md for v${next}`)
console.log(`  3. npm run verify && git commit && git tag v${next} && git push && git push origin v${next}`)
console.log(`  4. npm run setup:whisper && npm run tauri build`)
console.log(`  5. npm run release:publish -- v${next}`)
console.log(`  6. Commit landing/ download links if changed, then push`)
