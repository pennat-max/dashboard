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

export type LineInboxAnalyzeResponse = {
  detected_car: {
    plate_text: string;
    chassis: string;
    car_row_id: string;
    confidence: number;
    spec_text?: string;
    sale?: string;
  };
  ignored_vehicle_spec_lines?: string[];
  ignored_mention_lines?: string[];
  ignored_noise_lines?: string[];
  items: LineInboxAnalyzeItem[];
  needs_human_review: boolean;
};

export type ExistingOrderItemRow = {
  id: string;
  label: string;
  status: string;
};
