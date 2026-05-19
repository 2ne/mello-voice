---
name: mello-voice-release
description: >-
  Ship a Mello Voice version end-to-end: bump synced app version, write user-facing GitHub
  release notes (same tone as releases/v1.0.0.md), commit, create vX.Y.Z tag, push so CI builds
  Windows + macOS installers and publishes the GitHub Release. Use when the user asks to release,
  ship, bump version for users, cut a version, publish installers, or tag a release — even if
  they only bumped version in code and want the rest handled.
---

# Mello Voice — ship a release (agent-owned)

The human should **not** run git tags, edit GitHub Releases by hand, or build installers locally for a normal ship. **You** run the full flow below unless something is blocked (no git push access, missing GitHub Actions permissions).

## What happens automatically after you push a tag

Pushing **`vX.Y.Z`** runs [`.github/workflows/release.yml`](../../.github/workflows/release.yml):

1. Confirms the tag matches `src-tauri/tauri.conf.json` (and `package.json` / `Cargo.toml`).
2. Builds **Windows** (`*-setup.exe` + `.msi`) and **macOS** (`.dmg` + `.app.tar.gz`).
3. Creates/updates the **GitHub Release** with those files attached.
4. Sets the release description from **`releases/vX.Y.Z.md`** (user-facing — not commit logs).

One-time repo setting (tell the user if releases fail with permissions errors): **Settings → Actions → General → Workflow permissions → Read and write**.

## Release notes — tone and file

**Source of truth for the GitHub Release body:** `releases/vX.Y.Z.md`

**Match the tone of** [`releases/v1.0.0.md`](../../releases/v1.0.0.md):

- Plain language for **people installing the app**, not developers.
- Lead with **“What’s new”** bullets: what changed from the **user’s** perspective.
- Use **Install** sections for Windows and macOS (WebView2, microphone, SmartScreen, Accessibility) — copy from `releases/TEMPLATE.md` unless something changed.
- **Do not** paste auto-generated commit lists, PR numbers, or `### Added / Fixed` changelog jargon into the GitHub Release body.
- **Do** mention hotkeys, overlay, paste behavior, privacy/local STT, and platform requirements when relevant.

Also add a short **user-facing** entry to [`CHANGELOG.md`](../../CHANGELOG.md) (mirror the same bullets; date in `YYYY-MM-DD`).

## Your checklist (run in order)

1. **Understand the delta** — `git log v<last>..HEAD --oneline` (or since last tag). Turn commits into user-facing bullets; drop internal-only work.

2. **Run verification** — from repo root: `npm run verify`. Fix failures before continuing.

3. **Bump version** (keeps all three version files in sync):
   ```bash
   npm run release:prepare patch
   ```
   Use `minor` / `major` / `1.2.3` as appropriate. This runs `bump-version` and scaffolds `releases/vX.Y.Z.md` if missing.

4. **Write release notes** — edit `releases/vX.Y.Z.md` completely (especially **What’s new**). Compare tone to `releases/v1.0.0.md`.

5. **Update `CHANGELOG.md`** — new `## [X.Y.Z] - <date>` section; clear `[Unreleased]` or leave a placeholder.

6. **Commit** — only release-related files:
   ```bash
   git add src-tauri/tauri.conf.json package.json src-tauri/Cargo.toml releases/vX.Y.Z.md CHANGELOG.md
   git commit -m "Release vX.Y.Z"
   ```

7. **Tag and push** (tag **must** be `v` + exact version in `tauri.conf.json`):
   ```bash
   git tag vX.Y.Z
   git push
   git push origin vX.Y.Z
   ```
   Push the **commit first**, then the **tag**. CI triggers on the tag.

8. **Confirm CI** — check the **Release** workflow on GitHub Actions. If it fails, diagnose from logs; do not ask the user to build installers unless CI is broken and they need a manual fallback.

9. **Tell the user** the release URL when the workflow succeeds (or that the tag is pushed and builds are in progress).

## If the user already bumped the version in code

- Read the version from `src-tauri/tauri.conf.json`.
- Ensure `releases/vX.Y.Z.md` exists (create from `releases/TEMPLATE.md` if not).
- Write notes, update CHANGELOG, then **commit (if needed) → tag `vX.Y.Z` → push commit + tag**.
- Do **not** re-bump unless they asked for a different version.

## If the user only wants notes drafted (no ship yet)

- Prepare `releases/vX.Y.Z.md` and CHANGELOG only; **do not** tag or push unless they explicitly ask to publish.

## Local installer builds (fallback only)

Not part of a normal release. For manual Windows troubleshooting see [mello-voice-windows-release](../mello-voice-windows-release/SKILL.md).

## Version files (always stay aligned)

| File | Field |
|------|--------|
| `src-tauri/tauri.conf.json` | `"version"` |
| `package.json` | `"version"` |
| `src-tauri/Cargo.toml` | `[package] version` |

## Common failures

| Symptom | Fix |
|--------|-----|
| Tag ≠ app version | Tag must be `v` + `tauri.conf.json` version exactly. |
| Missing `releases/vX.Y.Z.md` | Add the file before tagging; CI will fail without it. |
| Resource not accessible by integration | Enable Actions **read/write** permissions (above). |
| Windows `app.exe` access denied (local build) | `taskkill /IM app.exe /F` — CI runners do not hit this. |
