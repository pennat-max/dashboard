export type VehicleSearchFields = {
  plate?: unknown;
  fullPlate?: unknown;
  chassis?: unknown;
  car?: unknown;
  sale?: unknown;
  carRowId?: unknown;
  carId?: unknown;
};

export function normalizeVehicleSearchText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, "").toLowerCase();
}

export function tokenizeVehicleSearchQuery(raw: string): string[] {
  return (
    raw
      .match(/[\u0E00-\u0E7Fa-zA-Z0-9.]+/g)
      ?.map((token) => token.trim())
      .filter((token) => token && !/^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)$/i.test(token)) ?? []
  );
}

/** Shared /m/orders vehicle search predicate. */
export function matchesVehicleSearchFields(vehicle: VehicleSearchFields, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const n = normalizeVehicleSearchText(q);
  const plate = String(vehicle.plate ?? "");
  const fullPlate = String(vehicle.fullPlate ?? "");
  const chassis = String(vehicle.chassis ?? "");
  const car = String(vehicle.car ?? "");
  const haystack = [plate, fullPlate, chassis, car, vehicle.sale, vehicle.carRowId, vehicle.carId].join(" ");
  const normalizedHaystack = normalizeVehicleSearchText(haystack);
  const strongTokens = tokenizeVehicleSearchQuery(q).filter((token) => /\d{4,6}/.test(token) || token.length >= 3);
  return (
    plate.includes(q) ||
    fullPlate.includes(q) ||
    normalizeVehicleSearchText(plate).includes(n) ||
    normalizeVehicleSearchText(fullPlate).includes(n) ||
    normalizeVehicleSearchText(chassis).includes(n) ||
    car.toLowerCase().includes(q.toLowerCase()) ||
    normalizedHaystack.includes(n) ||
    strongTokens.some((token) => /\d{4,6}/.test(token) && normalizedHaystack.includes(normalizeVehicleSearchText(token))) ||
    (strongTokens.length >= 2 && strongTokens.every((token) => normalizedHaystack.includes(normalizeVehicleSearchText(token))))
  );
}

export function vehiclesMatchingQuery<T>(vehicles: T[], query: string, map: (vehicle: T) => VehicleSearchFields): T[] {
  const q = query.trim();
  if (!q) return vehicles;
  return vehicles.filter((vehicle) => matchesVehicleSearchFields(map(vehicle), q));
}
