export const LINE_AUTO_SAVE_MAX_ITEMS = 10;

export function hasTooManyLineAutoSaveItems(count: unknown): boolean {
  const n = Number(count ?? 0);
  return Number.isFinite(n) && n >= LINE_AUTO_SAVE_MAX_ITEMS;
}
