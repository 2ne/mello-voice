/** Indeterminate stroke loop — `Button` loading state (`spinner-*` keyframes in `animation.css`). */
export function LoadingSpinnerIcon({
  className,
  size = 32,
}: {
  className?: string;
  /** Default 32 (Tailwind `size-8`). */
  size?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <path
        d="M 12 12 C 14 8.5 19 8.5 19 12 C 19 15.5 14 15.5 12 12 C 10 8.5 5 8.5 5 12 C 5 15.5 10 15.5 12 12 Z"
        stroke="currentColor"
        strokeWidth="1.125"
        strokeLinecap="round"
        pathLength="100"
        style={{
          strokeDasharray: "15 85",
          animation:
            "spinner-move 900ms linear infinite, spinner-dash 900ms var(--ease-spinner-dash) infinite",
        }}
      />
    </svg>
  );
}
