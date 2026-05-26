import { cn } from "@/lib/utils";
import { overlayListeningStopHint } from "@/dictationShortcut";
import { useEffect, useRef } from "react";

const overlayIdleBarBase =
  "w-[0.1875rem] shrink-0 rounded-full animate-[mello-logo-bar-breathe_1.28s_var(--ease-opacity-breathe)_infinite] motion-reduce:animate-none motion-reduce:opacity-100";

type OverlayState = "idle" | "listening" | "processing" | "error";

interface FloatingOverlayProps {
  state: OverlayState;
  shortcutLabel: string;
  audioLevel?: number;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
}

const AUDIO_METER_SAMPLE_MS = 48;
const AUDIO_METER_SPEED_PX_PER_MS = 0.096;
const AUDIO_METER_EDGE_BUFFER_PX = 24;
const AUDIO_METER_BAR_WIDTH = 3;
const AUDIO_METER_MIN_BAR_HEIGHT = 3;
const AUDIO_METER_MAX_BAR_HEIGHT = 35;

type AudioMeterSample = {
  level: number;
  time: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function audioBarHeight(level: number): number {
  const normalized = clamp01(level);
  const eased = Math.pow(normalized, 0.55);
  return Math.round(
    AUDIO_METER_MIN_BAR_HEIGHT +
      eased * (AUDIO_METER_MAX_BAR_HEIGHT - AUDIO_METER_MIN_BAR_HEIGHT),
  );
}

function fillRoundedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const radius = Math.min(width, height) / 2;
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fill();
}

function syncAudioMeterCanvas(canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return null;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, width: rect.width, height: rect.height };
}

function seedAudioMeterSilence(samples: AudioMeterSample[], now: number, width: number) {
  const maxAgeMs = (width + AUDIO_METER_EDGE_BUFFER_PX) / AUDIO_METER_SPEED_PX_PER_MS;
  for (let time = now - maxAgeMs; time <= now; time += AUDIO_METER_SAMPLE_MS) {
    samples.push({ level: 0, time });
  }
}

function drawAudioMeterFrame(
  canvas: HTMLCanvasElement,
  samples: AudioMeterSample[],
  now: number,
) {
  const metrics = syncAudioMeterCanvas(canvas);
  if (!metrics) return;

  const { ctx, width, height } = metrics;
  if (samples.length === 0) {
    seedAudioMeterSilence(samples, now, width);
  }

  const maxAgeMs = (width + AUDIO_METER_EDGE_BUFFER_PX) / AUDIO_METER_SPEED_PX_PER_MS;
  const firstLiveSample = samples.findIndex((sample) => now - sample.time <= maxAgeMs);
  if (firstLiveSample > 0) {
    samples.splice(0, firstLiveSample);
  }

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = getComputedStyle(canvas).color;

  for (const sample of samples) {
    const x = width - (now - sample.time) * AUDIO_METER_SPEED_PX_PER_MS;
    if (x < -AUDIO_METER_BAR_WIDTH || x > width + AUDIO_METER_BAR_WIDTH) continue;

    const normalized = clamp01(sample.level);
    const barHeight = audioBarHeight(normalized);
    const y = (height - barHeight) / 2;
    ctx.globalAlpha = normalized <= 0 ? 0.22 : 0.34 + normalized * 0.4;
    fillRoundedBar(ctx, x, y, AUDIO_METER_BAR_WIDTH, barHeight);
  }

  ctx.globalAlpha = 1;
}

