/** A small picture for a resource: an emoji, so it needs no image files. Unknown resources get a neutral one. */
const RESOURCE_ICONS: Record<string, string> = {
  money: '🪙',
  wood: '🪵',
  iron: '⛓️',
  grain: '🌾',
  coal: '⚫',
};

export function resourceIcon(id: string): string {
  return RESOURCE_ICONS[id] ?? '📦';
}
