# Agent notes — Mello Voice

## UI stack & components

Use these conventions before introducing new libraries or animation helpers:

- **Frontend:** React 19 + TypeScript + Vite (`vite.config.ts`).
- **Desktop shell:** Tauri 2 (`src-tauri/`).
- **Styling:** Tailwind CSS v4 with `@import "tailwindcss"` and tokens in `src/style.css`; utility merging via `tailwind-merge` / `clsx` (`src/lib/utils.ts`).
- **Components:** App-specific UI under `src/components/ui/` (buttons, popover, switch, etc.). Popovers/menus come from **`radix-ui`** (`Popover`, etc.), not always `@radix-ui/react-*` directly.
- **Icons:** Prefer **small inline SVG components** under `src/components/icons/` (see `SettingsGearIcon.tsx`). Avoid pulling in icon packs unless several icons are needed.
- **Overlay window:** Transparent overlay chrome is styled under `html.overlay-window` in `src/style.css`; pill UI lives in `src/components/FloatingOverlay.tsx` / `OverlayRoot.tsx`.

## Animations — CSS first

Prefer **native CSS** for motion (transitions, `@keyframes`, `linear()` easing, [`interpolate-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/interpolate-size), [`@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style)) instead of JS-driven animation libraries.

- **Easing:** Custom curves are fine with **`linear(...)`** multi-stop timing — see [Josh Comeau — Linear easing functions](https://www.joshwcomeau.com/animation/linear-timing-function/).
- **Where:** Overlay chrome motion is centralized in `src/style.css` (search `floating-overlay`, `overlay-chrome-pulse`). Extend there or co-locate component-scoped CSS rather than adding dependencies like Framer Motion unless there is a strong reason.

Verification before finishing risky UI changes: **`npm run verify`** (see `.cursor/rules/mello-voice-verify.mdc`).

## Windows release (installers for users)

To produce **sharable installers** (not just `tauri dev`):

1. From repo root: `npm install` → `npm run setup:whisper` → `npm run tauri build`
2. Give people **either** file from `src-tauri/target/release/bundle/`:
   - `nsis/Mello Voice_<version>_x64-setup.exe` (typical end-user wizard), or
   - `msi/Mello Voice_<version>_x64_en-US.msi`
3. If `app.exe` “Access denied” during build, stop running dev instances (`taskkill /IM app.exe /F`).

Full workflow, troubleshooting, and end-user expectations: **`.cursor/skills/mello-voice-windows-release/SKILL.md`**
