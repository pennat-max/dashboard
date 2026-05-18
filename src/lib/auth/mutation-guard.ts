import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { isOpenOrderTrackingMutations } from "@/lib/auth/open-order-tracking-mutations";
import { createServerSupabase } from "@/lib/supabase/server";
import { canManageUsers, canMutate, normalizeRole, type UserRole } from "@/lib/auth/user-role";

const OPEN_MODE_USER_ID = "00000000-0000-4000-8000-000000000001";

function syntheticOpenModeUser(): User {
  return {
    id: OPEN_MODE_USER_ID,
    aud: "authenticated",
    role: "authenticated",
    app_metadata: {},
    user_metadata: { open_order_tracking: true },
    created_at: new Date(0).toISOString(),
  } as User;
}

let warnedOpenOrderTrackingMutations = false;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; response: NextResponse };

async function loadRole(): Promise<{ user: User | null; role: UserRole }> {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { user: null, role: 1 };

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.warn("[profiles] read failed in API, defaulting role=1:", error.message);
    return { user, role: 1 };
  }
  return { user, role: normalizeRole(profile?.role ?? 1) };
}

export async function requireMutateRole(): Promise<Ok<{ user: User; role: UserRole }> | Err> {
  if (isOpenOrderTrackingMutations()) {
    if (!warnedOpenOrderTrackingMutations) {
      warnedOpenOrderTrackingMutations = true;
      console.warn(
        "[auth] OPEN_ORDER_TRACKING_MUTATIONS allows mutations without login — set OPEN_ORDER_TRACKING_MUTATIONS=false to require Supabase session"
      );
    }
    return { ok: true, user: syntheticOpenModeUser(), role: 4 };
  }

  const { user, role } = await loadRole();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canMutate(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: role 3+ required to modify data" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user, role };
}

export async function requireManageUsersRole(): Promise<Ok<{ user: User; role: UserRole }> | Err> {
  const { user, role } = await loadRole();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canManageUsers(role)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Forbidden: role 4 required to manage users" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, user, role };
}
