/**
 * LINE Inbox AI analysis — shared types (see LINE_INBOX_AI_ANALYSIS_PLAN.md)
 */

export type DuplicateStatus = "new" | "duplicate" | "possible_duplicate" | "unclear";

export type LineInboxAnalyzeItem = {
  raw_text: string;
  suggested_item_name: string;
  suggested_category: string;
  suggested_status: string;
  duplicate_status: DuplicateStatus;
  matched_order_item_id: string;
  matched_item_name: string;
  confidence: number;
  reason: string;
};

/** ผลจาก LLM จับคู่รถ (แสดงเปรียบเทียบ Groq vs Gemini เท่านั้น — ผลที่ใช้ใน pipeline อยู่ที่ detected_car) */
export type LineInboxCarAiModelPick =
  | {
      car_row_id: string;
      plate_text: string;
      chassis: string;
      spec: string;
      confidence: number;
      /** ช่วงสเปกจากบรรทัดแรกข้อความ (ใช้เทียบกับ DB) */
      line_spec_snippet?: string;
      /** สเปกใน cars.spec */
      db_spec?: string;
    }
  | null;

export type LineInboxCarAiByModel = {
  groq: LineInboxCarAiModelPick;
  gemini: LineInboxCarAiModelPick;
};

export type LineInboxAnalyzeResponse = {
  detected_car: {
    plate_text: string;
    chassis: string;
    spec: string;
    car_row_id: string;
    confidence: number;
    /** ช่วงสเปกจากบรรทัดแรกข้อความ (หลังตัดป้าย/VIN) — ฝั่งที่เอาไปเทียบสเปกใน DB */
    line_spec_snippet?: string;
    /** สเปกจากคอลัมน์ cars.spec ของคันที่จับคู่ */
    db_spec?: string;
  };
  /** ผล LLM เลือกคันที่ล่าสุด แต่ละรุ่น — ให้ผู้ใช้เทียบกับ Groq/Gemini ขณะที่ pipeline จะใช้ลำดับใน env เลือกหนึ่งคันเป็น detected_car */
  detected_car_ai_by_model?: LineInboxCarAiByModel;
  items: LineInboxAnalyzeItem[];
  needs_human_review: boolean;
  /** ถอดประโยคเป็นบรรทัดงาน: rule เดิม หรือ LLM เมื่อ rule ว่าง / ประโยคยาว */
  task_lines_source?: "heuristic" | "llm";
  /** บรรทัดจาก split-line-text (rule) เทียบกับผลใน `items` เมื่อ source เป็น llm */
  task_lines_heuristic?: string[];
  /** ผลจาก Groq และ Gemini เมื่อมีการเรียกแยกบรรทัดงานด้วย LLM (อาจบรรทัดว่างฝั่งใดฝั่งหนึ่งเมื่อเกิดข้อผิดพลาด) */
  task_lines_ai_by_model?: { groq: string[]; gemini: string[] };
  /** รุ่นที่เลือกใช้จริงเมื่อ task_lines_source === llm (ตาม LINE_INBOX_TASK_LINES_LLM_ORDER รายรอบ) */
  task_lines_chosen_llm?: "groq" | "gemini" | null;
};

export type ExistingOrderItemRow = {
  id: string;
  label: string;
  status: string;
};
