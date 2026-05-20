export interface DictationShortcutPreference {
  /** Native accelerator id — overlay treats this as double-tap toggle. */
  accelerator: string;
  /** Human label used in settings, onboarding copy, and overlay hints. */
  label: string;
}

export const DEFAULT_DICTATION_SHORTCUT: DictationShortcutPreference = {
  accelerator: "CapsLock",
  label: "Caps Lock",
};

const CHARACTER_CODE_SHORTCUTS: Record<string, DictationShortcutPreference> = {
  Backquote: { accelerator: "`", label: "`" },
  Backslash: { accelerator: "\\", label: "\\" },
  BracketLeft: { accelerator: "[", label: "[" },
  BracketRight: { accelerator: "]", label: "]" },
  Backspace: { accelerator: "Backspace", label: "Backspace" },
  Comma: { accelerator: ",", label: "," },
  Delete: { accelerator: "Delete", label: "Delete" },
  End: { accelerator: "End", label: "End" },
  Enter: { accelerator: "Enter", label: "Enter" },
  Equal: { accelerator: "=", label: "=" },
  Home: { accelerator: "Home", label: "Home" },
  Insert: { accelerator: "Insert", label: "Insert" },
  Minus: { accelerator: "-", label: "-" },
  PageDown: { accelerator: "PageDown", label: "Page Down" },
  PageUp: { accelerator: "PageUp", label: "Page Up" },
  Pause: { accelerator: "Pause", label: "Pause Break" },
  Period: { accelerator: ".", label: "." },
  PrintScreen: { accelerator: "PrintScreen", label: "Print Screen" },
  Quote: { accelerator: "'", label: "'" },
  ScrollLock: { accelerator: "ScrollLock", label: "Scroll Lock" },
  Semicolon: { accelerator: ";", label: ";" },
  Slash: { accelerator: "/", label: "/" },
  Space: { accelerator: "Space", label: "Space" },
  ArrowDown: { accelerator: "ArrowDown", label: "Arrow Down" },
  ArrowLeft: { accelerator: "ArrowLeft", label: "Arrow Left" },
  ArrowRight: { accelerator: "ArrowRight", label: "Arrow Right" },
  ArrowUp: { accelerator: "ArrowUp", label: "Arrow Up" },
  NumpadAdd: { accelerator: "NumpadAdd", label: "Num +" },
  NumpadDecimal: { accelerator: "NumpadDecimal", label: "Num ." },
  NumpadDivide: { accelerator: "NumpadDivide", label: "Num /" },
  NumpadEnter: { accelerator: "NumpadEnter", label: "Num Enter" },
  NumpadEqual: { accelerator: "NumpadEqual", label: "Num =" },
  NumpadMultiply: { accelerator: "NumpadMultiply", label: "Num *" },
  NumpadSubtract: { accelerator: "NumpadSubtract", label: "Num -" },
  NumLock: { accelerator: "NumLock", label: "Num Lock" },
};

for (let i = 1; i <= 12; i += 1) {
  CHARACTER_CODE_SHORTCUTS[`F${i}`] = { accelerator: `F${i}`, label: `F${i}` };
}

for (let i = 0; i <= 9; i += 1) {
  CHARACTER_CODE_SHORTCUTS[`Digit${i}`] = { accelerator: String(i), label: String(i) };
  CHARACTER_CODE_SHORTCUTS[`Numpad${i}`] = { accelerator: `Numpad${i}`, label: `Num ${i}` };
}

for (let i = 0; i < 26; i += 1) {
  const letter = String.fromCharCode(65 + i);
  CHARACTER_CODE_SHORTCUTS[`Key${letter}`] = { accelerator: letter, label: letter };
}

const SUPPORTED_ACCELERATORS = new Set([
  DEFAULT_DICTATION_SHORTCUT.accelerator,
  ...Object.values(CHARACTER_CODE_SHORTCUTS).map((shortcut) => shortcut.accelerator),
]);

interface KeyboardShortcutEvent {
  altKey: boolean;
  code: string;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}

export function isDefaultDictationShortcut(shortcut: DictationShortcutPreference): boolean {
  return shortcut.accelerator === DEFAULT_DICTATION_SHORTCUT.accelerator;
}

export function parseDictationShortcut(value: unknown): DictationShortcutPreference {
  if (value == null || typeof value !== "object") return DEFAULT_DICTATION_SHORTCUT;
  const { accelerator, label } = value as { accelerator?: unknown; label?: unknown };
  if (typeof accelerator !== "string" || typeof label !== "string") return DEFAULT_DICTATION_SHORTCUT;
  const trimmedAccelerator = accelerator.trim();
  const trimmedLabel = label.trim();
  if (!SUPPORTED_ACCELERATORS.has(trimmedAccelerator) || trimmedLabel.length === 0) {
    return DEFAULT_DICTATION_SHORTCUT;
  }
  return { accelerator: trimmedAccelerator, label: trimmedLabel };
}

export function dictationShortcutFromKeyboardEvent(event: KeyboardShortcutEvent): DictationShortcutPreference | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;
  if (event.key === "CapsLock" || event.code === "CapsLock") return DEFAULT_DICTATION_SHORTCUT;
  return CHARACTER_CODE_SHORTCUTS[event.code] ?? null;
}

/** Text around `<kbd>{shortcutLabel}</kbd>` in the empty-history hint. */
export function dictationShortcutGestureParts(): { beforeKey: string; afterKey: string } {
  return { beforeKey: "Double-tap ", afterKey: " to toggle dictation." };
}

/** Shown under “Listening…” when the overlay has no transcript yet. */
export function overlayListeningStopHint(shortcutLabel: string = DEFAULT_DICTATION_SHORTCUT.label): string {
  return `Double-tap ${shortcutLabel} to stop`;
}
