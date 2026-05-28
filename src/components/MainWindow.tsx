import { useState, useEffect, useCallback, useRef, useReducer, useEffectEvent, type KeyboardEvent, type MouseEvent, type ReactNode } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsGearIcon } from "@/components/icons/SettingsGearIcon";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { CopyIcon } from "@/components/icons/CopyIcon";
import { CheckIcon } from "@/components/icons/CheckIcon";
import { getHistory, clearHistory, type HistoryEntry } from "../history";
import {
  DEFAULT_DICTATION_SHORTCUT,
  dictationShortcutFromKeyboardEvent,
  dictationShortcutGestureParts,
  isDefaultDictationShortcut,
  parseDictationShortcut,
  type DictationShortcutPreference,
} from "../dictationShortcut";
import { cn } from "@/lib/utils";
import { Elevated } from "@/lib/elevated";
import { Button } from "@/components/ui/button";
import { HoldToClearButton } from "@/components/ui/hold-to-clear-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SETTINGS_CONTROL_WIDTH_CLASS,
  settingsControlTriggerCn,
} from "@/components/ui/select";
import { Drawer } from "vaul";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseThemePreference, syncDocumentTheme, THEME_STORAGE_KEY, type ThemePreference } from "@/themePreference";
import { AFTER_DICTATION_OPTIONS, DEFAULT_AFTER_DICTATION_ACTION, afterDictationActionLabel, parseAfterDictationAction, type AfterDictationActionOption } from "../afterDictationAction";
import { DICTATION_BAR_MODE_OPTIONS, dictationBarModeLabel, dictationBarModeFromEnabled, overlayBarEnabledFromMode, parseDictationBarMode } from "../dictationBarMode";
import { FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS, fetchOverlayBarEnabledWithRetry } from "../overlayBarPrefFetch";
import {
  getMicPermissionState,
  requestMicPermission,
  setPreferredMicrophoneDeviceId,
  type MicRecoveryKind,
} from "../transcription/wavCapture";
import { parseMicrophoneDeviceId } from "../microphoneDevicePreference";
import { MicrophoneInputSelect } from "@/components/MicrophoneInputSelect";
import { MicOnboardingScreen } from "@/components/MicOnboardingScreen";
import { HistoryTimestamp } from "@/components/HistoryTimestamp";
import { Tooltip } from "@/components/ui/tooltip";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null || (import.meta.env.TAURI_PLATFORM != null && import.meta.env.TAURI_PLATFORM !== ""))
  );
}

const MIC_RECOVERY_KINDS = new Set<MicRecoveryKind>(["notAllowed", "notFound", "notReadable", "unknown"]);

function parseMicRecoveryReason(payload: unknown): MicRecoveryKind | null {
  if (payload == null || typeof payload !== "object" || !("reason" in payload)) return null;
  const r = (payload as { reason?: unknown }).reason;
  if (typeof r !== "string") return null;
  if (MIC_RECOVERY_KINDS.has(r as MicRecoveryKind)) return r as MicRecoveryKind;
  return null;
}

/** Same shell + body padding for empty state + every history row. Light: Fluid shadow + ring via Elevated; dark: ring only (see `elevated.tsx`). */
const HISTORY_CARD_SHELL = "gap-0 rounded-2xl py-0 outline-none";

const HISTORY_CARD_BODY = "px-4 py-3.5";
/** Empty card exit before first row appears — keep in sync with `--history-empty-exit-duration`. */
const HISTORY_EMPTY_EXIT_MS = 220;
/** Empty-history how-to: numbered circles + vertical connector */
const HISTORY_TIMELINE_BUBBLE =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-2xs font-medium tabular-nums text-muted-foreground";
/** Hover/focus affordances for history rows. Named `group/history` so copy reveal does not fire the ghost `Button`'s inner `group-hover` layers (plain `group` on the card would). */
const HISTORY_CARD_INTERACTIVE =
  "group/history transition-[background-color,box-shadow,transform] duration-100 ease-snappy hover:bg-accent/40";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

interface SettingsPrefs {
  overlayBarEnabled: boolean;
  afterDictationAction: AfterDictationActionOption;
  themePreference: ThemePreference;
  dictationShortcut: DictationShortcutPreference;
  microphoneDeviceId: string;
}

const INITIAL_SETTINGS_PREFS: SettingsPrefs = {
  overlayBarEnabled: true,
  afterDictationAction: DEFAULT_AFTER_DICTATION_ACTION,
  themePreference: "system",
  dictationShortcut: DEFAULT_DICTATION_SHORTCUT,
  microphoneDeviceId: "",
};

