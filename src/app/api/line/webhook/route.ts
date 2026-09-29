import { createServiceRoleClient } from "@/lib/site/data";
import { verifyLineWebhookSignature } from "@/lib/line/verify-line-signature";
import { isLineGroupAllowed, parseLineAllowedGroups } from "@/lib/line/allowed-groups";
import {
  insertLineInboxMessage,
  LINE_INBOX_MESSAGES_TABLE,
  updateLineInboxMessageAnalyze,
} from "@/lib/line-inbox/line-inbox-messages";
import {
  buildLineOrderReviewUrl,
  isLineInboxSystemAcknowledgementText,
} from "@/lib/line-inbox/acknowledgement";
import {
  extractLineQuotedMessageId,
  extractLineQuoteToken,
  makeLineReplyCaptureAnalyzePayload,
} from "@/lib/line-inbox/reply-context";
import { isLineInboxNoiseOrSeparatorOnlyText } from "@/lib/line-inbox/split-line-text";
import { replyLineJobReceiptMessage, replyLineTextMessage } from "@/lib/line/push-message";
import {
  fetchLineMessageContent,
  makeLineAttachmentAnalyzePayload,
  makeLineInboxAttachmentMeta,
  uploadLineInboxImageAttachment,
} from "@/lib/line-inbox/line-inbox-attachments";
import {
  extractReceiptCardDetails,
  isLineImageSetComplete,
  isLineReceiptVehicleText,
  LINE_RECEIPT_IMAGE_AFTER_TEXT_WINDOW_MS,
  normalizeLineImageSet,
  shouldAttemptLineReceiptReply,
  type LineImageSet,
} from "@/lib/line-inbox/webhook-receipt";

export const dynamic = "force-dynamic";

type LineEvent = {
  type?: string;
  mode?: string;
  timestamp?: number;
  message?: {
    type?: string;
    id?: string;
    text?: string;
    fileName?: string;
    fileSize?: number;
    quotedMessageId?: string;
    quoteToken?: string;
    imageSet?: LineImageSet;
  };
  source?: { type?: string; groupId?: string; userId?: string; roomId?: string };
  replyToken?: string;
};

type CapturableLineMessageType = "text" | "image" | "file" | "sticker";
type CaptureLineMessageResult = { id: string | null; duplicate: boolean };

function isTruthyEnvFlag(value: string | undefined): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(value?.trim() ?? "");
}

function cleanLine(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function maskLineTarget(value: unknown): string {
  const raw = cleanLine(value);
  if (!raw) return "";
  if (raw.length <= 8) return `${raw.slice(0, 1)}...${raw.slice(-1)}`;
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function receivedAtFromLineTimestamp(timestamp: number | undefined): string | undefined {
  if (!Number.isFinite(timestamp)) return undefined;
  const date = new Date(Number(timestamp));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

type ReceiptTextContext = {
  inboxMessageId: string;
  lineMessageId: string;
  rawText: string;
  workflowStatus: string;
  analyzePayload?: unknown;
};

function lineAutoSaveStatusFromPayload(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const autoSave = (value as Record<string, unknown>).auto_save;
  if (!autoSave || typeof autoSave !== "object" || Array.isArray(autoSave)) return "";
  return cleanLine((autoSave as Record<string, unknown>).status);
}

function isReceiptContextPersisted(context: ReceiptTextContext): boolean {
  if (context.workflowStatus !== "confirmed") return false;
  const status = lineAutoSaveStatusFromPayload(context.analyzePayload);
  return !status || status === "saved";
}

async function findRecentReceiptTextContext(params: {
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  receivedAt?: string;
}): Promise<ReceiptTextContext | null> {
  // In a busy group, the sender identity is required so a photo cannot be
  // acknowledged with another person's vehicle text.
  if (params.sourceType !== "group" || !params.groupId || !params.userId) return null;
  const receivedMs = Date.parse(params.receivedAt ?? "");
  const imageTime = Number.isFinite(receivedMs) ? receivedMs : Date.now();
  const dataClient = createServiceRoleClient();
  const { data, error } = await dataClient
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id,line_message_id,raw_text,received_at,workflow_status,analyze_payload")
    .eq("source_type", "group")
    .eq("group_id", params.groupId)
    .eq("user_id", params.userId)
    .gte("received_at", new Date(imageTime - LINE_RECEIPT_IMAGE_AFTER_TEXT_WINDOW_MS).toISOString())
    .lte("received_at", new Date(imageTime).toISOString())
    .order("received_at", { ascending: false })
    .limit(20);

  if (error) {
    console.warn("[line-webhook] receipt context lookup failed", { error: cleanLine(error.message).slice(0, 300) });
    return null;
  }

  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const rawText = cleanLine(row.raw_text);
    if (!isLineReceiptVehicleText(rawText)) continue;
    if (isLineInboxSystemAcknowledgementText(rawText) || isLineInboxNoiseOrSeparatorOnlyText(rawText)) continue;
    const inboxMessageId = cleanLine(row.id);
    const lineMessageId = cleanLine(row.line_message_id);
    const workflowStatus = cleanLine(row.workflow_status);
    if (inboxMessageId && lineMessageId) {
      return { inboxMessageId, lineMessageId, rawText, workflowStatus, analyzePayload: row.analyze_payload };
    }
  }
  return null;
}

async function claimReceiptReply(params: {
  context: ReceiptTextContext;
  destination?: string;
  groupId: string;
  userId: string;
  receivedAt?: string;
}): Promise<{ id: string | null; duplicate: boolean }> {
  return insertLineInboxMessage(createServiceRoleClient(), {
    line_message_id: `receipt-ack:${params.context.lineMessageId}`,
    destination: params.destination ?? null,
    source_type: "group",
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: "[LINE receipt acknowledgement]",
    received_at: params.receivedAt,
    analyze_status: "ok",
    needs_human_review: false,
    workflow_status: "skipped",
  });
}

async function releaseReceiptReplyClaim(id: string | null): Promise<void> {
  if (!id) return;
  const { error } = await createServiceRoleClient().from(LINE_INBOX_MESSAGES_TABLE).delete().eq("id", id);
  if (error) console.warn("[line-webhook] receipt claim release failed", { error: cleanLine(error.message).slice(0, 300) });
}

async function isReceiptImageSetReady(params: {
  groupId: string;
  userId: string;
  receivedAt?: string;
  imageSet?: LineImageSet;
}): Promise<boolean> {
  const imageSet = normalizeLineImageSet(params.imageSet);
  if (!imageSet || imageSet.total <= 1) return true;

  const receivedMs = Date.parse(params.receivedAt ?? "");
  const imageTime = Number.isFinite(receivedMs) ? receivedMs : Date.now();
  const { data, error } = await createServiceRoleClient()
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("analyze_payload")
    .eq("source_type", "group")
    .eq("group_id", params.groupId)
    .eq("user_id", params.userId)
    .gte("received_at", new Date(imageTime - LINE_RECEIPT_IMAGE_AFTER_TEXT_WINDOW_MS).toISOString())
    .lte("received_at", new Date(imageTime + LINE_RECEIPT_IMAGE_AFTER_TEXT_WINDOW_MS).toISOString())
    .order("received_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[line-webhook] image-set lookup failed", { error: cleanLine(error.message).slice(0, 300) });
    return false;
  }

  return isLineImageSetComplete(
    imageSet,
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => row.analyze_payload)
  );
}

