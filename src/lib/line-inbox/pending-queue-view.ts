export const LINE_INBOX_QUEUE_REFRESH_MS = 5 * 60 * 1000;

export type LineInboxQueueFilter = "all" | "today" | "yesterday" | "manual" | "waiting_for_car";

export type LineInboxQueueFilterMessage = {
  received_at?: string;
  car_row_id?: string;
  action_line_count?: number;
  new_line_count?: number;
  needs_human_review?: boolean;
  extractionStatus?: string;
  matchStatus?: string;
  unmatchedReason?: string;
  unmatched_reason?: string;
};

export type LineInboxQueueFilterAttachment = {
  received_at?: string;
};

export type LineInboxQueueFilterGroup = {
  car_row_id?: string;
  total_manual_reviews?: number;
  matchStatus?: string;
  unmatchedReason?: string;
  unmatched_reason?: string;
  messages?: LineInboxQueueFilterMessage[];
  attachments?: LineInboxQueueFilterAttachment[];
};

export type LineInboxQueueFilterCounts = Record<LineInboxQueueFilter, number>;

export function parseLineInboxQueueFilter(value: unknown): LineInboxQueueFilter {
  const clean = String(value ?? "").trim();
  if (clean === "today" || clean === "yesterday" || clean === "manual") return clean;
  if (clean === "waiting_for_car" || clean === "waiting") return "waiting_for_car";
  return "all";
}

