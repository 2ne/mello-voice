import { useEffect, useCallback, useLayoutEffect, useRef, useState } from "react";
import { getCurrentWindow, primaryMonitor, LogicalPosition, LogicalSize, PhysicalPosition, cursorPosition } from "@tauri-apps/api/window";
import { moveWindow, Position } from "@tauri-apps/plugin-positioner";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";
import FloatingOverlay from "./FloatingOverlay";
import { shouldShowSessionChrome } from "./overlaySessionState";
import {
  getMicPermissionState,
  mapMicError,
  setPreferredMicrophoneDeviceId,
  startWavMicCapture,
  stopWavMicCapture,
  subscribeCaptureLevels,
  warmWavMicCapturePipeline,
  resumeCaptureAudioIfActive,
} from "../transcription/wavCapture";
import { parseMicrophoneDeviceId } from "../microphoneDevicePreference";
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
import { CAPS_DOUBLE_TAP_WINDOW_MS, evaluateCapsDoubleTap } from "../capsLockDictationGesture";
import { DEFAULT_DICTATION_SHORTCUT, parseDictationShortcut, type DictationShortcutPreference } from "../dictationShortcut";

const TOP_OFFSET = 10;
const OVERLAY_WIDTH = 340;
const IDLE_CIRCLE_SIZE = 28;
const MIN_OVERLAY_HEIGHT = 52;
const RESIZE_EPSILON = 2;
const OVERLAY_DRAG_THRESHOLD_PX = 6;

/**
 * Known minimum chrome height per expanded state, derived from `FloatingOverlay`
 * Tailwind classes so we can pre-size the native window before paint even when
 * `scrollHeight` is unreliable (i.e. while transitioning between mini and expanded
 * widths — the chrome still occupies the previous narrow width when measured).
 *
 * Layout per state: chrome.height = max(chrome.min-height, padding-block + content-min-height).
 *   listening:  min-h-[52px] + py-1.5 (12px) + content min-h-11 (44px) = 56px
 *   processing: min-h-[56px] + py-3   (24px) + content h-8    (32px) = 56px
 *   error:      min-h-[56px] + py-3   (24px) + content (variable, floor) = 56px
 * +1 logical pixel guards against subpixel clipping during the chrome's CSS transition.
 */
const EXPANDED_HEIGHT_FLOOR = 57;

