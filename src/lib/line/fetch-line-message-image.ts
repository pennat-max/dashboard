/**
 * LINE Messaging API — binary content for image messages.
 * Requires LINE_CHANNEL_ACCESS_TOKEN (same as reply API).
 * @see https://developers.line.biz/en/reference/messaging-api/#get-image-content
 */
export async function fetchLineMessageImageContent(
  lineMessageId: string,
  channelAccessToken: string
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const token = channelAccessToken.trim();
  const mid = lineMessageId.trim();
  if (!token || !mid) return null;

  const res = await fetch(`https://api-data.line.me/v2/bot/message/${encodeURIComponent(mid)}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    console.warn("[line-image] fetch content failed:", res.status, mid);
    return null;
  }

  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, contentType };
}

export function extensionFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "jpg";
}
