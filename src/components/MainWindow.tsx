import { useState, useEffect, useCallback, useRef, type KeyboardEvent, type ReactNode } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsGearIcon } from "@/components/icons/SettingsGearIcon";
import { CloseIcon } from "@/components/icons/CloseIcon";
import { ChevronDownIcon } from "@/components/icons/ChevronDownIcon";
import { getHistory, clearHistory, type HistoryEntry } from "../history";
import {
  DICTATION_SHORTCUT_OPTIONS,
  getDictationShortcut,
  setDictationShortcut,
  DEFAULT_DICTATION_SHORTCUT,
  type DictationShortcutOption,
} from "../dictationShortcut";
import { cn } from "@/lib/utils";
import { Elevated } from "@/lib/elevated";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  settingsControlTriggerCn,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Drawer } from "vaul";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  parseThemePreference,
  syncDocumentTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/themePreference";
import {
  AFTER_DICTATION_OPTIONS,
  DEFAULT_AFTER_DICTATION_ACTION,
  afterDictationActionLabel,
  parseAfterDictationAction,
  type AfterDictationActionOption,
} from "../afterDictationAction";

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    (((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null) ||
      (import.meta.env.TAURI_PLATFORM != null && import.meta.env.TAURI_PLATFORM !== ""))
  );
}

/** Same shell + body padding for empty state + every history row. Light: Fluid shadow + ring via Elevated; dark: ring only (see `elevated.tsx`). */
const HISTORY_CARD_SHELL = "gap-0 rounded-2xl py-0 outline-none";

const HISTORY_CARD_BODY = "px-4 py-3.5";
/** Empty-history how-to: numbered circles + vertical connector */
const HISTORY_TIMELINE_BUBBLE =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border bg-card text-[9.75px] font-medium tabular-nums text-muted-foreground";
/** Hover/focus affordances layered on top of HISTORY_CARD_SHELL */
const HISTORY_CARD_INTERACTIVE =
  "group cursor-pointer transition-[background-color,box-shadow,transform] duration-100 ease-[var(--ease-ui-snappy)] hover:bg-accent/40 active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

function dictationBarModeLabel(alwaysShowWhenIdle: boolean): string {
  return alwaysShowWhenIdle ? "Always visible" : "Hide when idle";
}

