import { NextResponse } from "next/server";
import { isOpenOrderTrackingMutations } from "@/lib/auth/open-order-tracking-mutations";
import { getChatGPTUser, type ChatGPTUser } from "@/lib/auth/chatgpt-auth";
import { createAnonClient } from "@/lib/supabase/anon";
import { canManageUsers, canMutate, normalizeRole, type UserRole } from "@/lib/auth/user-role";

const OPEN_MODE_USER_ID = "00000000-0000-4000-8000-000000000001";

function syntheticOpenModeUser(): ChatGPTUser {
  return {
    id: OPEN_MODE_USER_ID,
    email: "open-order-tracking@site.local",
    fullName: "Open order tracking",
  };
}

let warnedOpenOrderTrackingMutations = false;

type Ok<T> = { ok: true } & T;
type Err = { ok: false; response: NextResponse };

async function loadRole(): Promise<{ user: ChatGPTUser | null; role: UserRole }> {
  const user = await getChatGPTUser();
  if (!user) return { user: null, role: 1 };

  const { data: profile, error } = await createAnonClient()
    .from("profiles")
    .select("role")
    .eq("email", user.email)
    .maybeSingle();

  if (error) {
    console.warn("[profiles] read failed in API, defaulting role=1:", error.message);
    return { user, role: 1 };
  }
  return { user, role: normalizeRole(profile?.role ?? 1) };
}

export async function requireMutateRole(): Promise<Ok<{ user: ChatGPTUser; role: UserRole }> | Err> {
  if (isOpenOrderTrackingMutations()) {
    if (!warnedOpenOrderTrackingMutations) {
      warnedOpenOrderTrackingMutations = true;
      console.warn(
        "[auth] OPEN_ORDER_TRACKING_MUTATIONS allows mutations without login"
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

export async function requireManageUsersRole(): Promise<Ok<{ user: ChatGPTUser; role: UserRole }> | Err> {
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
