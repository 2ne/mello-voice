import { useEffect, useCallback, useRef, useState } from "react";
import { getCurrentWindow, primaryMonitor, LogicalPosition, LogicalSize, PhysicalPosition, cursorPosition } from "@tauri-apps/api/window";
import { moveWindow, Position } from "@tauri-apps/plugin-positioner";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import FloatingOverlay from "./FloatingOverlay";
import { shouldShowSessionChrome } from "./overlaySessionState";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import {
  ensureMicPermission,
  warmUpMicPermissionForWebview,
  startWavMicCapture,
  stopWavMicCapture,
} from "../transcription/wavCapture";
import {
  buildFinalDictationText,
  transcribeWithWhisperPreferLocal,
} from "../transcription/transcriptionService";
import { addToHistory } from "../history";
import {
  FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS,
  FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS,
  fetchOverlayBarEnabledWithRetry,
} from "../overlayBarPrefFetch";

const TOP_OFFSET = 10;
const OVERLAY_WIDTH = 340;
const MIN_OVERLAY_HEIGHT = 52;
const DUPLICATE_PRESS_DEBOUNCE_MS = 88;
const RESIZE_HEIGHT_EPSILON = 2;
const OVERLAY_DRAG_THRESHOLD_PX = 6;

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" &&
    (((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ != null) ||
      (import.meta.env.TAURI_PLATFORM != null && String(import.meta.env.TAURI_PLATFORM) !== ""))
  );
}

async function positionOverlayTopCenter() {
  const win = getCurrentWindow();
  const monitor = await primaryMonitor();
  if (!monitor) return;
  const winSize = await win.outerSize();
  const scale = monitor.scaleFactor;
  const x = (monitor.position.x + (monitor.size.width - winSize.width) / 2) / scale;
  const y = (monitor.position.y + TOP_OFFSET) / scale;
  // react-doctor-disable-next-line react-doctor/async-parallel -- Tauri window placement has to settle before the final readback adjustment.
  await Promise.all([
    win.setPosition(new LogicalPosition(x, y)),
    moveWindow(Position.TopCenter),
  ]);
  const pos = await win.outerPosition();
  await win.setPosition(new LogicalPosition(x, (pos.y + TOP_OFFSET) / scale));
}

type HotkeyState = string;

