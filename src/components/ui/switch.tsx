"use client";

import {
  useRef,
  useState,
  useLayoutEffect,
  useCallback,
  type HTMLAttributes,
  type Ref,
} from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

interface SwitchProps extends HTMLAttributes<HTMLDivElement> {
  /** Optional; omit for control-only rows (no On/Off copy). */
  label?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
  /**
   * Use on tinted / raised shells (menus, cards) where the default off-track `--accent`
   * sits too close to the surrounding fill.
   */
  variant?: "default" | "onRaisedSurface";
  ref?: Ref<HTMLDivElement>;
}

const TRACK_WIDTH = 34;
const TRACK_HEIGHT = 20;
const THUMB_SIZE = 16;
const THUMB_OFFSET = 2;
const THUMB_TRAVEL = TRACK_WIDTH - THUMB_SIZE - THUMB_OFFSET * 2;
const PILL_EXTEND = 2;
const PRESS_EXTEND = 4;
const PRESS_SHRINK = 4;
const DRAG_DEAD_ZONE = 2;

/** Slight overshoot via linear() stops — no cubic-bezier */
const THUMB_TRANSITION =
  "transform 220ms var(--ease-switch-thumb), width 200ms var(--ease-switch-thumb), height 200ms var(--ease-switch-thumb)";

