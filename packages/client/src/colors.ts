export const OWNER_COLORS: Record<string, string> = {
  red: '#c4524b',
  blue: '#4b7cc4',
  green: '#5aa36b',
  yellow: '#d6a13a',
};

export const NEUTRAL_COLOR = '#c8c2b0';

export function ownerColor(ownerId: string | null): string {
  if (ownerId === null) return NEUTRAL_COLOR;
  return OWNER_COLORS[ownerId] ?? '#8a8a8a';
}

/** Lightens (amount > 0) or darkens (amount < 0) a #rrggbb color. amount is in -1..1. */
export function shade(hex: string, amount: number): string {
  const channel = (start: number) => {
    const value = parseInt(hex.slice(start, start + 2), 16);
    const target = amount >= 0 ? 255 : 0;
    const mixed = Math.round(value + (target - value) * Math.abs(amount));
    return Math.max(0, Math.min(255, mixed)).toString(16).padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
