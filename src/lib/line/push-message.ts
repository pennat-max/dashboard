const LINE_PUSH_MESSAGE_URL = "https://api.line.me/v2/bot/message/push";

export type LinePushTextResult =
  | { ok: true }
  | { ok: false; status?: number; error: string };

function cleanErrorMessage(value: unknown): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  return raw.replace(/\s+/g, " ").trim().slice(0, 300) || "LINE push failed";
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

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(LINE_PUSH_MESSAGE_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: target,
        messages: [{ type: "text", text: bodyText }],
      }),
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
