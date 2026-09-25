const LINE_PUSH_MESSAGE_URL = "https://api.line.me/v2/bot/message/push";
const LINE_REPLY_MESSAGE_URL = "https://api.line.me/v2/bot/message/reply";

export type LinePushTextResult =
  | { ok: true }
  | { ok: false; status?: number; error: string };

export type LineSendErrorReason = "line_quota_limit" | "line_error";

type LineTextMessage = {
  type: "text";
  text: string;
};

type LineFlexMessage = {
  type: "flex";
  altText: string;
  contents: Record<string, unknown>;
};

type LineOutboundMessage = LineTextMessage | LineFlexMessage;

function cleanErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 300) || "LINE push failed";
}

export function classifyLineSendError(status: number | undefined, error: string | undefined): LineSendErrorReason {
  const message = String(error ?? "").toLowerCase();
  if (status === 429 && (message.includes("monthly limit") || message.includes("quota") || message.includes("limit"))) {
    return "line_quota_limit";
  }
  return "line_error";
}

async function sendLineMessages({
  accessToken,
  url,
  body,
  missingTargetError,
}: {
  accessToken: string;
  url: string;
  body: Record<string, unknown>;
  missingTargetError: string;
}): Promise<LinePushTextResult> {
  const token = accessToken.trim();
  if (!token) return { ok: false, error: "Missing LINE_CHANNEL_ACCESS_TOKEN" };
  if (!body.to && !body.replyToken) return { ok: false, error: missingTargetError };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return { ok: true };
    let message = res.statusText || `HTTP ${res.status}`;
    try {
      const parsed = (await res.json()) as { message?: unknown };
      message = cleanErrorMessage(parsed.message ?? message);
    } catch {
      // Keep status text when LINE returns a non-JSON response.
    }
    return { ok: false, status: res.status, error: message };
  } catch (error) {
    return { ok: false, error: cleanErrorMessage(error) };
  } finally {
    clearTimeout(timeout);
  }
}

function lineOrderReviewFlexMessage(reviewUrl: string): LineFlexMessage {
  return {
    type: "flex",
    altText: "รับทราบ - ดูรายละเอียด",
    contents: {
      type: "bubble",
      size: "micro",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: "รับทราบ",
            weight: "bold",
            size: "md",
            color: "#111827",
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#0f172a",
            action: {
              type: "uri",
              label: "ดูรายละเอียด",
              uri: reviewUrl,
            },
          },
        ],
      },
    },
  };
}

function lineJobReviewFlexMessage({
  reviewUrl,
  carTitle,
  itemCount,
}: {
  reviewUrl: string;
  carTitle: string;
  itemCount: number;
}): LineFlexMessage {
  const title = carTitle.trim() || "งานจาก LINE";
  const count = Math.max(0, Math.floor(itemCount || 0));
  return {
    type: "flex",
    altText: `รับทราบ - ${title}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: "รับทราบ",
            weight: "bold",
            size: "lg",
            color: "#111827",
          },
          {
            type: "text",
            text: title.slice(0, 120),
            size: "sm",
            color: "#334155",
            wrap: true,
          },
          {
            type: "text",
            text: count > 0 ? `ระบบจับงานได้ ${count} รายการ รอตรวจในเว็บ` : "ระบบจัดเข้าคิวงานแล้ว รอตรวจในเว็บ",
            size: "xs",
            color: "#64748b",
            wrap: true,
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            height: "sm",
            color: "#0f172a",
            action: {
              type: "uri",
              label: "ดูรายละเอียดงาน",
              uri: reviewUrl,
            },
          },
        ],
      },
    },
  };
}

export async function pushLineMessages({
  accessToken,
  to,
  messages,
}: {
  accessToken: string;
  to: string;
  messages: LineOutboundMessage[];
}): Promise<LinePushTextResult> {
  const target = to.trim();
  const safeMessages = messages.filter(Boolean).slice(0, 5);
  if (!target) return { ok: false, error: "Missing LINE push target" };
  if (safeMessages.length === 0) return { ok: false, error: "Missing LINE messages" };
  return sendLineMessages({
    accessToken,
    url: LINE_PUSH_MESSAGE_URL,
    body: { to: target, messages: safeMessages },
    missingTargetError: "Missing LINE push target",
  });
}

export async function pushLineOrderReviewMessage({
  accessToken,
  to,
  reviewUrl,
}: {
  accessToken: string;
  to: string;
  reviewUrl: string;
}): Promise<LinePushTextResult> {
  const safeUrl = reviewUrl.trim();
  if (!safeUrl) return { ok: false, error: "Missing LINE review URL" };
  return pushLineMessages({
    accessToken,
    to,
    messages: [lineOrderReviewFlexMessage(safeUrl)],
  });
}

export async function pushLineJobReviewMessage({
  accessToken,
  to,
  reviewUrl,
  carTitle,
  itemCount,
}: {
  accessToken: string;
  to: string;
  reviewUrl: string;
  carTitle: string;
  itemCount: number;
}): Promise<LinePushTextResult> {
  const safeUrl = reviewUrl.trim();
  if (!safeUrl) return { ok: false, error: "Missing LINE job review URL" };
  return pushLineMessages({
    accessToken,
    to,
    messages: [lineJobReviewFlexMessage({ reviewUrl: safeUrl, carTitle, itemCount })],
  });
}

export async function pushLineTextMessage({
  accessToken,
  to,
  text,
}: {
  accessToken: string;
  to: string;
  text: string;
}): Promise<LinePushTextResult> {
  const token = accessToken.trim();
  const target = to.trim();
  const bodyText = text.trim();
  if (!token) return { ok: false, error: "Missing LINE_CHANNEL_ACCESS_TOKEN" };
  if (!target) return { ok: false, error: "Missing LINE push target" };
  if (!bodyText) return { ok: false, error: "Missing LINE message text" };
  return pushLineMessages({ accessToken: token, to: target, messages: [{ type: "text", text: bodyText }] });
}

export async function replyLineTextMessage({
  accessToken,
  replyToken,
  text,
}: {
  accessToken: string;
  replyToken: string;
  text: string;
}): Promise<LinePushTextResult> {
  const token = accessToken.trim();
  const lineReplyToken = replyToken.trim();
  const bodyText = text.trim();
  if (!token) return { ok: false, error: "Missing LINE_CHANNEL_ACCESS_TOKEN" };
  if (!lineReplyToken) return { ok: false, error: "Missing LINE reply token" };
  if (!bodyText) return { ok: false, error: "Missing LINE message text" };
  return sendLineMessages({
    accessToken: token,
    url: LINE_REPLY_MESSAGE_URL,
    body: { replyToken: lineReplyToken, messages: [{ type: "text", text: bodyText }] },
    missingTargetError: "Missing LINE reply token",
  });
}
