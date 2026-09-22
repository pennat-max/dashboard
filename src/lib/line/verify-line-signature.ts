/**
 * Verify `X-Line-Signature` for webhook POST body (raw string, not parsed JSON).
 * @see https://developers.line.biz/en/reference/messaging-api/#signature-validation
 */
export async function verifyLineWebhookSignature(
  channelSecret: string,
  rawBody: string,
  signatureHeader: string | null
): Promise<boolean> {
  if (!signatureHeader || !channelSecret) return false;
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(channelSecret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signed = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(rawBody))
    );
    let binary = "";
    for (const byte of signed) binary += String.fromCharCode(byte);
    const digest = btoa(binary);
    if (digest.length !== signatureHeader.length) return false;
    let mismatch = 0;
    for (let index = 0; index < digest.length; index += 1) {
      mismatch |= digest.charCodeAt(index) ^ signatureHeader.charCodeAt(index);
    }
    return mismatch === 0;
  } catch {
    return false;
  }
}
