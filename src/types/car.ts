/**
 * แถวจาก public.cars ใน Supabase — รองรับทั้งสคีมาเดิมใน repo และสคีมาจริง (sheet/import)
 */
export type Car = {
  id: number | string;
  row_id?: string | null;
  spec?: string | null;
  status?: string | null;
  brand?: string | null;
  model?: string | null;
  model_year?: string | null;
  color?: string | null;
  plate_number?: string | null;
  mileage?: string | number | null;
  buy_price?: string | number | null;
  country?: string | null;
  destination_port?: string | null;
  chassis_number?: string | null;
  engine_number?: string | null;
  picture?: string | null;
  income_date?: string | null;
  advance_date?: string | null;
  updated_at?: string | null;
  gear_type?: string | null;
  drive_type?: string | null;
  engine_size?: string | null;
  grade?: string | null;
  shipped?: string | null;
  /** ผู้ซื้อ (ถ้ามีในตาราง) */
  buyer?: string | null;
  province?: string | null;
  c_year?: string | number | null;
  /** สคีมาเดิม (ถ้ามี view) */
  make?: string | null;
  stock_code?: string | null;
  year?: number | null;
  mileage_km?: number | null;
  price_thb?: number | null;
  fuel_type?: string | null;
  transmission?: string | null;
  destination_country?: string | null;
  vin?: string | null;
  image_url?: string | null;
  notes?: string | null;
  created_at?: string;
};

export type CarsSortField =
  | "updated_at"
  | "income_date"
  | "id"
  | "brand"
  | "model"
  | "buy_price"
  | "mileage";

export type SortOrder = "asc" | "desc";
