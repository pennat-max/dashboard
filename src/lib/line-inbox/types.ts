/**
 * LINE Inbox AI analysis — shared types (see LINE_INBOX_AI_ANALYSIS_PLAN.md)
 */

export type DuplicateStatus = "new" | "duplicate" | "possible_duplicate" | "unclear";

export type LineInboxCarCandidate = {
  text: string;
  source?: "rule" | "ai";
  kind?: string;
  confidence?: number | string;
  reason?: string;
  line?: string;
};

export type LineInboxMatchedCarCandidate = {
  car_row_id: string;
  car_id?: number | null;
  plate_text: string;
  spec_text?: string;
  chassis?: string;
  sale?: string;
  label: string;
};

export type LineInboxAnalyzeItem = {
  raw_text: string;
  suggested_item_name: string;
  suggested_note?: string;
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
  line_attachments?: LineInboxAttachmentMeta[];
  attachments_meta_count?: number;
  extractedCarCandidates?: LineInboxCarCandidate[];
  matchedCarCandidates?: LineInboxMatchedCarCandidate[];
  aiTargetCarReference?: string;
  aiTargetCarConfidence?: string;
  matchReason?: string;
  matchStatus?: "matched" | "waiting_for_car_record" | "ambiguous_vehicle" | "no_vehicle_context" | "unresolved";
  unmatchedReason?: "" | "pending_car_record" | "multiple_candidates" | "no_car_candidate";
  context_source?: "reply_context" | string;
  reply_context?: {
    context_source: "reply_context" | "fallback_previous_message" | string;
    quoted_message_id?: string;
    source_line_message_id?: string;
    source_inbox_message_id?: string;
    source_car_row_id?: string;
    source_raw_text_preview?: string;
    source_detected_car?: Partial<LineInboxAnalyzeResponse["detected_car"]>;
    confidence?: "high" | "medium" | "low";
    reason?: string;
    fallback_window_ms?: number;
    ambiguous?: boolean;
  };
  existing_items?: ExistingOrderItemRow[];
  items: LineInboxAnalyzeItem[];
  needs_human_review: boolean;
};

export type ExistingOrderItemRow = {
  id: string;
  order_task_id?: string;
  label: string;
  status: string;
  assignee_staff?: string;
  note?: string;
  due_date?: string;
  updated_at?: string;
};

export type LineInboxAttachmentStatus =
  | "pending"
  | "stored"
  | "missing_env"
  | "unsupported"
  | "error";

export type LineInboxAttachmentMeta = {
  id: string;
  line_message_id: string;
  line_message_type: "image" | "file";
  file_name?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  public_url?: string | null;
  status: LineInboxAttachmentStatus;
  error?: string | null;
  captured_at: string;
};
