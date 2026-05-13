import { useState, useEffect, useCallback, useRef } from "react";
import { listen, emit } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { getHistory, clearHistory, type HistoryEntry } from "../history";
import { DICTATION_SHORTCUT_OPTIONS, getDictationShortcut, setDictationShortcut, DEFAULT_DICTATION_SHORTCUT } from "../dictationShortcut";

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
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
    <li className="history-item" role="button" tabIndex={0} data-copied={copied} onClick={handleCopy} onKeyDown={handleKeyDown}>
      <p className="history-item-text">{entry.text}</p>
      <div className="history-item-meta">
        <span className="history-item-time">{formatTime(entry.timestamp)}</span>
        <span className="history-item-copy">{copied ? "Copied" : "Copy"}</span>
      </div>
    </li>
  );
}

function SettingsGearIcon() {
  return (
    <svg className="main-window-cog-svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.488.488 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.484.484 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"
      />
    </svg>
  );
}

function MainWindow() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [liveShortcut, setLiveShortcut] = useState(getDictationShortcut);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [overlayBarEnabled, setOverlayBarEnabled] = useState(true);
  const settingsAnchorRef = useRef<HTMLDivElement>(null);
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
    const setup = async () => {
      const previous = registeredShortcutRef.current;
      if (previous !== null) {
        await unregister(previous).catch(() => {});
      }
      try {
        await register(liveShortcut, (event) => {
          void emit("dictation-hotkey", { state: event.state });
        });
        registeredShortcutRef.current = liveShortcut;
      } catch (e) {
        const message = String(e);
        let recovered = previous ?? DEFAULT_DICTATION_SHORTCUT;
        if (previous !== null) {
          try {
            await register(previous, (event) => {
              void emit("dictation-hotkey", { state: event.state });
            });
            registeredShortcutRef.current = previous;
            recovered = previous;
          } catch {
            recovered = DEFAULT_DICTATION_SHORTCUT;
            try {
              await register(recovered, (event) => {
                void emit("dictation-hotkey", { state: event.state });
              });
              registeredShortcutRef.current = recovered;
            } catch {
              registeredShortcutRef.current = null;
            }
          }
        } else {
          try {
            await register(DEFAULT_DICTATION_SHORTCUT, (event) => {
              void emit("dictation-hotkey", { state: event.state });
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
    setLiveShortcut(getDictationShortcut());
  }, [settingsOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (settingsAnchorRef.current && !settingsAnchorRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
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

  return (
    <div className="main-window">
      <header className="main-window-header">
        <div className="main-window-header-row">
          <div className="main-window-header-left">
            <div className="main-window-title-row">
              <h1>Mello Voice</h1>
              {appVersion ? (
                <span className="main-window-version" title={`Mello Voice ${appVersion}`}>
                  v{appVersion}
                </span>
              ) : null}
            </div>
            <p className="main-window-subhint">Close this window to minimize to tray.</p>
          </div>
          <div className="main-window-settings-anchor" ref={settingsAnchorRef}>
            <button
              type="button"
              className="main-window-cog"
              aria-label="Settings"
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <SettingsGearIcon />
            </button>
            {settingsOpen ? (
              <div className="settings-popover" role="dialog" aria-label="Settings">
                <div className="settings-popover-section">
                  <div className="settings-popover-control-row">
                    <div className="settings-popover-copy">
                      <p className="settings-popover-label">Dictation bar</p>
                      <p className="settings-popover-hint">
                        Show the floating recording indicator at the top of the screen.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`settings-switch${overlayBarEnabled ? " settings-switch-on" : ""}`}
                      role="switch"
                      aria-checked={overlayBarEnabled}
                      onClick={() => void setDictationBarPreference(!overlayBarEnabled)}
                    >
                      <span className="settings-switch-thumb" />
                    </button>
                  </div>
                </div>

                <div className="settings-popover-divider" />

                <div className="settings-popover-section">
                  <p className="settings-popover-label">Dictation shortcut</p>
                  <p className="settings-popover-hint">Hold this key combination while you speak to record dictation.</p>
                  <div className="shortcut-presets settings-popover-presets" role="radiogroup" aria-label="Dictation shortcut">
                    {DICTATION_SHORTCUT_OPTIONS.map((preset) => {
                      const selected = liveShortcut === preset;
                      return (
                        <button
                          key={preset}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          className={`shortcut-preset-chip${selected ? " shortcut-preset-chip-selected" : ""}`}
                          onClick={() => selectPresetShortcut(preset)}
                        >
                          {preset}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <section className="history-section">
        <div className="history-header">
          <h2>History{history.length > 0 ? ` · ${history.length}` : ""}</h2>
          {history.length > 0 && (
            <button type="button" className="history-clear" onClick={handleClear}>
              Clear all
            </button>
          )}
        </div>

        {history.length === 0 ? (
          <div className="history-empty" role="status" aria-live="polite">
            <p className="history-empty-title">No transcriptions yet</p>
            <p className="history-empty-step">1. Click where you want to type.</p>
            <p className="history-empty-step">
              2. Hold <kbd>{liveShortcut}</kbd> and speak.
            </p>
            <p className="history-empty-note">Your words are pasted into the focused field.</p>
          </div>
        ) : (
          <ul className="history-list">
            {history.map((entry) => (
              <HistoryItem key={entry.id} entry={entry} onCopy={handleCopy} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default MainWindow;