function Switch({
  label,
  checked,
  onToggle,
  disabled = false,
  variant = "default",
  className,
  ref,
  ...props
}: SwitchProps) {
    const showLabel = Boolean(label?.trim());
    const hasMounted = useRef(false);
    const [hovered, setHovered] = useState(false);
    const [pressed, setPressed] = useState(false);
    const thumbRef = useRef<HTMLSpanElement>(null);

    const dragging = useRef(false);
    const didDrag = useRef(false);
    const pointerStart = useRef<{
      clientX: number;
      originX: number;
    } | null>(null);

    const thumbWidth = pressed
      ? THUMB_SIZE + PRESS_EXTEND
      : hovered
        ? THUMB_SIZE + PILL_EXTEND
        : THUMB_SIZE;
    const thumbHeight = pressed ? THUMB_SIZE - PRESS_SHRINK : THUMB_SIZE;
    const thumbY = pressed ? THUMB_OFFSET + PRESS_SHRINK / 2 : THUMB_OFFSET;
    const extraWidth = thumbWidth - THUMB_SIZE;
    const thumbX = checked ? THUMB_OFFSET + THUMB_TRAVEL - extraWidth : THUMB_OFFSET;

    const paintThumb = useCallback(
      (x: number, y: number, w: number, h: number, animate: boolean) => {
        const el = thumbRef.current;
        if (!el) return;
        Object.assign(el.style, {
          transition: animate ? THUMB_TRANSITION : "none",
          transform: `translate3d(${x}px, ${y}px, 0)`,
          width: `${w}px`,
          height: `${h}px`,
        });
      },
      [],
    );

    useLayoutEffect(() => {
      if (dragging.current) return;
      paintThumb(thumbX, thumbY, thumbWidth, thumbHeight, hasMounted.current);
      hasMounted.current = true;
    }, [thumbX, thumbY, thumbWidth, thumbHeight, paintThumb]);

    const handlePointerDown = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        setPressed(true);
        dragging.current = false;
        didDrag.current = false;
        const originXPressed =
          checked ? THUMB_OFFSET + THUMB_TRAVEL - PRESS_EXTEND : THUMB_OFFSET;
        pointerStart.current = {
          clientX: e.clientX,
          originX: originXPressed,
        };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      },
      [disabled, checked],
    );

    const handlePointerMove = useCallback(
      (e: React.PointerEvent<HTMLDivElement>) => {
        if (!pointerStart.current) return;
        const delta = e.clientX - pointerStart.current.clientX;

        if (!dragging.current) {
          if (Math.abs(delta) < DRAG_DEAD_ZONE) return;
          dragging.current = true;
        }

        const dragMin = THUMB_OFFSET;
        const pressedThumbWidth = THUMB_SIZE + PRESS_EXTEND;
        const dragMax = TRACK_WIDTH - THUMB_OFFSET - pressedThumbWidth;
        const rawX = pointerStart.current.originX + delta;
        const x = Math.max(dragMin, Math.min(dragMax, rawX));
        const py = THUMB_OFFSET + PRESS_SHRINK / 2;
        const pw = pressedThumbWidth;
        const ph = THUMB_SIZE - PRESS_SHRINK;
        paintThumb(x, py, pw, ph, false);
      },
      [paintThumb],
    );

    const handlePointerUp = useCallback(() => {
      if (!pointerStart.current) return;
      setPressed(false);

      if (dragging.current) {
        didDrag.current = true;
        dragging.current = false;

        const el = thumbRef.current;
        let currentX = thumbX;
        if (el) {
          const m = el.style.transform.match(/translate3d\(([-0-9.]+)px/);
          if (m) currentX = Number.parseFloat(m[1]);
        }

        const dragMin = THUMB_OFFSET;
        const pressedThumbWidth = THUMB_SIZE + PRESS_EXTEND;
        const dragMax = TRACK_WIDTH - THUMB_OFFSET - pressedThumbWidth;
        const midpoint = (dragMin + dragMax) / 2;
        const shouldBeOn = currentX > midpoint;

        if (shouldBeOn !== checked) {
          onToggle();
        }
        requestAnimationFrame(() => {
          didDrag.current = false;
        });
      }

      pointerStart.current = null;
    }, [checked, onToggle, thumbX]);

    return (
      <div
        ref={ref}
        role="group"
        className={cn(
          "relative z-10 flex cursor-pointer touch-none select-none items-center",
          showLabel ? "gap-2.5 px-3 py-2" : "gap-0 p-1",
          disabled && "pointer-events-none opacity-50",
          className,
        )}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") setHovered(true);
        }}
        onPointerLeave={() => setHovered(false)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={() => {}}
        onClick={() => {
          if (disabled || didDrag.current) return;
          onToggle();
        }}
        {...props}
      >
        <SwitchPrimitive.Root
          checked={checked}
          onCheckedChange={() => {
            if (didDrag.current) return;
            onToggle();
          }}
          disabled={disabled}
          tabIndex={0}
          className={cn(
            "relative shrink-0 cursor-pointer rounded-full outline-none",
            "transition-colors duration-80 ease-[var(--ease-ui)]",
            "focus-visible:ring-1 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            variant === "onRaisedSurface" &&
              "ring-1 ring-black/[0.06] dark:ring-white/[0.10] ring-inset shadow-none dark:shadow-none",
          )}
          style={{
            width: TRACK_WIDTH,
            height: TRACK_HEIGHT,
            backgroundColor:
              variant === "onRaisedSurface"
                ? checked
                  ? hovered
                    ? "var(--primary-hover)"
                    : "var(--primary)"
                  : hovered
                    ? "color-mix(in oklab, var(--input), var(--foreground) 18%)"
                    : "var(--input)"
                : checked
                  ? hovered
                    ? "var(--primary-hover)"
                    : "var(--primary)"
                  : hovered
                    ? "var(--switch-track-off-hover)"
                    : "var(--accent)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <SwitchPrimitive.Thumb asChild>
            <span
              ref={thumbRef}
              className={cn(
                "absolute top-0 left-0 block rounded-full bg-[var(--switch-thumb)] will-change-transform",
                variant === "default" && "shadow-sm dark:shadow-none",
              )}
            />
          </SwitchPrimitive.Thumb>
        </SwitchPrimitive.Root>

        {showLabel ? (
          <span
            className={cn(
              "text-[13px] transition-[color] duration-80 ease-[var(--ease-ui)]",
              checked ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
        ) : null}
      </div>
    );
}

export { Switch };
