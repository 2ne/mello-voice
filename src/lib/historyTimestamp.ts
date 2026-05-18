/** Display timestamps for transcription history: relative for recent rows, absolute en-GB-style dates after a week.
 *  Under one minute shows "just now" (no per-second ticker); timers fire only when the label would actually change.
 */

export function formatHistoryTimestampLabel(date: Date, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const sameYear = date.getFullYear() === now.getFullYear();
  const day = date.getDate();
  const month = new Intl.DateTimeFormat("en-GB", { month: "short" }).format(date);
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameYear) return `${day} ${month}, ${clock}`;
  return `${day} ${month} ${date.getFullYear()}, ${clock}`;
}

export function formatHistoryTimestampTooltip(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

/** How long until the visible label may change; drives a lightweight timer in the UI. */
export function getHistoryTimestampRefreshMs(date: Date, now: Date): number {
  const diffMs = Math.max(0, now.getTime() - date.getTime());
  const seconds = Math.floor(diffMs / 1000);

  if (seconds < 60) {
    return Math.max(1, 60_000 - diffMs);
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    const nextBoundaryMs = (minutes + 1) * 60_000;
    return Math.max(1, nextBoundaryMs - diffMs);
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const nextBoundaryMs = (hours + 1) * 60 * 60_000;
    return Math.max(1, nextBoundaryMs - diffMs);
  }

  const days = Math.floor(hours / 24);
  if (days < 7) {
    const nextBoundaryMs = (days + 1) * 24 * 60 * 60_000;
    return Math.max(1, nextBoundaryMs - diffMs);
  }

  return 60 * 60_000;
}
