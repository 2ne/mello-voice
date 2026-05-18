/** Max gap between accepted presses — latest & earliest in the rolling window stay within this. */
export const CAPS_DOUBLE_TAP_WINDOW_MS = 450;

/** Drop repeat `Pressed` events from the OS / plugin arriving back-to-back (same physical caps tap). */
export const CAPS_MIN_INTER_PRESS_MS = 55;

const MIN_TAPS_REQUIRED = 2;

export interface CapsTapEvalInput {
  /** Accepted press timestamps (`performance.now`), oldest first — only presses within WINDOW from `now`. */
  windowPressesMs: readonly number[];
  now: number;
  /** Last accepted press (`performance.now`); duplicates closer than MIN_INTER_PRESS are ignored. */
  lastAcceptedPressAt: number;
}

export interface CapsTapEvalOutput {
  /** False if `now` was treated as duplicate echo — window and lastAccepted stay unchanged inputs. */
  consumed: boolean;
  /** Two distinct accepted taps landed in-window — caller should start or stop dictation. */
  shouldAct: boolean;
  nextWindowPressesMs: number[];
  nextLastAcceptedPressAt: number;
}

/**
 * Count accepted Caps Lock hotkey presses in a rolling window. Like double-click: need two real presses
 * within {@link CAPS_DOUBLE_TAP_WINDOW_MS}, with at least {@link CAPS_MIN_INTER_PRESS_MS} between accepts.
 */
export function evaluateCapsDoubleTap(input: CapsTapEvalInput): CapsTapEvalOutput {
  const { windowPressesMs, now, lastAcceptedPressAt } = input;

  if (now - lastAcceptedPressAt < CAPS_MIN_INTER_PRESS_MS) {
    return {
      consumed: false,
      shouldAct: false,
      nextWindowPressesMs: [...windowPressesMs],
      nextLastAcceptedPressAt: lastAcceptedPressAt,
    };
  }

  const trimmed = windowPressesMs.filter((t) => now - t <= CAPS_DOUBLE_TAP_WINDOW_MS);
  const nextWindow = [...trimmed, now];
  const nextLast = now;

  if (nextWindow.length >= MIN_TAPS_REQUIRED) {
    return {
      consumed: true,
      shouldAct: true,
      nextWindowPressesMs: [],
      nextLastAcceptedPressAt: nextLast,
    };
  }

  return {
    consumed: true,
    shouldAct: false,
    nextWindowPressesMs: nextWindow,
    nextLastAcceptedPressAt: nextLast,
  };
}
