import { describe, expect, it } from "vitest";
import {
  DEFAULT_MICROPHONE_DEVICE_ID,
  microphoneDeviceIdToSelectValue,
  MICROPHONE_SELECT_SYSTEM_DEFAULT,
  parseMicrophoneDeviceId,
  selectValueToMicrophoneDeviceId,
} from "./microphoneDevicePreference";

describe("microphoneDevicePreference", () => {
  it("parses stored device ids", () => {
    expect(parseMicrophoneDeviceId("abc")).toBe("abc");
    expect(parseMicrophoneDeviceId("  mic-1  ")).toBe("mic-1");
    expect(parseMicrophoneDeviceId("")).toBe(DEFAULT_MICROPHONE_DEVICE_ID);
    expect(parseMicrophoneDeviceId(null)).toBe(DEFAULT_MICROPHONE_DEVICE_ID);
    expect(parseMicrophoneDeviceId(42)).toBe(DEFAULT_MICROPHONE_DEVICE_ID);
  });

  it("maps between persisted ids and Radix-safe select values", () => {
    expect(microphoneDeviceIdToSelectValue("")).toBe(MICROPHONE_SELECT_SYSTEM_DEFAULT);
    expect(microphoneDeviceIdToSelectValue("mic-a")).toBe("mic-a");
    expect(selectValueToMicrophoneDeviceId(MICROPHONE_SELECT_SYSTEM_DEFAULT)).toBe("");
    expect(selectValueToMicrophoneDeviceId("mic-a")).toBe("mic-a");
  });
});
