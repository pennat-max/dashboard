import { NextResponse } from "next/server";
import { verifyLineIdToken } from "@/lib/line/verify-line-id-token";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

function lineChannelIdForVerify(): string {
  return (
    process.env.LINE_LOGIN_CHANNEL_ID?.trim() ||
    process.env.NEXT_PUBLIC_LINE_CHANNEL_ID?.trim() ||
    ""
  );
}

function resolveRedirectTo(request: Request): string {
  try {
    const u = new URL(request.url);
    const next = u.searchParams.get("next");
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  } catch {
    /** ignore */
  }
  return "/liff/orders?load=full";
}

/**
 * POST body: { id_token: string } — LINE LIFF ID token.
 * Looks up profiles.line_user_id, then returns Supabase magic-link URL to complete session.
 */
export async function POST(request: Request) {
  const channelId = lineChannelIdForVerify();
  if (!channelId) {
    return NextResponse.json(
      {
        error:
          "Server missing LINE_LOGIN_CHANNEL_ID or NEXT_PUBLIC_LINE_CHANNEL_ID (LINE Developers → channel ID)",
      },
      { status: 503 }
    );
  }

  let body: { id_token?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const idToken = String(body.id_token ?? "").trim();
  if (!idToken) {
    return NextResponse.json({ error: "id_token required" }, { status: 400 });
  }

  const verified = await verifyLineIdToken(idToken, channelId);
  if ("error" in verified) {
    return NextResponse.json({ error: verified.error }, { status: 401 });
  }

  const admin = createServiceRoleClient();
  const { data: prof, error: pErr } = await admin
    .from("profiles")
    .select("id")
    .eq("line_user_id", verified.sub)
    .maybeSingle();

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 });
  }
  if (!prof?.id) {
    return NextResponse.json(
      { error: "no_linked_account", line_user_id: verified.sub },
      { status: 404 }
    );
  }

  const userId = String(prof.id);
  const { data: userRes, error: uErr } = await admin.auth.admin.getUserById(userId);
  if (uErr || !userRes?.user?.email) {
    return NextResponse.json({ error: "auth_user_missing_email" }, { status: 500 });
  }

  const redirectTo = resolveRedirectTo(request);
  const origin = new URL(request.url).origin;

  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: userRes.user.email,
    options: {
      redirectTo: `${origin}${redirectTo.startsWith("/") ? redirectTo : "/liff/orders?load=full"}`,
    },
  });

  if (linkErr || !linkData?.properties?.action_link) {
    return NextResponse.json(
      { error: linkErr?.message ?? "generate_link_failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    action_link: linkData.properties.action_link as string,
  });
}
