import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Select,
  SelectContent,
  SelectStackedItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DEFAULT_MICROPHONE_DEVICE_ID,
  microphoneDeviceIdToSelectValue,
  selectValueToMicrophoneDeviceId,
} from "@/microphoneDevicePreference";
import {
  listMicrophoneSelectOptions,
  systemDefaultPrimaryLabel,
  type MicrophoneSelectOption,
} from "@/microphoneInputDevices";

function findOptionForDeviceId(
  options: MicrophoneSelectOption[],
  deviceId: string,
): MicrophoneSelectOption | undefined {
  const selectValue = microphoneDeviceIdToSelectValue(deviceId);
  return options.find((o) => o.selectValue === selectValue);
}

/** Closed-trigger label: short title + detail in parentheses when system default. */
export function microphoneTriggerLabel(option: MicrophoneSelectOption): string {
  if (option.deviceId === DEFAULT_MICROPHONE_DEVICE_ID && option.secondaryLabel) {
    return `${option.primaryLabel} (${option.secondaryLabel})`;
  }
  return option.primaryLabel;
}

export function MicrophoneInputSelect({
  value,
  onChange,
  disabled,
  active,
  runtimeOs,
}: {
  value: string;
  onChange: (deviceId: string) => void;
  disabled?: boolean;
  /** When true, refresh the device list (e.g. settings drawer opened). */
  active?: boolean;
  runtimeOs?: string | null;
}) {
  const [options, setOptions] = useState<MicrophoneSelectOption[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setOptions(await listMicrophoneSelectOptions(runtimeOs));
    } finally {
      setLoading(false);
    }
  }, [runtimeOs]);

  useEffect(() => {
    if (active === false) return;
    void refresh();
  }, [active, refresh]);

  useEffect(() => {
    const media = navigator.mediaDevices;
    if (!media) return;
    media.addEventListener("devicechange", refresh);
    return () => media.removeEventListener("devicechange", refresh);
  }, [refresh]);

  const selectValue = microphoneDeviceIdToSelectValue(value);
  const selectedOption = useMemo(() => findOptionForDeviceId(options, value), [options, value]);

  const triggerText = loading
    ? "Loading…"
    : selectedOption
      ? microphoneTriggerLabel(selectedOption)
      : systemDefaultPrimaryLabel(runtimeOs);

  const hasStoredButMissing =
    value.length > 0 && !options.some((o) => o.deviceId === value);

  const missingOption: MicrophoneSelectOption | null = hasStoredButMissing
    ? {
        selectValue: value,
        deviceId: value,
        triggerLabel: "Selected microphone",
        primaryLabel: "Selected microphone",
      }
    : null;

  return (
    <Select
      value={selectValue}
      onValueChange={(v) => onChange(selectValueToMicrophoneDeviceId(v))}
      disabled={disabled || loading}
    >
      <SelectTrigger aria-label="Microphone input" className="w-full max-w-none">
        <SelectValue placeholder={triggerText} />
      </SelectTrigger>
      <SelectContent variant="menu" align="end" side="top" sideOffset={8} collisionPadding={16}>
        {options.map((opt) => (
          <SelectStackedItem
            key={opt.selectValue}
            value={opt.selectValue}
            primaryLabel={opt.primaryLabel}
            secondaryLabel={opt.secondaryLabel}
          />
        ))}
        {missingOption ? (
          <SelectStackedItem
            value={missingOption.selectValue}
            primaryLabel={missingOption.primaryLabel}
          />
        ) : null}
      </SelectContent>
    </Select>
  );
}
