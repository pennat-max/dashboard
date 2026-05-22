import { NextResponse } from "next/server";
import { requireManageUsersRole } from "@/lib/auth/mutation-guard";
import { isUserRole, normalizeRole, type UserRole } from "@/lib/auth/user-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type Body = {
  email?: string;
  password?: string;
  role?: number;
};

export async function POST(request: Request) {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const email = String(body.email ?? "").trim().toLowerCase();
  const password = String(body.password ?? "");
  const requestedRole = Number(body.role);

  if (!email || !email.includes("@")) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (!isUserRole(requestedRole)) {
    return NextResponse.json({ error: "role must be 1–4" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const newId = created.user?.id;
  if (!newId) {
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  }

  const newRole = requestedRole as UserRole;
  const { error: upErr } = await admin.from("profiles").upsert(
    { id: newId, role: newRole, updated_at: new Date().toISOString() },
    { onConflict: "id" }
  );

  if (upErr) {
    return NextResponse.json(
      {
        error: `${upErr.message} · apply public.profiles migration (see supabase/migrations/20260502120000_profiles_roles.sql)`,
      },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, userId: newId, email, role: newRole });
}

/** List Auth users + roles from `profiles` (role 4 only). */
export async function GET() {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;

  const admin = createServiceRoleClient();
  const { data: page1, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (listErr) {
    return NextResponse.json({ error: listErr.message }, { status: 500 });
  }

  const authUsers = page1?.users ?? [];
  const ids = authUsers.map((u) => u.id);

  const roleById = new Map<string, number>();
  const lineById = new Map<string, string | null>();
  if (ids.length > 0) {
    const { data: rows, error: profErr } = await admin.from("profiles").select("id, role, line_user_id").in("id", ids);
    if (profErr) {
      return NextResponse.json({ error: profErr.message }, { status: 500 });
    }
    for (const row of rows ?? []) {
      if (row.id != null && row.role != null) {
        roleById.set(String(row.id), Number(row.role));
      }
      if (row.id != null) {
        const lid = row.line_user_id != null ? String(row.line_user_id).trim() : "";
        lineById.set(String(row.id), lid || null);
      }
    }
  }

  const users = authUsers.map((u) => ({
    id: u.id,
    email: u.email ?? "",
    created_at: u.created_at,
    role: normalizeRole(roleById.get(u.id) ?? 1),
    line_user_id: lineById.get(u.id) ?? null,
  }));

  return NextResponse.json({
    ok: true,
    currentUserId: gate.user.id,
    users,
  });
}