function OverlayRoot() {
  const overlayRef = useRef<HTMLDivElement>(null);
  const shortcutHeldRef = useRef(false);
  const barEnabledRef = useRef(true);
  const errorRef = useRef<string | null>(null);
  const lastResizeHeightRef = useRef(0);
  const lastPressAtRef = useRef(-Infinity);
  const isListeningRef = useRef(false);
  const isExpandedRef = useRef(false);
  /** Synchronous mirror of `barPrefsResolved` so a slow boot fetch can't clobber a fresher event-driven write. */
  const barPrefsResolvedRef = useRef(false);
  /** One-shot guard so toggling the bar on/off doesn't re-trigger `getUserMedia()` warm-up. */
  const overlayMicWarmupDoneRef = useRef(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [inlineHideOpen, setInlineHideOpen] = useState(false);
  const [barEnabled, setBarEnabled] = useState(true);
  /** After first `get_overlay_bar_enabled` read — avoids mic warm-up while `barEnabled` still reflects only the optimistic default. */
  const [barPrefsResolved, setBarPrefsResolved] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const {
    interimTranscript,
    finalTranscript,
    error: speechError,
    startListening,
    stopListening,
    stopAndWaitForFinal,
    clearTranscript,
  } = useSpeechRecognition();

  const activeError = speechError ?? sessionError;

  useEffect(() => {
    errorRef.current = activeError;
  }, [activeError]);

  useEffect(() => {
    barEnabledRef.current = barEnabled;
  }, [barEnabled]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  const sessionChromeVisible = shouldShowSessionChrome({
    barEnabled,
    isExpanded,
    isProcessing,
    activeError,
    inlineHideOpen,
  });

  const hideOverlayWhenBarPreferOff = useCallback(() => {
    window.setTimeout(() => {
      if (barEnabledRef.current) return;
      if (errorRef.current) return;
      void getCurrentWindow().hide().catch(() => {});
    }, 50);
  }, []);

  const overlayDragSessionRef = useRef<{
    pointerId: number;
    winOrigin: PhysicalPosition | null;
    cursorOrigin: PhysicalPosition | null;
    passedThreshold: boolean;
  } | null>(null);

  const releaseOverlayDrag = useCallback((el: HTMLDivElement, pointerId: number) => {
    const s = overlayDragSessionRef.current;
    if (s?.pointerId === pointerId) {
      overlayDragSessionRef.current = null;
    }
    try {
      el.releasePointerCapture(pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  const onOverlayPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== "overlay") return;
    if (e.button !== 0) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest("[data-overlay-no-drag]")) return;

    const pid = e.pointerId;
    const host = e.currentTarget;
    overlayDragSessionRef.current = {
      pointerId: pid,
      winOrigin: null,
      cursorOrigin: null,
      passedThreshold: false,
    };
    try {
      host.setPointerCapture(pid);
    } catch {
      overlayDragSessionRef.current = null;
      return;
    }

    void (async () => {
      const win = getCurrentWindow();
      let winOrigin: PhysicalPosition;
      let cursorOrigin: PhysicalPosition;
      try {
        [winOrigin, cursorOrigin] = await Promise.all([win.outerPosition(), cursorPosition()]);
      } catch (err) {
        console.warn("Overlay drag: could not read window/cursor position:", err);
        const s = overlayDragSessionRef.current;
        if (s?.pointerId === pid) {
          overlayDragSessionRef.current = null;
        }
        try {
          host.releasePointerCapture(pid);
        } catch {
          /* ignore */
        }
        return;
      }
      const s = overlayDragSessionRef.current;
      if (!s || s.pointerId !== pid) return;
      s.winOrigin = winOrigin;
      s.cursorOrigin = cursorOrigin;
    })();
  }, []);

  const onOverlayPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const session = overlayDragSessionRef.current;
    if (
      !session ||
      e.pointerId !== session.pointerId ||
      session.winOrigin == null ||
      session.cursorOrigin == null
    ) {
      return;
    }

    const winOrigin = session.winOrigin;
    const cursorOrigin = session.cursorOrigin;

    void (async () => {
      let cur: PhysicalPosition;
      try {
        cur = await cursorPosition();
      } catch {
        return;
      }
      const dx = cur.x - cursorOrigin.x;
      const dy = cur.y - cursorOrigin.y;
      if (!session.passedThreshold) {
        const d2 = dx * dx + dy * dy;
        if (d2 < OVERLAY_DRAG_THRESHOLD_PX * OVERLAY_DRAG_THRESHOLD_PX) {
          return;
        }
        session.passedThreshold = true;
      }
      try {
        await getCurrentWindow().setPosition(new PhysicalPosition(winOrigin.x + dx, winOrigin.y + dy));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const onOverlayPointerUpOrCancel = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const session = overlayDragSessionRef.current;
    if (!session || e.pointerId !== session.pointerId) return;
    releaseOverlayDrag(e.currentTarget, e.pointerId);
  }, [releaseOverlayDrag]);

  useEffect(() => {
    let cancelled = false;
    const bootDelay = window.setTimeout(() => {
      void (async () => {
        await new Promise((r) => setTimeout(r, 50));
        if (cancelled) return;
        try {
          await positionOverlayTopCenter();
        } catch (e) {
          console.warn("Could not position overlay:", e);
        }
        if (cancelled) return;
        const enabled = await fetchOverlayBarEnabledWithRetry(
          () => invoke<boolean>("get_overlay_bar_enabled"),
          /** Privacy-first on boot: do not leave an idle overlay visible when persisted preference cannot be read. */
          FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS,
        );
        if (cancelled) return;
        /** Skip clobbering if the event listener already wrote a fresher value during our await. */
        if (barPrefsResolvedRef.current) return;
        barPrefsResolvedRef.current = true;
        setBarEnabled(enabled);
        barEnabledRef.current = enabled;
        if (enabled) {
          await getCurrentWindow().show().catch(() => {});
          await positionOverlayTopCenter().catch(() => {});
        } else {
          await getCurrentWindow().hide().catch(() => {});
        }
        if (!cancelled) setBarPrefsResolved(true);
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(bootDelay);
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<boolean>("overlay-bar-enabled-changed", (event) => {
      const v = event.payload;
      barPrefsResolvedRef.current = true;
      setBarPrefsResolved(true);
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

  /**
   * Warm up the overlay's mic permission once the bar pref resolves to "always visible". Per WebView2 (Windows),
   * the permission store can differ between webviews, so we touch it from this webview specifically. One-shot.
   */
  useEffect(() => {
    if (overlayMicWarmupDoneRef.current) return;
    if (!barEnabled || !barPrefsResolved) return;
    const id = window.setTimeout(() => {
      overlayMicWarmupDoneRef.current = true;
      warmUpMicPermissionForWebview("overlay-always-bar");
    }, 400);
    return () => clearTimeout(id);
  }, [barEnabled, barPrefsResolved]);

  // Resize window to fit pill + inline actions
  useEffect(() => {
    if (!sessionChromeVisible) {
      lastResizeHeightRef.current = 0;
      return;
    }
    const el = overlayRef.current;
    if (!el) return;
    const win = getCurrentWindow();
    let raf = 0;
    const resizeToContent = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        /* +1 avoids subpixel clipping when the pill animates chrome height */
        const height = Math.max(MIN_OVERLAY_HEIGHT, Math.ceil(el.scrollHeight) + 1);
        if (Math.abs(height - lastResizeHeightRef.current) <= RESIZE_HEIGHT_EPSILON) return;
        lastResizeHeightRef.current = height;
        void win.setSize(new LogicalSize(OVERLAY_WIDTH, height));
      });
    };
    resizeToContent();
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sessionChromeVisible, inlineHideOpen]);

  const handleShortcut = useCallback(
    async (event: { state: HotkeyState }) => {
      const normalizedState = event.state.trim().toLowerCase();
      const isPressedEvent =
        normalizedState === "pressed" || normalizedState === "press" || normalizedState === "down";
      const isReleasedEvent =
        normalizedState === "released" || normalizedState === "release" || normalizedState === "up";
      if (!isPressedEvent && !isReleasedEvent) return;

      if (isPressedEvent) {
        // Missed Released — reset stale refs only when nothing is actively capturing.
        if (shortcutHeldRef.current) {
          const active = isListeningRef.current || isExpandedRef.current;
          if (active) {
            // Global shortcut repeat can emit additional Pressed events while holding; ignore re-entry.
            return;
          }
          if (!active) {
            shortcutHeldRef.current = false;
            setIsExpanded(false);
            setIsListening(false);
            stopListening();
            clearTranscript();
            await stopWavMicCapture().catch(() => {});
          }
        }

        const now = performance.now();
        if (now - lastPressAtRef.current < DUPLICATE_PRESS_DEBOUNCE_MS) {
          return;
        }
        lastPressAtRef.current = now;

        const pref = await fetchOverlayBarEnabledWithRetry(
          () => invoke<boolean>("get_overlay_bar_enabled"),
          FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS,
        );
        barEnabledRef.current = pref;

        shortcutHeldRef.current = true;
        setInlineHideOpen(false);
        setSessionError(null);

        try {
          await getCurrentWindow().show();
        } catch (e) {
          console.warn("Could not show overlay:", e);
        }

        const permissionGranted = await ensureMicPermission();
        if (!permissionGranted) {
          shortcutHeldRef.current = false;
          setIsExpanded(false);
          setSessionError("Microphone access is required. Allow it and try again.");
          hideOverlayWhenBarPreferOff();
          return;
        }

        setIsExpanded(true);
        try {
          await startWavMicCapture();
        } catch (e) {
          console.warn("WAV mic capture:", e);
          shortcutHeldRef.current = false;
          setIsExpanded(false);
          setSessionError("Could not start microphone capture.");
          hideOverlayWhenBarPreferOff();
          return;
        }
        startListening();
        setIsListening(true);
      } else {
        if (!shortcutHeldRef.current) return;
        shortcutHeldRef.current = false;
        lastPressAtRef.current = -Infinity;
        setIsExpanded(false);
        setIsListening(false);
        setIsProcessing(true);
        const wavPromise = stopWavMicCapture().catch((e) => {
          console.warn("stop WAV capture:", e);
          return new Uint8Array(0);
        });
        try {
          const wav = await wavPromise;
          const whisperPromise = transcribeWithWhisperPreferLocal(wav);
          const [whisperText, fallbackSpeech] = await Promise.all([
            whisperPromise,
            stopAndWaitForFinal(),
          ]);
          clearTranscript();

          const text = await buildFinalDictationText({
            whisperPreferred: whisperText,
            webSpeechFallback: fallbackSpeech,
          });

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
    [clearTranscript, hideOverlayWhenBarPreferOff, startListening, stopAndWaitForFinal, stopListening],
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

  const displayState = activeError
    ? "error"
    : isProcessing
      ? "processing"
      : isExpanded
        ? "listening"
        : "idle";

  const onBarToggleHideMenu = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    if (!sessionChromeVisible) return;
    setInlineHideOpen((v) => !v);
  };

  const hideDictationBar = async () => {
    try {
      setInlineHideOpen(false);
      /** Rust emits `overlay-bar-enabled-changed` and hides this window — the listener above flips state + chrome. Avoid double-emitting. */
      await invoke("set_overlay_bar_enabled", { enabled: false });
    } catch {
      /* ignore */
    }
  };

  const onOverlayDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement | null)?.closest("[data-overlay-no-drag]")) return;
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== "overlay") return;
    e.preventDefault();
    setInlineHideOpen(false);
    void positionOverlayTopCenter().catch(() => {});
  }, []);

  return (
    <div
      ref={overlayRef}
      className="pointer-events-auto flex min-h-full w-full cursor-move items-start justify-center px-2 pb-2 pt-2.5 active:cursor-grabbing"
      data-expanded="true"
      data-inline-hide={inlineHideOpen}
      data-session-visible={sessionChromeVisible}
      onPointerDown={onOverlayPointerDown}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={onOverlayPointerUpOrCancel}
      onPointerCancel={onOverlayPointerUpOrCancel}
      onDoubleClick={onOverlayDoubleClick}
      onMouseLeave={() => setInlineHideOpen(false)}
    >
      {sessionChromeVisible ? (
        <FloatingOverlay
          state={displayState}
          interimTranscript={interimTranscript}
          finalTranscript={finalTranscript}
          error={activeError}
          inlineHideOpen={inlineHideOpen}
          onBarToggleHideMenu={onBarToggleHideMenu}
          onHideDictationBar={hideDictationBar}
        />
      ) : null}
    </div>
  );
}

export default OverlayRoot;
