---
name: mello-voice-release
description: >-
  Ship a Mello Voice version end-to-end: bump synced app version, write user-facing GitHub
  release notes (same tone as releases/v1.0.0.md), build Windows installers locally,
  commit, tag, push, and publish the GitHub Release with .exe + .msi assets. Use when the
  user asks to release, ship, bump version for users, cut a version, publish installers,
  or tag a release — even if they only bumped version in code and want the rest handled.
---

# Mello Voice — ship a release (agent-owned)

The human should **not** run git tags, edit GitHub Releases by hand, or upload installers themselves for a normal ship. **You** run the full flow below unless something is blocked (no git push access, missing build toolchain, `gh` not authenticated).

**Windows only.** macOS installers are not built or published as part of releases.

## Release notes — tone and file

**Source of truth for the GitHub Release body:** `releases/vX.Y.Z.md`

**Match the tone of** [`releases/v1.0.0.md`](../../releases/v1.0.0.md):

- Plain language for **people installing the app**, not developers.
- Lead with **“What’s new”** bullets: what changed from the **user’s** perspective.
- Use the **Install → Windows** section from `releases/TEMPLATE.md` unless something changed.
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

6. **Commit** — release-related files plus any code that ships in this version:
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
   Push the **commit first**, then the **tag**.

8. **Build Windows installers locally** (required — not CI):
   - Stop running dev instances first: `taskkill /IM app.exe /F` if needed.
   ```bash
   npm run setup:whisper
   npm run tauri build
   ```
   Expect artifacts under `src-tauri/target/release/bundle/`:
   - `nsis/Mello Voice_<version>_x64-setup.exe` (recommended for users)
   - `msi/Mello Voice_<version>_x64_en-US.msi`

   Build troubleshooting: [mello-voice-windows-release](../mello-voice-windows-release/SKILL.md).

9. **Publish GitHub Release** with uploaded installers:
   ```bash
   npm run release:publish -- vX.Y.Z
   ```
   This creates/updates the release for the tag, uploads the Windows `.exe` and `.msi`, sets the body from `releases/vX.Y.Z.md`, patches **Direct downloads** links from the uploaded assets, and **pins the marketing site** (`landing/app.js` + `landing/index.html`) to that tag’s Windows `.exe` and macOS `.dmg` (when present on the release).

   Requires **`gh`** authenticated (`gh auth status`). Repo defaults from the current checkout.

10. **Commit and push landing download links** (after publish — assets must exist first):
    ```bash
    git add landing/app.js landing/index.html
    git commit -m "Update landing download links for vX.Y.Z"
    git push
    ```
    If macOS `.dmg` was not uploaded for this tag, the mac button falls back to the release page until a later release includes it.

    Pushing `landing/` to **`main`** also triggers **`.github/workflows/deploy-landing.yml`**, which publishes the marketing site to GitHub Pages (usually within a couple of minutes).

11. **Tell the user** the release URL and marketing site URL (see **Marketing site** below).

## Marketing site (GitHub Pages)

The static landing page lives in **`landing/`** and deploys via **`.github/workflows/deploy-landing.yml`** when `landing/` changes on **`main`**.

**Site URL:** `https://2ne.github.io/mello-voice/`

**One-time setup** (after the repo is public):

```bash
gh api --method POST repos/2ne/mello-voice/pages -f build_type=workflow
```

Then push `landing/` or run `gh workflow run deploy-landing.yml`. Diagnose with `npm run landing:pages-setup`.

If the repo is ever private again on GitHub Free, use a separate public **`mello-voice-landing`** repo instead — see `npm run landing:pages-setup`.

## If the user already bumped the version in code

- Read the version from `src-tauri/tauri.conf.json`.
- Ensure `releases/vX.Y.Z.md` exists (create from `releases/TEMPLATE.md` if not).
- Write notes, update CHANGELOG, then **commit (if needed) → tag → push → local build → `npm run release:publish` → commit/push `landing/` download links**.

## If the user only wants notes drafted (no ship yet)

- Prepare `releases/vX.Y.Z.md` and CHANGELOG only; **do not** tag, build, or publish unless they explicitly ask.

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
| Missing `releases/vX.Y.Z.md` | Add the file before publishing. |
| `app.exe` access denied during build | `taskkill /IM app.exe /F`, then rebuild. |
| Missing NSIS/MSI after build | Install Tauri Windows prerequisites (WiX + NSIS). See windows-release skill. |
| `gh release` fails | Run `gh auth status`; ensure tag is pushed. |
| Download links 404 in release notes | Re-run `npm run release:publish -- vX.Y.Z` after assets upload. |
| Landing site still points at old version | Re-run `npm run release:publish -- vX.Y.Z` (or `npm run release:patch-landing -- vX.Y.Z`), then commit and push `landing/`. |
| Marketing site not updating | Confirm Pages is set up (`npm run landing:pages-setup`). Check Actions run for **Deploy landing site** after `landing/` push. |
| Pages unavailable on private repo (Free) | Use public **`mello-voice-landing`** repo + `LANDING_PAGES_REPO` / `LANDING_PAGES_TOKEN` (see skill **Marketing site**). |
