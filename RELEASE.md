# Releasing Mello Voice

**You do not need to run this checklist yourself.** Ask the agent to **release** or **ship** a version — it follows [`.cursor/skills/mello-voice-release/SKILL.md`](.cursor/skills/mello-voice-release/SKILL.md) and handles version sync, user-facing notes, git tag, local Windows build, and GitHub Release upload.

## What you say

Examples:

- “Release 1.0.9” / “Ship a patch release”
- “I bumped the version — publish it”
- “Cut a release with the overlay fix in the notes”

The agent will run tests, write `releases/vX.Y.Z.md`, commit, tag, push, build Windows installers locally, and publish the GitHub Release.

## What the agent does

1. **`npm run verify`** — tests + production build + Rust tests
2. **Version bump + notes** — `npm run release:prepare`, edit `releases/vX.Y.Z.md` and `CHANGELOG.md`
3. **Commit + tag + push**
4. **Local Windows build** — `npm run setup:whisper` → `npm run tauri build`
5. **Publish** — `npm run release:publish -- vX.Y.Z` (uploads `.exe` + `.msi`, sets release notes, patches download links, updates `landing/` download URLs)
6. **Landing** — commit and push `landing/app.js` + `landing/index.html` if they changed (triggers GitHub Pages deploy)

**Marketing site:** `landing/` deploys via `.github/workflows/deploy-landing.yml`. First-time setup: `npm run landing:pages-setup` (private Free accounts need a separate public `mello-voice-landing` repo).

**Windows only.** macOS installers are not part of the release process.

## If you must do it manually

```bash
npm run release:prepare patch   # bump + scaffold releases/vX.Y.Z.md
# edit releases/vX.Y.Z.md and CHANGELOG.md
npm run verify
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push origin vX.Y.Z
npm run setup:whisper
npm run tauri build
npm run release:publish -- vX.Y.Z
```

Build troubleshooting: [`.cursor/skills/mello-voice-windows-release/SKILL.md`](.cursor/skills/mello-voice-windows-release/SKILL.md).
