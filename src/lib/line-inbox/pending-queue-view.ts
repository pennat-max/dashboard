export const LINE_INBOX_QUEUE_REFRESH_MS = 5 * 60 * 1000;

export type LineInboxQueueFilter = "all" | "today" | "yesterday" | "manual";

export type LineInboxQueueFilterMessage = {
  received_at?: string;
  action_line_count?: number;
  new_line_count?: number;
  needs_human_review?: boolean;
  extractionStatus?: string;
};

export type LineInboxQueueFilterAttachment = {
  received_at?: string;
};

export type LineInboxQueueFilterGroup = {
  total_manual_reviews?: number;
  messages?: LineInboxQueueFilterMessage[];
  attachments?: LineInboxQueueFilterAttachment[];
};

export type LineInboxQueueFilterCounts = Record<LineInboxQueueFilter, number>;

export function parseLineInboxQueueFilter(value: unknown): LineInboxQueueFilter {
  const clean = String(value ?? "").trim();
  if (clean === "today" || clean === "yesterday" || clean === "manual") return clean;
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

export function lineInboxQueueMessageNeedsManualReview(message: LineInboxQueueFilterMessage): boolean {
  const actionCount = Math.max(0, Number(message.action_line_count ?? 0));
  const newCount = Math.max(0, Number(message.new_line_count ?? 0));
  if (actionCount > 0 || newCount > 0) return false;
  return (
    Boolean(message.needs_human_review) ||
    String(message.extractionStatus ?? "").trim() === "needs_manual_review" ||
    String(message.extractionStatus ?? "").trim() === "no_items"
  );
}

export function lineInboxQueueGroupHasManualReview(group: LineInboxQueueFilterGroup): boolean {
  return (
    Math.max(0, Number(group.total_manual_reviews ?? 0)) > 0 ||
    (group.messages ?? []).some(lineInboxQueueMessageNeedsManualReview)
  );
}

export function lineInboxQueueGroupHasWorkOnYmd(group: LineInboxQueueFilterGroup, ymd: string): boolean {
  const messageOnDate = (group.messages ?? []).some((message) => {
    if (ymdBangkokFromLineInboxIso(message.received_at) !== ymd) return false;
    const jobs = Math.max(0, Number(message.action_line_count ?? 0)) + Math.max(0, Number(message.new_line_count ?? 0));
    return jobs > 0 || lineInboxQueueMessageNeedsManualReview(message);
  });
  const photoOnDate = (group.attachments ?? []).some((attachment) => ymdBangkokFromLineInboxIso(attachment.received_at) === ymd);
  return messageOnDate || photoOnDate;
}

export function lineInboxQueueGroupMatchesFilter(
  group: LineInboxQueueFilterGroup,
  filter: LineInboxQueueFilter,
  todayYmd: string
): boolean {
  if (filter === "all") return true;
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
    all: groups.length,
    today: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "today", todayYmd)).length,
    yesterday: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "yesterday", todayYmd)).length,
    manual: groups.filter((group) => lineInboxQueueGroupMatchesFilter(group, "manual", todayYmd)).length,
  };
}
