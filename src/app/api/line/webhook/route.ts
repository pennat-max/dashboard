import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { verifyLineWebhookSignature } from "@/lib/line/verify-line-signature";
import { insertLineInboxMessage } from "@/lib/line-inbox/line-inbox-messages";

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
  message?: { type?: string; id?: string; text?: string };
  source?: { type?: string; groupId?: string; userId?: string; roomId?: string };
  replyToken?: string;
};

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

/**
 * LINE Messaging API webhook - verifies signature and stores text messages only.
 * Configure URL in LINE Developers -> Messaging API -> Webhook URL.
 *
 * Phase 2 is capture-only: no auto reply, no AI analyze, no order_items writes.
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
    if (!msg || msg.type !== "text") continue;
    const text = String(msg.text ?? "").trim();
    const mid = String(msg.id ?? "").trim();
    if (!text || !mid) continue;

    const src = ev.source;
    if (!src?.type) continue;

    const replyToken = typeof ev.replyToken === "string" ? ev.replyToken : undefined;
    const receivedAt = receivedAtFromLineTimestamp(ev.timestamp);

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
        await captureTextMessage({
          destination,
          lineMessageId: mid,
          sourceType: "group",
          groupId: gid,
          userId: src.userId ? String(src.userId) : null,
          rawText: text,
          replyToken,
          receivedAt,
        });
      } catch (e) {
        console.error("[line-webhook] capture failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "user" && acceptDm) {
      try {
        await captureTextMessage({
          destination,
          lineMessageId: mid,
          sourceType: "user",
          groupId: null,
          userId: src.userId ? String(src.userId) : null,
          rawText: text,
          replyToken,
          receivedAt,
        });
      } catch (e) {
        console.error("[line-webhook] capture DM failed:", e instanceof Error ? e.message : e);
      }
      continue;
    }

    if (src.type === "room") {
      if (process.env.LINE_ACCEPT_ROOM !== "true") continue;
      try {
        await captureTextMessage({
          destination,
          lineMessageId: mid,
          sourceType: "room",
          groupId: null,
          userId: src.userId ? String(src.userId) : null,
          rawText: text,
          replyToken,
          receivedAt,
        });
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
