import { parseSort } from "@/lib/data/cars";
import type { Car, CarsSortField } from "@/types/car";

export type CarsInventoryFilterState = {
  q: string;
  brand: string[];
  status: string;
  destination: string;
  driveType: string[];
  engineSize: string[];
  gearType: string[];
  cabin: string[];
  color: string[];
  cYear: string[];
  sort: string;
  order: string;
};

export const DEFAULT_CARS_INVENTORY_FILTERS: CarsInventoryFilterState = {
  q: "",
  brand: [],
  status: "all",
  destination: "all",
  driveType: [],
  engineSize: [],
  gearType: [],
  cabin: [],
  color: [],
  cYear: [],
  sort: "updated_at",
  order: "desc",
};

function parseMulti(raw?: string | null): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s && s !== "all");
}

export function carsInventoryStateFromSearchParams(
  sp: Record<string, string | string[] | undefined>
): CarsInventoryFilterState {
  const first = (k: string): string | undefined => {
    const v = sp[k];
    return Array.isArray(v) ? v[0] : v;
  };
  return {
    q: first("q")?.trim() ?? "",
    brand: parseMulti(first("brand")),
    status: first("status")?.trim() || "all",
    destination: first("destination")?.trim() || "all",
    driveType: parseMulti(first("driveType")),
    engineSize: parseMulti(first("engineSize")),
    gearType: parseMulti(first("gearType")),
    cabin: parseMulti(first("cabin")),
    color: parseMulti(first("color")),
    cYear: parseMulti(first("cYear")),
    sort: first("sort")?.trim() || DEFAULT_CARS_INVENTORY_FILTERS.sort,
    order: first("order")?.trim() || DEFAULT_CARS_INVENTORY_FILTERS.order,
  };
}

function fieldIncludes(car: Car, search: string): boolean {
  const parts = [
    car.brand,
    car.model,
    car.chassis_number,
    car.plate_number,
    car.spec,
  ]
    .map((x) => String(x ?? "").toLowerCase());
  return parts.some((p) => p.includes(search));
}

function matchesDestination(car: Car, selected: string): boolean {
  const d = selected.trim();
  const co = (car.country ?? "").trim();
  const port = (car.destination_port ?? "").trim();
  const legacy = (car.destination_country ?? "").trim();
  return co === d || port === d || legacy === d;
}

/** กรองชุดรถให้สอดคล้องกับ logic ฝั่ง Supabase (`applyCarsListFilters`) แบบคร่าวๆ */
export function filterCarsForInventory(
  cars: Car[],
  f: CarsInventoryFilterState
): Car[] {
  const search = f.q.trim().toLowerCase();
  const statuses = parseMulti(f.status === "all" ? "" : f.status);
  const brands = f.brand;
  const destinations =
    f.destination && f.destination !== "all" ? [f.destination.trim()] : [];
  const driveTypes = f.driveType;
  const engineSizes = f.engineSize;
  const gearTypes = f.gearType;
  const cabins = f.cabin;
  const colors = f.color;
  const cYears = f.cYear;

  return cars.filter((car) => {
    if (search && !fieldIncludes(car, search)) return false;

    if (statuses.length > 0) {
      const s = (car.status ?? "").trim();
      if (!statuses.includes(s)) return false;
    }

    if (brands.length > 0) {
      const b = (car.brand ?? "").trim();
      if (!brands.includes(b)) return false;
    }

    if (destinations.length > 0) {
      const ok = destinations.some((d) => matchesDestination(car, d));
      if (!ok) return false;
    }

    if (driveTypes.length > 0) {
      const v = (car.drive_type ?? "").trim();
      if (!driveTypes.includes(v)) return false;
    }
    if (engineSizes.length > 0) {
      const v = (car.engine_size ?? "").trim();
      if (!engineSizes.includes(v)) return false;
    }
    if (gearTypes.length > 0) {
      const v = (car.gear_type ?? "").trim();
      if (!gearTypes.includes(v)) return false;
    }
    if (cabins.length > 0) {
      const v = (car.cabin ?? "").trim();
      if (!cabins.includes(v)) return false;
    }
    if (colors.length > 0) {
      const v = (car.color ?? "").trim();
      if (!colors.includes(v)) return false;
    }
    if (cYears.length > 0) {
      const v = String(car.c_year ?? "").trim();
      if (!cYears.includes(v)) return false;
    }

    return true;
  });
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function strOrEmpty(v: unknown): string {
  return String(v ?? "").trim();
}

function cmpNullsLast(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
  mult: number
): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") {
    return mult * (a - b);
  }
  return mult * String(a).localeCompare(String(b), "th");
}

function parseIsoTime(s: string | null | undefined): number | null {
  if (!s?.trim()) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : t;
}

export function sortCarsForInventory(
  cars: Car[],
  sort: string | undefined,
  order: string | undefined
): Car[] {
  const { field, order: ord } = parseSort(sort, order);
  const mult: 1 | -1 = ord === "asc" ? 1 : -1;
  const out = [...cars];
  out.sort((a, b) => {
    switch (field as CarsSortField) {
      case "updated_at":
      case "income_date": {
        const ta = parseIsoTime(a[field as "updated_at" | "income_date"]);
        const tb = parseIsoTime(b[field as "updated_at" | "income_date"]);
        return cmpNullsLast(ta, tb, mult);
      }
      case "id": {
        const ai = a.id;
        const bi = b.id;
        const na = typeof ai === "number" ? ai : Number(ai);
        const nb = typeof bi === "number" ? bi : Number(bi);
        if (Number.isFinite(na) && Number.isFinite(nb)) {
          return mult * (na - nb);
        }
        return mult * String(ai).localeCompare(String(bi), "th");
      }
      case "brand":
        return cmpNullsLast(strOrEmpty(a.brand), strOrEmpty(b.brand), mult);
      case "model":
        return cmpNullsLast(strOrEmpty(a.model), strOrEmpty(b.model), mult);
      case "buy_price":
        return cmpNullsLast(carPriceLoose(a), carPriceLoose(b), mult);
      case "mileage":
        return cmpNullsLast(numOrNull(a.mileage ?? a.mileage_km), numOrNull(b.mileage ?? b.mileage_km), mult);
      default:
        return 0;
    }
  });
  return out;
}

function carPriceLoose(car: Car): number | null {
  const n = numOrNull(car.buy_price ?? car.price_thb);
  return n;
}
