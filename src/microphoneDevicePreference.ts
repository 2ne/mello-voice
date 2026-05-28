/** Empty string = system default microphone (persisted / getUserMedia). */
export const DEFAULT_MICROPHONE_DEVICE_ID = "";

/** Radix Select forbids empty-string item values — UI-only sentinel. */
export const MICROPHONE_SELECT_SYSTEM_DEFAULT = "__system_default__";

export function parseMicrophoneDeviceId(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_MICROPHONE_DEVICE_ID;
  return raw.trim();
}

export function microphoneDeviceIdToSelectValue(deviceId: string): string {
  const parsed = parseMicrophoneDeviceId(deviceId);
  return parsed || MICROPHONE_SELECT_SYSTEM_DEFAULT;
}

export function selectValueToMicrophoneDeviceId(selectValue: string): string {
  if (selectValue === MICROPHONE_SELECT_SYSTEM_DEFAULT) return DEFAULT_MICROPHONE_DEVICE_ID;
  return parseMicrophoneDeviceId(selectValue);
}

export function defaultMicrophoneOptionLabel(): string {
  return "System default";
}
