export function formatDuration(milliseconds = 0) {
  const seconds = Math.max(0, milliseconds) / 1000;
  if (seconds < 1) return `${Math.round(milliseconds)} ms`;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

export function formatTimestamp(timestamp) {
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

export function shortText(text, maximum = 64) {
  const compact = (text ?? "").replace(/\s+/g, " ").trim();
  return compact.length > maximum ? `${compact.slice(0, maximum - 1)}…` : compact;
}
