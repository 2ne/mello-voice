import {
  DEFAULT_MICROPHONE_DEVICE_ID,
  MICROPHONE_SELECT_SYSTEM_DEFAULT,
} from "./microphoneDevicePreference";

export interface MicInputDevice {
  deviceId: string;
  label: string;
}

export interface MicrophoneSelectOption {
  /** Value for Radix Select (never empty string). */
  selectValue: string;
  /** Persisted device id; empty = system default. */
  deviceId: string;
  /** Single line shown in the closed trigger (may truncate). */
  triggerLabel: string;
  primaryLabel: string;
  secondaryLabel?: string;
}

const VIRTUAL_DEVICE_LABEL = /^(default|communications)\s*[-–—]\s*/i;

function fallbackMicLabel(index: number): string {
  return `Microphone ${index + 1}`;
}

function stripVirtualPrefix(label: string): string {
  return label.replace(VIRTUAL_DEVICE_LABEL, "").trim();
}

function isVirtualDeviceLabel(label: string): boolean {
  return VIRTUAL_DEVICE_LABEL.test(label.trim());
}

export function systemDefaultPrimaryLabel(runtimeOs: string | null | undefined): string {
  return runtimeOs === "windows" ? "Windows Default" : "System default";
}

function buildTriggerLabel(primary: string, secondary?: string): string {
  if (!secondary) return primary;
  return `${primary} (${secondary})`;
}

/** Lists audio input devices. Labels are only populated after microphone permission is granted. */
export async function listMicInputDevices(): Promise<MicInputDevice[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "");
  return inputs.map((d, index) => ({
    deviceId: d.deviceId,
    label: d.label?.trim() || fallbackMicLabel(index),
  }));
}

/** Options for the settings microphone select (system default + physical devices). */
export async function listMicrophoneSelectOptions(
  runtimeOs?: string | null,
): Promise<MicrophoneSelectOption[]> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.enumerateDevices) {
    const primary = systemDefaultPrimaryLabel(runtimeOs);
    return [
      {
        selectValue: MICROPHONE_SELECT_SYSTEM_DEFAULT,
        deviceId: DEFAULT_MICROPHONE_DEVICE_ID,
        triggerLabel: primary,
        primaryLabel: primary,
      },
    ];
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const inputs = devices.filter((d) => d.kind === "audioinput" && d.deviceId !== "");

  const defaultVirtual = inputs.find((d) => /^default\s*[-–—]\s*/i.test(d.label));
  const firstPhysical = inputs.find((d) => d.label?.trim() && !isVirtualDeviceLabel(d.label));
  const defaultDetail = defaultVirtual
    ? stripVirtualPrefix(defaultVirtual.label)
    : firstPhysical?.label?.trim() || undefined;

  const primaryDefault = systemDefaultPrimaryLabel(runtimeOs);
  const options: MicrophoneSelectOption[] = [
    {
      selectValue: MICROPHONE_SELECT_SYSTEM_DEFAULT,
      deviceId: DEFAULT_MICROPHONE_DEVICE_ID,
      triggerLabel: buildTriggerLabel(primaryDefault, defaultDetail),
      primaryLabel: primaryDefault,
      secondaryLabel: defaultDetail,
    },
  ];

  let physicalIndex = 0;
  for (const d of inputs) {
    const rawLabel = d.label?.trim();
    if (!rawLabel || isVirtualDeviceLabel(rawLabel)) continue;
    const label = rawLabel || fallbackMicLabel(physicalIndex);
    physicalIndex += 1;
    options.push({
      selectValue: d.deviceId,
      deviceId: d.deviceId,
      triggerLabel: label,
      primaryLabel: label,
    });
  }

  return options;
}
