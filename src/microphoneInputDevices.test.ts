import { describe, expect, it } from "vitest";
import { systemDefaultPrimaryLabel } from "./microphoneInputDevices";

describe("microphoneInputDevices", () => {
  it("uses Windows-specific default label on Windows", () => {
    expect(systemDefaultPrimaryLabel("windows")).toBe("Windows Default");
    expect(systemDefaultPrimaryLabel("macos")).toBe("System default");
    expect(systemDefaultPrimaryLabel(null)).toBe("System default");
  });
});
