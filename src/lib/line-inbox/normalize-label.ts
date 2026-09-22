/** Normalize for duplicate comparison */
export function normalizeLabelForMatch(s: string): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

export function tokenSet(s: string): Set<string> {
  const n = normalizeLabelForMatch(s);
  const parts = n.split(/\s+/).filter(Boolean);
  return new Set(parts);
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter += 1;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}
