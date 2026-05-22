import type { User } from "@supabase/supabase-js";
import { createServerSupabase } from "@/lib/supabase/server";
import { normalizeRole, type UserRole } from "@/lib/auth/user-role";

export type SessionWithRole = {
  user: User | null;
  /** null เมื่อยังไม่ล็อกอิน */
  role: UserRole | null;
};

/**
 * อ่าน session + role จากตาราง public.profiles (ไม่มีแถว = role 1)
 * ถ้ายังไม่รัน migration `profiles` จะตีความเป็น role 1
 */
export async function getSessionAndRole(): Promise<SessionWithRole> {
  try {
    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { user: null, role: null };

    const { data: profile, error } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      console.warn("[profiles] read failed, defaulting role=1:", error.message);
      return { user, role: 1 };
    }

    const role = normalizeRole(profile?.role ?? 1);
    return { user, role };
  } catch {
    return { user: null, role: null };
  }
}
