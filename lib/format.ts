/** Formats a byte count with binary steps, e.g. `1.5 MB`. */
export function formatBytes(value: number | string): string {
  const n = typeof value === 'number' ? value : parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

/** Formats a transfer rate, e.g. `1.5 MB/s`. */
export function formatSpeed(bytesPerSecond: number | string): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
