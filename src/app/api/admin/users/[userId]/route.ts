import { NextResponse } from "next/server";
import { requireManageUsersRole } from "@/lib/auth/mutation-guard";
import { isUserRole, normalizeRole } from "@/lib/auth/user-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type RouteContext = { params: { userId: string } };

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;

  const userId = context.params.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let body: { role?: number; line_user_id?: string | null };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const admin = createServiceRoleClient();
  const { data: existing, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr || !existing?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { data: curProf, error: curErr } = await admin
    .from("profiles")
    .select("role, line_user_id")
    .eq("id", userId)
    .maybeSingle();

  if (curErr) {
    return NextResponse.json({ error: curErr.message }, { status: 500 });
  }

  const currentRole = normalizeRole(curProf?.role ?? 1);
  const currentLine =
    curProf?.line_user_id != null ? String(curProf.line_user_id).trim() : null;

  const hasRole = body.role !== undefined && body.role !== null;
  const hasLine = body.line_user_id !== undefined;

  if (!hasRole && !hasLine) {
    return NextResponse.json({ error: "Provide role and/or line_user_id" }, { status: 400 });
  }

  const newRole = hasRole ? Number(body.role) : currentRole;
  if (hasRole && !isUserRole(newRole)) {
    return NextResponse.json({ error: "role must be 1–4" }, { status: 400 });
  }

  if (gate.user.id === userId && newRole < 4) {
    return NextResponse.json(
      {
        error:
          "You cannot lower your own role below admin from this account. Ask another admin or use SQL if needed.",
      },
      { status: 403 }
    );
  }

  let nextLine: string | null = currentLine;
  if (hasLine) {
    if (body.line_user_id === null || body.line_user_id === "") {
      nextLine = null;
    } else {
      const lid = String(body.line_user_id).trim();
      if (lid.length > 120) {
        return NextResponse.json({ error: "line_user_id too long" }, { status: 400 });
      }
      if (!/^U[a-f0-9]{8,40}$/i.test(lid)) {
        return NextResponse.json(
          { error: "line_user_id must look like LINE user id (U + hex)" },
          { status: 400 }
        );
      }
      nextLine = lid;
    }
  }

  const { error } = await admin.from("profiles").upsert(
    {
      id: userId,
      role: newRole,
      line_user_id: nextLine,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId, role: newRole, line_user_id: nextLine });
}
