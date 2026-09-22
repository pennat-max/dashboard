import type { CarsSortField, SortOrder } from "@/types/car";

const ORDERABLE_COLUMNS = new Set<string>(["updated_at", "income_date", "id", "brand", "model", "buy_price", "mileage"]);
const SORT_LEGACY: Record<string, CarsSortField> = {
  created_at: "updated_at", make: "brand", price_thb: "buy_price", mileage_km: "mileage", year: "id", destination_country: "updated_at",
};

export function parseSort(sort: string | undefined, order: string | undefined): { field: CarsSortField; order: SortOrder } {
  const raw = (sort ?? "").trim();
  const field = raw && SORT_LEGACY[raw]
    ? SORT_LEGACY[raw]
    : raw && ORDERABLE_COLUMNS.has(raw)
      ? raw as CarsSortField
      : "updated_at";
  return { field, order: order === "asc" ? "asc" : "desc" };
}
