import { useState } from "react";

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

  return (
    <div
      className="floating-overlay"
      data-state={state}
      data-mini={isMiniLayout ? "true" : "false"}
      data-hovered={isMiniLayout && hovered ? "true" : "false"}
      data-inline-hide={inlineHideOpen}
      data-align={alignTranscript ? "start" : "center"}
      onContextMenu={onBarContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="overlay-content">
        {state === "processing" && <span className="overlay-spinner" aria-hidden />}
        <p className="overlay-text">{displayText}</p>
      </div>
      {inlineHideOpen ? (
        <div className="overlay-inline-actions">
          <button type="button" className="overlay-hide-bar-btn" onClick={onHideDictationBar}>
            Hide dictation bar
          </button>
        </div>
      ) : null}
    </div>
  );
}

function getStateLabel(state: OverlayState): string {
  switch (state) {
    case "listening":
      return "Listening...";
    case "transcribing":
      return "Listening...";
    case "processing":
      return "Processing...";
    case "error":
      return "Error";
    default:
      return "Ready";
  }
}

export default FloatingOverlay;
