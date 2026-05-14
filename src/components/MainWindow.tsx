import { useState, useEffect, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { SettingsGearIcon } from "@/components/icons/SettingsGearIcon";
import { getHistory, clearHistory, type HistoryEntry } from "../history";
import {
  DICTATION_SHORTCUT_OPTIONS,
  getDictationShortcut,
  setDictationShortcut,
  DEFAULT_DICTATION_SHORTCUT,
} from "../dictationShortcut";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  parseThemePreference,
  syncDocumentTheme,
  THEME_STORAGE_KEY,
  type ThemePreference,
} from "@/themePreference";

/** Same shell + body padding for empty state and every history row. */
const HISTORY_CARD_SHELL =
  "gap-0 rounded-2xl border border-border/70 bg-card/80 py-0 shadow-sm ring-1 ring-border/30 dark:bg-card/50 dark:ring-border/25";
const HISTORY_CARD_BODY = "px-4 py-3.5";
/** Hover/focus affordances layered on top of HISTORY_CARD_SHELL */
const HISTORY_CARD_INTERACTIVE =
  "group cursor-pointer transition-[background-color,box-shadow,transform] duration-100 hover:bg-accent/40 hover:ring-foreground/10 active:scale-[0.99] focus-visible:ring-2 focus-visible:ring-ring";

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** Preset pills: foreground labels when idle; selected = primary fill — primary-foreground on blue (light), background ink on blue (dark). */
function settingsSegmentClass(selected: boolean): string {
  return cn(
    "box-border inline-flex h-8 shrink-0 items-center justify-center rounded-full border px-3.5 text-[12px] font-normal transition-colors",
    "border-border bg-background outline-none hover:bg-muted/70",
    "text-foreground",
    "focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    selected &&
      "border-primary bg-primary text-primary-foreground hover:bg-primary-hover hover:text-primary-foreground dark:text-background dark:hover:text-background dark:hover:bg-primary-hover",
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
    (e: React.KeyboardEvent) => {
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
          <span className={cn("text-muted-foreground transition-colors", copied ? "text-success" : "group-hover:text-primary")}>
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
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overlayBarEnabled, setOverlayBarEnabled] = useState(true);
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
    void getVersion()
      .then((v) => setAppVersion(v || null))
      .catch(() => setAppVersion(null));
  }, []);

  useEffect(() => {
    void invoke<boolean>("get_overlay_bar_enabled")
      .then(setOverlayBarEnabled)
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

  const selectPresetShortcut = useCallback((preset: (typeof DICTATION_SHORTCUT_OPTIONS)[number]) => {
    setDictationShortcut(preset);
    setLiveShortcut(preset);
    void emit("dictation-shortcut-changed", preset);
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
    <div className="flex min-h-svh select-none flex-col bg-background px-5 pb-8 pt-6 text-foreground">
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border/80 pb-6">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-[22px] font-medium tracking-[-0.02em] text-foreground">Mello Voice</h1>
            {appVersion ? (
              <Badge variant="secondary" className="font-normal tabular-nums" title={`Mello Voice ${appVersion}`}>
                v{appVersion}
              </Badge>
            ) : null}
          </div>
          <p className="text-[13px] text-muted-foreground">Close this window to minimize to tray.</p>
        </div>

        <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="surface" size="icon" aria-label="Settings">
              <SettingsGearIcon strokeWidth={1.5} className="size-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(100vw-2rem,22rem)] gap-0 rounded-3xl p-0">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium leading-snug text-foreground">Dictation bar</p>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground pr-21">
                    Show the floating recording indicator at the top of the screen.
                  </p>
                </div>
                <div className="shrink-0 pt-px">
                  <Switch
                    aria-label="Dictation bar"
                    checked={overlayBarEnabled}
                    onToggle={() => void setDictationBarPreference(!overlayBarEnabled)}
                    className="p-1 pr-0 pl-0"
                  />
                </div>
              </div>
            </div>
            <Separator className="bg-border/80" />
            <div className="p-4">
              <p className="text-[13px] font-medium text-foreground">Dictation shortcut</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground pr-21">
                Hold this key combination while you speak to record dictation.
              </p>
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Dictation shortcut">
                {DICTATION_SHORTCUT_OPTIONS.map((preset) => {
                  const selected = liveShortcut === preset;
                  return (
                    <button
                      key={preset}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={settingsSegmentClass(selected)}
                      onClick={() => selectPresetShortcut(preset)}
                    >
                      {preset}
                    </button>
                  );
                })}
              </div>
            </div>
            <Separator className="bg-border/80" />
            <div className="p-4">
              <p className="text-[13px] font-medium text-foreground">Appearance</p>
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground pr-21">
                Match your system theme, or keep Mello light or dark.
              </p>
              <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Appearance theme">
                {THEME_OPTIONS.map(({ value, label }) => {
                  const selected = themePreference === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className={settingsSegmentClass(selected)}
                      onClick={() => void applyThemePreference(value)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </header>

      <section className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
        <div className="flex min-h-8 items-center justify-between gap-3">
          <h2 className="min-w-0 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
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
          <ul className="flex flex-col gap-2.5 pb-1 pt-0">
            {history.length === 0 ? (
              <li className="min-w-0">
                <Card size="sm" className={HISTORY_CARD_SHELL}>
                  <CardContent className={HISTORY_CARD_BODY}>
                    <div className="space-y-3 text-[13px] leading-relaxed">
                      <p className="text-[15px] font-medium text-foreground">No transcriptions yet</p>
                      <div className="space-y-2 text-muted-foreground">
                        <p>1. Click where you want to type.</p>
                        <p>
                          2. Hold{" "}
                          <kbd className="inline-flex items-center rounded-md border border-border bg-muted/50 px-1.5 py-0.5 font-mono text-[12px] leading-none text-foreground">
                            {liveShortcut}
                          </kbd>{" "}
                          and speak.
                        </p>
                        <p>3. Your words are pasted into the focused field.</p>
                      </div>
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
