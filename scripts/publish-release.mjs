/**
 * Publish a tagged release: upload local Windows installers and set GitHub Release notes.
 *
 * Prerequisites:
 *   - Tag vX.Y.Z pushed
 *   - releases/vX.Y.Z.md written
 *   - npm run setup:whisper && npm run tauri build completed on Windows
 *   - gh CLI authenticated
 *
 * Usage: node scripts/publish-release.mjs vX.Y.Z
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const BUNDLE = path.join(ROOT, 'src-tauri', 'target', 'release', 'bundle')

const tag = process.argv[2]
if (!tag || !/^v\d+\.\d+\.\d+$/.test(tag)) {
  console.error('Usage: node scripts/publish-release.mjs vX.Y.Z')
  process.exit(1)
}

const version = tag.slice(1)
const tauriVersion = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'src-tauri', 'tauri.conf.json'), 'utf8'),
).version
if (version !== tauriVersion) {
  console.error(`Tag ${tag} does not match tauri.conf.json version ${tauriVersion}.`)
  process.exit(1)
}

const notesPath = path.join(ROOT, 'releases', `v${version}.md`)
if (!fs.existsSync(notesPath)) {
  console.error(`Missing ${notesPath}`)
  process.exit(1)
}

/** @param {string} dir @param {(name: string) => boolean} match */
function findOne(dir, match) {
  if (!fs.existsSync(dir)) return null
  for (const name of fs.readdirSync(dir)) {
    if (match(name)) return path.join(dir, name)
  }
  return null
}

const setupExe = findOne(
  path.join(BUNDLE, 'nsis'),
  (name) => name.endsWith('-setup.exe') || name.endsWith('_x64-setup.exe'),
)
const msi = findOne(path.join(BUNDLE, 'msi'), (name) => name.toLowerCase().endsWith('.msi'))

if (!setupExe || !msi) {
  console.error('Windows installers not found. Run from repo root after a successful build:')
  console.error('  npm run setup:whisper')
  console.error('  npm run tauri build')
  console.error(`Expected under ${BUNDLE}`)
  process.exit(1)
}

const bodyFile = path.join(ROOT, '.release-body.tmp.md')
fs.writeFileSync(bodyFile, fs.readFileSync(notesPath, 'utf8'))

function gh(args) {
  const result = spawnSync('gh', args, { cwd: ROOT, encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  return result.status ?? 1
}

const title = `Mello Voice ${tag}`
const assets = [setupExe, msi]

let status = gh(['release', 'view', tag])
if (status !== 0) {
  status = gh([
    'release',
    'create',
    tag,
    '--title',
    title,
    '--notes-file',
    bodyFile,
    ...assets,
  ])
} else {
  status = gh(['release', 'upload', tag, ...assets, '--clobber'])
  if (status === 0) {
    status = gh(['release', 'edit', tag, '--title', title, '--notes-file', bodyFile])
  }
}

if (status !== 0) {
  fs.unlinkSync(bodyFile)
  process.exit(status)
}

const repoResult = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const repo = repoResult.stdout?.trim()
const tokenResult = spawnSync('gh', ['auth', 'token'], {
  cwd: ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
})
const token = tokenResult.stdout?.trim()

if (repo && token) {
  const patch = spawnSync(
    process.execPath,
    [path.join(__dirname, 'patch-release-download-links.mjs'), tag, bodyFile],
    {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_REPOSITORY: repo, GITHUB_TOKEN: token },
    },
  )
  if (patch.stdout) process.stdout.write(patch.stdout)
  if (patch.stderr) process.stderr.write(patch.stderr)
  if (patch.status !== 0) {
    fs.unlinkSync(bodyFile)
    process.exit(patch.status ?? 1)
  }
} else {
  console.warn('Could not resolve gh repo/token; skipped download-link patch.')
}

fs.unlinkSync(bodyFile)
console.log(`Published ${tag} with:`)
console.log(`  - ${path.basename(setupExe)}`)
console.log(`  - ${path.basename(msi)}`)