function settingsPrefsReducer(state: SettingsPrefs, patch: Partial<SettingsPrefs>): SettingsPrefs {
  return { ...state, ...patch };
}

interface MicGateState {
  phase: "checking" | "needsMic" | "ready";
  recoveryKind: MicRecoveryKind | null;
  busy: boolean;
}

const INITIAL_MIC_GATE_STATE: MicGateState = {
  phase: "checking",
  recoveryKind: null,
  busy: false,
};

function micGateReducer(state: MicGateState, patch: Partial<MicGateState>): MicGateState {
  return { ...state, ...patch };
}

interface MainUiState {
  settingsOpen: boolean;
  settingsTooltipOpen: boolean;
}

const INITIAL_MAIN_UI_STATE: MainUiState = {
  settingsOpen: false,
  settingsTooltipOpen: false,
};

function mainUiReducer(state: MainUiState, patch: Partial<MainUiState>): MainUiState {
  return { ...state, ...patch };
}

/** ChatGPT-like row: stacked label/description left, trailing control aligned right. */
function SettingsSettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-5 py-5">
      <div className="min-w-0 flex-1">
        <p className="text-base text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div data-settings-control="" className={cn("relative z-[2] flex min-h-9 shrink-0 items-center justify-end", SETTINGS_CONTROL_WIDTH_CLASS)}>
        {children}
      </div>
    </div>
  );
}

function DictationShortcutInput({
  value,
  onChange,
  onCaptureActiveChange,
}: {
  value: DictationShortcutPreference;
  onChange: (shortcut: DictationShortcutPreference) => void;
  onCaptureActiveChange: (active: boolean) => void;
}) {
  const [isCapturing, setIsCapturing] = useState(false);
  const hasCustomValue = !isDefaultDictationShortcut(value);

  const setCaptureActive = useCallback(
    (active: boolean) => {
      setIsCapturing(active);
      onCaptureActiveChange(active);
    },
    [onCaptureActiveChange],
  );

  useEffect(() => {
    return () => onCaptureActiveChange(false);
  }, [onCaptureActiveChange]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Tab") return;
      event.preventDefault();
      event.stopPropagation();

      if (event.key === "Escape") {
        setCaptureActive(false);
        event.currentTarget.blur();
        return;
      }

      const next = dictationShortcutFromKeyboardEvent(event);
      if (next == null) return;
      onChange(next);
      setCaptureActive(false);
      event.currentTarget.blur();
    },
    [onChange, setCaptureActive],
  );

  const resetToDefault = useCallback(() => {
    onChange(DEFAULT_DICTATION_SHORTCUT);
    setCaptureActive(false);
  }, [onChange, setCaptureActive]);

  return (
    <div className={cn("relative inline-flex shrink-0", SETTINGS_CONTROL_WIDTH_CLASS)}>
      <input
        aria-label="Dictation shortcut"
        className={cn(
          settingsControlTriggerCn("pr-9 caret-transparent"),
          "placeholder:text-muted-foreground",
          isCapturing && "text-muted-foreground",
        )}
        inputMode="none"
        placeholder={isCapturing ? "Tap any key" : undefined}
        readOnly
        spellCheck={false}
        value={isCapturing ? "" : value.label}
        onBlur={() => setCaptureActive(false)}
        onFocus={() => setCaptureActive(true)}
        onKeyDown={handleKeyDown}
      />
      {hasCustomValue ? (
        <Tooltip content="Reset to Caps Lock" side="top">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="absolute right-1.5 top-1/2 size-6 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Reset shortcut to Caps Lock"
            onMouseDown={(event) => event.preventDefault()}
            onClick={resetToDefault}
          >
            <CloseIcon strokeWidth={1.75} className="size-3.5" />
          </Button>
        </Tooltip>
      ) : null}
    </div>
  );
}

