import type { SupabaseClient } from "@supabase/supabase-js";

const CARS_TABLE = process.env.NEXT_PUBLIC_SUPABASE_CARS_TABLE ?? "cars";

export type ResolvedCar = {
  car_row_id: string;
  plate_text: string;
  chassis: string;
  confidence: number;
};

export function extractChassisCandidates(text: string): string[] {
  const out: string[] = [];
  const re = /\b([A-HJ-NPR-Z0-9]{17})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1].toUpperCase());
  }
  return Array.from(new Set(out));
}

export async function resolveCarFromContext(
  supabase: SupabaseClient,
  opts: {
    car_row_id?: string | null;
    car_id?: number | null;
    raw_text: string;
  }
): Promise<ResolvedCar> {
  const empty: ResolvedCar = { car_row_id: "", plate_text: "", chassis: "", confidence: 0 };

  const rowIdIn = String(opts.car_row_id ?? "").trim();
  if (rowIdIn) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .eq("row_id", rowIdIn)
      .maybeSingle();
    if (data?.row_id) {
      return {
        car_row_id: String(data.row_id),
        plate_text: String(data.plate_number ?? "").trim(),
        chassis: String(data.chassis_number ?? "").trim(),
        confidence: 1,
      };
    }
  }

  const cid = opts.car_id;
  if (cid != null && Number.isFinite(Number(cid))) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .eq("id", cid)
      .maybeSingle();
    if (data?.row_id) {
      return {
        car_row_id: String(data.row_id),
        plate_text: String(data.plate_number ?? "").trim(),
        chassis: String(data.chassis_number ?? "").trim(),
        confidence: 0.95,
      };
    }
  }

  const raw = String(opts.raw_text ?? "");
  const chassisList = extractChassisCandidates(raw);
  for (const ch of chassisList) {
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .ilike("chassis_number", `%${ch}%`)
      .limit(2);
    const rows = data ?? [];
    if (rows.length === 1 && rows[0]?.row_id) {
      const r = rows[0] as { row_id?: unknown; plate_number?: unknown; chassis_number?: unknown };
      return {
        car_row_id: String(r.row_id),
        plate_text: String(r.plate_number ?? "").trim(),
        chassis: String(r.chassis_number ?? "").trim(),
        confidence: 0.85,
      };
    }
  }

  const plateMatch = raw.match(/[ก-ฮ]{1,3}[-\s]?\d{1,4}/);
  if (plateMatch) {
    const compact = plateMatch[0].replace(/\s+/g, "");
    const { data } = await supabase
      .from(CARS_TABLE)
      .select("row_id,plate_number,chassis_number")
      .or(`plate_number.ilike.%${compact}%,plate_number.ilike.%${plateMatch[0]}%`)
      .limit(5);
    const rows = data ?? [];
    if (rows.length === 1 && rows[0]?.row_id) {
      const r = rows[0] as { row_id?: unknown; plate_number?: unknown; chassis_number?: unknown };
      return {
        car_row_id: String(r.row_id),
        plate_text: String(r.plate_number ?? "").trim(),
        chassis: String(r.chassis_number ?? "").trim(),
        confidence: 0.55,
      };
    }
  }

  return empty;
}
