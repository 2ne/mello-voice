import { afterEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS,
  FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS,
  MAX_FETCH_ATTEMPTS,
  fetchOverlayBarEnabledWithRetry,
} from "./overlayBarPrefFetch";

describe("fetchOverlayBarEnabledWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("returns first successful result immediately", async () => {
    const fn = vi.fn().mockResolvedValueOnce(true);
    await expect(fetchOverlayBarEnabledWithRetry(fn, FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS)).resolves.toBe(
      true,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries until success before exhausting attempts", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const fn = vi.fn(() => {
      calls++;
      if (calls === 1) return Promise.reject(new Error(" ipc "));
      return Promise.resolve(true);
    });

    const p = fetchOverlayBarEnabledWithRetry(fn, FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS);
    await vi.advanceTimersByTimeAsync(120);
    await expect(p).resolves.toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it(`returns FALLBACK_OVERLAY_BAR_DISABLED (${FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS}) after all retries fail`, async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new Error("no"));

    const p = fetchOverlayBarEnabledWithRetry(fn, FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS);

    await vi.advanceTimersByTimeAsync(2000);

    await expect(p).resolves.toBe(FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS);
    expect(fn).toHaveBeenCalledTimes(MAX_FETCH_ATTEMPTS);
  });

  it("honours optimistic fallback for hotkey-style reads", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fn = vi.fn().mockRejectedValue(new Error("no"));
    const p = fetchOverlayBarEnabledWithRetry(fn, FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS);
    await vi.advanceTimersByTimeAsync(2000);
    await expect(p).resolves.toBe(FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS);
  });
});
