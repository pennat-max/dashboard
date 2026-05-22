import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyLineWebhookSignature } from "@/lib/line/verify-line-signature";
import { fetchLineMessageImageContent } from "@/lib/line/fetch-line-message-image";
import {
  insertLineInboxMessage,
  updateLineInboxMessageAnalyze,
  updateLineInboxMessageImage,
} from "@/lib/line-inbox/line-inbox-messages";
import { runLineInboxAnalyzeCore } from "@/lib/line-inbox/run-analyze-core";
import { findInboxRowToAttachForwardImage } from "@/lib/line-inbox/image-followup-merge";
import { LINE_INBOX_IMAGE_PLACEHOLDER } from "@/lib/line-inbox/line-image-placeholder";
import { uploadLineInboxImageToBucket } from "@/lib/line-inbox/upload-line-inbox-image";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseAllowedGroupIds(): Set<string> {
  const raw = process.env.LINE_ALLOWED_GROUP_IDS ?? "";
  return new Set(raw.split(",").map((s) => s.trim()).filter(Boolean));
}

type LineEvent = {
  type?: string;
  mode?: string;
  message?: { type?: string; id?: string; text?: string };
  source?: { type?: string; groupId?: string; userId?: string; roomId?: string };
  replyToken?: string;
};

async function ingestLineGroupImage(params: {
  destination: string | undefined;
  lineMessageId: string;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  replyToken: string | undefined;
}): Promise<void> {
  const channelToken = process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!channelToken) {
    console.warn(
      "[line-webhook] LINE_CHANNEL_ACCESS_TOKEN missing — set it to fetch image bytes from LINE (see .env.example)"
    );
  }

  const supabase = createServiceRoleClient();

  if (channelToken) {
    const mergeTargetId = await findInboxRowToAttachForwardImage(supabase, {
      sourceType: params.sourceType,
      groupId: params.groupId,
      userId: params.userId,
    });
    if (mergeTargetId) {
      const fetched = await fetchLineMessageImageContent(params.lineMessageId, channelToken);
      if (fetched) {
        const path = await uploadLineInboxImageToBucket(
          supabase,
          mergeTargetId,
          params.lineMessageId,
          fetched.bytes,
          fetched.contentType
        );
        if (path) {
          try {
            await updateLineInboxMessageImage(supabase, mergeTargetId, {
              image_storage_path: path,
              image_mime_type: fetched.contentType,
            });
            console.info(
              `[line-webhook] attached forward image to existing inbox row ${mergeTargetId} (text said ตามรูป/ตามภาพ)`
            );
            return;
          } catch (e) {
            console.error(
              "[line-webhook] merge follow-up image:",
              e instanceof Error ? e.message : e
            );
          }
        }
      }
    }
  }

  const inserted = await insertLineInboxMessage(supabase, {
    line_message_id: params.lineMessageId,
    destination: params.destination ?? null,
    source_type: params.sourceType,
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: LINE_INBOX_IMAGE_PLACEHOLDER,
    reply_token: params.replyToken ?? null,
  });

  if (inserted.duplicate || !inserted.id) {
    return;
  }

  const rowId = inserted.id;
  let storedOk = false;

  if (channelToken) {
    const fetched = await fetchLineMessageImageContent(params.lineMessageId, channelToken);
    if (fetched) {
      const path = await uploadLineInboxImageToBucket(
        supabase,
        rowId,
        params.lineMessageId,
        fetched.bytes,
        fetched.contentType
      );
      if (path) {
        storedOk = true;
        try {
          await updateLineInboxMessageImage(supabase, rowId, {
            image_storage_path: path,
            image_mime_type: fetched.contentType,
          });
        } catch (e) {
          console.error("[line-webhook] update image path:", e instanceof Error ? e.message : e);
        }
      }
    }
  }

  try {
    const payload = await runLineInboxAnalyzeCore(supabase, {
      raw_text: LINE_INBOX_IMAGE_PLACEHOLDER,
      attachmentsCount: 1,
    });
    const carRow = String(payload.detected_car.car_row_id ?? "").trim();
    await updateLineInboxMessageAnalyze(supabase, rowId, {
      analyze_status: "ok",
      analyze_error: null,
      analyze_payload: payload as unknown,
      needs_human_review: payload.needs_human_review,
      car_row_id: carRow || null,
    });
    if (!storedOk && channelToken) {
      console.warn(
        `[line-webhook] image message ${params.lineMessageId} analyzed but file not stored — check Storage / token`
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateLineInboxMessageAnalyze(supabase, rowId, {
      analyze_status: "error",
      analyze_error: msg,
      analyze_payload: null,
      needs_human_review: null,
      car_row_id: null,
    });
  }
}

async function ingestAndAnalyzeText(params: {
  destination: string | undefined;
  lineMessageId: string;
  sourceType: "group" | "user" | "room";
  groupId: string | null;
  userId: string | null;
  rawText: string;
  replyToken: string | undefined;
}): Promise<void> {
  const supabase = createServiceRoleClient();

  const inserted = await insertLineInboxMessage(supabase, {
    line_message_id: params.lineMessageId,
    destination: params.destination ?? null,
    source_type: params.sourceType,
    group_id: params.groupId,
    user_id: params.userId,
    raw_text: params.rawText,
    reply_token: params.replyToken ?? null,
  });

  if (inserted.duplicate || !inserted.id) {
    return;
  }

  const rowId = inserted.id;

  try {
    const payload = await runLineInboxAnalyzeCore(supabase, {
      raw_text: params.rawText,
      attachmentsCount: 0,
    });
    const carRow = String(payload.detected_car.car_row_id ?? "").trim();
    await updateLineInboxMessageAnalyze(supabase, rowId, {
      analyze_status: "ok",
      analyze_error: null,
      analyze_payload: payload as unknown,
      needs_human_review: payload.needs_human_review,
      car_row_id: carRow || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateLineInboxMessageAnalyze(supabase, rowId, {
      analyze_status: "error",
      analyze_error: msg,
      analyze_payload: null,
      needs_human_review: null,
      car_row_id: null,
    });
  }
}

/**
 * LINE Messaging API webhook — verifies signature, stores text + image messages, runs inbox analyze.
 * Configure URL in LINE Developers → Messaging API → Webhook URL.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature");
  const secret = process.env.LINE_CHANNEL_SECRET?.trim();

  if (!secret) {
    console.error("[line-webhook] LINE_CHANNEL_SECRET is not set — configure env and redeploy");
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
    if (!msg?.type || !msg.id) continue;
    const mid = String(msg.id).trim();
    if (!mid) continue;

    const msgType = msg.type;
    if (msgType !== "text" && msgType !== "image") continue;

    const text = msgType === "text" ? String(msg.text ?? "").trim() : "";
    if (msgType === "text" && !text) continue;

    const src = ev.source;
    if (!src?.type) continue;

    const replyToken = typeof ev.replyToken === "string" ? ev.replyToken : undefined;

    if (src.type === "group") {
      const gid = String(src.groupId ?? "").trim();
      /** Set LINE_WEBHOOK_LOG_GROUP_IDS=true temporarily — send any text in the group, read server logs, copy the `groupId` into LINE_ALLOWED_GROUP_IDS */
      const logGroupDiscovery = process.env.LINE_WEBHOOK_LOG_GROUP_IDS === "true";
      if (logGroupDiscovery && gid) {
        console.info(
          `[line-webhook] groupId=${gid} — add to env · LINE_ALLOWED_GROUP_IDS=${gid} (then turn LINE_WEBHOOK_LOG_GROUP_IDS off)`
        );
      }

      if (allowedGroups.size === 0) {
        console.warn(
          "[line-webhook] skipped group message — set LINE_ALLOWED_GROUP_IDS (see LINE_WEBHOOK_LOG_GROUP_IDS in .env.example)"
        );
        continue;
      }
      if (!gid || !allowedGroups.has(gid)) {
        if (gid && !logGroupDiscovery) {
          console.warn(`[line-webhook] skipped group ${gid} — not in LINE_ALLOWED_GROUP_IDS`);
        }
        continue;
      }

      try {
        if (msgType === "text") {
          await ingestAndAnalyzeText({
            destination,
            lineMessageId: mid,
            sourceType: "group",
            groupId: gid,
            userId: src.userId ? String(src.userId) : null,
            rawText: text,
            replyToken,
          });
        } else {
          await ingestLineGroupImage({
            destination,
            lineMessageId: mid,
            sourceType: "group",
            groupId: gid,
            userId: src.userId ? String(src.userId) : null,
            replyToken,
          });
        }
      } catch (e) {
        console.error("[line-webhook] ingest failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "user" && acceptDm) {
      try {
        if (msgType === "text") {
          await ingestAndAnalyzeText({
            destination,
            lineMessageId: mid,
            sourceType: "user",
            groupId: null,
            userId: src.userId ? String(src.userId) : null,
            rawText: text,
            replyToken,
          });
        } else {
          await ingestLineGroupImage({
            destination,
            lineMessageId: mid,
            sourceType: "user",
            groupId: null,
            userId: src.userId ? String(src.userId) : null,
            replyToken,
          });
        }
      } catch (e) {
        console.error("[line-webhook] ingest DM failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "room") {
      if (process.env.LINE_ACCEPT_ROOM !== "true") continue;
      try {
        if (msgType === "text") {
          await ingestAndAnalyzeText({
            destination,
            lineMessageId: mid,
            sourceType: "room",
            groupId: null,
            userId: src.userId ? String(src.userId) : null,
            rawText: text,
            replyToken,
          });
        } else {
          await ingestLineGroupImage({
            destination,
            lineMessageId: mid,
            sourceType: "room",
            groupId: null,
            userId: src.userId ? String(src.userId) : null,
            replyToken,
          });
        }
      } catch (e) {
        console.error("[line-webhook] ingest room failed:", e instanceof Error ? e.message : e);
      }
    }
  }

  return new Response("OK", { status: 200 });
}

export async function GET() {
  return new Response("LINE webhook endpoint — POST only", { status: 405 });
}
