import { describe, expect, it } from "vitest";
import {
  DEFAULT_DICTATION_BAR_MODE,
  DICTATION_BAR_MODE_OPTIONS,
  dictationBarModeFromEnabled,
  dictationBarModeLabel,
  overlayBarEnabledFromMode,
  parseDictationBarMode,
} from "./dictationBarMode";

describe("dictationBarMode", () => {
  it("defaults to 'always_visible' (the historical product default)", () => {
    expect(DEFAULT_DICTATION_BAR_MODE).toBe("always_visible");
    /** Option order also matters: it is the order users see in the Select. */
    expect(DICTATION_BAR_MODE_OPTIONS).toEqual(["always_visible", "hide_when_idle"]);
  });

  it("parses known modes and falls back for unknown strings", () => {
    expect(parseDictationBarMode("always_visible")).toBe("always_visible");
    expect(parseDictationBarMode("hide_when_idle")).toBe("hide_when_idle");
    expect(parseDictationBarMode("bogus")).toBe(DEFAULT_DICTATION_BAR_MODE);
    expect(parseDictationBarMode("")).toBe(DEFAULT_DICTATION_BAR_MODE);
  });

  it("maps overlay preference bool ↔ select values (round-trip)", () => {
    for (const opt of DICTATION_BAR_MODE_OPTIONS) {
      const enabled = overlayBarEnabledFromMode(opt);
      expect(dictationBarModeFromEnabled(enabled)).toBe(opt);
    }
  });

  it("always_visible enables overlay bar; hide_when_idle disables", () => {
    expect(overlayBarEnabledFromMode("always_visible")).toBe(true);
    expect(overlayBarEnabledFromMode("hide_when_idle")).toBe(false);
  });

  it("labels match UI strings", () => {
    expect(dictationBarModeLabel("always_visible")).toBe("Always visible");
    expect(dictationBarModeLabel("hide_when_idle")).toBe("Hide when idle");
  });
});
