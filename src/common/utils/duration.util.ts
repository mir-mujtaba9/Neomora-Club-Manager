export function parseDurationToMs(value: string): number {
  // Supports: 30s, 15m, 2h, 7d
  const match = /^([0-9]+)\s*([smhd])$/i.exec(value.trim());
  if (!match) {
    // Fallback: treat as seconds if numeric
    const asNumber = Number(value);
    if (!Number.isNaN(asNumber) && asNumber > 0) {
      return asNumber * 1000;
    }
    // Default to 7 days
    return 7 * 24 * 60 * 60 * 1000;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return 7 * 24 * 60 * 60 * 1000;
  }
}
