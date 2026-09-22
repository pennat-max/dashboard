import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

type LineSource = {
  type?: "group" | "user" | "room";
  groupId?: string;
  roomId?: string;
  userId?: string;
};

type LineEvent = {
  type?: string;
  timestamp?: number;
  replyToken?: string;
  source?: LineSource;
  message?: {
    id?: string;
    type?: string;
    text?: string;
    fileName?: string;
    quotedMessageId?: string;
    quoteToken?: string;
    mention?: { mentionees?: Array<{ userId?: string }> };
  };
};

const LINE_SECRET = Deno.env.get("LINE_CHANNEL_SECRET")?.trim() ?? "";
const LINE_TOKEN = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")?.trim() ?? "";
const SUPABASE_URL =
  Deno.env.get("SUPABASE_URL")?.trim() || Deno.env.get("SB_URL")?.trim() || "";
const SERVICE_ROLE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ||
  Deno.env.get("SB_SERVICE_ROLE_KEY")?.trim() ||
  "";
const INBOX_TABLE = Deno.env.get("LINE_INBOX_MESSAGES_TABLE")?.trim() || "line_inbox_messages";
const ATTACHMENTS_BUCKET =
  Deno.env.get("LINE_INBOX_ATTACHMENTS_BUCKET")?.trim() || "order-tracking-photos";
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function truthy(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(value?.trim() ?? "");
}

