import { NextResponse } from "next/server";
import { requireManageUsersRole } from "@/lib/auth/mutation-guard";
import { isUserRole } from "@/lib/auth/user-role";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

type RouteContext = { params: { userId: string } };

export async function PATCH(request: Request, context: RouteContext) {
  const gate = await requireManageUsersRole();
  if (!gate.ok) return gate.response;

  const userId = context.params.userId?.trim();
  if (!userId) {
    return NextResponse.json({ error: "Missing user id" }, { status: 400 });
  }

  let body: { role?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const newRole = Number(body.role);
  if (!isUserRole(newRole)) {
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

  const admin = createServiceRoleClient();
  const { data: existing, error: getErr } = await admin.auth.admin.getUserById(userId);
  if (getErr || !existing?.user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { error } = await admin.from("profiles").upsert(
    {
      id: userId,
      role: newRole,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, userId, role: newRole });
}
