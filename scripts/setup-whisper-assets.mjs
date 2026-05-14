/**
 * Fetches quantized ggml-base.en-q8_0 + OpenBLAS whisper-cli (optional cuBLAS --gpu) for Windows.
 *
 * Usage: node scripts/setup-whisper-assets.mjs [--gpu]
 */
import { spawnSync, execSync } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import https from 'node:https'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const SRC_TAURI = path.join(ROOT, 'src-tauri')
const BIN_DIR = path.join(SRC_TAURI, 'binaries')
const MODEL_DIR = path.join(SRC_TAURI, 'resources', 'models')
const MODEL_PATH = path.join(MODEL_DIR, 'ggml-base.en-q8_0.bin')
/** OpenBLAS / cuBLAS zips ship DLLs beside whisper-cli.exe; Tauri bundles them here and Rust prepends PATH. */
const RUNTIME_DIR = path.join(SRC_TAURI, 'resources', 'whisper_runtime')

const WHISPER_TAG = 'v1.8.4'
const useGpuCli = process.argv.includes('--gpu')

function rustTriple() {
  try {
    return execSync('rustc --print host-tuple', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('rust not found in PATH (rustc --print host-tuple failed)')
  }
}

function downloadHttps(url, destPath) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume()
          void downloadHttps(res.headers.location, destPath).then(resolve, reject)
          return
        }
        if (res.statusCode !== 200) {
          reject(new Error(`GET ${url} -> ${res.statusCode}`))
          return
        }
        const out = createWriteStream(destPath)
        pipeline(res, out).then(resolve, reject)
      })
      .on('error', reject)
  })
}

async function unzipZip(zipPath, outDir) {
  await fs.mkdir(outDir, { recursive: true })
  const z = zipPath.replace(/'/g, "''")
  const o = outDir.replace(/'/g, "''")
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${z}' -DestinationPath '${o}' -Force`],
    { stdio: 'inherit' },
  )
  if (r.status !== 0) throw new Error(`Expand-Archive failed for ${zipPath}`)
}

async function walkFindExe(dir, nameRe) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  for (const ent of entries) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      const hit = await walkFindExe(full, nameRe)
      if (hit) return hit
    } else if (nameRe.test(ent.name)) {
      return full
    }
  }
  return null
}

function windowsZipNameForTriple(triple) {
  const is32 = triple.startsWith('i686-') || triple.startsWith('i586-')
  if (!triple.includes('windows')) {
    throw new Error(`No published whisper.cpp zip for Rust triple ${triple} (Windows only for auto-setup).`)
  }

  if (useGpuCli) {
    if (is32) {
      console.warn('[setup:whisper] No official cuBLAS build for Win32; falling back to OpenBLAS package.')
      return 'whisper-blas-bin-Win32.zip'
    }
    console.log('[setup:whisper] Using NVIDIA cuBLAS-compatible CLI (CUDA 12.4 toolchain required at runtime).')
    return 'whisper-cublas-12.4.0-bin-x64.zip'
  }

  return is32 ? 'whisper-blas-bin-Win32.zip' : 'whisper-blas-bin-x64.zip'
}

async function whisperRuntimeLooksPopulated() {
  try {
    return existsSync(path.join(RUNTIME_DIR, 'ggml.dll'))
  } catch {
    return false
  }
}

async function copyWhisperDlls(sourceReleaseDir, destDir) {
  await fs.mkdir(destDir, { recursive: true })
  const entries = await fs.readdir(sourceReleaseDir, { withFileTypes: true })
  let n = 0
  for (const ent of entries) {
    if (!ent.isFile() || !ent.name.toLowerCase().endsWith('.dll')) continue
    await fs.copyFile(path.join(sourceReleaseDir, ent.name), path.join(destDir, ent.name))
    n++
  }
  if (n === 0) {
    console.warn('[setup:whisper] No .dll files found next to whisper-cli (unexpected whisper.cpp layout).')
  } else {
    console.log('[setup:whisper] Copied', n, 'Whisper runtime DLL(s) ->', destDir)
  }
}

async function ensureWindowsSidecar(triple) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const cliDest = path.join(BIN_DIR, `whisper-cli-${triple}${ext}`)
  const serverDest = path.join(BIN_DIR, `whisper-server-${triple}${ext}`)
  const haveExes = existsSync(cliDest) && existsSync(serverDest)
  const haveRuntime = await whisperRuntimeLooksPopulated()

  if (haveExes && haveRuntime) {
    console.log('Whisper sidecars + runtime DLLs already present.')
    console.log(cliDest)
    console.log(serverDest)
    console.log(RUNTIME_DIR)
    return
  }

  const zipName = windowsZipNameForTriple(triple)
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_TAG}/${zipName}`
  const zipPath = path.join(BIN_DIR, zipName)
  await fs.mkdir(BIN_DIR, { recursive: true })

  console.log('Downloading', url)
  await downloadHttps(url, zipPath)

  const staging = path.join(BIN_DIR, '_whisper_unzip')
  await fs.rm(staging, { recursive: true, force: true })
  await unzipZip(zipPath, staging)

  const cliExe = await walkFindExe(staging, /^whisper-cli(?:\.exe)?$/i)
  const serverExe = await walkFindExe(staging, /^whisper-server(?:\.exe)?$/i)
  if (!cliExe) {
    throw new Error(`whisper-cli executable not found inside ${zipName}`)
  }
  if (!serverExe) {
    throw new Error(`whisper-server executable not found inside ${zipName}`)
  }

  const releaseDir = path.dirname(cliExe)
  await copyWhisperDlls(releaseDir, RUNTIME_DIR)

  if (!existsSync(cliDest)) {
    await fs.copyFile(cliExe, cliDest)
  }
  if (!existsSync(serverDest)) {
    await fs.copyFile(serverExe, serverDest)
  }

  await fs.rm(zipPath, { force: true }).catch(() => {})
  await fs.rm(staging, { recursive: true, force: true })

  console.log('Installed sidecars ->', cliDest, serverDest)
}

async function ensureModel() {
  if (existsSync(MODEL_PATH)) {
    console.log('Model already present:', MODEL_PATH)
    return
  }
  await fs.mkdir(MODEL_DIR, { recursive: true })
  const url =
    'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q8_0.bin?download=1'
  console.log('Downloading quantized model (may take several minutes)…')
  await downloadHttps(url, MODEL_PATH)
  console.log('Installed model ->', MODEL_PATH)
}

async function main() {
  const triple = rustTriple()
  console.log('Host triple:', triple)
  console.log(useGpuCli ? 'CLI bundle: NVIDIA cuBLAS (optional --gpu)' : 'CLI bundle: CPU OpenBLAS')

  if (!(process.platform === 'win32' && triple.includes('windows'))) {
    console.warn(
      `\nAutomatic sidecar download supports Windows hosts only.\n` +
        `Build whisper.cpp locally, install to:\n` +
        `  <repo>/src-tauri/binaries/whisper-cli-${triple}${process.platform === 'win32' ? '.exe' : ''}\n` +
        `  <repo>/src-tauri/binaries/whisper-server-${triple}${process.platform === 'win32' ? '.exe' : ''}\n` +
        `  <repo>/src-tauri/resources/whisper_runtime/*.dll (same folder layout as whisper.cpp Release/, including ggml.dll)\n`,
    )
    await ensureModel().catch((e) => {
      console.warn('Model download failed:', e)
      process.exitCode = 1
    })
    return
  }

  await ensureWindowsSidecar(triple)
  await ensureModel()
}

await main().catch((e) => {
  console.error(e)
  process.exit(1)
})
