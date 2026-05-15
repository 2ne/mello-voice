import { afterEach, describe, expect, it, vi } from "vitest";
import { warmUpMicPermissionForWebview } from "./wavCapture";

describe("warmUpMicPermissionForWebview", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns synchronously (fire-and-forget) and never throws", () => {
    /** Suppress the dev-only warning the inner permission probe emits in the node test env (no `navigator`). */
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(warmUpMicPermissionForWebview("test-context")).toBeUndefined();
    /** Let the inner microtask + .then() chain settle so we'd see any unhandled rejection. */
    return new Promise<void>((resolve) => {
      setImmediate(() => {
        warn.mockRestore();
        resolve();
      });
    });
  });
});
