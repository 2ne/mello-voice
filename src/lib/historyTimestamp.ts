/** Display timestamps for transcription history: relative for recent rows, absolute en-GB-style dates after a week. */

export function formatHistoryTimestampLabel(date: Date, now: Date): string {
  const diffMs = now.getTime() - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s`;

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
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 1_000;
  if (seconds < 60 * 60) return 30_000;
  if (seconds < 24 * 60 * 60) return 60_000;
  if (seconds < 7 * 24 * 60 * 60) return 5 * 60_000;

  return 60 * 60_000;
}
