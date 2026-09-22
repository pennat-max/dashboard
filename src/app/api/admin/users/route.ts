import { NextResponse } from "next/server";
import { requireManageUsersRole } from "@/lib/auth/mutation-guard";
import { isUserRole, normalizeRole, type UserRole } from "@/lib/auth/user-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type Body = { email?: string; role?: number };

export async function POST(request: Request) {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;
  let body: Body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  const email = String(body.email ?? "").trim().toLowerCase();
  const requestedRole = Number(body.role);
  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!isUserRole(requestedRole)) return NextResponse.json({ error: "role must be 1–4" }, { status: 400 });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const { data, error } = await createServiceRoleClient().from("profiles").upsert(
    { id, email, role: requestedRole as UserRole, created_at: now, updated_at: now },
    { onConflict: "email" },
  ).select("id,email,role").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, userId: data.id, email: data.email, role: normalizeRole(data.role) });
}

export async function GET() {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;
  const { data, error } = await createServiceRoleClient().from("profiles").select("id,email,created_at,role").order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const users = (data ?? []).map((row: Record<string, unknown>) => ({ ...row, role: normalizeRole(row.role) }));
  const current = users.find((row: Record<string, unknown>) => String(row.email).toLowerCase() === gate.user.email)?.id ?? gate.user.id;
  return NextResponse.json({ ok: true, currentUserId: current, users });
}