export function todayYmdBangkokForLineInboxQueue(now = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function addBangkokCalendarDaysForLineInboxQueue(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T12:00:00+07:00`);
  if (!Number.isFinite(t)) return "";
  return new Date(t + days * 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Bangkok",
  });
}

export function ymdBangkokFromLineInboxIso(iso: string | undefined): string {
  const t = Date.parse(String(iso ?? ""));
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
}

export function lineInboxQueueMessageIsWaitingForCarRecord(message: LineInboxQueueFilterMessage): boolean {
  return (
    String(message.matchStatus ?? "").trim() === "waiting_for_car_record" ||
    String(message.unmatchedReason ?? message.unmatched_reason ?? "").trim() === "pending_car_record"
  );
}

export function lineInboxQueueMessageIsUnknownCarManualReview(message: LineInboxQueueFilterMessage): boolean {
  if (lineInboxQueueMessageIsWaitingForCarRecord(message)) return false;
  if (String(message.car_row_id ?? "").trim()) return false;
  const matchStatus = String(message.matchStatus ?? "").trim();
  const unmatchedReason = String(message.unmatchedReason ?? message.unmatched_reason ?? "").trim();
  return (
    matchStatus === "unresolved" ||
    matchStatus === "no_vehicle_context" ||
    matchStatus === "ambiguous_vehicle" ||
    unmatchedReason === "multiple_candidates" ||
    unmatchedReason === "no_car_candidate"
  );
}

export function lineInboxQueueGroupIsWaitingForCarRecord(group: LineInboxQueueFilterGroup): boolean {
  return (
    String(group.matchStatus ?? "").trim() === "waiting_for_car_record" ||
    String(group.unmatchedReason ?? group.unmatched_reason ?? "").trim() === "pending_car_record" ||
    (group.messages ?? []).some(lineInboxQueueMessageIsWaitingForCarRecord)
  );
}

export function lineInboxQueueGroupIsUnknownCarManualReview(group: LineInboxQueueFilterGroup): boolean {
  if (lineInboxQueueGroupIsWaitingForCarRecord(group)) return false;
  if (String(group.car_row_id ?? "").trim()) return false;
  const matchStatus = String(group.matchStatus ?? "").trim();
  const unmatchedReason = String(group.unmatchedReason ?? group.unmatched_reason ?? "").trim();
  return (
    matchStatus === "unresolved" ||
    matchStatus === "no_vehicle_context" ||
    matchStatus === "ambiguous_vehicle" ||
    unmatchedReason === "multiple_candidates" ||
    unmatchedReason === "no_car_candidate" ||
    (group.messages ?? []).some(lineInboxQueueMessageIsUnknownCarManualReview)
  );
}

export function lineInboxQueueMessageNeedsManualReview(message: LineInboxQueueFilterMessage): boolean {
  if (lineInboxQueueMessageIsWaitingForCarRecord(message)) return false;
  if (lineInboxQueueMessageIsUnknownCarManualReview(message)) return true;
  const actionCount = Math.max(0, Number(message.action_line_count ?? 0));
  const newCount = Math.max(0, Number(message.new_line_count ?? 0));
  if (actionCount > 0 || newCount > 0) return false;
  return (
    Boolean(message.needs_human_review) ||
    String(message.extractionStatus ?? "").trim() === "needs_manual_review" ||
    String(message.extractionStatus ?? "").trim() === "matched_no_work" ||
    String(message.extractionStatus ?? "").trim() === "no_items"
  );
}

export function lineInboxQueueGroupHasManualReview(group: LineInboxQueueFilterGroup): boolean {
  if (lineInboxQueueGroupIsWaitingForCarRecord(group)) return false;
  if (lineInboxQueueGroupIsUnknownCarManualReview(group)) return true;
  return (
    Math.max(0, Number(group.total_manual_reviews ?? 0)) > 0 ||
    (group.messages ?? []).some(lineInboxQueueMessageNeedsManualReview)
  );
}

export function lineInboxQueueMessageIsReadyActionable(message: LineInboxQueueFilterMessage): boolean {
  if (lineInboxQueueMessageIsWaitingForCarRecord(message)) return false;
  if (lineInboxQueueMessageIsUnknownCarManualReview(message)) return false;
  const matchStatus = String(message.matchStatus ?? "").trim();
  const hasMatchedCar = Boolean(String(message.car_row_id ?? "").trim()) || matchStatus === "matched";
  if (!hasMatchedCar) return false;
  const actionCount = Math.max(0, Number(message.action_line_count ?? 0));
  const newCount = Math.max(0, Number(message.new_line_count ?? 0));
  return actionCount > 0 || newCount > 0;
}

export function lineInboxQueueGroupIsReadyActionable(group: LineInboxQueueFilterGroup): boolean {
  if (lineInboxQueueGroupIsWaitingForCarRecord(group)) return false;
  if (lineInboxQueueGroupIsUnknownCarManualReview(group)) return false;
  const matchStatus = String(group.matchStatus ?? "").trim();
  const hasMatchedCar = Boolean(String(group.car_row_id ?? "").trim()) || matchStatus === "matched";
  if (!hasMatchedCar) return false;
  return (group.messages ?? []).some(lineInboxQueueMessageIsReadyActionable);
}

export function lineInboxQueueGroupHasWorkOnYmd(group: LineInboxQueueFilterGroup, ymd: string): boolean {
  const messageOnDate = (group.messages ?? []).some((message) => {
    if (ymdBangkokFromLineInboxIso(message.received_at) !== ymd) return false;
    const jobs = Math.max(0, Number(message.action_line_count ?? 0)) + Math.max(0, Number(message.new_line_count ?? 0));
    return jobs > 0 || lineInboxQueueMessageNeedsManualReview(message) || lineInboxQueueMessageIsWaitingForCarRecord(message);
  });
  const photoOnDate = (group.attachments ?? []).some((attachment) => ymdBangkokFromLineInboxIso(attachment.received_at) === ymd);
  return messageOnDate || photoOnDate;
}

export function lineInboxQueueGroupMatchesFilter(
  group: LineInboxQueueFilterGroup,
  filter: LineInboxQueueFilter,
  todayYmd: string
): boolean {
  if (filter === "all") return lineInboxQueueGroupIsReadyActionable(group);
  if (filter === "waiting_for_car") return lineInboxQueueGroupIsWaitingForCarRecord(group);
  if (filter === "manual") return lineInboxQueueGroupHasManualReview(group);
  if (filter === "today") return lineInboxQueueGroupHasWorkOnYmd(group, todayYmd);
  if (filter === "yesterday") {
    return lineInboxQueueGroupHasWorkOnYmd(group, addBangkokCalendarDaysForLineInboxQueue(todayYmd, -1));
  }
  return true;
}

export function lineInboxQueueFilterCounts(
  groups: LineInboxQueueFilterGroup[],
  todayYmd: string
): LineInboxQueueFilterCounts {
  return {
    all: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "all", todayYmd)).length,
    today: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "today", todayYmd)).length,
    yesterday: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "yesterday", todayYmd)).length,
    manual: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "manual", todayYmd)).length,
    waiting_for_car: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "waiting_for_car", todayYmd))
      .length,
  };
}
