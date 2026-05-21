"use client";

import {
  type ButtonHTMLAttributes,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { useShape } from "@/lib/shape-context";

const HOLD_DURATION_MS = 2000;
const HOLD_RELEASE_MS = 200;
const LABEL_IDLE = "Clear all";
const LABEL_HOLD = "Hold to clear";
const LABEL_CHAR_IN_MS = 22;
const LABEL_CHAR_OUT_MS = 14;
const LABEL_IN_BASE_DELAY_MS = 70;
const LABEL_WIDTH_MS = 260;

type HoldToClearButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children"
> & {
  onClear: () => void | Promise<void>;
};

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function resetOverlayReveal(overlay: HTMLSpanElement) {
  overlay.style.transition = "none";
  overlay.style.clipPath = "inset(0 100% 0 0)";
  void overlay.offsetHeight;
  overlay.style.transition = "";
  overlay.style.clipPath = "";
}

function AnimatedLabel({
  text,
  visible,
  className,
  instant = false,
}: {
  text: string;
  visible: boolean;
  className?: string;
  instant?: boolean;
}) {
  const reduced = prefersReducedMotion();
  const chars = text.split("");
  const animate = !reduced && !instant;

  return (
    <span
      aria-hidden={!visible}
      className={cn("inline-flex whitespace-nowrap", className)}
    >
      {chars.map((char, index) => {
        const outDelay = index * LABEL_CHAR_OUT_MS;
        const inDelay = LABEL_IN_BASE_DELAY_MS + index * LABEL_CHAR_IN_MS;

        return (
          <span
            key={`${text}-${index}`}
            className={cn(
              "inline-block will-change-[opacity,transform,filter]",
              animate
                ? "transition-[opacity,transform,filter] duration-150 ease-[var(--ease-ui-snappy)]"
                : "transition-none"
            )}
            style={
              reduced || instant
                ? {
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(-0.18em)",
                    filter: visible ? "blur(0)" : "blur(2px)",
                  }
                : {
                    transitionDelay: visible ? `${inDelay}ms` : `${outDelay}ms`,
                    opacity: visible ? 1 : 0,
                    transform: visible ? "translateY(0)" : "translateY(-0.18em)",
                    filter: visible ? "blur(0)" : "blur(2px)",
                  }
            }
          >
            {char === " " ? "\u00A0" : char}
          </span>
        );
      })}
    </span>
  );
}

function LabelTrack({
  showHoldLabel,
  lockHoldLabel,
  labelWidth,
  idleMeasureRef,
  holdMeasureRef,
  tone = "base",
}: {
  showHoldLabel: boolean;
  lockHoldLabel: boolean;
  labelWidth: number;
  idleMeasureRef?: RefObject<HTMLSpanElement | null>;
  holdMeasureRef?: RefObject<HTMLSpanElement | null>;
  tone?: "base" | "overlay";
}) {
  const reduced = prefersReducedMotion();
  const trackStyle =
    labelWidth > 0
      ? {
          width: labelWidth,
          transitionDuration:
            reduced || lockHoldLabel ? "0ms" : `${LABEL_WIDTH_MS}ms`,
        }
      : undefined;

  return (
    <>
      <span
        className="hold-to-clear__label-track relative inline-block overflow-hidden align-top"
        style={trackStyle}
      >
        <span className="relative block h-[1.25em]">
          <span className="absolute left-0 top-0 inline-flex items-center">
            <AnimatedLabel
              text={LABEL_IDLE}
              visible={!showHoldLabel}
              instant={lockHoldLabel}
              className={
                tone === "overlay"
                  ? "text-primary-foreground"
                  : showHoldLabel
                    ? "text-destructive"
                    : undefined
              }
            />
          </span>
          <span className="absolute left-0 top-0 inline-flex items-center">
            <AnimatedLabel
              text={LABEL_HOLD}
              visible={showHoldLabel}
              instant={lockHoldLabel}
              className={
                tone === "overlay"
                  ? "text-primary-foreground"
                  : showHoldLabel
                    ? "text-destructive"
                    : undefined
              }
            />
          </span>
        </span>
      </span>

      {idleMeasureRef && holdMeasureRef ? (
        <span aria-hidden className="pointer-events-none absolute h-0 w-0 overflow-hidden">
          <span ref={idleMeasureRef} className="inline-block whitespace-nowrap">
            {LABEL_IDLE}
          </span>
          <span ref={holdMeasureRef} className="inline-block whitespace-nowrap">
            {LABEL_HOLD}
          </span>
        </span>
      ) : null}
    </>
  );
}

function HoldToClearButton({
  onClear,
  className,
  disabled,
  ...props
}: HoldToClearButtonProps) {
  const shape = useShape();
  const overlayRef = useRef<HTMLSpanElement>(null);
  const idleMeasureRef = useRef<HTMLSpanElement>(null);
  const holdMeasureRef = useRef<HTMLSpanElement>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [holding, setHolding] = useState(false);
  const [labelWidths, setLabelWidths] = useState({ idle: 0, hold: 0 });
  const holdTimerRef = useRef<number | null>(null);
  const clearingRef = useRef(false);
  const holdLabelWasVisibleRef = useRef(false);

  const showHoldLabel = hovered || focused || holding;
  const labelWidth = showHoldLabel ? labelWidths.hold : labelWidths.idle;

  if (showHoldLabel && !holding) {
    holdLabelWasVisibleRef.current = true;
  } else if (!showHoldLabel) {
    holdLabelWasVisibleRef.current = false;
  }

  const lockHoldLabel = holdLabelWasVisibleRef.current && holding;

  const measureLabelWidths = useCallback(() => {
    const idle = idleMeasureRef.current?.offsetWidth ?? 0;
    const hold = holdMeasureRef.current?.offsetWidth ?? 0;
    if (idle > 0 && hold > 0) {
      setLabelWidths({ idle, hold });
    }
  }, []);

  useLayoutEffect(() => {
    measureLabelWidths();
  }, [measureLabelWidths]);

  useEffect(() => {
    const observer = new ResizeObserver(measureLabelWidths);
    if (idleMeasureRef.current) observer.observe(idleMeasureRef.current);
    if (holdMeasureRef.current) observer.observe(holdMeasureRef.current);
    return () => observer.disconnect();
  }, [measureLabelWidths]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current != null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const endHold = useCallback(() => {
    clearHoldTimer();
    setHolding(false);
  }, [clearHoldTimer]);

  const startHold = useCallback(() => {
    if (disabled || clearingRef.current) return;

    clearHoldTimer();

    const overlay = overlayRef.current;
    if (overlay) resetOverlayReveal(overlay);

    setHolding(true);

    const duration = prefersReducedMotion() ? 1 : HOLD_DURATION_MS;

    holdTimerRef.current = window.setTimeout(() => {
      holdTimerRef.current = null;
      clearingRef.current = true;
      setHolding(false);
      void Promise.resolve(onClear()).finally(() => {
        clearingRef.current = false;
      });
    }, duration);
  }, [clearHoldTimer, disabled, onClear]);

  useEffect(() => clearHoldTimer, [clearHoldTimer]);

  return (
    <button
      type="button"
      className={cn(
        "hold-to-clear group relative isolate inline-flex h-7 items-center justify-center px-3 text-sm",
        "touch-manipulation select-none outline-none",
        "text-muted-foreground transition-[transform,background-color] duration-80",
        showHoldLabel && "hold-to-clear--show-hold bg-destructive/10",
        holding && "hold-to-clear--holding bg-destructive/10",
        showHoldLabel && !holding && "text-destructive",
        "disabled:pointer-events-none disabled:opacity-50",
        holding && "hold-to-clear--holding",
        shape.button,
        className
      )}
      disabled={disabled}
      aria-label={`${LABEL_IDLE}. ${LABEL_HOLD} to confirm.`}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        endHold();
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        startHold();
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        endHold();
      }}
      onPointerCancel={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        endHold();
      }}
      onKeyDown={(event) => {
        if (disabled || clearingRef.current) return;
        if (event.key !== " " && event.key !== "Enter") return;
        if (event.repeat) return;
        event.preventDefault();
        startHold();
      }}
      onKeyUp={(event) => {
        if (event.key !== " " && event.key !== "Enter") return;
        endHold();
      }}
      onContextMenu={(event) => event.preventDefault()}
      {...props}
    >
      <span
        ref={overlayRef}
        aria-hidden
        className={cn(
          "hold-to-clear__overlay absolute inset-0 inline-flex items-center justify-center rounded-[inherit]",
          shape.button
        )}
      >
        <LabelTrack
          showHoldLabel={showHoldLabel}
          lockHoldLabel={lockHoldLabel}
          labelWidth={labelWidth}
          tone="overlay"
        />
      </span>

      <LabelTrack
        showHoldLabel={showHoldLabel}
        lockHoldLabel={lockHoldLabel}
        labelWidth={labelWidth}
        idleMeasureRef={idleMeasureRef}
        holdMeasureRef={holdMeasureRef}
      />
    </button>
  );
}

export {
  HoldToClearButton,
  HOLD_DURATION_MS,
  HOLD_RELEASE_MS,
  LABEL_HOLD,
  LABEL_IDLE,
};
