import { useEffect, useCallback, useRef, useState } from "react";
import { getCurrentWindow, primaryMonitor, LogicalPosition, LogicalSize, PhysicalPosition, cursorPosition } from "@tauri-apps/api/window";
import { moveWindow, Position } from "@tauri-apps/plugin-positioner";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import FloatingOverlay from "./FloatingOverlay";
import { shouldShowSessionChrome } from "./overlaySessionState";
import { useSpeechRecognition } from "../hooks/useSpeechRecognition";
import {
  getMicPermissionState,
  mapMicError,
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
const IDLE_CIRCLE_SIZE = 28;
const MIN_OVERLAY_HEIGHT = 52;
const DUPLICATE_PRESS_DEBOUNCE_MS = 88;
const RESIZE_EPSILON = 2;
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
  const lastResizeFrameRef = useRef({ width: 0, height: 0 });
  const lastPressAtRef = useRef(-Infinity);
  const isListeningRef = useRef(false);
  const isExpandedRef = useRef(false);
  /** Synchronous mirror of `barPrefsResolved` so a slow boot fetch can't clobber a fresher event-driven write. */
  const barPrefsResolvedRef = useRef(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [barEnabled, setBarEnabled] = useState(true);
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
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  const sessionChromeVisible = shouldShowSessionChrome({
    barEnabled,
    isExpanded,
    isProcessing,
    activeError,
  });

  const hideOverlayWhenBarPreferOff = useCallback(() => {
    window.setTimeout(() => {
      if (barEnabledRef.current) return;
      if (errorRef.current) return;
      void getCurrentWindow().hide().catch(() => {});
    }, 50);
  }, []);

  const applyOverlayVisibility = useCallback(async (enabled: boolean) => {
    if (enabled) {
      const allowed = await invoke<boolean>("get_mic_overlay_boot_allowed").catch(() => false);
      if (!allowed) {
        await getCurrentWindow().hide().catch(() => {});
        return;
      }
      try {
        await getCurrentWindow().show();
        await positionOverlayTopCenter();
      } catch (e) {
        console.warn("Could not show overlay:", e);
      }
    } else {
      await getCurrentWindow().hide().catch(() => {});
    }
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
        if (!cancelled && !barPrefsResolvedRef.current) {
          /** Skip clobbering if the event listener already wrote a fresher value during our await. */
          barPrefsResolvedRef.current = true;
          setBarEnabled(enabled);
          barEnabledRef.current = enabled;
          await applyOverlayVisibility(enabled);
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      clearTimeout(bootDelay);
    };
  }, [applyOverlayVisibility]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<boolean>("overlay-bar-enabled-changed", (event) => {
      const v = event.payload;
      barPrefsResolvedRef.current = true;
      setBarEnabled(v);
      barEnabledRef.current = v;
      if (!v) {
        void getCurrentWindow().hide().catch(() => {});
      } else {
        void applyOverlayVisibility(true);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, [applyOverlayVisibility]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void listen<boolean>("mic-overlay-boot-changed", (event) => {
      const allowed = event.payload;
      if (!allowed) {
        void getCurrentWindow().hide().catch(() => {});
        return;
      }
      void (async () => {
        if (!barEnabledRef.current) return;
        try {
          await getCurrentWindow().show();
          await positionOverlayTopCenter();
        } catch (e) {
          console.warn("Could not show overlay:", e);
        }
      })();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  const displayState = activeError
    ? "error"
    : isProcessing
      ? "processing"
      : isExpanded
        ? "listening"
        : "idle";

  const idleCircleVisible = sessionChromeVisible && displayState === "idle";

  // Resize the native overlay window itself so transparent space does not steal clicks from apps underneath.
  useEffect(() => {
    if (!sessionChromeVisible) {
      lastResizeFrameRef.current = { width: 0, height: 0 };
      return;
    }
    const host = overlayRef.current;
    const chrome = host?.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
    if (!chrome) return;
    const win = getCurrentWindow();
    let raf = 0;
    const resizeToContent = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const width = idleCircleVisible
          ? IDLE_CIRCLE_SIZE
          : OVERLAY_WIDTH;
        /* +1 avoids subpixel clipping when the pill animates chrome height */
        const height = idleCircleVisible
          ? IDLE_CIRCLE_SIZE
          : Math.max(MIN_OVERLAY_HEIGHT, Math.ceil(chrome.scrollHeight) + 1);
        const previous = lastResizeFrameRef.current;
        if (
          Math.abs(width - previous.width) <= RESIZE_EPSILON &&
          Math.abs(height - previous.height) <= RESIZE_EPSILON
        ) {
          return;
        }
        lastResizeFrameRef.current = { width, height };

        void (async () => {
          let previousPosition: PhysicalPosition | null = null;
          let previousWidth = 0;
          let scale = 1;
          try {
            const [position, size, windowScale] = await Promise.all([
              win.outerPosition(),
              win.outerSize(),
              win.scaleFactor(),
            ]);
            previousPosition = position;
            previousWidth = size.width;
            scale = windowScale;
          } catch {
            /* Keep resizing even if the anchor readback is unavailable. */
          }

          await win.setSize(new LogicalSize(width, height));

          if (!previousPosition) return;
          const nextPhysicalWidth = Math.round(width * scale);
          const nextX = Math.round(previousPosition.x + (previousWidth - nextPhysicalWidth) / 2);
          await win.setPosition(new PhysicalPosition(nextX, previousPosition.y));
        })().catch((err) => {
          console.warn("Could not resize overlay:", err);
        });
      });
    };
    resizeToContent();
    const observer = new ResizeObserver(resizeToContent);
    observer.observe(chrome);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [sessionChromeVisible, displayState, idleCircleVisible]);

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
            isListeningRef.current = false;
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
        setSessionError(null);

        try {
          await getCurrentWindow().show();
        } catch (e) {
          console.warn("Could not show overlay:", e);
        }

        const perm = await getMicPermissionState();
        // "prompt" can still succeed in this webview after getUserMedia triggers the OS permission flow.
        // Treat only explicit denial as unrecoverable before capture start to avoid a recovery-loop dead-end.
        if (perm === "denied") {
          shortcutHeldRef.current = false;
          await invoke("raise_mic_recovery_to_main", { reason: "notAllowed" }).catch(() => {});
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
          const mapped = mapMicError(e);
          await invoke("raise_mic_recovery_to_main", { reason: mapped }).catch(() => {});
          hideOverlayWhenBarPreferOff();
          return;
        }
        startListening();
        isListeningRef.current = true;
      } else {
        if (!shortcutHeldRef.current) return;
        shortcutHeldRef.current = false;
        lastPressAtRef.current = -Infinity;
        setIsExpanded(false);
        isListeningRef.current = false;
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

  const onOverlayDoubleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!isTauriRuntime()) return;
    if (getCurrentWindow().label !== "overlay") return;
    e.preventDefault();
    void positionOverlayTopCenter().catch(() => {});
  }, []);

  return (
    <div
      ref={overlayRef}
      className={cn(
        "flex min-h-full w-full items-start justify-center",
        idleCircleVisible
          ? "pointer-events-none cursor-default p-0"
          : "pointer-events-auto cursor-move p-0 active:cursor-grabbing",
      )}
      data-expanded="true"
      data-session-visible={sessionChromeVisible}
      onPointerDown={onOverlayPointerDown}
      onPointerMove={onOverlayPointerMove}
      onPointerUp={onOverlayPointerUpOrCancel}
      onPointerCancel={onOverlayPointerUpOrCancel}
      onDoubleClick={onOverlayDoubleClick}
    >
      {sessionChromeVisible ? (
        <FloatingOverlay
          state={displayState}
          interimTranscript={interimTranscript}
          finalTranscript={finalTranscript}
          error={activeError}
        />
      ) : null}
    </div>
  );
}

export default OverlayRoot;
