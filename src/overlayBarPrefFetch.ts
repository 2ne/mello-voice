/** Pause (ms) after each failed `get_overlay_bar_enabled` IPC before the next attempt. */
const BACKOFF_BEFORE_RETRY_MS = [100, 300] as const;

/** Exported for tests so an intentional change to `BACKOFF_BEFORE_RETRY_MS` is one obvious edit, not a silent test churn. */
export const MAX_FETCH_ATTEMPTS = BACKOFF_BEFORE_RETRY_MS.length + 1;

/** Use when aligning main settings + overlay boot: prefer hiding the overlay and "hide when idle" UI when IPC dies. */
export const FALLBACK_OVERLAY_BAR_DISABLED_WHEN_FETCH_FAILS = false;

/** Use during hotkey handling: avoids treating a dead IPC read as "hide bar" so we do not wrongly auto-hide after a session. */
export const FALLBACK_OVERLAY_BAR_ENABLED_WHEN_FETCH_FAILS = true;

/**
 * Reads `get_overlay_bar_enabled` with backoff. IPC can be flaky during startup; never throws -
 * applies `fallbackWhenAllRetriesFail` after exhausting attempts.
 */
export async function fetchOverlayBarEnabledWithRetry(
  invokeGet: () => Promise<boolean>,
  fallbackWhenAllRetriesFail: boolean,
): Promise<boolean> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_FETCH_ATTEMPTS; attempt++) {
    try {
      return await invokeGet();
    } catch (e) {
      lastErr = e;
      const pause = BACKOFF_BEFORE_RETRY_MS[attempt];
      if (pause !== undefined) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, pause);
        });
      }
    }
  }

  if (import.meta.env.DEV) {
    console.warn("[mello] get_overlay_bar_enabled failed after retries; using fallback", lastErr);
  }

  return fallbackWhenAllRetriesFail;
}
