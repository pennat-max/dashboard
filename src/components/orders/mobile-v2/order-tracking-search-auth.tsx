"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { UserRole } from "@/lib/auth/user-role";
import { ROLE_LABELS } from "@/lib/auth/role-labels";

type UiLang = "th" | "en";

export function OrderTrackingSearchAuth({ uiLang }: { uiLang: UiLang }) {
  const pathname = usePathname() ?? "/m/orders";
  const searchParams = useSearchParams();
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  const pathWithQuery =
    pathname + (searchParams?.toString().length ? `?${searchParams.toString()}` : "");
  const next =
    pathname.startsWith("/login") || pathname.startsWith("/auth/")
      ? "/m/orders?load=full"
      : pathWithQuery || "/m/orders?load=full";

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createBrowserSupabase();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.email) {
        setEmail(null);
        setRole(null);
        return;
      }
      setEmail(user.email);
      const { data: prof } = await supabase.from("profiles").select("role").eq("id", user.id).maybeSingle();
      const r = Number(prof?.role);
      setRole(r >= 1 && r <= 4 ? (r as UserRole) : 1);
    } catch {
      setEmail(null);
      setRole(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signOut = async () => {
    setSigningOut(true);
    try {
      const supabase = createBrowserSupabase();
      await supabase.auth.signOut();
    } finally {
      setSigningOut(false);
      setEmail(null);
      setRole(null);
      router.replace(next.startsWith("/m") ? next : "/m/orders");
      router.refresh();
    }
  };

  if (loading) {
    return (
      <span className="shrink-0 text-[10px] font-medium text-slate-500" aria-hidden>
        …
      </span>
    );
  }

  if (!email) {
    return (
      <Link
        href={`/login?next=${encodeURIComponent(
          next.startsWith("/m/orders") && !next.includes("load=") ? `${pathname}?load=full` : next
        )}`}
        className={cn(
          "inline-flex h-10 shrink-0 items-center justify-center rounded-2xl px-3 text-xs font-semibold touch-manipulation",
          "bg-violet-600 text-white ring-1 ring-violet-700/40 active:bg-violet-700/90"
        )}
      >
        {uiLang === "en" ? "Login" : "เข้าสู่ระบบ"}
      </Link>
    );
  }

  const roleLabel = role != null ? ROLE_LABELS[role] : "";
  return (
    <div className="flex max-w-[9.5rem] shrink-0 flex-col items-end gap-0.5 text-right">
      <span className="truncate text-[10px] font-medium leading-tight text-slate-700" title={email}>
        {email}
      </span>
      {role != null ? (
        <span className="text-[9px] font-medium text-violet-800" title={roleLabel}>
          {uiLang === "en" ? `Role ${role}` : `สิทธิ์ ${role}`} · {roleLabel}
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 min-h-7 px-2 text-[10px] touch-manipulation"
        onPointerDown={(e) => e.preventDefault()}
        onClick={() => void signOut()}
        disabled={signingOut}
      >
        {signingOut ? "…" : uiLang === "en" ? "Sign out" : "ออก"}
      </Button>
    </div>
  );
}
