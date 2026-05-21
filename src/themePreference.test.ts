import { describe, expect, it } from "vitest";
import { parseThemePreference, resolveThemeIsDark } from "./themePreference";

describe("themePreference", () => {
  it("parses stored theme values", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
    expect(parseThemePreference(null)).toBe("system");
    expect(parseThemePreference("invalid")).toBe("system");
  });

  it("resolves dark mode from preference and system", () => {
    expect(resolveThemeIsDark("dark", false)).toBe(true);
    expect(resolveThemeIsDark("light", true)).toBe(false);
    expect(resolveThemeIsDark("system", true)).toBe(true);
    expect(resolveThemeIsDark("system", false)).toBe(false);
  });
});
