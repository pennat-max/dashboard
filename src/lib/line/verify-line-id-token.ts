/**
 * Verify LINE ID token (from LIFF getIDToken()) — returns LINE `sub` (user id).
 * @see https://developers.line.biz/en/reference/line-login/#verify-id-token
 */
export type LineIdTokenVerifyOk = { sub: string; aud?: string };

export async function verifyLineIdToken(
  idToken: string,
  clientId: string
): Promise<LineIdTokenVerifyOk | { error: string }> {
  const tok = String(idToken ?? "").trim();
  const cid = String(clientId ?? "").trim();
  if (!tok || !cid) return { error: "missing_token_or_client_id" };

  const body = new URLSearchParams();
  body.set("id_token", tok);
  body.set("client_id", cid);

  const res = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as {
    sub?: string;
    aud?: string;
    error?: string;
    error_description?: string;
  };

  if (!res.ok) {
    return {
      error: json.error_description ?? json.error ?? `line_verify_${res.status}`,
    };
  }
  const sub = String(json.sub ?? "").trim();
  if (!sub) return { error: "missing_sub" };
  return { sub, aud: json.aud };
}
