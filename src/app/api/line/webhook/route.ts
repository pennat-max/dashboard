import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyLineWebhookSignature } from "@/lib/line/verify-line-signature";
import {
  insertLineInboxMessage,
  updateLineInboxMessageAnalyze,
} from "@/lib/line-inbox/line-inbox-messages";
import {
  fetchLineMessageContent,
  makeLineAttachmentAnalyzePayload,
  makeLineInboxAttachmentMeta,
  uploadLineInboxImageAttachment,
} from "@/lib/line-inbox/line-inbox-attachments";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseAllowedGroupIds(): Set<string> {
  const raw = process.env.LINE_ALLOWED_GROUP_IDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

type LineEvent = {
  type?: string;
  mode?: string;
  timestamp?: number;
  message?: { type?: string; id?: string; text?: string; fileName?: string; fileSize?: number };
  source?: { type?: string; groupId?: string; userId?: string; roomId?: string };
  replyToken?: string;
};

type CapturableLineMessageType = "text" | "image" | "file";

function receivedAtFromLineTimestamp(timestamp: number | undefined): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function captureTextMessage(params: {
  destination: string | undefined;
  lineMessageId: string;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  rawText: string;
  replyToken: string | undefined;
  receivedAt?: string | undefined;
}): Promise<void> {
  const supabase = createServiceRoleClient();

  await insertLineInboxMessage(supabase, {
    line_message_id: params.lineMessageId,
    destination: params.destination ?? null,
    source_type: params.sourceType,
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: params.rawText,
    reply_token: params.replyToken ?? null,
    received_at: params.receivedAt,
  });
}

function normalizeCapturableMessageType(value: string | undefined): CapturableLineMessageType | null {
  if (value === "text" || value === "image" || value === "file") return value;
  return null;
}

function attachmentRawText(messageType: "image" | "file", fileName: string | undefined): string {
  const name = String(fileName ?? "").trim();
  if (messageType === "file" && name) return `[LINE file] ${name}`;
  return messageType === "image" ? "[LINE image]" : "[LINE file]";
}

async function captureAttachmentMessage(params: {
  destination: string | undefined;
  lineMessageId: string;
  lineMessageType: "image" | "file";
  fileName?: string | undefined;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  replyToken: string | undefined;
  receivedAt?: string | undefined;
}): Promise<void> {
  const supabase = createServiceRoleClient();
  const pendingAttachment = makeLineInboxAttachmentMeta({
    lineMessageId: params.lineMessageId,
    lineMessageType: params.lineMessageType,
    fileName: params.fileName,
    receivedAt: params.receivedAt,
    status: "pending",
  });

  const inserted = await insertLineInboxMessage(supabase, {
    line_message_id: params.lineMessageId,
    destination: params.destination ?? null,
    source_type: params.sourceType,
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: attachmentRawText(params.lineMessageType, params.fileName),
    reply_token: params.replyToken ?? null,
    received_at: params.receivedAt,
    analyze_status: "ok",
    analyze_payload: makeLineAttachmentAnalyzePayload(pendingAttachment),
    needs_human_review: true,
  });

  if (inserted.duplicate || !inserted.id) return;

  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!accessToken) {
    const missing = makeLineInboxAttachmentMeta({
      lineMessageId: params.lineMessageId,
      lineMessageType: params.lineMessageType,
      fileName: params.fileName,
      receivedAt: params.receivedAt,
      status: "missing_env",
      error: "Missing LINE_CHANNEL_ACCESS_TOKEN",
    });
    await updateLineInboxMessageAnalyze(supabase, inserted.id, {
      analyze_status: "error",
      analyze_error: "Missing LINE_CHANNEL_ACCESS_TOKEN",
      analyze_payload: makeLineAttachmentAnalyzePayload(missing),
      needs_human_review: true,
      car_row_id: null,
    });
    console.warn("[line-webhook] image/file capture skipped - LINE_CHANNEL_ACCESS_TOKEN is not set");
    return;
  }

  try {
    const downloaded = await fetchLineMessageContent(params.lineMessageId, accessToken);
    const attachment = await uploadLineInboxImageAttachment(supabase, {
      lineMessageId: params.lineMessageId,
      lineMessageType: params.lineMessageType,
      fileName: params.fileName,
      receivedAt: params.receivedAt,
      ...downloaded,
    });
    await updateLineInboxMessageAnalyze(supabase, inserted.id, {
      analyze_status: "ok",
      analyze_error: attachment.status === "unsupported" ? attachment.error ?? null : null,
      analyze_payload: makeLineAttachmentAnalyzePayload(attachment),
      needs_human_review: true,
      car_row_id: null,
    });
  } catch (error) {
    const msg =
      error instanceof Error
        ? error.message.replace(/\s+/g, " ").trim().slice(0, 400)
        : "LINE attachment capture failed";
    const failed = makeLineInboxAttachmentMeta({
      lineMessageId: params.lineMessageId,
      lineMessageType: params.lineMessageType,
      fileName: params.fileName,
      receivedAt: params.receivedAt,
      status: "error",
      error: msg,
    });
    await updateLineInboxMessageAnalyze(supabase, inserted.id, {
      analyze_status: "error",
      analyze_error: msg,
      analyze_payload: makeLineAttachmentAnalyzePayload(failed),
      needs_human_review: true,
      car_row_id: null,
    });
    console.error("[line-webhook] image/file capture failed:", msg);
  }
}

