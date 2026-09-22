export type VehicleSearchRecord = {
  plate?: unknown;
  fullPlate?: unknown;
  chassis?: unknown;
  car?: unknown;
  plate_number?: unknown;
  chassis_number?: unknown;
  spec?: unknown;
  brand?: unknown;
  model?: unknown;
  model_year?: unknown;
  c_year?: unknown;
  color?: unknown;
  sale_support?: unknown;
};

export function normalizeVehicleSearchText(value: unknown): string {
  return String(value || "").replace(/\s+/g, "").toLowerCase();
}

function vehicleSearchHaystack(record: VehicleSearchRecord): string {
  const car =
    record.car ??
    [
      record.brand,
      record.model,
      record.model_year,
      record.c_year,
      record.spec,
      record.color,
      record.sale_support,
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean)
      .join(" ");

  return [
    record.plate ?? record.plate_number,
    record.fullPlate ?? record.plate_number,
    record.chassis ?? record.chassis_number,
    car,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function vehicleMatchesOrderSearch(record: VehicleSearchRecord, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  const n = normalizeVehicleSearchText(q);
  const plate = String(record.plate ?? record.plate_number ?? "").trim();
  const fullPlate = String(record.fullPlate ?? record.plate_number ?? "").trim();
  const chassis = String(record.chassis ?? record.chassis_number ?? "").trim();
  const car = String(
    record.car ??
      [
        record.brand,
        record.model,
        record.model_year,
        record.c_year,
        record.spec,
        record.color,
        record.sale_support,
      ]
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join(" ")
  );
  const normalizedHaystack = normalizeVehicleSearchText(vehicleSearchHaystack(record));
  const tokens =
    q
      .match(/[\u0E00-\u0E7Fa-zA-Z0-9.]+/g)
      ?.map((token) => token.trim())
      .filter((token) => token && !/^(?:ทะเบียน|เลขทะเบียน|stock|สต็อก|สต๊อก|ref|reference)$/i.test(token)) ?? [];
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

export function deriveVehicleSearchQueryFromLineText(input: {
  rawText?: unknown;
  aiTargetCarReference?: unknown;
  candidateTexts?: unknown[];
}): string {
  const candidates = [
    input.aiTargetCarReference,
    ...(input.candidateTexts ?? []),
    input.rawText,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  for (const candidate of candidates) {
    const mileageRef = candidate.match(
      /^\s*(\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}|\d{4,6})\s*(?:[-\u2013\u2014:]|\s)\s*(?:\d{2,3}(?:,\d{3})|\d{4,6})\s*(?:km|kms|\u0e01\u0e21\.?|\u0e01\u0e34\u0e42\u0e25)?/i
    );
    if (mileageRef?.[1]) return mileageRef[1].replace(/\s+/g, "");

    const explicitPlate = candidate.match(/\d{0,2}[\u0E01-\u0E2E]{1,3}[-\s]?\d{2,4}/);
    if (explicitPlate?.[0]) return explicitPlate[0].replace(/\s+/g, "");

    const numeric = candidate.match(/\b\d{4,6}\b/);
    if (numeric?.[0] && !/^(?:19|20)\d{2}$/.test(numeric[0])) return numeric[0];
  }

  return "";
}
