const VEHICLE_SEARCH_STOPWORDS_RE =
  /^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)$/i;

export type VehicleSearchTarget = {
  plate?: unknown;
  fullPlate?: unknown;
  chassis?: unknown;
  car?: unknown;
};

export function normalizeVehicleSearchText(value: unknown): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

export function matchesVehicleSearch(target: VehicleSearchTarget, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const n = normalizeVehicleSearchText(q);
  const plate = String(target.plate ?? "");
  const fullPlate = String(target.fullPlate ?? "");
  const chassis = String(target.chassis ?? "");
  const car = String(target.car ?? "");
  const haystack = [plate, fullPlate, chassis, car].join(" ");
  const normalizedHaystack = normalizeVehicleSearchText(haystack);
  const tokens =
    q
      .match(/[\u0E00-\u0E7Fa-zA-Z0-9.]+/g)
      ?.map((token) => token.trim())
      .filter((token) => token && !VEHICLE_SEARCH_STOPWORDS_RE.test(token)) ?? [];
  const strongTokens = tokens.filter((token) => /\d{4,6}/.test(token) || token.length >= 3);
  return (
    plate.includes(q) ||
    fullPlate.includes(q) ||
    normalizeVehicleSearchText(chassis).includes(n) ||
    car.toLowerCase().includes(q.toLowerCase()) ||
    normalizedHaystack.includes(n) ||
    strongTokens.some((token) => /\d{4,6}/.test(token) && normalizedHaystack.includes(normalizeVehicleSearchText(token))) ||
    (strongTokens.length >= 2 && strongTokens.every((token) => normalizedHaystack.includes(normalizeVehicleSearchText(token))))
  );
}