/** Cover the slowest chrome transition (260ms expanded variant) plus a small settle buffer. */
const OVERLAY_SHRINK_DELAY_MS = 280;

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
  const barEnabledRef = useRef(true);
  const errorRef = useRef<string | null>(null);
  /** Last logical dimensions actually sent to the native window. Shared by the layout-effect
   *  pre-grow path and the ResizeObserver safety net so they don't fight each other. */
  const lastAppliedSizeRef = useRef({ width: 0, height: 0 });
  /** Pending deferred shrink (chrome animates downward inside a still-larger window). */
  const pendingShrinkTimeoutRef = useRef<number | null>(null);
  /** Monotonic op id so a slow async setSize can't undo a fresher one. */
  const resizeOpRef = useRef(0);
  const isListeningRef = useRef(false);
  const isExpandedRef = useRef(false);
  /** Synchronous mirror of `barPrefsResolved` so a slow boot fetch can't clobber a fresher event-driven write. */
  const barPrefsResolvedRef = useRef(false);

  const [isExpanded, setIsExpanded] = useState(false);
  const [barEnabled, setBarEnabled] = useState(true);
  const [dictationShortcut, setDictationShortcut] = useState<DictationShortcutPreference>(DEFAULT_DICTATION_SHORTCUT);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0);
  const isProcessingRef = useRef(false);

  const capsTapWindowRef = useRef<number[]>([]);
  const capsLastAcceptedPressRef = useRef(-Infinity);
  const capsStaleTimerRef = useRef<number | null>(null);
  /** Maps OS key timestamps (from Rust) onto `performance.now()` for double-tap detection. */
  const pressClockOffsetRef = useRef<number | null>(null);

  const hotkeyPressToPerfNow = useCallback((pressMs: number | undefined): number => {
    if (pressMs == null || !Number.isFinite(pressMs)) {
      return performance.now();
    }
    if (pressClockOffsetRef.current == null) {
      pressClockOffsetRef.current = performance.now() - pressMs;
    }
    return pressClockOffsetRef.current + pressMs;
  }, []);

  /** Only session/mic errors belong in the pill. */
  const activeError = sessionError;

  useEffect(() => {
    errorRef.current = activeError;
  }, [activeError]);

  useEffect(() => {
    barEnabledRef.current = barEnabled;
  }, [barEnabled]);

  useEffect(() => {
    isExpandedRef.current = isExpanded;
  }, [isExpanded]);

  useEffect(() => {
    isProcessingRef.current = isProcessing;
  }, [isProcessing]);

  useEffect(() => {
    return subscribeCaptureLevels(({ level }) => {
      setAudioLevel(level);
    });
  }, []);

  const clearCapsStaleTimer = useCallback(() => {
    if (capsStaleTimerRef.current != null) {
      window.clearTimeout(capsStaleTimerRef.current);
      capsStaleTimerRef.current = null;
    }
  }, []);

  const resetCapsGestureState = useCallback(() => {
    capsTapWindowRef.current = [];
    capsLastAcceptedPressRef.current = -Infinity;
    clearCapsStaleTimer();
  }, [clearCapsStaleTimer]);

  const scheduleCapsWindowStaleClear = useCallback(() => {
    clearCapsStaleTimer();
    capsStaleTimerRef.current = window.setTimeout(() => {
      capsTapWindowRef.current = [];
      capsStaleTimerRef.current = null;
    }, CAPS_DOUBLE_TAP_WINDOW_MS + 40);
  }, [clearCapsStaleTimer]);

  useEffect(() => {
    return () => {
      clearCapsStaleTimer();
    };
  }, [clearCapsStaleTimer]);

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
    void invoke<unknown>("get_dictation_shortcut")
      .then((shortcut) => setDictationShortcut(parseDictationShortcut(shortcut)))
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    listen<unknown>("dictation-shortcut-changed", (event) => {
      setDictationShortcut(parseDictationShortcut(event.payload));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    void invoke<string>("get_microphone_device_id")
      .then((deviceId) => setPreferredMicrophoneDeviceId(parseMicrophoneDeviceId(deviceId)))
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    listen<string>("microphone-device-changed", (event) => {
      setPreferredMicrophoneDeviceId(parseMicrophoneDeviceId(event.payload));
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let unlistenWarm: (() => void) | undefined;
    void listen("dictation-warm-request", async () => {
      try {
        await warmWavMicCapturePipeline();
      } catch (e) {
        console.warn("dictation-warm-request:", e);
      }
      await emit("dictation-warm-complete", {}).catch(() => {});
    }).then((fn) => {
      unlistenWarm = fn;
      void emit("overlay-runtime-ready", {}).catch(() => {});
    });
    return () => unlistenWarm?.();
  }, []);

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
        const win = getCurrentWindow();
        let wasVisible = false;
        try {
          wasVisible = await win.isVisible();
        } catch {
          /* ignore */
        }
        try {
          await win.show();
          if (!wasVisible) {
            await positionOverlayTopCenter();
          }
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

  /**
   * Single source of truth for "what size should the native overlay window be right now?".
   *
   * Width handling is straightforward (mini = 28, expanded = 340). Height is trickier:
   * during a mini↔expanded transition the chrome still has the previous (narrow) layout
   * width when we measure, so a fresh `scrollHeight` reading wraps text and reports a
   * misleading value. In that case we fall back to a known per-state floor. Once the
   * window has caught up to `OVERLAY_WIDTH`, `scrollHeight` becomes trustworthy and
   * grows the window naturally for multi-line transcripts.
   */
  const computeTargetSize = useCallback((): { width: number; height: number } | null => {
    const host = overlayRef.current;
    const chrome = host?.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
    if (!chrome) return null;
    if (idleCircleVisible) {
      return { width: IDLE_CIRCLE_SIZE, height: IDLE_CIRCLE_SIZE };
    }
    const last = lastAppliedSizeRef.current;
    const widthAtTarget = last.width >= OVERLAY_WIDTH - RESIZE_EPSILON;
    const measured = widthAtTarget
      ? Math.max(MIN_OVERLAY_HEIGHT, Math.ceil(chrome.scrollHeight) + 1)
      : EXPANDED_HEIGHT_FLOOR;
    return { width: OVERLAY_WIDTH, height: Math.max(EXPANDED_HEIGHT_FLOOR, measured) };
  }, [idleCircleVisible]);

  const applyWindowSize = useCallback(async (width: number, height: number) => {
    const opId = ++resizeOpRef.current;
    const win = getCurrentWindow();
    try {
      const [position, size, scale] = await Promise.all([
        win.outerPosition(),
        win.outerSize(),
        win.scaleFactor(),
      ]);
      if (opId !== resizeOpRef.current) return; // newer resize has superseded us
      await win.setSize(new LogicalSize(width, height));
      const nextPhysicalWidth = Math.round(width * scale);
      const nextX = Math.round(position.x + (size.width - nextPhysicalWidth) / 2);
      await win.setPosition(new PhysicalPosition(nextX, position.y));
    } catch (err) {
      console.warn("Could not resize overlay:", err);
    }
  }, []);

  /**
   * Native window must lead the CSS chrome animation so the pill is never clipped.
   *
   * - GROW synchronously in `useLayoutEffect` (before browser paint): if the new
   *   target is bigger, snap the window to that size immediately. The chrome's CSS
   *   transition then animates inside an already-large-enough window.
   * - SHRINK after the CSS chrome transition has settled (~280ms): leaving the window
   *   temporarily larger than the pill is invisible because the surrounding area is
   *   transparent, but shrinking first would clip the pill while it animates down.
   *
   * Re-runs on transcript / error changes too so multi-line text growth is captured
   * pre-paint instead of chasing it with a `ResizeObserver` frame behind.
   */
  useLayoutEffect(() => {
    if (!sessionChromeVisible) {
      if (pendingShrinkTimeoutRef.current != null) {
        clearTimeout(pendingShrinkTimeoutRef.current);
        pendingShrinkTimeoutRef.current = null;
      }
      lastAppliedSizeRef.current = { width: 0, height: 0 };
      return;
    }
    const target = computeTargetSize();
    if (!target) return;
    const last = lastAppliedSizeRef.current;
    const widthGrew = target.width > last.width + RESIZE_EPSILON;
    const heightGrew = target.height > last.height + RESIZE_EPSILON;
    const widthShrank = target.width < last.width - RESIZE_EPSILON;
    const heightShrank = target.height < last.height - RESIZE_EPSILON;
    if (!widthGrew && !heightGrew && !widthShrank && !heightShrank) return;

    if (pendingShrinkTimeoutRef.current != null) {
      clearTimeout(pendingShrinkTimeoutRef.current);
      pendingShrinkTimeoutRef.current = null;
    }

    if (widthGrew || heightGrew) {
      lastAppliedSizeRef.current = { width: target.width, height: target.height };
      void applyWindowSize(target.width, target.height);
      return;
    }

    /** Shrink only: defer past the chrome's CSS transition so the pill isn't clipped mid-animation. */
    pendingShrinkTimeoutRef.current = window.setTimeout(() => {
      pendingShrinkTimeoutRef.current = null;
      const settled = computeTargetSize();
      if (!settled) return;
      lastAppliedSizeRef.current = { width: settled.width, height: settled.height };
      void applyWindowSize(settled.width, settled.height);
    }, OVERLAY_SHRINK_DELAY_MS);
  }, [
    sessionChromeVisible,
    displayState,
    idleCircleVisible,
    activeError,
    computeTargetSize,
    applyWindowSize,
  ]);

  /** Safety net for reflows our React deps don't see (font load, transcript wrapping that
   *  doesn't change the transcript string between renders, OS scale changes). Only grows
   *  the window — shrinkage is owned by the layout effect's deferred path above. */
  useEffect(() => {
    if (!sessionChromeVisible) return;
    const host = overlayRef.current;
    const chrome = host?.firstElementChild instanceof HTMLElement ? host.firstElementChild : null;
    if (!chrome) return;
    const observer = new ResizeObserver(() => {
      const target = computeTargetSize();
      if (!target) return;
      const last = lastAppliedSizeRef.current;
      const widthGrew = target.width > last.width + RESIZE_EPSILON;
      const heightGrew = target.height > last.height + RESIZE_EPSILON;
      if (!widthGrew && !heightGrew) return;
      lastAppliedSizeRef.current = { width: target.width, height: target.height };
      void applyWindowSize(target.width, target.height);
    });
    observer.observe(chrome);
    return () => observer.disconnect();
  }, [sessionChromeVisible, idleCircleVisible, computeTargetSize, applyWindowSize]);

  useEffect(() => {
    return () => {
      if (pendingShrinkTimeoutRef.current != null) {
        clearTimeout(pendingShrinkTimeoutRef.current);
        pendingShrinkTimeoutRef.current = null;
      }
    };
  }, []);

  const runStopDictationPipeline = useCallback(async () => {
    resetCapsGestureState();

    setIsExpanded(false);
    isListeningRef.current = false;
    setAudioLevel(0);
    setIsProcessing(true);
    const wavPromise = stopWavMicCapture().catch((e) => {
      console.warn("stop WAV capture:", e);
      return new Uint8Array(0);
    });
    try {
      const wav = await wavPromise;
      const whisperText = await transcribeWithWhisperPreferLocal(wav);
      const text = await buildFinalDictationText(whisperText);

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
  }, [resetCapsGestureState, hideOverlayWhenBarPreferOff]);

  const runStartDictationPipeline = useCallback(async () => {
    let pref = barEnabledRef.current;
    if (!barPrefsResolvedRef.current) {
      pref = await fetchOverlayBarEnabledWithRetry(
        () => invoke<boolean>("get_overlay_bar_enabled"),
        FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS,
      );
      barPrefsResolvedRef.current = true;
      setBarEnabled(pref);
    }
    barEnabledRef.current = pref;

    setSessionError(null);
    setAudioLevel(0);

    try {
      await getCurrentWindow().show();
    } catch (e) {
      console.warn("Could not show overlay:", e);
    }

    const perm = await getMicPermissionState();
    if (perm === "denied") {
      await invoke("raise_mic_recovery_to_main", { reason: "notAllowed" }).catch(() => {});
      hideOverlayWhenBarPreferOff();
      return;
    }

    setIsExpanded(true);
    try {
      await startWavMicCapture();
    } catch (e) {
      console.warn("WAV mic capture:", e);
      setIsExpanded(false);
      const mapped = mapMicError(e);
      await invoke("raise_mic_recovery_to_main", { reason: mapped }).catch(() => {});
      hideOverlayWhenBarPreferOff();
      return;
    }
    isListeningRef.current = true;

    resetCapsGestureState();
  }, [hideOverlayWhenBarPreferOff, resetCapsGestureState]);

  const handleShortcut = useCallback(
    async (event: { state: HotkeyState; pressMs?: number }) => {
      const normalizedState = event.state.trim().toLowerCase();
      const isPressedEvent =
        normalizedState === "pressed" || normalizedState === "press" || normalizedState === "down";
      const isReleasedEvent =
        normalizedState === "released" || normalizedState === "release" || normalizedState === "up";
      if (!isPressedEvent && !isReleasedEvent) return;

      if (isReleasedEvent) {
        return;
      }
      const nowCaps = hotkeyPressToPerfNow(event.pressMs);
      if (isProcessingRef.current) {
        return;
      }

      const tap = evaluateCapsDoubleTap({
        windowPressesMs: capsTapWindowRef.current,
        now: nowCaps,
        lastAcceptedPressAt: capsLastAcceptedPressRef.current,
      });

      if (!tap.consumed) {
        return;
      }

      capsTapWindowRef.current = tap.nextWindowPressesMs;
      capsLastAcceptedPressRef.current = tap.nextLastAcceptedPressAt;

      if (!tap.shouldAct) {
        scheduleCapsWindowStaleClear();
        return;
      }
      clearCapsStaleTimer();

      if (isListeningRef.current) {
        await runStopDictationPipeline();
      } else {
        await runStartDictationPipeline();
      }
    },
    [
      clearCapsStaleTimer,
      hotkeyPressToPerfNow,
      runStartDictationPipeline,
      runStopDictationPipeline,
      scheduleCapsWindowStaleClear,
    ],
  );

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        resumeCaptureAudioIfActive();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime() || !isExpanded) return;
    let unlisten: (() => void) | undefined;
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (focused) resumeCaptureAudioIfActive();
      })
      .then((fn) => {
        unlisten = fn;
      });
    return () => {
      unlisten?.();
    };
  }, [isExpanded]);

  // Pass-through key listener runs in Rust so keys still reach other apps; overlay listens for double-taps.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ state: HotkeyState; pressMs?: number }>("dictation-hotkey", (event) => {
      void handleShortcut({ state: event.payload.state, pressMs: event.payload.pressMs });
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
          shortcutLabel={dictationShortcut.label}
          audioLevel={audioLevel}
          interimTranscript=""
          finalTranscript=""
          error={activeError}
        />
      ) : null}
    </div>
  );
}

export default OverlayRoot;
