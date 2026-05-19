# Releasing Mello Voice

**You do not need to run this checklist yourself.** Ask the agent to **release** or **ship** a version — it follows [`.cursor/skills/mello-voice-release/SKILL.md`](.cursor/skills/mello-voice-release/SKILL.md) and handles version sync, user-facing notes, git tag, push, and CI.

## What you say

Examples:

- “Release 1.0.1” / “Ship a patch release”
- “I bumped the version — publish it”
- “Cut a release with the Caps Lock fix in the notes”

The agent will run tests, write `releases/v1.0.1.md` in the same tone as `releases/v1.0.0.md`, commit, tag `v1.0.1`, and push.

## What CI does (automatic)

On tag `v*`: build **Windows** + **macOS** installers → GitHub Release with notes from `releases/vX.Y.Z.md`, then inject download links from the uploaded assets (exact URLs GitHub serves).

**Broken download links on an existing release?** Actions → **Repatch release download links** → run for that tag (e.g. `v1.0.1`).

**One-time:** GitHub **Settings → Actions → Workflow permissions → Read and write**.

## If you must do it manually

```bash
npm run release:prepare patch   # bump + scaffold releases/vX.Y.Z.md
# edit releases/vX.Y.Z.md and CHANGELOG.md
npm run verify
git commit -m "Release vX.Y.Z"
git tag vX.Y.Z
git push && git push origin vX.Y.Z
```