function allowedGroupIds(): Set<string> {
  return new Set(
    (Deno.env.get("LINE_ALLOWED_GROUP_IDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

function decodeBase64(value: string): Uint8Array | null {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

async function verifySignature(body: string, signature: string): Promise<boolean> {
  if (!LINE_SECRET || !signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(LINE_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const actual = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  const expected = decodeBase64(signature);
  return expected ? constantTimeEqual(actual, expected) : false;
}

function sourceIsAllowed(event: LineEvent): boolean {
  const source = event.source;
  if (!source?.type) return false;

  if (source.type === "user") return truthy(Deno.env.get("LINE_ACCEPT_DM") ?? "true");
  if (source.type === "room") return truthy(Deno.env.get("LINE_ACCEPT_ROOM"));

  const groupId = source.groupId?.trim() ?? "";
  const allowList = allowedGroupIds();
  if (allowList.has("*") || allowList.has(groupId)) return true;

  // Preserve the former bot's least-privilege behavior until an allow-list is configured.
  const mentionees = event.message?.mention?.mentionees ?? [];
  const botUserId = Deno.env.get("LINE_BOT_USER_ID")?.trim() ?? "";
  const explicitlyMentioned =
    (botUserId && mentionees.some((mention) => mention.userId === botUserId)) ||
    /@VIGO4U/i.test(event.message?.text ?? "");
  return allowList.size === 0 && explicitlyMentioned;
}

function receivedAt(timestamp: number | undefined): string {
  const date = Number.isFinite(timestamp) ? new Date(Number(timestamp)) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function cleanText(event: LineEvent): string {
  return (event.message?.text ?? "").replace(/@VIGO4U\s*/gi, "").trim();
}

function attachmentPayload(input: {
  messageId: string;
  messageType: "image" | "file";
  fileName?: string;
  capturedAt: string;
  status: "pending" | "stored" | "unsupported" | "error";
  mimeType?: string | null;
  sizeBytes?: number | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  error?: string | null;
}) {
  return {
    detected_car: { plate_text: "", chassis: "", car_row_id: "", confidence: 0 },
    ignored_vehicle_spec_lines: [],
    ignored_mention_lines: [],
    ignored_noise_lines: [],
    line_attachments: [
      {
        id: input.messageId,
        line_message_id: input.messageId,
        line_message_type: input.messageType,
        file_name: input.fileName ?? null,
        mime_type: input.mimeType ?? null,
        size_bytes: input.sizeBytes ?? null,
        storage_bucket: input.storagePath ? ATTACHMENTS_BUCKET : null,
        storage_path: input.storagePath ?? null,
        public_url: input.publicUrl ?? null,
        status: input.status,
        error: input.error ?? null,
        captured_at: input.capturedAt,
      },
    ],
    attachments_meta_count: 1,
    existing_items: [],
    items: [],
    needs_human_review: true,
  };
}

async function insertInbox(event: LineEvent): Promise<{ id: string | null; duplicate: boolean }> {
  const message = event.message;
  const source = event.source;
  const messageId = message?.id?.trim() ?? "";
  const messageType = message?.type;
  const capturedAt = receivedAt(event.timestamp);
  const isAttachment = messageType === "image" || messageType === "file";
  const rawText = isAttachment
    ? messageType === "file" && message?.fileName
      ? `[LINE file] ${message.fileName}`
      : messageType === "image"
        ? "[LINE image]"
        : "[LINE file]"
    : cleanText(event);

  const analyzePayload = isAttachment
    ? attachmentPayload({
        messageId,
        messageType,
        fileName: message?.fileName,
        capturedAt,
        status: "pending",
      })
    : message?.quotedMessageId || message?.quoteToken
      ? {
          reply_context: {
            quoted_message_id: message.quotedMessageId ?? null,
            quote_token: message.quoteToken ?? null,
          },
        }
      : null;

  const { data, error } = await supabase
    .from(INBOX_TABLE)
    .insert({
      line_message_id: messageId,
      destination: null,
      source_type: source?.type,
      group_id: source?.groupId ?? null,
      user_id: source?.userId ?? null,
      raw_text: rawText,
      reply_token: event.replyToken ?? null,
      received_at: capturedAt,
      analyze_status: isAttachment ? "ok" : "pending",
      analyze_payload: analyzePayload,
      needs_human_review: isAttachment ? true : null,
      workflow_status: "pending",
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23505" || /duplicate|unique/i.test(error.message)) {
      return { id: null, duplicate: true };
    }
    throw new Error(error.message);
  }
  return { id: data?.id ?? null, duplicate: false };
}

function extensionFor(mimeType: string, fileName?: string): string {
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("gif")) return "gif";
  const extension = fileName?.split(".").pop()?.toLowerCase();
  return extension && /^(jpe?g|png|webp|gif|heic|heif)$/.test(extension) ? extension : "jpg";
}

async function captureAttachment(event: LineEvent, inboxId: string): Promise<void> {
  const message = event.message!;
  const messageType = message.type as "image" | "file";
  const capturedAt = receivedAt(event.timestamp);
  let payload: unknown;
  let analyzeStatus: "ok" | "error" = "ok";
  let analyzeError: string | null = null;

  try {
    if (!LINE_TOKEN) throw new Error("Missing LINE_CHANNEL_ACCESS_TOKEN");
    const response = await fetch(
      `https://api-data.line.me/v2/bot/message/${encodeURIComponent(message.id!)}/content`,
      { headers: { Authorization: `Bearer ${LINE_TOKEN}` }, signal: AbortSignal.timeout(25_000) },
    );
    if (!response.ok) throw new Error(`LINE content fetch failed with status ${response.status}`);
    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_ATTACHMENT_BYTES) throw new Error("LINE attachment is larger than 15MB");
    const mimeType = (response.headers.get("content-type") ?? "application/octet-stream")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("LINE attachment is larger than 15MB");
    const isImage = mimeType.startsWith("image/") || /\.(jpe?g|png|webp|gif|heic|heif)$/i.test(message.fileName ?? "");
    if (!isImage) {
      payload = attachmentPayload({
        messageId: message.id!,
        messageType,
        fileName: message.fileName,
        capturedAt,
        status: "unsupported",
        mimeType,
        sizeBytes: bytes.byteLength,
        error: "Only image attachments are supported",
      });
    } else {
      const safeId = message.id!.replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `line-inbox/${capturedAt.slice(0, 7)}/${safeId}-${crypto.randomUUID()}.${extensionFor(mimeType, message.fileName)}`;
      const upload = await supabase.storage.from(ATTACHMENTS_BUCKET).upload(path, bytes, {
        contentType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
        upsert: false,
      });
      if (upload.error) throw new Error(upload.error.message);
      const publicUrl = supabase.storage.from(ATTACHMENTS_BUCKET).getPublicUrl(path).data.publicUrl;
      payload = attachmentPayload({
        messageId: message.id!,
        messageType,
        fileName: message.fileName,
        capturedAt,
        status: "stored",
        mimeType,
        sizeBytes: bytes.byteLength,
        storagePath: path,
        publicUrl,
      });
    }
  } catch (error) {
    analyzeStatus = "error";
    analyzeError = (error instanceof Error ? error.message : String(error)).slice(0, 400);
    payload = attachmentPayload({
      messageId: message.id!,
      messageType,
      fileName: message.fileName,
      capturedAt,
      status: "error",
      error: analyzeError,
    });
  }

  const { error } = await supabase
    .from(INBOX_TABLE)
    .update({
      analyze_status: analyzeStatus,
      analyze_error: analyzeError,
      analyze_payload: payload,
      needs_human_review: true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", inboxId);
  if (error) throw new Error(error.message);
}

Deno.serve(async (request: Request) => {
  if (request.method === "GET") {
    return Response.json({ status: "ok", service: "VIGO4U LINE capture bridge", mode: "capture-only" });
  }
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  if (!LINE_SECRET || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("LINE capture bridge is missing required server configuration");
    return new Response("Service unavailable", { status: 503 });
  }

  const body = await request.text();
  const signature = request.headers.get("x-line-signature") ?? "";
  if (!(await verifySignature(body, signature))) {
    console.warn("Rejected LINE request with invalid signature");
    return new Response("Forbidden", { status: 403 });
  }

  let payload: { events?: LineEvent[] };
  try {
    payload = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  for (const event of payload.events ?? []) {
    const type = event.message?.type;
    const messageId = event.message?.id?.trim();
    if (event.type !== "message" || !messageId || !["text", "image", "file"].includes(type ?? "")) continue;
    if (type === "text" && !cleanText(event)) continue;
    if (!sourceIsAllowed(event)) continue;

    try {
      const inserted = await insertInbox(event);
      if (!inserted.duplicate && inserted.id && (type === "image" || type === "file")) {
        await captureAttachment(event, inserted.id);
      }
    } catch (error) {
      console.error("LINE capture failed", error instanceof Error ? error.message : String(error));
      return new Response("Temporary failure", { status: 500 });
    }
  }

  return Response.json({ status: "ok" });
});
