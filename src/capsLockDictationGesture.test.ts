import { describe, expect, it } from "vitest";
import {
  CAPS_DOUBLE_TAP_WINDOW_MS,
  CAPS_MIN_INTER_PRESS_MS,
  evaluateCapsDoubleTap,
} from "./capsLockDictationGesture";

describe("evaluateCapsDoubleTap", () => {
  it("does not act on a single accepted press", () => {
    const t0 = 10_000;
    const a = evaluateCapsDoubleTap({
      windowPressesMs: [],
      now: t0,
      lastAcceptedPressAt: -Infinity,
    });
    expect(a.consumed).toBe(true);
    expect(a.shouldAct).toBe(false);
    expect(a.nextWindowPressesMs).toEqual([t0]);
  });

  it("acts when two spaced presses fall inside the window", () => {
    const t0 = 1000;
    const t1 = t0 + 200;
    const first = evaluateCapsDoubleTap({
      windowPressesMs: [],
      now: t0,
      lastAcceptedPressAt: -Infinity,
    });
    const second = evaluateCapsDoubleTap({
      windowPressesMs: first.nextWindowPressesMs,
      now: t1,
      lastAcceptedPressAt: first.nextLastAcceptedPressAt,
    });
    expect(second.shouldAct).toBe(true);
    expect(second.nextWindowPressesMs).toEqual([]);
  });

  it("ignores echo presses within MIN_INTER_PRESS", () => {
    const t0 = 500;
    const echo = t0 + CAPS_MIN_INTER_PRESS_MS - 5;
    const first = evaluateCapsDoubleTap({
      windowPressesMs: [],
      now: t0,
      lastAcceptedPressAt: -Infinity,
    });
    const dup = evaluateCapsDoubleTap({
      windowPressesMs: first.nextWindowPressesMs,
      now: echo,
      lastAcceptedPressAt: first.nextLastAcceptedPressAt,
    });
    expect(dup.consumed).toBe(false);
    expect(dup.shouldAct).toBe(false);
    expect(dup.nextWindowPressesMs).toEqual([t0]);
  });

  it("does not pair across a window that is too wide", () => {
    const t0 = 2000;
    const t1 = t0 + CAPS_DOUBLE_TAP_WINDOW_MS + 50;
    const first = evaluateCapsDoubleTap({
      windowPressesMs: [],
      now: t0,
      lastAcceptedPressAt: -Infinity,
    });
    const second = evaluateCapsDoubleTap({
      windowPressesMs: first.nextWindowPressesMs,
      now: t1,
      lastAcceptedPressAt: first.nextLastAcceptedPressAt,
    });
    expect(second.shouldAct).toBe(false);
    expect(second.nextWindowPressesMs).toEqual([t1]);
  });
});