async function captureTextMessage(params: {
  destination: string | undefined;
  lineMessageId: string;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  rawText: string;
  replyToken: string | undefined;
  quotedMessageId?: string | null;
  quoteToken?: string | null;
  receivedAt?: string | undefined;
}): Promise<CaptureLineMessageResult> {
  const supabase = createServiceRoleClient();
  const replyContextPayload = makeLineReplyCaptureAnalyzePayload({
    quotedMessageId: params.quotedMessageId,
    quoteToken: params.quoteToken,
  });

  return insertLineInboxMessage(supabase, {
    line_message_id: params.lineMessageId,
    destination: params.destination ?? null,
    source_type: params.sourceType,
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: params.rawText,
    reply_token: params.replyToken ?? null,
    received_at: params.receivedAt,
    analyze_payload: replyContextPayload ?? undefined,
  });
}

async function maybeSendWebhookReceiptReply(params: {
  destination: string | undefined;
  replyToken: string | undefined;
  lineMessageId: string;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  messageType: CapturableLineMessageType;
  rawText?: string;
  receivedAt?: string;
  imageSet?: LineImageSet;
}): Promise<void> {
  if (!isTruthyEnvFlag(process.env.LINE_WEBHOOK_RECEIPT_REPLY_ENABLED)) return;
  if (isTruthyEnvFlag(process.env.LINE_AUTO_SAVE_REPLY_ENABLED)) return;
  if (!params.replyToken) return;
  if (params.sourceType !== "group") return;
  if (!shouldAttemptLineReceiptReply({ messageType: params.messageType, imageSet: params.imageSet, rawText: params.rawText })) return;
  if (!params.groupId || !params.userId) return;
  if (!(await isReceiptImageSetReady({
    groupId: params.groupId,
    userId: params.userId,
    receivedAt: params.receivedAt,
    imageSet: params.imageSet,
  }))) return;

  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim() ?? "";
  if (!token) {
    console.warn("[line-webhook] receipt reply skipped - LINE_CHANNEL_ACCESS_TOKEN is not set", {
      line_message_id: maskLineTarget(params.lineMessageId),
      group_id: maskLineTarget(params.groupId),
    });
    return;
  }

  const context = await findRecentReceiptTextContext(params);
  if (!context) return;
  if (!isReceiptContextPersisted(context)) return;
  const claim = await claimReceiptReply({
    context,
    destination: params.destination,
    groupId: params.groupId,
    userId: params.userId,
    receivedAt: params.receivedAt,
  });
  if (claim.duplicate) return;

  const cardDetails = extractReceiptCardDetails(context.rawText);
  if (!cardDetails.plate) {
    await releaseReceiptReplyClaim(claim.id);
    return;
  }
  const reviewUrl = buildLineOrderReviewUrl({ plate: cardDetails.plate });

  let sent = await replyLineJobReceiptMessage({
    accessToken: token,
    replyToken: params.replyToken,
    reviewUrl,
    ...cardDetails,
  });

  if (!sent.ok) {
    sent = await replyLineTextMessage({
      accessToken: token,
      replyToken: params.replyToken,
      text: cardDetails.plate ? `รับทราบงานแล้ว\n${cardDetails.plate}` : "รับทราบงานแล้ว",
    });
  }

  if (!sent.ok) {
    await releaseReceiptReplyClaim(claim.id);
    console.warn("[line-webhook] receipt reply not sent", {
      line_message_id: maskLineTarget(params.lineMessageId),
      group_id: maskLineTarget(params.groupId),
      status: sent.status ?? null,
      error: cleanLine(sent.error).slice(0, 300),
    });
    return;
  }

  console.info("[line-webhook] receipt reply sent", {
    line_message_id: maskLineTarget(params.lineMessageId),
    group_id: maskLineTarget(params.groupId),
  });
}

