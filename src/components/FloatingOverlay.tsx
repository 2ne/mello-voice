import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type OverlayState = "idle" | "listening" | "transcribing" | "processing" | "error";

interface FloatingOverlayProps {
  state: OverlayState;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  inlineHideOpen: boolean;
  onBarContextMenu: (e: React.MouseEvent) => void;
  onHideDictationBar: () => void;
}

function FloatingOverlay({
  state,
  interimTranscript,
  finalTranscript,
  error,
  inlineHideOpen,
  onBarContextMenu,
  onHideDictationBar,
}: FloatingOverlayProps) {
  const [hovered, setHovered] = useState(false);
  const displayText = error ?? (finalTranscript || interimTranscript || getStateLabel(state));
  const alignTranscript =
    !error && (interimTranscript.trim().length > 0 || finalTranscript.trim().length > 0);

  const isMiniLayout = state === "idle" && !inlineHideOpen;
  const isActivePulse = state !== "idle" && state !== "processing" && !inlineHideOpen;
  /** Match main `data-align="center"`: centre status/errors; left-align live dictation only */
  const expandedCenterRow = !isMiniLayout && !alignTranscript;

  return (
    <div
      onContextMenu={onBarContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={
        isActivePulse ? { animation: "overlay-chrome-pulse 1.2s ease-in-out infinite" } : undefined
      }
      className={cn(
        "floating-overlay relative mx-auto flex w-full overflow-hidden shadow-none ring-0 outline-none",
        "border border-solid bg-overlay-chrome-bg text-overlay-chrome-fg",
        "border-[color:var(--overlay-chrome-border)]",
        inlineHideOpen
          ? "transition-none"
          : isMiniLayout
            ? "[transition-property:width,min-height,padding,border-color,background-color] duration-200 ease-out"
            : "transition-[border-color] duration-200",
        isMiniLayout
          ? "min-h-7 w-[120px] items-center justify-center rounded-full px-3 py-1"
          : cn(
              "min-h-[56px] w-full flex-col rounded-[28px] border-[color:var(--overlay-chrome-border-expanded)] px-5 py-3",
              inlineHideOpen ? "justify-start" : "justify-center",
            ),
        isMiniLayout &&
          hovered &&
          "w-[240px] min-h-10 border-[color:var(--overlay-chrome-border-hover)] bg-[color:color-mix(in_oklab,var(--overlay-chrome-bg)_93%,var(--overlay-chrome-fg)_7%)] px-4 py-2",
        error && "border-destructive/40",
      )}
    >
      <div
        className={cn(
          "flex max-w-full items-center gap-2.5",
          isMiniLayout ? "w-full justify-center" : alignTranscript ? "w-full justify-start" : "justify-center",
        )}
      >
        {state === "processing" && (
          <span
            className="size-3 shrink-0 animate-spin rounded-full border-2 border-[color:var(--overlay-spinner-track)] border-t-[color:var(--overlay-spinner-tip)]"
            aria-hidden
          />
        )}
        <p
          className={cn(
            "text-[13px] font-medium leading-snug tracking-[-0.01em] text-overlay-chrome-fg-muted",
            isMiniLayout && "max-w-full shrink-0 text-center text-[12px]",
            isMiniLayout && hovered && "text-[13px]",
            !isMiniLayout && alignTranscript && "min-w-0 flex-1 text-left",
            !isMiniLayout && expandedCenterRow && "min-w-0 max-w-full text-center",
            error && "text-destructive",
          )}
        >
          {displayText}
        </p>
      </div>

      {inlineHideOpen ? (
        <div className="mt-2.5 w-full">
          <Button
            type="button"
            variant="overlay"
            size="sm"
            className="h-8 w-full text-[12px] font-medium"
            onClick={onHideDictationBar}
          >
            Hide dictation bar
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function getStateLabel(state: OverlayState): string {
  switch (state) {
    case "listening":
      return "Listening…";
    case "transcribing":
      return "Listening…";
    case "processing":
      return "Processing…";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

export default FloatingOverlay;
