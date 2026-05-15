/** Minimal X — close affordance for drawers and sheets only. */
export function CloseIcon({
  className,
  strokeWidth = 1.5,
  size,
}: {
  className?: string;
  strokeWidth?: number;
  size?: number;
}) {
  const dim = size ?? 24;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={dim}
      height={dim}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