/** ChatGPT-like row: stacked label/description left, trailing control aligned right. */
function SettingsSettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium leading-snug text-foreground">{title}</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div
        data-settings-control=""
        className="relative z-[2] flex min-h-9 min-w-[10rem] shrink-0 items-center justify-end"
      >
        {children}
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) {
    return `Yesterday ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
  }
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HistoryItem({ entry, onCopy }: { entry: HistoryEntry; onCopy: (text: string) => void }) {
  const [copied, setCopied] = useState(false);
  const copiedTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copiedTimeoutRef.current !== null) {
        window.clearTimeout(copiedTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = useCallback(() => {
    onCopy(entry.text);
    setCopied(true);
    if (copiedTimeoutRef.current !== null) {
      window.clearTimeout(copiedTimeoutRef.current);
    }
    copiedTimeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      copiedTimeoutRef.current = null;
    }, 1500);
  }, [entry.text, onCopy]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleCopy();
      }
    },
    [handleCopy],
  );

  return (
    <Card
      role="button"
      tabIndex={0}
      data-copied={copied}
      size="sm"
      onClick={handleCopy}
      onKeyDown={handleKeyDown}
      className={cn(HISTORY_CARD_SHELL, HISTORY_CARD_INTERACTIVE, copied && "ring-foreground/15")}
    >
      <CardContent className={HISTORY_CARD_BODY}>
        <div className="text-[13px] leading-relaxed text-foreground">{entry.text}</div>
        <div className="mt-2 flex items-center justify-between text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          <span>{formatTime(entry.timestamp)}</span>
          <span className={cn("text-muted-foreground transition-colors duration-80 ease-[var(--ease-ui)]", copied ? "text-success" : "group-hover:text-primary")}>
            {copied ? "Copied" : "Copy"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function MainWindow() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [liveShortcut, setLiveShortcut] = useState(getDictationShortcut);
  const [settingsOpen, setSettingsOpen] = useState(false);
  /** Semver shown in Settings footer + used for native window title. */
  const [appVersionLabel, setAppVersionLabel] = useState<string | null>(null);
  const [overlayBarEnabled, setOverlayBarEnabled] = useState(true);
  const [afterDictationAction, setAfterDictationAction] = useState<AfterDictationActionOption>(
    DEFAULT_AFTER_DICTATION_ACTION,
  );
  const [themePreference, setThemePreference] = useState<ThemePreference>("system");
  const registeredShortcutRef = useRef<string | null>(null);

  const refreshHistory = useCallback(async () => {
    const entries = await getHistory();
    setHistory(entries);
  }, []);

  const syncOverlayFromPrefs = useCallback(async () => {
    try {
      const show = await invoke<boolean>("get_overlay_bar_enabled");
      setOverlayBarEnabled(show);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    refreshHistory();
    let unlistenHistory: (() => void) | undefined;
    let unlistenShortcutFail: (() => void) | undefined;
    let unlistenShortcutOk: (() => void) | undefined;
    let unlistenOverlayPref: (() => void) | undefined;

    listen("history-updated", () => void refreshHistory()).then((fn) => {
      unlistenHistory = fn;
    });
    listen("dictation-shortcut-register-failed", () => {
      setLiveShortcut(getDictationShortcut());
    }).then((fn) => {
      unlistenShortcutFail = fn;
    });
    listen<string>("dictation-shortcut-changed", (e) => setLiveShortcut(e.payload)).then((fn) => {
      unlistenShortcutOk = fn;
    });
    listen<boolean>("overlay-bar-enabled-changed", (e) => setOverlayBarEnabled(e.payload)).then((fn) => {
      unlistenOverlayPref = fn;
    });

    const onStorage = () => void refreshHistory();
    window.addEventListener("storage", onStorage);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshHistory();
        void syncOverlayFromPrefs();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      unlistenHistory?.();
      unlistenShortcutFail?.();
      unlistenShortcutOk?.();
      unlistenOverlayPref?.();
      window.removeEventListener("storage", onStorage);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refreshHistory, syncOverlayFromPrefs]);

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
    void invoke<boolean>("get_overlay_bar_enabled")
      .then(setOverlayBarEnabled)
      .catch(() => {});
    void invoke<string>("get_after_dictation_action")
      .then((s) => setAfterDictationAction(parseAfterDictationAction(s)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    void invoke<string>("get_theme")
      .then((s) => setThemePreference(parseThemePreference(s)))
      .catch(() =>
        setThemePreference(parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))),
      );
  }, []);

  useEffect(() => {
    const setup = async () => {
      const previous = registeredShortcutRef.current;
      if (previous !== null) {
        await unregister(previous).catch(() => {});
      }
      try {
        await register(liveShortcut, (event) => {
          void invoke("relay_dictation_hotkey", { state: event.state }).catch(() => {});
        });
        registeredShortcutRef.current = liveShortcut;
      } catch (e) {
        const message = String(e);
        let recovered = previous ?? DEFAULT_DICTATION_SHORTCUT;
        if (previous !== null) {
          try {
            await register(previous, (event) => {
              void invoke("relay_dictation_hotkey", { state: event.state }).catch(() => {});
            });
            registeredShortcutRef.current = previous;
            recovered = previous;
          } catch {
            recovered = DEFAULT_DICTATION_SHORTCUT;
            try {
              await register(recovered, (event) => {
                void invoke("relay_dictation_hotkey", { state: event.state }).catch(() => {});
              });
              registeredShortcutRef.current = recovered;
            } catch {
              registeredShortcutRef.current = null;
            }
          }
        } else {
          try {
            await register(DEFAULT_DICTATION_SHORTCUT, (event) => {
              void invoke("relay_dictation_hotkey", { state: event.state }).catch(() => {});
            });
            registeredShortcutRef.current = DEFAULT_DICTATION_SHORTCUT;
            recovered = DEFAULT_DICTATION_SHORTCUT;
          } catch {
            registeredShortcutRef.current = null;
          }
        }
        const uiShortcut = registeredShortcutRef.current ?? recovered;
        setDictationShortcut(uiShortcut);
        setLiveShortcut(uiShortcut);
        await emit("dictation-shortcut-register-failed", { message }).catch(() => {});
      }
    };
    void setup();
    return () => {
      const reg = registeredShortcutRef.current;
      if (reg !== null) {
        void unregister(reg).catch(() => {});
        registeredShortcutRef.current = null;
      }
    };
  }, [liveShortcut]);

  useEffect(() => {
    if (!settingsOpen) return;
    void invoke<boolean>("get_overlay_bar_enabled")
      .then(setOverlayBarEnabled)
      .catch(() => {});
    void invoke<string>("get_theme")
      .then((s) => setThemePreference(parseThemePreference(s)))
      .catch(() =>
        setThemePreference(parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY))),
      );
    void invoke<string>("get_after_dictation_action")
      .then((s) => setAfterDictationAction(parseAfterDictationAction(s)))
      .catch(() => {});
    setLiveShortcut(getDictationShortcut());
  }, [settingsOpen]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.error("Failed to copy:", e);
    }
  }, []);

  const handleClear = useCallback(async () => {
    if (history.length === 0) return;
    await clearHistory();
    await refreshHistory();
  }, [history.length, refreshHistory]);

  const selectPresetShortcut = useCallback((preset: string) => {
    const next = (DICTATION_SHORTCUT_OPTIONS as readonly string[]).includes(preset)
      ? (preset as DictationShortcutOption)
      : DEFAULT_DICTATION_SHORTCUT;
    setDictationShortcut(next);
    setLiveShortcut(next);
    void emit("dictation-shortcut-changed", next);
  }, []);

  const setDictationBarPreference = useCallback(async (enabled: boolean) => {
    try {
      await invoke("set_overlay_bar_enabled", { enabled });
      setOverlayBarEnabled(enabled);
      await emit("overlay-bar-enabled-changed", enabled);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const setAfterDictationPreference = useCallback(async (next: AfterDictationActionOption) => {
    try {
      await invoke("set_after_dictation_action", { action: next });
      setAfterDictationAction(next);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const applyThemePreference = useCallback(async (next: ThemePreference) => {
    setThemePreference(next);
    localStorage.setItem(THEME_STORAGE_KEY, next);
    syncDocumentTheme(next);
    try {
      await invoke("set_theme", { theme: next });
    } catch {
      /* Browser dev without Tauri backend */
    }
    await emit("theme-changed", next).catch(() => {});
  }, []);

  return (
    <div
      data-vaul-drawer-wrapper=""
      className="flex min-h-svh select-none flex-col bg-background text-foreground"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/80 p-6">
        <div className="min-w-0 space-y-1">
          <h1 className="text-[22px] font-medium tracking-[-0.025em] text-foreground">Mello Voice</h1>
          <p className="text-[13px] text-muted-foreground">Closing minimises to the tray.</p>
        </div>

        <Drawer.Root
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          shouldScaleBackground
          setBackgroundColorOnScale={false}
        >
          <Drawer.Trigger asChild>
            <Button type="button" variant="surface" size="icon" aria-label="Settings">
              <SettingsGearIcon strokeWidth={1.5} className="size-4" />
            </Button>
          </Drawer.Trigger>
          <Drawer.Portal>
            <Drawer.Overlay className="fixed inset-0 z-[120] bg-black/35 backdrop-blur-[1px]" />
            <Drawer.Content
              className="fixed inset-x-0 bottom-0 z-[121] flex max-h-[min(95vh,36rem)] flex-col overflow-hidden rounded-t-[1.25rem]"
            >
              <Elevated
                offset={1}
                className="flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden rounded-t-[1.25rem]"
              >
              <div className="flex shrink-0 flex-col border-b border-border/80 px-5 pb-[max(.75rem,env(safe-area-inset-bottom))] pt-2">
                <Drawer.Handle className="mb-1" />
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Drawer.Title className="text-[17px] font-medium tracking-[-0.02em] leading-tight text-foreground">
                      Settings
                    </Drawer.Title>
                    <Drawer.Description className="sr-only">
                      Dictation shortcut, bar, after-dictation behaviour and appearance for Mello Voice.
                    </Drawer.Description>
                  </div>
                  <Drawer.Close asChild>
                    <Button type="button" variant="ghost" size="icon" aria-label="Close settings">
                      <CloseIcon strokeWidth={1.5} className="size-4" />
                    </Button>
                  </Drawer.Close>
                </div>
              </div>
              <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto overflow-x-hidden overscroll-y-contain">
                <div className="flex flex-col gap-0 pb-6 px-5 pt-1">
                  <SettingsSettingRow
                    title="Dictation shortcut"
                    description="Hold the shortcut whilst speaking."
                  >
                    <Select
                      value={
                        (DICTATION_SHORTCUT_OPTIONS as readonly string[]).includes(liveShortcut)
                          ? liveShortcut
                          : DEFAULT_DICTATION_SHORTCUT
                      }
                      onValueChange={(v) => selectPresetShortcut(v)}
                    >
                      <SelectTrigger aria-label="Dictation shortcut" className="w-full max-w-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DICTATION_SHORTCUT_OPTIONS.map((preset) => (
                          <SelectItem key={preset} value={preset}>
                            {preset}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </SettingsSettingRow>
                  <Separator className="bg-border/80" />
                  <SettingsSettingRow
                    title="Dictation bar"
                    description="Turn off to hide when not in use."
                  >
                    <Popover modal={false}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          className={cn(settingsControlTriggerCn(), "w-full max-w-none")}
                          aria-label={`Dictation bar visibility: ${dictationBarModeLabel(overlayBarEnabled)}`}
                        >
                          <span className="min-w-0 flex-1 truncate text-left">{dictationBarModeLabel(overlayBarEnabled)}</span>
                          <ChevronDownIcon className="size-4 shrink-0 opacity-65" strokeWidth={1.75} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent
                        align="end"
                        sideOffset={6}
                        collisionPadding={16}
                        className="min-w-[10rem] max-w-[min(18rem,calc(100vw-2rem))] p-1"
                      >
                        <div
                          role="presentation"
                          className="flex items-center justify-between gap-4 px-2.5 py-1"
                          onPointerDown={(e) => e.stopPropagation()}
                        >
                          <span className="min-w-0 flex-1 truncate text-[13px] text-card-foreground">
                            {dictationBarModeLabel(overlayBarEnabled)}
                          </span>
                          <Switch
                            variant="onRaisedSurface"
                            aria-label="Dictation bar"
                            checked={overlayBarEnabled}
                            onToggle={() => void setDictationBarPreference(!overlayBarEnabled)}
                            className="shrink-0 p-1 pr-0 pl-0"
                          />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </SettingsSettingRow>
                  <Separator className="bg-border/80" />
                  <SettingsSettingRow
                    title="After dictation"
                    description="Choose action after speaking."
                  >
                    <Select
                      value={
                        (AFTER_DICTATION_OPTIONS as readonly string[]).includes(afterDictationAction)
                          ? afterDictationAction
                          : DEFAULT_AFTER_DICTATION_ACTION
                      }
                      onValueChange={(v) =>
                        void setAfterDictationPreference(parseAfterDictationAction(v))
                      }
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
                  <SettingsSettingRow
                    title="Appearance"
                    description="System colours or light / dark"
                  >
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
                  {appVersionLabel ? (
                    <p className="mt-6 text-center text-[11px] text-muted-foreground tabular-nums">
                      Version {appVersionLabel}
                    </p>
                  ) : null}
                </div>
              </div>
              </Elevated>
            </Drawer.Content>
          </Drawer.Portal>
        </Drawer.Root>
      </header>

      <section className="flex min-h-0 flex-1 flex-col pt-6">
        <div className="flex min-h-8 items-center justify-between gap-3 px-6">
          <h2 className="min-w-0 text-[13px] text-muted-foreground">
            <span className="inline-flex items-baseline gap-1.5">
              <span>History</span>
              <span className="tabular-nums opacity-90">· {history.length}</span>
            </span>
          </h2>
          <div className="flex shrink-0 justify-end">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={cn(
                "h-7 min-w-[4.5rem] justify-center text-[12px] text-muted-foreground hover:text-destructive",
                history.length === 0 && "invisible pointer-events-none",
              )}
              onClick={handleClear}
              tabIndex={history.length === 0 ? -1 : 0}
              aria-hidden={history.length === 0}
            >
              Clear all
            </Button>
          </div>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-2.5 p-6 pt-2">
            {history.length === 0 ? (
              <li className="min-w-0">
                <Card size="sm" className={HISTORY_CARD_SHELL}>
                  <CardContent className={HISTORY_CARD_BODY}>
                    <div className="space-y-3 text-[13px] leading-relaxed">
                      <p className="text-[13px] text-foreground font-medium">No transcriptions yet</p>
                      <ol className="m-0 list-none space-y-0 p-0 text-muted-foreground">
                        <li className="flex gap-3">
                          <div className="flex w-6 shrink-0 flex-col items-center">
                            <div className={HISTORY_TIMELINE_BUBBLE}>1</div>
                            <div className="mt-0 w-px min-h-2.5 flex-1 bg-border" aria-hidden />
                          </div>
                          <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">
                            Click where you want text to go.
                          </p>
                        </li>
                        <li className="flex gap-3">
                          <div className="flex w-6 shrink-0 flex-col items-center">
                            <div className={HISTORY_TIMELINE_BUBBLE}>2</div>
                            <div className="mt-0 w-px min-h-2.5 flex-1 bg-border" aria-hidden />
                          </div>
                          <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">
                            Hold{" "}
                            <kbd className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[12px] leading-none text-foreground">
                              {liveShortcut}
                            </kbd>{" "}
                            whilst speaking.
                          </p>
                        </li>
                        <li className="flex gap-3">
                          <div className="flex w-6 shrink-0 flex-col items-center">
                            <div className={HISTORY_TIMELINE_BUBBLE}>3</div>
                          </div>
                          <p className="min-w-0 flex-1 pt-0.5 leading-relaxed">
                            Your words are pasted into the focused field.
                          </p>
                        </li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              </li>
            ) : (
              history.map((entry) => (
                <li key={entry.id} className="min-w-0">
                  <HistoryItem entry={entry} onCopy={handleCopy} />
                </li>
              ))
            )}
          </ul>
        </ScrollArea>
      </section>
    </div>
  );
}

export default MainWindow;
