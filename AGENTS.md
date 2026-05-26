# Agent notes — Mello Voice

## UI stack & components

Use these conventions before introducing new libraries or animation helpers:

- **Frontend:** React 19 + TypeScript + Vite (`vite.config.ts`).
- **Desktop shell:** Tauri 2 (`src-tauri/`).
- **Styling:** Tailwind CSS v4 with `@import "tailwindcss"` and tokens in `src/style.css`; utility merging via `tailwind-merge` / `clsx` (`src/lib/utils.ts`).
- **Components:** App-specific UI under `src/components/ui/` (buttons, card, badge, separator, scroll area, etc.). Overlay / floating primitives use **`radix-ui`** where helpful; **main-window settings** use **`vaul`**’s **`Drawer`** (see **Animations**).
- **Icons:** Prefer **small inline SVG components** under `src/components/icons/` (see `SettingsGearIcon.tsx`). Avoid pulling in icon packs unless several icons are needed.
- **Overlay window:** Transparent overlay chrome is styled under `html.overlay-window` in `src/style.css`; pill UI lives in `src/components/FloatingOverlay.tsx` / `OverlayRoot.tsx`. **Not** the surface ladder below—uses `--overlay-chrome-*` only.

## Elevation & surfaces

[Fluid Functionalism — Surfaces](https://www.fluidfunctionalism.com/docs/surfaces): substrate ladder + tokens in `src/style.css` (`--surface-*`, `shadow-surface-*`). **Shadcn `elevated.json` does not install** with our `radix-luma` preset (`surfaces` missing on ui.shadcn)—implementation is **`src/lib/surface-context.tsx`**, **`surface-classes.ts`**, **`elevated.tsx`**.

- **Root:** `<SurfaceProvider value={1}>` in `main.tsx`.
- **Raised UI:** wrap with **`<Elevated offset={n}>`** (optional **`shadowLevel`**). **`Card`** defaults **`surfaceOffset={1}`**; drawer offset lives in **`MainWindow.tsx`**. **`useSurface()`** + **`SURFACE_BG`** for inset fills (e.g. settings segment buttons). Tailwind needs **literal** `bg-surface-*` / `shadow-surface-*`—use **`surface-classes.ts`** maps, not templates.
- **Interactive states:** hover / active fills are **not new elevated surfaces**. Per Fluid examples, use shared **`bg-hover`** / **`bg-active`** tokens (`--hover` = foreground 6%, `--active` = foreground 10%) for flat controls such as **`Button variant="ghost"`** and menu/select rows. Use `bg-surface-*` / `<Elevated>` only when the component itself is a raised substrate (panel, popover, card, drawer, surface button), not for ordinary hover feedback.
- **Chrome:** elevated things use **soft `ring-*` + Fluid shadow in light**. **Do not stack a hard `border` on the same outer edge** as elevation shadow (looks double / harsh). **`Elevated`** owns the shared **`dark:shadow-none`** rule—**dark mode = ring + fill only, no box-shadow** on those surfaces; **`Button` `variant="surface"`** follows the same language (see `button.tsx`).
- **`variant="surface"`** (settings icon): **`bg-card`** (+1 step vs page), same ring language as elevated surfaces; meant for **substrate 1** (header). If reused deeper in the tree, reconsider or use substrate-aware classes.

## Animations — CSS first

Prefer **native CSS** for motion (transitions, `@keyframes`, `linear()` easing, [`interpolate-size`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/interpolate-size), [`@starting-style`](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@starting-style)) instead of JS-driven animation libraries.

### Easing

- **Prefer `linear(...)`** multi-stop curves for motion we define in stylesheet CSS (overlay chrome, drawers, etc.) so easing stays consistent across the app — see [Josh Comeau — Linear easing functions](https://www.joshwcomeau.com/animation/linear-timing-function/).
- **Shared tokens (`:root`):** **`--ease-ui`**, **`--ease-ui-snappy`**, **`--ease-opacity-breathe`**, **`--ease-spinner-dash`** in **`src/style.css`**. Prefer these (or **`var(--overlay-chrome-ease)`**, **`var(--settings-drawer-ease)`**) over **`cubic-bezier`** / **`ease-in-out`** / Tailwind’s default **`ease`** on any transition or animation we control.
- Keep **explicit durations** (~150–260ms chrome; drawer ~200ms) and align related nodes on the same **`--*-ease`** family when they should move together.

- Use **`transition`** when the element **stays mounted** and only property values change.
- Use **`@starting-style`** where it helps define the **first frame before a transition** (clean enters without a one-frame flash). Prefer it when lifecycle and browsers allow — it complements transitions; see MDN linked above.

### Settings bottom drawer ([Vaul](https://github.com/emilkowalski/vaul))

**Main-window settings** use **`Drawer` from `vaul`** (built on Radix Dialog): sheet from the **bottom**, **drag handle**, dismiss via **drag / overlay / Esc** (handled by the library).

- **`shouldScaleBackground`** shrinks/pushes back the rest of the UI while open. Vaul looks up **`document.querySelector('[data-vaul-drawer-wrapper]')`** and applies **`transform`** + **`border-radius`** there ([source](https://github.com/emilkowalski/vaul/blob/main/src/use-scale-background.ts)); the **main shell** must expose that wrapper (see **`MainWindow.tsx`** root div).
- **`setBackgroundColorOnScale={false}`** avoids forcing a **`body`** “letterbox” tint (better for desktop / WebView2); enable if you want the darker surround from the demos.
- **Scrolling inside the sheet:** prefer a plain **`overflow-y-auto`** region with **`min-h-0 flex-1`** plus **`touch-pan-y`** inside **`Drawer.Content`** (Vaul sets **`touch-action: none`** on the drawer; nested scroll needs an explicit pan-y scroller — Radix **`ScrollArea`** alone is a poor fit here).
- Vaul **injects** drawer/overlay motion CSS at runtime on **`[data-vaul-drawer]`** and **`[data-vaul-overlay]`**. **`src/style.css`** maps those to **`linear(...)`** timing via **`--settings-drawer-ease`** / **`--settings-drawer-duration`** on **`html [data-vaul-drawer]`** and **`html [data-vaul-overlay]`** so Mello’s easing wins over the injected defaults (higher specificity — the inject runs after the bundled CSS).
- **Handle** color is tokenized in the same block (`html [data-vaul-handle]`).
- **`prefers-reduced-motion`:** collapse **`--settings-drawer-duration`** toward instant motion.

**Where:** Pill / overlay chrome is under **`html.overlay-window`** — search **`floating-overlay`**, **`overlay-chrome-pulse`**. Drawer tuning: search **`settings-drawer`**, **`data-vaul-`** in `src/style.css`; UI in **`src/components/MainWindow.tsx`**. Prefer extending those areas or co-located component CSS over Framer Motion unless justified.

Verification before finishing risky UI changes: **`npm run verify`** (see `.cursor/rules/mello-voice-verify.mdc`).

## Seeing your change in the running app

When the user asks for a change they will want to **see** (UI, overlay, desktop behavior), do **not** assume an old `tauri dev` window picked it up.

1. **Tear down** anything already running for this project: stop the dev terminal job(s) (`tauri dev`, `vite`, etc.). On Windows, if the app is stuck or duplicated, close the Mello Voice window and/or `taskkill /IM app.exe /F`. **Do not** run bulk `Stop-Process` on “whatever owns port 1420”—another program can bind that port, and killing arbitrary PIDs can destabilize the machine.
2. **Boot a fresh instance** from the repo root: `npm run tauri dev` (run in the background so it keeps serving).
3. Glance at the new dev terminal output once to confirm the stack started; if it failed, fix and retry.

Do **not** stop after `npm run verify` alone when the user will look at the UI—you must **actually run** `npm run tauri dev` (background is fine) in the same turn unless something blocks it (missing toolchain, etc.).

This is **in addition to** `npm run verify` when that rule applies—verification is for the automated suite; restarting the app is so the user can visually confirm the change.

## Releases (agent-owned)

When the user wants to **ship** a version, read **`.cursor/skills/mello-voice-release/SKILL.md`** and run the full flow: **`npm run verify`**, **`npm run release:prepare`**, write **`releases/vX.Y.Z.md`** (tone: **`releases/v1.0.0.md`**), update **`CHANGELOG.md`**, commit, **`git tag vX.Y.Z`**, push commit + tag, **`npm run setup:whisper`**, **`npm run tauri build`**, then **`npm run release:publish -- vX.Y.Z`**. **Windows installers only** — no macOS release builds. Human-oriented summary: **`RELEASE.md`**.

## Windows release (installers for users)

To produce **sharable installers** (not just `tauri dev`):

1. From repo root: `npm install` → `npm run setup:whisper` → `npm run tauri build`
2. Give people **either** file from `src-tauri/target/release/bundle/`:
   - `nsis/Mello Voice_<version>_x64-setup.exe` (typical end-user wizard), or
   - `msi/Mello Voice_<version>_x64_en-US.msi`
3. If `app.exe` “Access denied” during build, stop running dev instances (`taskkill /IM app.exe /F`).

Full workflow, troubleshooting, and end-user expectations: **`.cursor/skills/mello-voice-windows-release/SKILL.md`**
