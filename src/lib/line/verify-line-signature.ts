import crypto from "crypto";

/**
 * Verify `X-Line-Signature` for webhook POST body (raw string, not parsed JSON).
 * @see https://developers.line.biz/en/reference/messaging-api/#signature-validation
 */
export function verifyLineWebhookSignature(channelSecret: string, rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !channelSecret) return false;
  const mac = crypto.createHmac("sha256", channelSecret);
  mac.update(rawBody, "utf8");
  const digest = mac.digest("base64");
  try {
    const a = Buffer.from(digest, "utf8");
    const b = Buffer.from(signatureHeader, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
