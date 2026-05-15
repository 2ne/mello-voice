/** Persisted keys — keep in sync with `get_after_dictation_action` / `set_after_dictation_action` (Rust). */
export const AFTER_DICTATION_OPTIONS = ["paste_text", "paste_and_send"] as const;

export type AfterDictationActionOption = (typeof AFTER_DICTATION_OPTIONS)[number];

export const DEFAULT_AFTER_DICTATION_ACTION: AfterDictationActionOption = "paste_text";

export function parseAfterDictationAction(raw: string | null | undefined): AfterDictationActionOption {
  const v = raw?.trim() ?? "";
  return (AFTER_DICTATION_OPTIONS as readonly string[]).includes(v)
    ? (v as AfterDictationActionOption)
    : DEFAULT_AFTER_DICTATION_ACTION;
}

export function afterDictationActionLabel(option: AfterDictationActionOption): string {
  switch (option) {
    case "paste_text":
      return "Paste text";
    case "paste_and_send":
      return "Paste and send";
  }
}
