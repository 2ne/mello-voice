import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";
import { useSurface, SurfaceProvider } from "@/lib/surface-context";
import { surfaceClasses } from "@/lib/surface-classes";

export interface ElevatedProps extends ComponentPropsWithoutRef<"div"> {
  /**
   * Steps above the current substrate; clamped so the effective level stays ≤ 8.
   * Conventional offsets: 2 — popovers/menus; 4 — dialogs / modal sheets.
   */
  offset: number;
  /** Shadow token level; defaults to the computed surface level (background depth). */
  shadowLevel?: number;
}

/** Soft perimeter; Fluid `shadow-surface-*` lifts in light — dark uses ring only (drops cleared below). */
const elevatedChrome =
  "outline-none ring-1 ring-black/[0.045] dark:ring-white/[0.065] dark:shadow-none";

/** See https://www.fluidfunctionalism.com/docs/surfaces */
const Elevated = forwardRef<HTMLDivElement, ElevatedProps>(
  ({ offset, shadowLevel, className, children, ...props }, ref) => {
    const substrate = useSurface();
    const level = Math.min(substrate + offset, 8);
    const shadow = shadowLevel ?? level;
    return (
      <SurfaceProvider value={level}>
        <div ref={ref} className={cn(surfaceClasses(level, shadow), elevatedChrome, className)} {...props}>
          {children}
        </div>
      </SurfaceProvider>
    );
  },
);

Elevated.displayName = "Elevated";

export { Elevated };