function normalizeCapturableMessageType(value: string | undefined): CapturableLineMessageType | null {
  if (value === "text" || value === "image" || value === "file" || value === "sticker") return value;
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
  imageSet?: LineImageSet;
}): Promise<CaptureLineMessageResult> {
  const supabase = createServiceRoleClient();
  const imageSet = normalizeLineImageSet(params.imageSet);
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
    analyze_payload: makeLineAttachmentAnalyzePayload(pendingAttachment, imageSet),
    needs_human_review: true,
  });

  if (inserted.duplicate || !inserted.id) return inserted;

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
      analyze_payload: makeLineAttachmentAnalyzePayload(missing, imageSet),
      needs_human_review: true,
      car_row_id: null,
    });
    console.warn("[line-webhook] image/file capture skipped - LINE_CHANNEL_ACCESS_TOKEN is not set");
    return inserted;
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
      analyze_payload: makeLineAttachmentAnalyzePayload(attachment, imageSet),
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
      analyze_payload: makeLineAttachmentAnalyzePayload(failed, imageSet),
      needs_human_review: true,
      car_row_id: null,
    });
    console.error("[line-webhook] image/file capture failed:", msg);
  }

  return inserted;
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

  if (!(await verifyLineWebhookSignature(secret, rawBody, signature))) {
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
  const allowedGroups = parseLineAllowedGroups(process.env.LINE_ALLOWED_GROUP_IDS);
  const acceptDm = process.env.LINE_ACCEPT_DM === "true";

  for (const ev of events) {
    if (!ev || ev.type !== "message") continue;
    const msg = ev.message;
    const messageType = normalizeCapturableMessageType(msg?.type);
    if (!msg || !messageType) continue;
    const text = messageType === "text" ? String(msg.text ?? "").trim() : "";
    const mid = String(msg.id ?? "").trim();
    if (!mid || (messageType === "text" && !text)) continue;
    if (messageType === "text" && isLineInboxSystemAcknowledgementText(text)) continue;

    const src = ev.source;
    if (!src?.type) continue;

    const replyToken = typeof ev.replyToken === "string" ? ev.replyToken : undefined;
    const quotedMessageId = extractLineQuotedMessageId(msg);
    const quoteToken = extractLineQuoteToken(msg);
    const receivedAt = receivedAtFromLineTimestamp(ev.timestamp);
    const runCapture = async (
      sourceType: "group" | "user" | "room",
      groupId: string | null,
      userId: string | null
    ): Promise<CaptureLineMessageResult> => {
      if (messageType === "text" || messageType === "sticker") {
        return captureTextMessage({
          destination,
          lineMessageId: mid,
          sourceType,
          groupId,
          userId,
          rawText: messageType === "sticker" ? "[LINE sticker]" : text,
          replyToken,
          quotedMessageId,
          quoteToken,
          receivedAt,
        });
      }

      return captureAttachmentMessage({
        destination,
        lineMessageId: mid,
        lineMessageType: messageType,
        fileName: msg.fileName,
        sourceType,
        groupId,
        userId,
        replyToken,
        receivedAt,
        imageSet: msg.imageSet,
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

      if (!allowedGroups.allowAllGroups && allowedGroups.groupIds.size === 0) {
        console.warn(
          "[line-webhook] skipped group message - set LINE_ALLOWED_GROUP_IDS to a comma-separated list or * for all groups"
        );
        continue;
      }
      if (!isLineGroupAllowed(gid, allowedGroups)) {
        if (gid && !logGroupDiscovery) {
          console.warn(`[line-webhook] skipped group ${gid} - not in LINE_ALLOWED_GROUP_IDS`);
        }
        continue;
      }

      try {
        await runCapture("group", gid, src.userId ? String(src.userId) : null);
        await maybeSendWebhookReceiptReply({
          destination,
          replyToken,
          lineMessageId: mid,
          sourceType: "group",
          groupId: gid,
          userId: src.userId ? String(src.userId) : null,
          messageType,
          rawText: messageType === "sticker" ? "[LINE sticker]" : text,
          receivedAt,
          imageSet: msg.imageSet,
        });
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
