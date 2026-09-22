import { headers } from "next/headers";

export type ChatGPTUser = { id: string; email: string; fullName: string | null };

export async function getChatGPTUser(): Promise<ChatGPTUser | null> {
  const requestHeaders = await headers();
  const id = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (!id || !email) return null;
  const encodedName = requestHeaders.get("oai-authenticated-user-full-name");
  let fullName: string | null = null;
  if (encodedName && requestHeaders.get("oai-authenticated-user-full-name-encoding") === "percent-encoded-utf-8") {
    try { fullName = decodeURIComponent(encodedName); } catch { /* optional display value */ }
  }
  return { id, email, fullName };
}

export function chatGPTSignInPath(returnTo = "/dashboard") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/dashboard";
  return `/signin-with-chatgpt?return_to=${encodeURIComponent(safe)}`;
}

export function chatGPTSignOutPath(returnTo = "/") {
  const safe = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
  return `/signout-with-chatgpt?return_to=${encodeURIComponent(safe)}`;
}