/**
 * LINE Messaging API webhook - verifies signature and stores capture-only messages.
 * Configure URL in LINE Developers -> Messaging API -> Webhook URL.
 *
 * Capture-only: no auto reply, no inline AI save, no order_items writes.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();

  if (!secret) {
    console.error("[line-webhook] LINE_CHANNEL_SECRET is not set - configure env and redeploy");
    return new Response("OK", { status: 200 });
  }

  if (!verifyLineWebhookSignature(secret, rawBody, signature)) {
    console.warn("[line-webhook] signature verification failed");
    return new Response("Forbidden", { status: 403 });
  }

  let payload: { destination?: string; events?: LineEvent[] };
  try {
    payload = JSON.parse(rawBody) as { destination?: string; events?: LineEvent[] };
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const events = Array.isArray(payload.events) ? payload.events : [];
  const destination = payload.destination;
  const allowedGroups = parseAllowedGroupIds();
  const acceptDm = process.env.LINE_ACCEPT_DM === "true";

  for (const ev of events) {
    if (!ev || ev.type !== "message") continue;
    const msg = ev.message;
    const messageType = normalizeCapturableMessageType(msg?.type);
    if (!msg || !messageType) continue;
    const text = messageType === "text" ? String(msg.text ?? "").trim() : "";
    const mid = String(msg.id ?? "").trim();
    if (!mid || (messageType === "text" && !text)) continue;

    const src = ev.source;
    if (!src?.type) continue;

    const replyToken = typeof ev.replyToken === "string" ? ev.replyToken : undefined;
    const receivedAt = receivedAtFromLineTimestamp(ev.timestamp);
    const runCapture = async (sourceType: "group" | "user" | "room", groupId: string | null, userId: string | null) => {
      if (messageType === "text") {
        await captureTextMessage({
          destination,
          lineMessageId: mid,
          sourceType,
          groupId,
          userId,
          rawText: text,
          replyToken,
          receivedAt,
        });
        return;
      }

      await captureAttachmentMessage({
        destination,
        lineMessageId: mid,
        lineMessageType: messageType,
        fileName: msg.fileName,
        sourceType,
        groupId,
        userId,
        replyToken,
        receivedAt,
      });
    };

    if (src.type === "group") {
      const gid = String(src.groupId ?? "").trim();
      const logGroupDiscovery = process.env.LINE_WEBHOOK_LOG_GROUP_IDS === "true";
      if (logGroupDiscovery && gid) {
        console.info(
          `[line-webhook] groupId=${gid} - add to env LINE_ALLOWED_GROUP_IDS, then turn LINE_WEBHOOK_LOG_GROUP_IDS off`
        );
      }

      if (allowedGroups.size === 0) {
        console.warn(
          "[line-webhook] skipped group message - set LINE_ALLOWED_GROUP_IDS (see LINE_WEBHOOK_LOG_GROUP_IDS in .env.example)"
        );
        continue;
      }
      if (!gid || !allowedGroups.has(gid)) {
        if (gid && !logGroupDiscovery) {
          console.warn(`[line-webhook] skipped group ${gid} - not in LINE_ALLOWED_GROUP_IDS`);
        }
        continue;
      }

      try {
        await runCapture("group", gid, src.userId ? String(src.userId) : null);
      } catch (e) {
        console.error("[line-webhook] capture failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "user" && acceptDm) {
      try {
        await runCapture("user", null, src.userId ? String(src.userId) : null);
      } catch (e) {
        console.error("[line-webhook] capture DM failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "room") {
      if (process.env.LINE_ACCEPT_ROOM !== "true") continue;
      try {
        await runCapture("room", null, src.userId ? String(src.userId) : null);
      } catch (e) {
        console.error("[line-webhook] capture room failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  return new Response("OK", { status: 200 });
}

export async function GET() {
  return new Response("LINE webhook endpoint - POST only", { status: 405 });
}
