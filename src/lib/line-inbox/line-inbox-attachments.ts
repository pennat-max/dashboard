import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  LineInboxAnalyzeResponse,
  LineInboxAttachmentMeta,
  LineInboxAttachmentStatus,
} from "@/lib/line-inbox/types";

export const LINE_INBOX_ATTACHMENTS_BUCKET =
  process.env.LINE_INBOX_ATTACHMENTS_BUCKET?.trim() || "order-tracking-photos";

const LINE_CONTENT_API_BASE = "https://api-data.line.me/v2/bot/message";
const MAX_LINE_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const LINE_CONTENT_TIMEOUT_MS = 25_000;

type LineInboxAttachmentInput = {
  lineMessageId: string;
  lineMessageType: "image" | "file";
  fileName?: string | null;
  receivedAt?: string | null;
};

type DownloadedLineContent = {
  bytes: Uint8Array;
  mimeType: string;
  sizeBytes: number;
};

function cleanMessage(value: unknown): string {
  return String(value instanceof Error ? value.message : value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 96) || "line";
}

function fileNameLooksImage(fileName: string | null | undefined): boolean {
  return /\.(?:jpe?g|png|webp|gif|heic|heif)$/i.test(String(fileName ?? "").trim());
}

function extFromMimeAndName(mimeType: string, fileName: string | null | undefined): string {
  const mime = String(mimeType ?? "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("heic")) return "heic";
  if (mime.includes("heif")) return "heif";

  const fromName = String(fileName ?? "")
    .split(".")
    .pop()
    ?.toLowerCase();
  if (fromName && /^(?:jpe?g|png|webp|gif|heic|heif)$/.test(fromName)) return fromName;
  return "jpg";
}

export function makeLineInboxAttachmentMeta(
  input: LineInboxAttachmentInput & {
    status: LineInboxAttachmentStatus;
    mimeType?: string | null;
    sizeBytes?: number | null;
    storagePath?: string | null;
    publicUrl?: string | null;
    error?: string | null;
  }
): LineInboxAttachmentMeta {
  const capturedAt = input.receivedAt || new Date().toISOString();
  return {
    id: input.lineMessageId,
    line_message_id: input.lineMessageId,
    line_message_type: input.lineMessageType,
    file_name: input.fileName ?? null,
    mime_type: input.mimeType ?? null,
    size_bytes: input.sizeBytes ?? null,
    storage_bucket: input.storagePath ? LINE_INBOX_ATTACHMENTS_BUCKET : null,
    storage_path: input.storagePath ?? null,
    public_url: input.publicUrl ?? null,
    status: input.status,
    error: input.error ? cleanMessage(input.error) : null,
    captured_at: capturedAt,
  };
}

export function makeLineAttachmentAnalyzePayload(
  attachment: LineInboxAttachmentMeta
): LineInboxAnalyzeResponse {
  return {
    detected_car: {
      plate_text: "",
      chassis: "",
      car_row_id: "",
      confidence: 0,
    },
    ignored_vehicle_spec_lines: [],
    ignored_mention_lines: [],
    ignored_noise_lines: [],
    line_attachments: [attachment],
    attachments_meta_count: 1,
    existing_items: [],
    items: [],
    needs_human_review: true,
  };
}

export async function fetchLineMessageContent(
  lineMessageId: string,
  accessToken: string
): Promise<DownloadedLineContent> {
  const id = String(lineMessageId ?? "").trim();
  if (!id) throw new Error("Missing LINE message id");

  const res = await fetch(`${LINE_CONTENT_API_BASE}/${encodeURIComponent(id)}/content`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "image/*,application/octet-stream;q=0.8,*/*;q=0.5",
    },
    signal: AbortSignal.timeout(LINE_CONTENT_TIMEOUT_MS),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`LINE content fetch failed with status ${res.status}`);
  }

  const contentLength = res.headers.get("content-length");
  if (contentLength && Number(contentLength) > MAX_LINE_ATTACHMENT_BYTES) {
    throw new Error("LINE attachment is larger than 15MB");
  }

  const mimeType = String(res.headers.get("content-type") ?? "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_LINE_ATTACHMENT_BYTES) {
    throw new Error("LINE attachment is larger than 15MB");
  }

  return {
    bytes: new Uint8Array(buf),
    mimeType: mimeType || "application/octet-stream",
    sizeBytes: buf.byteLength,
  };
}

export async function uploadLineInboxImageAttachment(
  supabase: SupabaseClient,
  input: LineInboxAttachmentInput & DownloadedLineContent
): Promise<LineInboxAttachmentMeta> {
  const mimeType = String(input.mimeType ?? "").toLowerCase();
  const fileName = String(input.fileName ?? "").trim() || null;
  const isImage = mimeType.startsWith("image/") || fileNameLooksImage(fileName);
  if (!isImage) {
    return makeLineInboxAttachmentMeta({
      ...input,
      fileName,
      status: "unsupported",
      error: "Only image attachments are supported in Sprint 3",
    });
  }

  const ext = extFromMimeAndName(mimeType, fileName);
  const month = new Date().toISOString().slice(0, 7);
  const path = [
    "line-inbox",
    month,
    `${sanitizeSegment(input.lineMessageId)}-${Math.random().toString(36).slice(2, 10)}.${ext}`,
  ].join("/");

  const upload = await supabase.storage.from(LINE_INBOX_ATTACHMENTS_BUCKET).upload(path, input.bytes, {
    contentType: mimeType.startsWith("image/") ? mimeType : "image/jpeg",
    upsert: false,
  });
  if (upload.error) {
    throw new Error(upload.error.message);
  }

  const publicUrl = supabase.storage.from(LINE_INBOX_ATTACHMENTS_BUCKET).getPublicUrl(path).data.publicUrl;
  return makeLineInboxAttachmentMeta({
    ...input,
    fileName,
    mimeType,
    sizeBytes: input.sizeBytes,
    storagePath: path,
    publicUrl,
    status: "stored",
  });
}

