import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICTATION_SHORTCUT,
  dictationShortcutFromKeyboardEvent,
  isDefaultDictationShortcut,
  overlayListeningStopHint,
  parseDictationShortcut,
} from "./dictationShortcut";

function keyEvent(partial: Partial<Parameters<typeof dictationShortcutFromKeyboardEvent>[0]>) {
  return {
    altKey: false,
    code: "",
    ctrlKey: false,
    key: "",
    metaKey: false,
    ...partial,
  };
}

describe("dictation shortcut preference", () => {
  it("keeps Caps Lock as the default shortcut", () => {
    expect(parseDictationShortcut(null)).toEqual(DEFAULT_DICTATION_SHORTCUT);
    expect(isDefaultDictationShortcut(DEFAULT_DICTATION_SHORTCUT)).toBe(true);
  });

  it("maps character key presses to global shortcut accelerators", () => {
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "KeyM", key: "m" }))).toEqual({
      accelerator: "M",
      label: "M",
    });
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Digit7", key: "7" }))).toEqual({
      accelerator: "7",
      label: "7",
    });
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Semicolon", key: ";" }))).toEqual({
      accelerator: ";",
      label: ";",
    });
  });

  it("maps named single keys to global shortcut accelerators", () => {
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Insert", key: "Insert" }))).toEqual({
      accelerator: "Insert",
      label: "Insert",
    });
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "PageDown", key: "PageDown" }))).toEqual({
      accelerator: "PageDown",
      label: "Page Down",
    });
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Pause", key: "Pause" }))).toEqual({
      accelerator: "Pause",
      label: "Pause Break",
    });
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "ScrollLock", key: "ScrollLock" }))).toEqual({
      accelerator: "ScrollLock",
      label: "Scroll Lock",
    });
  });

  it("ignores modifier chords and unsupported keys", () => {
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "KeyM", key: "m", ctrlKey: true }))).toBeNull();
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Escape", key: "Escape" }))).toBeNull();
    expect(dictationShortcutFromKeyboardEvent(keyEvent({ code: "Tab", key: "Tab" }))).toBeNull();
  });

  it("uses the active shortcut label in listening copy", () => {
    expect(overlayListeningStopHint("M")).toBe("Double-tap M to stop");
  });
});
