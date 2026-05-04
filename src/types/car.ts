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
  bf_on_web?: string | null;
  income_date?: string | null;
  advance_date?: string | null;
  updated_at?: string | null;
  agent?: string | null;
  gear_type?: string | null;
  drive_type?: string | null;
  engine_size?: string | null;
  grade?: string | null;
  cabin?: string | null;
  shipped?: string | null;
  /** จองขนส่ง / booked shipping (sheet) */
  booked_shipping?: string | null;
  /** ผู้ซื้อ (ถ้ามีในตาราง) */
  buyer?: string | null;
  /** วันที่จอง (sheet) */
  booked_date?: string | null;
  /** sale support */
  sale_support?: string | null;
  remarks?: string | null;
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
  /** สถานะเอกสาร / เล่ม (ชีตหรือคอลัมน์เสริมใน cars) */
  document_status?: string | null;
  initial_document?: string | null;
  doc_fee?: string | number | null;
  /** ต้นทุนรวม / ราคาขาย USD / ค่าซ่อม (ชีต) */
  total_cost?: string | number | null;
  sale_price_usd?: string | number | null;
  repair_cost?: string | number | null;
  repair_details?: string | null;
  part_accessories?: string | null;
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
