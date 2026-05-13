import { useEffect, useCallback, useRef, useState } from "react";
import { getCurrentWindow, primaryMonitor, LogicalPosition, LogicalSize } from "@tauri-apps/api/window";
import { moveWindow, Position } from "@tauri-apps/plugin-positioner";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import FloatingOverlay from "./FloatingOverlay";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import { addToHistory } from "../history";

const TOP_OFFSET = 10;
const OVERLAY_WIDTH = 340;
const MIN_OVERLAY_HEIGHT = 56;

async function positionOverlayTopCenter() {
  const win = getCurrentWindow();
  const monitor = await primaryMonitor();
  if (!monitor) return;
  const winSize = await win.outerSize();
  const scale = monitor.scaleFactor;
  const x = (monitor.position.x + (monitor.size.width - winSize.width) / 2) / scale;
  const y = (monitor.position.y + TOP_OFFSET) / scale;
  await win.setPosition(new LogicalPosition(x, y));
  await moveWindow(Position.TopCenter);
  const pos = await win.outerPosition();
  await win.setPosition(new LogicalPosition(x, (pos.y + TOP_OFFSET) / scale));
}

type HotkeyState = "Pressed" | "Released";

function OverlayRoot() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const shortcutHeldRef = useRef(false);
  const barEnabledRef = useRef(true);
  const errorRef = useRef<string | null>(null);

  const [isExpanded, setIsExpanded] = useState(false);
  const [inlineHideOpen, setInlineHideOpen] = useState(false);
  const [barEnabled, setBarEnabled] = useState(true);

  const {
    isListening,
    interimTranscript,
    finalTranscript,
    error,
    startListening,
    stopAndWaitForFinal,
    clearTranscript,
  } = useSpeechRecognition();

  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    errorRef.current = error;
  }, [error]);

  useEffect(() => {
    barEnabledRef.current = barEnabled;
  }, [barEnabled]);

  /** Preference on: always show the pill. Preference off: only while dictating / processing / error, or inline menu. */
  const sessionChromeVisible =
    barEnabled || isExpanded || isProcessing || !!error || inlineHideOpen;

  const hideOverlayWhenBarPreferOff = useCallback(() => {
    window.setTimeout(() => {
      if (barEnabledRef.current) return;
      if (errorRef.current) return;
      void getCurrentWindow().hide().catch(() => {});
    }, 50);
  }, []);

  // Position on mount; keep the bar visible whenever the preference is on (default)
  useEffect(() => {
    const setup = async () => {
      await new Promise((r) => setTimeout(r, 50));
      try {
        await positionOverlayTopCenter();
      } catch (e) {
        console.warn("Could not position overlay:", e);
      }
      try {
        const enabled = await invoke<boolean>("get_overlay_bar_enabled");
        setBarEnabled(enabled);
        barEnabledRef.current = enabled;
        if (enabled) {
          await getCurrentWindow().show().catch(() => {});
          await positionOverlayTopCenter().catch(() => {});
        } else {
          await getCurrentWindow().hide().catch(() => {});
        }
      } catch {
        await getCurrentWindow().show().catch(() => {});
        await positionOverlayTopCenter().catch(() => {});
      }
    };
    setup();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<boolean>("overlay-bar-enabled-changed", (event) => {
      const v = event.payload;
      setBarEnabled(v);
      barEnabledRef.current = v;
      if (!v) {
        setInlineHideOpen(false);
        void getCurrentWindow().hide().catch(() => {});
      } else {
        void (async () => {
          try {
            await getCurrentWindow().show();
            await positionOverlayTopCenter();
          } catch (e) {
            console.warn("Could not show overlay:", e);
          }
        })();
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  // Resize window to fit pill + inline actions
  useEffect(() => {
    if (!sessionChromeVisible) return;
    const el = overlayRef.current;
    if (!el) return;
    const win = getCurrentWindow();
    const resizeToContent = () => {
      const height = Math.max(MIN_OVERLAY_HEIGHT, Math.ceil(el.scrollHeight));
      win.setSize(new LogicalSize(OVERLAY_WIDTH, height)).catch(() => {});
    };
    resizeToContent();
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sessionChromeVisible, inlineHideOpen]);

  const handleShortcut = useCallback(
    async (event: { state: HotkeyState }) => {
      if (event.state === "Pressed") {
        if (shortcutHeldRef.current) return;

        let pref = true;
        try {
          pref = await invoke<boolean>("get_overlay_bar_enabled");
        } catch {
          pref = true;
        }
        barEnabledRef.current = pref;

        shortcutHeldRef.current = true;
        setInlineHideOpen(false);

        try {
          await getCurrentWindow().show();
          await positionOverlayTopCenter();
        } catch (e) {
          console.warn("Could not show overlay:", e);
        }

        setIsExpanded(true);
        startListening();
        try {
          await positionOverlayTopCenter();
        } catch (e) {
          console.warn("Could not position overlay:", e);
        }
      } else {
        if (!shortcutHeldRef.current) return;
        shortcutHeldRef.current = false;
        setIsExpanded(false);
        setIsProcessing(true);
        try {
          const text = await stopAndWaitForFinal();
          clearTranscript();
          if (text) {
            await addToHistory(text);
            emit("history-updated").catch(() => {});
            await new Promise((r) => setTimeout(r, 280));
            try {
              await invoke("paste_text", { text });
            } catch (e) {
              console.error("Failed to paste:", e);
            }
          }
        } finally {
          setIsProcessing(false);
          hideOverlayWhenBarPreferOff();
        }
      }
    },
    [startListening, stopAndWaitForFinal, clearTranscript, hideOverlayWhenBarPreferOff],
  );

  // Global shortcut is registered on the main window so it still fires while this overlay webview is hidden (WebView2 can stop delivering plugin IPC here).
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ state: HotkeyState }>("dictation-hotkey", (event) => {
      void handleShortcut({ state: event.payload.state });
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [handleShortcut]);

  useEffect(() => {
    if (!inlineHideOpen) return;
    const close = () => setInlineHideOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inlineHideOpen]);

  const displayState = error
    ? "error"
    : isProcessing
      ? "processing"
      : isExpanded && isListening
        ? interimTranscript
          ? "transcribing"
          : "listening"
        : isExpanded
          ? "listening"
          : "idle";

  const onBarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (!sessionChromeVisible) return;
    setInlineHideOpen((v) => !v);
  };

  const hideDictationBar = async () => {
    try {
      await invoke("set_overlay_bar_enabled", { enabled: false });
      setInlineHideOpen(false);
      await emit("overlay-bar-enabled-changed", false);
      setBarEnabled(false);
      barEnabledRef.current = false;
      void getCurrentWindow().hide().catch(() => {});
    } catch {
      /* ignore */
    }
  };

  return (
    <div
      ref={overlayRef}
      className="pointer-events-auto flex min-h-full w-full cursor-default items-start justify-center px-2 pb-2 pt-2.5"
      data-expanded="true"
      data-inline-hide={inlineHideOpen}
      data-session-visible={sessionChromeVisible}
      onMouseLeave={() => setInlineHideOpen(false)}
    >
      {sessionChromeVisible ? (
        <FloatingOverlay
          state={displayState}
          interimTranscript={interimTranscript}
          finalTranscript={finalTranscript}
          error={error}
          inlineHideOpen={inlineHideOpen}
          onBarContextMenu={onBarContextMenu}
          onHideDictationBar={hideDictationBar}
        />
      ) : null}
    </div>
  );
}

export default OverlayRoot;