function AudioMeter({ level }: { level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestLevelRef = useRef(0);
  const smoothedLevelRef = useRef(0);
  const samplesRef = useRef<AudioMeterSample[]>([]);
  const lastSampleAtRef = useRef(0);

  useEffect(() => {
    latestLevelRef.current = clamp01(level);
  }, [level]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationFrame = 0;
    const resizeObserver = new ResizeObserver(() => {
      syncAudioMeterCanvas(canvas);
    });
    resizeObserver.observe(canvas);

    const pushMeterSamples = (now: number) => {
      if (lastSampleAtRef.current === 0) {
        lastSampleAtRef.current = now;
      }

      while (now - lastSampleAtRef.current >= AUDIO_METER_SAMPLE_MS) {
        lastSampleAtRef.current += AUDIO_METER_SAMPLE_MS;
        const target = latestLevelRef.current;
        const current = smoothedLevelRef.current;
        const mix = target > current ? 0.58 : 0.3;
        const next = current + (target - current) * mix;
        smoothedLevelRef.current = next < 0.01 ? 0 : next;
        samplesRef.current.push({
          level: smoothedLevelRef.current,
          time: lastSampleAtRef.current,
        });
      }
    };

    const render = (now: number) => {
      pushMeterSamples(now);
      drawAudioMeterFrame(canvas, samplesRef.current, now);
      animationFrame = window.requestAnimationFrame(render);
    };

    animationFrame = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div
      className="floating-overlay-audio-meter -mx-5 h-11 w-[calc(100%+2.5rem)] min-w-0 overflow-hidden"
      role="img"
      aria-label="Listening"
    >
      <canvas ref={canvasRef} className="block h-full w-full text-overlay-chrome-fg" aria-hidden />
    </div>
  );
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

/**
 * Lane floors per state. These deliberately SNAP between class changes; transitioning
 * `min-height` here causes two visible bugs because the chrome's expanded variant snaps
 * its own `min-height` / `padding-block` (see the `data-chrome-variant="expanded"` rule
 * in style.css and its "Ready slides upward" comment):
 *   - idle→listening: the listening label wipes in through the lane's `overflow-hidden`
 *     as the lane grows from 20px to 44px.
 *   - listening→processing: chrome padding snaps 12→24 while the lane min-height still
 *     animates 44→32, so chrome height briefly bulges to `24 + 44 = 68` before settling.
 * If a future change re-enables tweening on the chrome expanded variant, animating these
 * lane min-heights becomes safe again.
 */
const STATUS_LANE_MINI_H = "min-h-5"; /* 20px — fits inside min-h-7 + p-0 mini pill */
const STATUS_LANE_EXPANDED_H = "min-h-8"; /* 32px — spinner + one line */

/** Listening hint + transcript share this minimum so chrome height stays stable when text appears. */
const LISTENING_EXPANDED_BODY_MIN = "min-h-11"; /* 44px */

function FloatingOverlay({
  state,
  shortcutLabel,
  audioLevel = 0,
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

  /** Echo empty-history hint while mic is live but Whisper has not emitted text yet. */
  const showListeningStopHint =
    state === "listening" && !hasError && trimmedFinal.length === 0 && trimmedInterim.length === 0;
  const showListeningMeter = showListeningStopHint;

  const listeningLayout = state === "listening";

  const flowingBodyClasses = cn(
    "floating-overlay-body relative z-[1] w-full min-w-0 shrink px-0.5 text-left text-base font-medium leading-snug tracking-[-0.01em]",
    "break-words [overflow-wrap:anywhere] [word-break:break-word]",
  );

  return (
    <div
      data-chrome-variant={isMiniLayout ? "mini" : "expanded"}
      className={cn(
        "floating-overlay floating-overlay-chrome pointer-events-auto relative mx-auto flex w-full cursor-grab select-none overflow-hidden shadow-none ring-0 outline-none active:cursor-grabbing",
        "bg-overlay-chrome-bg text-overlay-chrome-fg",
        isMiniLayout &&
          "size-7 min-h-7 flex-col items-center justify-center rounded-full p-0",
        !isMiniLayout &&
          cn(
            "w-full flex-col items-stretch justify-center rounded-[28px] px-5",
            listeningLayout ? "min-h-[52px] py-1.5" : "min-h-[56px] py-3",
          ),
      )}
    >
      {transcriptPrimary ? (
        <div
          aria-live="polite"
          className={cn(
            flowingBodyClasses,
            "text-overlay-chrome-fg",
            /* `flex` centers vertically; final + interim must sit inside one child or each <span> becomes its own column. */
            state === "listening" && cn(LISTENING_EXPANDED_BODY_MIN, "flex items-center"),
          )}
        >
          <span className="block min-w-0 w-full">{transcriptInline}</span>
        </div>
      ) : hasError ? (
        <div aria-live="polite" className={cn(flowingBodyClasses, "text-destructive")}>
          {error}
        </div>
      ) : (
        <div
          className={cn(
            "floating-overlay-status-lane floating-overlay-body relative w-full shrink-0 overflow-hidden",
            isMiniLayout ? STATUS_LANE_MINI_H : showListeningStopHint ? LISTENING_EXPANDED_BODY_MIN : STATUS_LANE_EXPANDED_H,
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
            ) : showListeningMeter ? (
              <AudioMeter level={audioLevel} />
            ) : (
              <div
                aria-live={
                  state === "processing" || state === "listening"
                    ? "polite"
                    : "off"
                }
                className={cn(
                  /* Keep the listening label + hint on single lines throughout the chrome's
                   * width animation (28px → 340px / 340px → 28px). Without this, the hint
                   * the double-tap stop hint wraps to 3-4 lines at intermediate widths,
                   * overflows the lane's 44px overflow-hidden frame, then unwraps when the
                   * chrome reaches full width — visible as reflowing and white space inside
                   * the pill during the open transition. With nowrap the text just gets
                   * horizontally clipped by the lane and reveals symmetrically from center
                   * as the chrome widens. */
                  "whitespace-nowrap",
                  /* Fade the "Listening…" label + hint in only once the chrome has grown
                   * to its full width. Class is conditional on state === "listening" so the
                   * enter animation only runs on the fresh mount for idle→listening; it's a
                   * no-op for listening↔processing because the wrapper stays mounted (just
                   * its content swaps) and for the close animation because the wrapper
                   * unmounts (nothing to animate). See src/style.css. */
                  state === "listening" && "floating-overlay-listening-fade-in",
                  showListeningStopHint &&
                    "flex min-h-full flex-col items-center justify-center gap-1 text-center",
                )}
              >
                <p
                  className={cn(
                    "floating-overlay-status-label font-medium tracking-[-0.01em] text-overlay-chrome-fg-muted transition-none",
                    isMiniLayout && "max-w-full shrink-0 text-center text-xs",
                    !isMiniLayout && "text-base leading-snug",
                    !isMiniLayout && alignTranscript && state !== "processing" && "min-w-0 flex-1 text-left",
                    !isMiniLayout &&
                      expandedCenterRow &&
                      !showListeningStopHint &&
                      "min-w-0 max-w-full truncate text-center",
                  )}
                >
                  {getStateLabel(state)}
                </p>
                {showListeningStopHint ? (
                  <p className="floating-overlay-status-label max-w-full px-1 text-center text-xs font-normal leading-snug tracking-[-0.01em] text-overlay-chrome-fg-muted opacity-90">
                    {overlayListeningStopHint(shortcutLabel)}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default FloatingOverlay;