function HistoryItem({ entry, onCopy }: { entry: HistoryEntry; onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const [copyTriggerActive, setCopyTriggerActive] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(
    (e: MouseEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onCopy(entry.text);
      setCopied(true);
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
      copiedTimeoutRef.current = window.setTimeout(() => {
        setCopied(false);
        copiedTimeoutRef.current = null;
      }, 2000);
    },
    [entry.text, onCopy],
  );

  const copyTooltipOpen = copyTriggerActive || copied;

  return (
    <Card
      data-copied={copied}
      size="sm"
      className={cn(HISTORY_CARD_SHELL, HISTORY_CARD_INTERACTIVE, copied && "ring-foreground/15")}
    >
      <CardContent className={cn(HISTORY_CARD_BODY, "relative")}>
        <div className="text-base leading-relaxed text-foreground">{entry.text}</div>
        <div className="mt-2 text-xs text-muted-foreground">
          <HistoryTimestamp value={entry.timestamp} />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute bottom-2 right-4 opacity-0 transition-opacity duration-80",
            "group-hover/history:pointer-events-auto group-hover/history:opacity-100",
            "group-focus-within/history:pointer-events-auto group-focus-within/history:opacity-100",
          )}
        >
          <Tooltip
            content={copied ? "Copied" : "Copy"}
            side="left"
            forceOpen={copyTooltipOpen}
            onOpenChange={(open) => {
              if (open) setCopyTriggerActive(true);
            }}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground hover:text-foreground"
              aria-label={copied ? "Copied" : "Copy"}
              onPointerEnter={() => setCopyTriggerActive(true)}
              onPointerLeave={() => setCopyTriggerActive(false)}
              onFocus={() => setCopyTriggerActive(true)}
              onBlur={() => setCopyTriggerActive(false)}
              onClick={handleCopy}
            >
              <span className="relative block size-3.5 shrink-0">
                <CopyIcon
                  strokeWidth={2}
                  className={cn(
                    "absolute inset-0 transition-[opacity,transform] duration-200",
                    copied ? "scale-90 opacity-0" : "scale-100 opacity-100 starting:scale-90 starting:opacity-0",
                  )}
                />
                <CheckIcon
                  strokeWidth={2}
                  className={cn(
                    "absolute inset-0 text-primary transition-[opacity,transform] duration-80",
                    copied ? "scale-100 opacity-100" : "scale-90 opacity-0",
                  )}
                />
              </span>
            </Button>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

function MainWindow() {
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [emptyMounted, setEmptyMounted] = useState(true);
  const [emptyExiting, setEmptyExiting] = useState(false);
  const historyHydratedRef = useRef(false);
  const dictationGestureHintParts = dictationShortcutGestureParts();
  const [mainUiState, updateMainUiState] = useReducer(mainUiReducer, INITIAL_MAIN_UI_STATE);
  /** Controlled so we can reject focus-driven opens after the drawer closes (Radix restores focus → instant tooltip). */
  const { settingsOpen, settingsTooltipOpen } = mainUiState;
  const suppressSettingsTooltipAfterCloseRef = useRef(false);
  const prevSettingsOpenRef = useRef(false);
  /** Semver shown in Settings footer + used for native window title. */
  const [appVersionLabel, setAppVersionLabel] = useState<string | null>(null);
  const [settingsPrefs, updateSettingsPrefs] = useReducer(settingsPrefsReducer, INITIAL_SETTINGS_PREFS);
  const [micGateState, updateMicGateState] = useReducer(micGateReducer, INITIAL_MIC_GATE_STATE);
  const [runtimeOs, setRuntimeOs] = useState<string | null>(null);
  /** Synchronous mirror of `overlayBarPrefResolved` — lets late boot fetches skip clobbering a fresher event-driven write. */
  const overlayBarPrefResolvedRef = useRef(false);
  const { phase: micPhase, recoveryKind: micRecoveryKind, busy: micBusy } = micGateState;
  const micPhaseRef = useRef(micPhase);
  /** Raised by overlay recovery. While true, only explicit "Allow microphone access" can clear mic gate. */
  const micRecoveryLockedRef = useRef(false);
  const { overlayBarEnabled, afterDictationAction, themePreference, dictationShortcut, microphoneDeviceId } = settingsPrefs;

  useEffect(() => {
    micPhaseRef.current = micPhase;
  }, [micPhase]);

  const prepareDictationPipeline = useCallback(async () => {
    if (!isTauriRuntime()) return;
    await invoke("prepare_dictation_pipeline");
  }, []);

  const isDictationPipelineReady = useCallback(async () => {
    if (!isTauriRuntime()) return true;
    try {
      return await invoke<boolean>("get_dictation_pipeline_ready");
    } catch {
      return false;
    }
  }, []);

  const beginPipelineWarm = useCallback(() => {
    if (!isTauriRuntime()) return;
    void prepareDictationPipeline().catch((e) => {
      console.warn("prepare_dictation_pipeline:", e);
    });
  }, [prepareDictationPipeline]);

  const syncMicGate = useCallback(async () => {
    const devOnboarding =
      import.meta.env.DEV &&
      typeof localStorage !== "undefined" &&
      localStorage.getItem("mello-dev-show-mic-onboarding") === "1";
    if (!isTauriRuntime()) {
      updateMicGateState({ phase: "ready" });
      return;
    }
    if (micRecoveryLockedRef.current) {
      try {
        await invoke("set_mic_overlay_boot_allowed", { enabled: false });
      } catch {
        /* ignore */
      }
      const permission = await getMicPermissionState();
      if (permission === "granted") {
        const result = await requestMicPermission();
        if (result.ok) {
          micRecoveryLockedRef.current = false;
          if (await isDictationPipelineReady()) {
            updateMicGateState({ recoveryKind: null, phase: "ready" });
            return;
          }
          try {
            await invoke("set_mic_overlay_boot_allowed", { enabled: true });
          } catch {
            /* ignore */
          }
          updateMicGateState({ recoveryKind: null, phase: "ready" });
          beginPipelineWarm();
          return;
        }
      }
      updateMicGateState({ phase: "needsMic" });
      return;
    }
    const permission = await getMicPermissionState();
    const blockMain = permission !== "granted" || devOnboarding;
    if (blockMain) {
      try {
        await invoke("set_mic_overlay_boot_allowed", { enabled: false });
      } catch {
        /* ignore */
      }
      updateMicGateState({ phase: "needsMic" });
    } else {
      if (await isDictationPipelineReady()) {
        updateMicGateState({ recoveryKind: null, phase: "ready" });
        return;
      }
      try {
        await invoke("set_mic_overlay_boot_allowed", { enabled: true });
      } catch {
        /* ignore */
      }
      updateMicGateState({ recoveryKind: null, phase: "ready" });
      beginPipelineWarm();
    }
  }, [beginPipelineWarm, isDictationPipelineReady]);

  const handleOpenMicSettings = useCallback(async () => {
    if (!isTauriRuntime()) return;
    try {
      await invoke("open_mic_privacy_settings");
    } catch (e) {
      console.warn("open_mic_privacy_settings:", e);
    }
  }, []);

  const handleMicAllow = useCallback(async () => {
    const wasWindowsBlocked = runtimeOs === "windows" && micRecoveryKind === "notAllowed";
    updateMicGateState({ busy: true, recoveryKind: null });
    if (wasWindowsBlocked && isTauriRuntime()) {
      try {
        await invoke("reset_webview_mic_permission");
      } catch (e) {
        console.warn("reset_webview_mic_permission:", e);
      }
    }
    const result = await requestMicPermission();
    if (result.ok) {
      micRecoveryLockedRef.current = false;
      updateMicGateState({ busy: false, recoveryKind: null, phase: "ready" });
      try {
        await invoke("set_mic_overlay_boot_allowed", { enabled: true });
      } catch {
        /* ignore */
      }
      beginPipelineWarm();
    } else {
      micRecoveryLockedRef.current = true;
      updateMicGateState({ busy: false, recoveryKind: result.mapped, phase: "needsMic" });
    }
  }, [beginPipelineWarm, micRecoveryKind, runtimeOs]);

  const refreshHistory = useCallback(async () => {
    const entries = await getHistory();
    setHistoryEntries(entries);
  }, []);

  /** Single fetch+apply for `get_overlay_bar_enabled`. Skips its write if an event-listener path already resolved the pref with a fresher value. */
  const applyOverlayBarPrefFromIpc = useEffectEvent(async () => {
    if (overlayBarPrefResolvedRef.current) return;
    const enabled = await fetchOverlayBarEnabledWithRetry(() => invoke<boolean>("get_overlay_bar_enabled"), FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS);
    if (!overlayBarPrefResolvedRef.current) {
      overlayBarPrefResolvedRef.current = true;
      updateSettingsPrefs({ overlayBarEnabled: enabled });
    }
  });

  const applyAllSettingsFromIpc = useEffectEvent(async () => {
    const [overlayBarShowResult, themeResult, afterDictationActionResult, dictationShortcutResult, microphoneDeviceResult] =
      await Promise.allSettled([
      fetchOverlayBarEnabledWithRetry(() => invoke<boolean>("get_overlay_bar_enabled"), FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS),
      invoke<string>("get_theme"),
      invoke<string>("get_after_dictation_action"),
      invoke<unknown>("get_dictation_shortcut"),
      invoke<string>("get_microphone_device_id"),
    ]);
    /** If a fresher `overlay-bar-enabled-changed` arrived during the await, use the in-memory pref instead of the fetched one. */
    const overlayBarShow = overlayBarPrefResolvedRef.current ? overlayBarEnabled : overlayBarShowResult.status === "fulfilled" ? overlayBarShowResult.value : overlayBarEnabled;
    overlayBarPrefResolvedRef.current = true;
    const nextMicDeviceId =
      microphoneDeviceResult.status === "fulfilled"
        ? parseMicrophoneDeviceId(microphoneDeviceResult.value)
        : microphoneDeviceId;
    setPreferredMicrophoneDeviceId(nextMicDeviceId);
    updateSettingsPrefs({
      overlayBarEnabled: overlayBarShow,
      themePreference: themeResult.status === "fulfilled" ? parseThemePreference(themeResult.value) : parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
      afterDictationAction: afterDictationActionResult.status === "fulfilled" ? parseAfterDictationAction(afterDictationActionResult.value) : afterDictationAction,
      dictationShortcut: dictationShortcutResult.status === "fulfilled" ? parseDictationShortcut(dictationShortcutResult.value) : dictationShortcut,
      microphoneDeviceId: nextMicDeviceId,
    });
  });

  const onOverlayBarEnabledChanged = useEffectEvent((enabled: boolean) => {
    overlayBarPrefResolvedRef.current = true;
    updateSettingsPrefs({ overlayBarEnabled: enabled });
  });

  const onDictationShortcutChanged = useEffectEvent((payload: unknown) => {
    updateSettingsPrefs({ dictationShortcut: parseDictationShortcut(payload) });
  });

  const onMicrophoneDeviceChanged = useEffectEvent((deviceId: string) => {
    const parsed = parseMicrophoneDeviceId(deviceId);
    setPreferredMicrophoneDeviceId(parsed);
    updateSettingsPrefs({ microphoneDeviceId: parsed });
  });

  const onMicRecoveryRequired = useEffectEvent((payload: unknown) => {
    micRecoveryLockedRef.current = true;
    updateMicGateState({ recoveryKind: parseMicRecoveryReason(payload), phase: "needsMic" });
  });

  const onMicHotkeyWhileBlocked = useEffectEvent(() => {
    void syncMicGate();
  });

  const onPipelineWarmingHotkey = useEffectEvent(() => {
    beginPipelineWarm();
  });

  const setSettingsOpen = useCallback((open: boolean) => {
    updateMainUiState({ settingsOpen: open });
  }, []);

  const setSettingsTooltipOpen = useCallback((open: boolean) => {
    updateMainUiState({ settingsTooltipOpen: open });
  }, []);

  const setShortcutCaptureActive = useCallback((active: boolean) => {
    void invoke("set_dictation_key_listener_suppressed", {
      suppressed: active,
      cooldownMs: active ? 0 : 500,
    }).catch(() => {});
  }, []);

  const onMainWindowVisible = useEffectEvent(() => {
    void refreshHistory();
    void syncMicGate();
    /** Force a re-read on tab return — overlay window may have toggled the pref while we were hidden. */
    overlayBarPrefResolvedRef.current = false;
    void applyOverlayBarPrefFromIpc();
  });

  useEffect(() => {
    refreshHistory();
    let unlistenHistory: (() => void) | undefined;
    let unlistenOverlayPref: (() => void) | undefined;
    let unlistenDictationShortcut: (() => void) | undefined;
    let unlistenMicrophoneDevice: (() => void) | undefined;
    let unlistenMicRecovery: (() => void) | undefined;
    let unlistenMicBlockedHotkey: (() => void) | undefined;
    let unlistenPipelineWarming: (() => void) | undefined;

    listen("history-updated", () => void refreshHistory()).then((fn) => {
      unlistenHistory = fn;
    });
    listen<boolean>("overlay-bar-enabled-changed", (e) => {
      onOverlayBarEnabledChanged(e.payload);
    }).then((fn) => {
      unlistenOverlayPref = fn;
    });
    listen<unknown>("dictation-shortcut-changed", (e) => {
      onDictationShortcutChanged(e.payload);
    }).then((fn) => {
      unlistenDictationShortcut = fn;
    });
    listen<string>("microphone-device-changed", (e) => {
      onMicrophoneDeviceChanged(e.payload);
    }).then((fn) => {
      unlistenMicrophoneDevice = fn;
    });
    listen<unknown>("mic-recovery-required", (e) => {
      onMicRecoveryRequired(e.payload);
    }).then((fn) => {
      unlistenMicRecovery = fn;
    });
    listen("mic-hotkey-while-blocked", () => {
      onMicHotkeyWhileBlocked();
    }).then((fn) => {
      unlistenMicBlockedHotkey = fn;
    });
    listen("dictation-pipeline-warming", () => {
      onPipelineWarmingHotkey();
    }).then((fn) => {
      unlistenPipelineWarming = fn;
    });

    const onStorage = () => void refreshHistory();
    window.addEventListener("storage", onStorage);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        onMainWindowVisible();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unlistenHistory?.();
      unlistenOverlayPref?.();
      unlistenDictationShortcut?.();
      unlistenMicrophoneDevice?.();
      unlistenMicRecovery?.();
      unlistenMicBlockedHotkey?.();
      unlistenPipelineWarming?.();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshHistory]);

  useEffect(() => {
    const isEmpty = historyEntries.length === 0;

    if (!historyHydratedRef.current) {
      historyHydratedRef.current = true;
      if (!isEmpty) {
        setEmptyMounted(false);
        setEmptyExiting(false);
        return;
      }
    }

    if (isEmpty) {
      setEmptyExiting(false);
      setEmptyMounted(true);
      return;
    }

    if (!emptyMounted) return;

    setEmptyExiting(true);
    const timer = window.setTimeout(() => {
      setEmptyMounted(false);
      setEmptyExiting(false);
    }, HISTORY_EMPTY_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [historyEntries.length, emptyMounted]);

  useEffect(() => {
    void syncMicGate();
  }, [syncMicGate]);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    void invoke<string>("runtime_os")
      .then(setRuntimeOs)
      .catch(() => setRuntimeOs(null));
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== "main") return;
    let unlistenFocus: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) void syncMicGate();
      })
      .then((fn) => {
        unlistenFocus = fn;
      });
    return () => {
      unlistenFocus?.();
    };
  }, [syncMicGate]);

  useEffect(() => {
    void (async () => {
      let v: string | null = null;
      try {
        v = await getVersion();
      } catch {
        /* vite dev without Tauri */
      }
      const trimmed = v?.trim() ?? "";
      setAppVersionLabel(trimmed ? trimmed : null);
      const title = trimmed ? `Mello Voice ${trimmed}` : "Mello Voice";
      if (!isTauriRuntime()) return;
      try {
        await getCurrentWindow().setTitle(title);
      } catch {
        /* ignore */
      }
    })();
  }, []);

  useEffect(() => {
    void applyOverlayBarPrefFromIpc();
    void invoke<string>("get_after_dictation_action")
      .then((s) => updateSettingsPrefs({ afterDictationAction: parseAfterDictationAction(s) }))
      .catch(() => {});
    void invoke<unknown>("get_dictation_shortcut")
      .then((shortcut) => updateSettingsPrefs({ dictationShortcut: parseDictationShortcut(shortcut) }))
      .catch(() => {});
    void invoke<string>("get_microphone_device_id")
      .then((deviceId) => {
        const parsed = parseMicrophoneDeviceId(deviceId);
        setPreferredMicrophoneDeviceId(parsed);
        updateSettingsPrefs({ microphoneDeviceId: parsed });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<string>("get_theme")
      .then((s) => updateSettingsPrefs({ themePreference: parseThemePreference(s) }))
      .catch(() =>
        updateSettingsPrefs({
          themePreference: parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY)),
        }),
      );
  }, []);

  useEffect(() => {
    void invoke("sync_dictation_key_listener", {
      accelerator: dictationShortcut.accelerator,
    }).catch((e) => {
      console.warn("dictation key listener sync:", e);
    });
  }, [dictationShortcut.accelerator]);

  useEffect(() => {
    if (!settingsOpen) return;
    overlayBarPrefResolvedRef.current = false;
    void applyAllSettingsFromIpc();
  }, [settingsOpen]);

  useEffect(() => {
    const wasOpen = prevSettingsOpenRef.current;
    prevSettingsOpenRef.current = settingsOpen;

    if (wasOpen && !settingsOpen) {
      suppressSettingsTooltipAfterCloseRef.current = true;
      setSettingsTooltipOpen(false);
      window.setTimeout(() => {
        suppressSettingsTooltipAfterCloseRef.current = false;
      }, 450);
    }
  }, [settingsOpen]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (historyEntries.length === 0) return;
    await clearHistory();
    await refreshHistory();
  }, [historyEntries.length, refreshHistory]);

  const setDictationBarPreference = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_overlay_bar_enabled", { enabled });
      overlayBarPrefResolvedRef.current = true;
      updateSettingsPrefs({ overlayBarEnabled: enabled });
      /** Rust emits `overlay-bar-enabled-changed` so the overlay window sees it; no JS-side fan-out needed. */
    } catch (e) {
      console.error(e);
    }
  }, []);

  const setAfterDictationPreference = useCallback(async (next: AfterDictationActionOption) => {
    try {
      await invoke("set_after_dictation_action", { action: next });
      updateSettingsPrefs({ afterDictationAction: next });
    } catch (e) {
      console.error(e);
    }
  }, []);

  const setDictationShortcutPreference = useCallback(async (next: DictationShortcutPreference) => {
    updateSettingsPrefs({ dictationShortcut: next });
    try {
      await invoke("set_dictation_shortcut", { accelerator: next.accelerator, label: next.label });
    } catch {
      /* Browser dev without Tauri backend. The registration effect still owns runtime fallback. */
    }
  }, []);

  const setMicrophoneDevicePreference = useCallback(async (deviceId: string) => {
    const parsed = parseMicrophoneDeviceId(deviceId);
    setPreferredMicrophoneDeviceId(parsed);
    updateSettingsPrefs({ microphoneDeviceId: parsed });
    try {
      await invoke("set_microphone_device_id", { deviceId: parsed });
    } catch {
      /* Browser dev without Tauri backend. */
    }
  }, []);

  const applyThemePreference = useCallback(async (next: ThemePreference) => {
    updateSettingsPrefs({ themePreference: next });
    localStorage.setItem(THEME_STORAGE_KEY, next);
    syncDocumentTheme(next);
    try {
      await invoke("set_theme", { theme: next });
    } catch {
      /* Browser dev without Tauri backend */
    }
    await emit("theme-changed", next).catch(() => {});
  }, []);

  if (micPhase === "checking") {
    return <MicOnboardingScreen phase="warming" recovery={null} busy={false} onAllowClick={handleMicAllow} />;
  }

  if (micPhase === "needsMic") {
    return (
      <MicOnboardingScreen
        phase="prompt"
        recovery={micRecoveryKind}
        runtimeOs={runtimeOs}
        busy={micBusy}
        onAllowClick={handleMicAllow}
        onOpenMicSettings={handleOpenMicSettings}
      />
    );
  }

  return (
    <div data-vaul-drawer-wrapper="" className="main-window-enter flex h-svh flex-col overflow-hidden select-none bg-background text-foreground">
      <ScrollArea className="min-h-0 flex-1">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/80 p-6">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-medium tracking-[-0.025em] text-foreground">Mello Voice</h1>
          <p className="text-base text-muted-foreground">Closing minimises to the tray.</p>
        </div>

        <Drawer.Root open={settingsOpen} onOpenChange={setSettingsOpen} shouldScaleBackground setBackgroundColorOnScale={false}>
          <Tooltip
            content="Settings"
            side="bottom"
            forceOpen={settingsTooltipOpen}
            onOpenChange={(open) => {
              if (open && suppressSettingsTooltipAfterCloseRef.current) return;
              setSettingsTooltipOpen(open);
            }}
          >
            <Drawer.Trigger asChild>
              <Button type="button" variant="surface" size="icon" aria-label="Settings">
                <SettingsGearIcon strokeWidth={1.5} className="size-4" />
              </Button>
            </Drawer.Trigger>
          </Tooltip>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px]" />
            <Drawer.Content className="fixed inset-x-0 bottom-0 z-[121] flex min-h-0 max-h-[min(95vh,36rem)] flex-col overflow-hidden rounded-t-[1.25rem]">
              <Elevated offset={1} className="grid min-h-0 w-full min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-t-[1.25rem] ring-0 dark:ring-0">
                <div className="flex shrink-0 flex-col border-b border-border/80 px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2">
                  <Drawer.Handle className="mb-1" />
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Drawer.Title className="text-xl font-medium tracking-[-0.02em] leading-tight text-foreground">Settings</Drawer.Title>
                      <Drawer.Description className="sr-only">Shortcut, microphone, dictation bar, after-dictation behaviour and appearance for Mello Voice.</Drawer.Description>
                    </div>
                    <Drawer.Close asChild>
                      <Button type="button" variant="ghost" size="icon" aria-label="Close settings">
                        <CloseIcon strokeWidth={1.5} className="size-4" />
                      </Button>
                    </Drawer.Close>
                  </div>
                </div>
                <ScrollArea className="min-h-0 size-full">
                  <div className="flex flex-col gap-0 pb-6 px-5 pt-1">
                    <SettingsSettingRow title="Shortcut Key" description="Choose the key to double-tap for dictation.">
                      <DictationShortcutInput
                        value={dictationShortcut}
                        onChange={(next) => void setDictationShortcutPreference(next)}
                        onCaptureActiveChange={setShortcutCaptureActive}
                      />
                    </SettingsSettingRow>
                    <Separator className="bg-border/80" />
                    <SettingsSettingRow title="Microphone" description="Choose which microphone to use for dictation.">
                      <MicrophoneInputSelect
                        value={microphoneDeviceId}
                        onChange={(next) => void setMicrophoneDevicePreference(next)}
                        disabled={micPhase !== "ready"}
                        active={settingsOpen}
                        runtimeOs={runtimeOs}
                      />
                    </SettingsSettingRow>
                    <Separator className="bg-border/80" />
                    <SettingsSettingRow title="Dictation bar" description="Show the floating bar all the time or only while dictating.">
                      <Select value={dictationBarModeFromEnabled(overlayBarEnabled)} onValueChange={(v) => void setDictationBarPreference(overlayBarEnabledFromMode(parseDictationBarMode(v)))}>
                        <SelectTrigger aria-label="Dictation bar visibility" className="w-full max-w-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DICTATION_BAR_MODE_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {dictationBarModeLabel(opt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingsSettingRow>
                    <Separator className="bg-border/80" />
                    <SettingsSettingRow title="After dictation" description="Choose action after speaking.">
                      <Select
                        value={(AFTER_DICTATION_OPTIONS as readonly string[]).includes(afterDictationAction) ? afterDictationAction : DEFAULT_AFTER_DICTATION_ACTION}
                        onValueChange={(v) => void setAfterDictationPreference(parseAfterDictationAction(v))}
                      >
                        <SelectTrigger aria-label="After dictation" className="w-full max-w-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {AFTER_DICTATION_OPTIONS.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {afterDictationActionLabel(opt)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingsSettingRow>
                    <Separator className="bg-border/80" />
                    <SettingsSettingRow title="Appearance" description="System colours or light / dark">
                      <Select value={themePreference} onValueChange={(v) => void applyThemePreference(parseThemePreference(v))}>
                        <SelectTrigger aria-label="Appearance theme" className="w-full max-w-none">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {THEME_OPTIONS.map(({ value, label }) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </SettingsSettingRow>
                    <Separator className="bg-border/80" />
                    {appVersionLabel ? <p className="mt-6 text-center text-xs text-muted-foreground tabular-nums">Version {appVersionLabel}</p> : null}
                  </div>
                </ScrollArea>
              </Elevated>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </header>

      <section className="pt-6">
        <div className="flex min-h-8 items-center justify-between gap-3 px-6">
          <h2 className="min-w-0 text-base text-muted-foreground">
            <span className="inline-flex items-baseline gap-1.5">
              <span>History</span>
              <span className="tabular-nums opacity-90">· {historyEntries.length}</span>
            </span>
          </h2>
          <div className="flex shrink-0 justify-end">
            <HoldToClearButton
              onClear={handleClear}
              className={cn(historyEntries.length === 0 && "invisible pointer-events-none")}
              disabled={historyEntries.length === 0}
              tabIndex={-1}
              aria-hidden={historyEntries.length === 0}
            />
          </div>
        </div>
        <ul className="history-panel flex flex-col gap-2.5 p-6 pt-2">
          {emptyMounted ? (
            <li
              className={cn(
                "history-empty-state min-w-0",
                emptyExiting && "history-empty-state--exit"
              )}
            >
              <Card size="sm" className={HISTORY_CARD_SHELL}>
                <CardContent className={HISTORY_CARD_BODY}>
                  <div className="space-y-3 text-base leading-relaxed">
                    <p className="text-base text-foreground font-medium">No transcriptions yet</p>
                    <ol className="m-0 list-none space-y-0 p-0 text-muted-foreground">
                      <li className="flex gap-3">
                        <div className="flex w-6 shrink-0 flex-col items-center">
                          <div className={HISTORY_TIMELINE_BUBBLE}>1</div>
                          <div className="mt-0 w-px min-h-2.5 flex-1 bg-border" aria-hidden />
                        </div>
                        <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">Click where you want text to go.</p>
                      </li>
                      <li className="flex gap-3">
                        <div className="flex w-6 shrink-0 flex-col items-center">
                          <div className={HISTORY_TIMELINE_BUBBLE}>2</div>
                          <div className="mt-0 w-px min-h-2.5 flex-1 bg-border" aria-hidden />
                        </div>
                        <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">
                          {dictationGestureHintParts.beforeKey}
                          <kbd className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-xs leading-none text-foreground">
                            {dictationShortcut.label}
                          </kbd>
                          {dictationGestureHintParts.afterKey}
                        </p>
                      </li>
                      <li className="flex gap-3">
                        <div className="flex w-6 shrink-0 flex-col items-center">
                          <div className={HISTORY_TIMELINE_BUBBLE}>3</div>
                        </div>
                        <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">Your words are pasted into the focused field.</p>
                      </li>
                    </ol>
                  </div>
                </CardContent>
              </Card>
            </li>
          ) : null}
          {historyEntries.map((entry) => (
            <li key={entry.id} className="history-entry-enter min-w-0">
              <HistoryItem entry={entry} onCopy={handleCopy} />
            </li>
          ))}
        </ul>
      </section>
      </ScrollArea>
    </div>
  );
}

export default MainWindow;
