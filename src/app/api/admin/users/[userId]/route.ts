import { NextResponse } from "next/server";
import { requireManageUsersRole } from "@/lib/auth/mutation-guard";
import { isUserRole } from "@/lib/auth/user-role";
import { createServiceRoleClient } from "@/lib/site/data";

type RouteContext = { params: Promise<{ userId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;
  const params = await context.params;
  const userId = params.userId?.trim();
  if (!userId) return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  let body: { role?: number };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const newRole = Number(body.role);
  if (!isUserRole(newRole)) return NextResponse.json({ error: "role must be 1–4" }, { status: 400 });
  const admin = createServiceRoleClient();
  const existing = await admin.from("profiles").select("id,email,role").eq("id", userId).maybeSingle();
  if (existing.error || !existing.data) return NextResponse.json({ error: "User not found" }, { status: 404 });
  if (String(existing.data.email).toLowerCase() === gate.user.email && newRole < 4) {
    return NextResponse.json({ error: "You cannot lower your own role below admin." }, { status: 403 });
  }
  const updated = await admin.from("profiles").update({ role: newRole, updated_at: new Date().toISOString() }).eq("id", userId);
  if (updated.error) return NextResponse.json({ error: updated.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, userId, role: newRole });
}
