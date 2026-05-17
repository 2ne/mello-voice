import { cn } from "@/lib/utils";

const overlayIdleBarBase =
  "w-[0.1875rem] shrink-0 rounded-full animate-[mello-logo-bar-breathe_1.28s_var(--ease-opacity-breathe)_infinite] motion-reduce:animate-none motion-reduce:opacity-100";

type OverlayState = "idle" | "listening" | "processing" | "error";

interface FloatingOverlayProps {
  state: OverlayState;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
}

function getStateLabel(state: OverlayState): string {
  switch (state) {
    case "listening":
      return "Listening…";
    case "processing":
      return "Processing…";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

/** Fixed lane when showing idle mark / status text / Processing — keeps vertical alignment stable during chrome morphs. */
const STATUS_LANE_MINI_H = "h-5"; /* 20px — fits inside min-h-7 + py-1 mini pill */
const STATUS_LANE_EXPANDED_H = "h-8"; /* 32px — spinner + one line */

function FloatingOverlay({
  state,
  interimTranscript,
  finalTranscript,
  error,
}: FloatingOverlayProps) {
  const trimmedFinal = finalTranscript.trim();
  const trimmedInterim = interimTranscript.trim();

  /** Final + interim styled together — grows with overlay height (no inner scroll). */
  const transcriptInline = !(error ?? null)
    ? (() => {
        if (!trimmedFinal && !trimmedInterim) return null;
        if (trimmedFinal && trimmedInterim) {
          return (
            <>
              <span className="text-overlay-chrome-fg">{trimmedFinal}</span>
              <span className="opacity-72">{" "}</span>
              <span className="text-overlay-chrome-fg-muted italic">{trimmedInterim}</span>
            </>
          );
        }
        if (trimmedFinal) return <>{trimmedFinal}</>;
        return <span className="text-overlay-chrome-fg-muted italic">{trimmedInterim}</span>;
      })()
    : null;

  const hasError = Boolean(error?.trim());
  const hasTranscript = !hasError && transcriptInline !== null;
  /** Dictated text replaces status labels; hidden during post-release processing so only spinner + label show. */
  const transcriptPrimary = hasTranscript && state !== "processing";

  const isMiniLayout = state === "idle";
  /** Match main: centre idle/processing/status rows; left-align only while transcript drives the row (handled above). */
  const alignTranscript = !hasError && (trimmedInterim.length > 0 || trimmedFinal.length > 0);
  const expandedCenterRow = !isMiniLayout && (!alignTranscript || state === "processing");

  /** Pulse for whole listening capture — quiet “Listening…” and live transcript */
  const listeningPulse = state === "listening";

  const flowingBodyClasses = cn(
    "relative z-[1] w-full min-w-0 shrink px-0.5 text-left text-base font-medium leading-snug tracking-[-0.01em]",
    "break-words [overflow-wrap:anywhere] [word-break:break-word]",
  );

  return (
    <div
      data-chrome-variant={isMiniLayout ? "mini" : "expanded"}
      className={cn(
        "floating-overlay floating-overlay-chrome pointer-events-auto relative mx-auto flex w-full cursor-grab select-none overflow-hidden shadow-none ring-0 outline-none active:cursor-grabbing",
        "bg-overlay-chrome-bg text-overlay-chrome-fg",
        listeningPulse && "floating-overlay-chrome-pulse floating-overlay-chrome-listening-breathe",
        isMiniLayout &&
          "size-7 min-h-7 flex-col items-center justify-center rounded-full p-0",
        !isMiniLayout && "min-h-[56px] w-full flex-col items-stretch justify-center rounded-[28px] px-5 py-3",
      )}
    >
      {transcriptPrimary ? (
        <div aria-live="polite" className={cn(flowingBodyClasses, "text-overlay-chrome-fg")}>
          {transcriptInline}
        </div>
      ) : hasError ? (
        <div aria-live="polite" className={cn(flowingBodyClasses, "text-destructive")}>
          {error}
        </div>
      ) : (
        <div
          className={cn(
            "floating-overlay-status-lane relative w-full shrink-0 overflow-hidden",
            isMiniLayout ? STATUS_LANE_MINI_H : STATUS_LANE_EXPANDED_H,
          )}
        >
          <div
            className={cn(
              "absolute inset-0 flex min-w-0 items-center gap-2.5 px-0.5",
              isMiniLayout
                ? "justify-center"
                : state === "processing" || !alignTranscript
                  ? "justify-center"
                  : "justify-start",
            )}
          >
            {state === "processing" && (
              <span
                className="size-3 shrink-0 animate-spin rounded-full border-2 border-[color:var(--overlay-spinner-track)] border-t-[color:var(--overlay-spinner-tip)]"
                aria-hidden
              />
            )}
            {state === "idle" ? (
              <div
                className="flex shrink-0 items-center justify-center gap-[0.1875rem]"
                role="img"
                aria-label={getStateLabel(state)}
              >
                <span
                  className={cn(
                    overlayIdleBarBase,
                    "h-[0.4375rem] bg-[color-mix(in_oklab,var(--overlay-chrome-fg)_52%,transparent)]",
                  )}
                />
                <span
                  className={cn(
                    overlayIdleBarBase,
                    "h-[0.875rem] bg-[color-mix(in_oklab,var(--overlay-chrome-fg)_94%,transparent)] delay-[130ms]",
                  )}
                />
                <span
                  className={cn(
                    overlayIdleBarBase,
                    "h-[0.4375rem] bg-[color-mix(in_oklab,var(--overlay-chrome-fg)_52%,transparent)] delay-[260ms]",
                  )}
                />
              </div>
            ) : (
              <p
                aria-live={
                  state === "processing" || state === "listening"
                    ? "polite"
                    : "off"
                }
                className={cn(
                  "floating-overlay-status-label font-medium leading-snug tracking-[-0.01em] text-overlay-chrome-fg-muted transition-none",
                  isMiniLayout && "max-w-full shrink-0 text-center text-xs",
                  !isMiniLayout && "text-base",
                  !isMiniLayout && alignTranscript && state !== "processing" && "min-w-0 flex-1 text-left",
                  !isMiniLayout && expandedCenterRow && "min-w-0 max-w-full truncate text-center",
                )}
              >
                {getStateLabel(state)}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FloatingOverlay;
