import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type OverlayState = "idle" | "listening" | "processing" | "error";

interface FloatingOverlayProps {
  state: OverlayState;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  inlineHideOpen: boolean;
  /** Opens/closes inline actions on left-click or right-click (context menu). */
  onBarToggleHideMenu: (e: React.MouseEvent) => void;
  onHideDictationBar: () => void;
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

/** Fixed lane when showing Ready / Processing — keeps vertical alignment stable during chrome morphs. */
const STATUS_LANE_MINI_H = "h-5"; /* 20px — fits inside min-h-7 + py-1 mini pill */
const STATUS_LANE_EXPANDED_H = "h-8"; /* 32px — spinner + one line */

function FloatingOverlay({
  state,
  interimTranscript,
  finalTranscript,
  error,
  inlineHideOpen,
  onBarToggleHideMenu,
  onHideDictationBar,
}: FloatingOverlayProps) {
  const [hovered, setHovered] = useState(false);
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

  const idleMenuOpen = state === "idle" && inlineHideOpen;
  const isMiniLayout = state === "idle" && !inlineHideOpen;
  const showHideSlot = idleMenuOpen || state !== "idle";
  /** Match main: centre idle/processing/status rows; left-align only while transcript drives the row (handled above). */
  const alignTranscript = !hasError && (trimmedInterim.length > 0 || trimmedFinal.length > 0);
  const expandedCenterRow = !isMiniLayout && (!alignTranscript || state === "processing");

  /** Pulse for whole listening capture — quiet “Listening…” and live transcript */
  const listeningPulse = state === "listening" && !inlineHideOpen;

  const flowingBodyClasses = cn(
    "relative z-[1] w-full min-w-0 shrink px-0.5 text-left text-[13px] font-medium leading-snug tracking-[-0.01em]",
    "break-words [overflow-wrap:anywhere] [word-break:break-word]",
  );

  return (
    <div
      role="presentation"
      onClick={onBarToggleHideMenu}
      onContextMenu={onBarToggleHideMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-chrome-variant={isMiniLayout ? "mini" : idleMenuOpen ? "idle-menu" : "expanded"}
      className={cn(
        "floating-overlay floating-overlay-chrome relative mx-auto flex w-full cursor-pointer select-none overflow-hidden shadow-none ring-0 outline-none",
        "border border-solid bg-overlay-chrome-bg text-overlay-chrome-fg",
        "border-[color:var(--overlay-chrome-border)]",
        listeningPulse && "floating-overlay-chrome-pulse floating-overlay-chrome-listening-breathe",
        isMiniLayout &&
          cn(
            "min-h-7 w-[120px] flex-col justify-center rounded-full px-3 py-1",
            hovered &&
              "w-[240px] min-h-10 border-[color:var(--overlay-chrome-border-hover)] bg-[color:color-mix(in_oklab,var(--overlay-chrome-bg)_93%,var(--overlay-chrome-fg)_7%)] px-4 py-2",
          ),
        idleMenuOpen &&
          cn(
            "w-[min(260px,calc(100vw-16px))] flex-col items-stretch justify-start rounded-full px-4 py-2",
            "border-[color:var(--overlay-chrome-border)]",
          ),
        !isMiniLayout &&
          !idleMenuOpen &&
          cn(
            "min-h-[56px] w-full flex-col items-stretch rounded-[28px] border-[color:var(--overlay-chrome-border-expanded)] px-5 py-3",
            inlineHideOpen ? "justify-start" : "justify-center",
          ),
        error && "border-destructive/40",
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
            isMiniLayout || idleMenuOpen ? STATUS_LANE_MINI_H : STATUS_LANE_EXPANDED_H,
          )}
        >
          <div
            className={cn(
              "absolute inset-0 flex min-w-0 items-center gap-2.5 px-0.5",
              isMiniLayout || idleMenuOpen
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
            <p
              aria-live={
                state === "processing" || state === "listening"
                  ? "polite"
                  : "off"
              }
              className={cn(
                "floating-overlay-status-label font-medium leading-snug tracking-[-0.01em] text-overlay-chrome-fg-muted transition-none",
                isMiniLayout && "max-w-full shrink-0 text-center text-[12px]",
                isMiniLayout && hovered && "text-[13px]",
                idleMenuOpen && "max-w-full shrink-0 text-center text-[13px]",
                !isMiniLayout && !idleMenuOpen && "text-[13px]",
                !isMiniLayout && !idleMenuOpen && alignTranscript && state !== "processing" && "min-w-0 flex-1 text-left",
                !isMiniLayout && !idleMenuOpen && expandedCenterRow && "min-w-0 max-w-full truncate text-center",
              )}
            >
              {getStateLabel(state)}
            </p>
          </div>
        </div>
      )}

      {showHideSlot ? (
        <div
          className="floating-overlay-hide-slot w-full"
          data-expanded={inlineHideOpen ? true : undefined}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="floating-overlay-hide-slot-inner">
            <div className="floating-overlay-hide-actions w-full">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 w-full justify-center text-[12px] text-muted-foreground hover:text-destructive"
                onClick={(e) => {
                  e.stopPropagation();
                  onHideDictationBar();
                }}
              >
                Hide dictation bar
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default FloatingOverlay;