import { NextResponse } from "next/server";
import type { Car } from "@/types/car";
import { fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";
import { createServiceRoleClient } from "@/lib/site/data";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";

const MAX_CARD_DETAILS_PER_REQUEST = 50;
const MAX_LINE_THREAD_ROWS_PER_REQUEST = 400;

type CardDetailRequestCar = {
  id?: string | number | null;
  row_id?: string | null;
};

type CardDetailRequestBody = {
  cars?: CardDetailRequestCar[];
};

type LineThreadMessage = {
  id: string;
  received_at: string;
  raw_text: string;
  workflow_status: string;
  analyze_status: string;
  needs_human_review: boolean;
  source_label: string;
  attachments: Array<{ url: string; file_name: string | null; mime_type: string | null }>;
  suggested_items: Array<{ name: string; status: string; assignee: string }>;
};

type LineThreadSummary = {
  total_messages: number;
  total_photos: number;
  pending_messages: number;
  confirmed_messages: number;
  review_messages: number;
  latest_at: string;
  messages: LineThreadMessage[];
};

type LineInboxThreadRow = {
  id?: unknown;
  received_at?: unknown;
  raw_text?: unknown;
  source_type?: unknown;
  workflow_status?: unknown;
  analyze_status?: unknown;
  analyze_payload?: unknown;
  car_row_id?: unknown;
  needs_human_review?: unknown;
};

type LineThreadPayload = {
  line_attachments?: unknown;
  items?: unknown;
};

type LineThreadPayloadRecord = Record<string, unknown>;

function isExperimentEnabled(): boolean {
  return String(process.env.NEXT_PUBLIC_ORDER_CHIP_CACHE_ENABLED ?? "true").trim().toLowerCase() !== "false";
}

function carKeys(car: CardDetailRequestCar): string[] {
  const keys: string[] = [];
  const rowId = String(car.row_id ?? "").trim();
  const id = String(car.id ?? "").trim();
  if (rowId) keys.push(`row:${rowId}`);
  if (id) keys.push(`id:${id}`);
  return keys;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function sourceLabel(value: unknown): string {
  const raw = clean(value);
  if (raw === "group") return "LINE group";
  if (raw === "user") return "LINE user";
  if (raw === "room") return "LINE room";
  return raw || "LINE";
}

function getRecordValue(record: LineThreadPayloadRecord, key: string): unknown {
  return record[key];
}

function analyzePayload(value: unknown): LineThreadPayload | null {
  if (!value || typeof value !== "object") return null;
  return value as LineThreadPayload;
}

function lineAttachments(payload: LineThreadPayload | null): LineThreadMessage["attachments"] {
  const list = Array.isArray(payload?.line_attachments) ? payload?.line_attachments : [];
  return list
    .map((item) => {
      const record = item && typeof item === "object" ? (item as LineThreadPayloadRecord) : {};
      return {
        url: clean(getRecordValue(record, "public_url")),
        file_name: clean(getRecordValue(record, "file_name")) || null,
        mime_type: clean(getRecordValue(record, "mime_type")) || null,
      };
    })
    .filter((item: { url: string }) => item.url)
    .slice(0, 12);
}

function suggestedItems(payload: LineThreadPayload | null): LineThreadMessage["suggested_items"] {
  const list = Array.isArray(payload?.items) ? payload?.items : [];
  return list
    .map((item) => {
      const record = item && typeof item === "object" ? (item as LineThreadPayloadRecord) : {};
      return {
        name: clean(getRecordValue(record, "suggested_item_name")) || clean(getRecordValue(record, "raw_text")),
        status: clean(getRecordValue(record, "suggested_status")),
        assignee: clean(getRecordValue(record, "assignee_staff")) || clean(getRecordValue(record, "assignee")),
      };
    })
    .filter((item: { name: string }) => item.name)
    .slice(0, 10);
}

async function fetchLineThreadsByCar(cars: Car[]): Promise<{ lineThreadsByCar: Record<string, LineThreadSummary>; lineThreadsError: string | null }> {
  const rowIds = Array.from(new Set(cars.map((car) => clean(car.row_id)).filter(Boolean)));
  if (rowIds.length === 0) return { lineThreadsByCar: {}, lineThreadsError: null };

  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,line_message_id,received_at,raw_text,source_type,workflow_status,analyze_status,analyze_payload,car_row_id,needs_human_review")
    .in("car_row_id", rowIds)
    .order("received_at", { ascending: false })
    .limit(MAX_LINE_THREAD_ROWS_PER_REQUEST);

  if (error) {
    const message = String(error.message ?? "");
    const lower = message.toLowerCase();
    if (lower.includes("does not exist") || lower.includes("could not find")) {
      return { lineThreadsByCar: {}, lineThreadsError: null };
    }
    return { lineThreadsByCar: {}, lineThreadsError: message };
  }

  const byRow: Record<string, LineThreadSummary> = {};
  for (const row of (data ?? []) as LineInboxThreadRow[]) {
    const carRowId = clean(row.car_row_id);
    if (!carRowId) continue;
    const payload = analyzePayload(row.analyze_payload);
    const attachments = lineAttachments(payload);
    const message: LineThreadMessage = {
      id: clean(row.id),
      received_at: clean(row.received_at),
      raw_text: clean(row.raw_text),
      workflow_status: clean(row.workflow_status),
      analyze_status: clean(row.analyze_status),
      needs_human_review: Boolean(row.needs_human_review),
      source_label: sourceLabel(row.source_type),
      attachments,
      suggested_items: suggestedItems(payload),
    };
    const existing =
      byRow[carRowId] ??
      (byRow[carRowId] = {
        total_messages: 0,
        total_photos: 0,
        pending_messages: 0,
        confirmed_messages: 0,
        review_messages: 0,
        latest_at: "",
        messages: [],
      });
    existing.total_messages += 1;
    existing.total_photos += attachments.length;
    if (message.workflow_status === "confirmed") existing.confirmed_messages += 1;
    if (message.workflow_status === "pending") existing.pending_messages += 1;
    if (message.needs_human_review || message.analyze_status === "needs_human_review") existing.review_messages += 1;
    if (!existing.latest_at || message.received_at > existing.latest_at) existing.latest_at = message.received_at;
    if (existing.messages.length < 12) existing.messages.push(message);
  }

  const lineThreadsByCar: Record<string, LineThreadSummary> = {};
  for (const car of cars) {
    const rowId = clean(car.row_id);
    const thread = rowId ? byRow[rowId] : null;
    if (!thread) continue;
    const keys = carKeys(car);
    for (const key of keys) lineThreadsByCar[key] = thread;
  }
  return { lineThreadsByCar, lineThreadsError: null };
}

export async function POST(req: Request) {
  if (!isExperimentEnabled()) {
    return NextResponse.json(
      {
        enabled: false,
        orderItemsByCar: {},
        orderUpdatesByCar: {},
        hydratedCarKeys: [],
      },
      { status: 404 }
    );
  }

  let body: CardDetailRequestBody;
  try {
    body = (await req.json()) as CardDetailRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inputCars = Array.isArray(body.cars) ? body.cars : [];
  const cars = inputCars
    .slice(0, MAX_CARD_DETAILS_PER_REQUEST)
    .map((car, index) => {
      const rowId = String(car.row_id ?? "").trim();
      const rawId = car.id == null ? "" : String(car.id).trim();
      return {
        id: rawId || `client:${index}`,
        row_id: rowId || null,
      } as Car;
    })
    .filter((car) => String(car.row_id ?? "").trim() || String(car.id ?? "").trim());

  if (cars.length === 0) {
    return NextResponse.json({
      enabled: true,
      orderItemsByCar: {},
      orderUpdatesByCar: {},
      hydratedCarKeys: [],
      itemsError: null,
      updatesError: null,
    });
  }

  const [pack, linePack] = await Promise.all([
    fetchOrderItemsAndUpdatesByCars(cars),
    fetchLineThreadsByCar(cars),
  ]);
  return NextResponse.json({
    enabled: true,
    orderItemsByCar: pack.orderItemsByCar,
    orderUpdatesByCar: pack.orderUpdatesByCar,
    lineThreadsByCar: linePack.lineThreadsByCar,
    hydratedCarKeys: Array.from(new Set(inputCars.slice(0, MAX_CARD_DETAILS_PER_REQUEST).flatMap(carKeys))),
    itemsError: pack.itemsError,
    updatesError: pack.updatesError,
    lineThreadsError: linePack.lineThreadsError,
  });
}
