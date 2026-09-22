export function formatThb(value: number | null | undefined): string {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
    maximumFractionDigits: 0,
  }).format(Number(value));
}

export function formatKm(value: number | string | null | undefined): string {
  if (value == null) return "—";
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (digits.length > 0) {
      const n = Number(digits);
      if (!Number.isNaN(n)) {
        return `${new Intl.NumberFormat("th-TH").format(n)} km`;
      }
    }
    return value.trim() || "—";
  }
  if (Number.isNaN(Number(value))) return "—";
  return `${new Intl.NumberFormat("th-TH").format(Number(value))} km`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("th-TH", {
      dateStyle: "medium",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
