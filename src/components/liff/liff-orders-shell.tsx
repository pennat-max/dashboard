"use client";

import { useEffect, useState } from "react";
import { UserRound } from "lucide-react";
import { cn } from "@/lib/utils";

type LineProfileLite = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type Props = {
  children: React.ReactNode;
  taskFirst?: boolean;
};

type LineLiffConfig = {
  liffId?: string;
};

/**
 * LIFF Phase 1 wrapper: init SDK when LIFF ID is set; show a small context strip.
 * Does not replace Supabase auth — intake/API behavior unchanged.
 */
export function LiffOrdersShell({ children, taskFirst = false }: Props) {
  const [phase, setPhase] = useState<"idle" | "ready" | "skipped">("idle");
  const [initError, setInitError] = useState<string | null>(null);
  const [inClient, setInClient] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<LineProfileLite | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        const configRes = await fetch("/api/line/liff-config", { cache: "no-store" });
        const config = (await configRes.json()) as LineLiffConfig;
        const liffId = String(config.liffId ?? "").trim();
        if (!configRes.ok || !liffId) {
          if (!cancelled) setPhase("skipped");
          return;
        }
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId });
        if (cancelled) return;
        const inside = liff.isInClient();
        setInClient(inside);
        if (inside && liff.isLoggedIn()) {
          try {
            const p = await liff.getProfile();
            if (!cancelled) {
              setProfile({
                userId: p.userId,
                displayName: p.displayName,
                pictureUrl: p.pictureUrl ?? undefined,
              });
            }
          } catch {
            /** LIFF app must include "profile" scope in LINE Developers, or getProfile throws "permission is not in LIFF app scope" */
            if (!cancelled) setProfile(null);
          }
        }
        setPhase("ready");
      } catch (e) {
        if (!cancelled) {
          setInitError(e instanceof Error ? e.message : String(e));
          setPhase("ready");
        }
      }
    }

    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const configMissing = phase === "skipped";
  const indicatorParts: string[] = [];
  if (configMissing) {
    indicatorParts.push("Missing NEXT_PUBLIC_LINE_LIFF_ID");
  } else if (initError) {
    indicatorParts.push(`LIFF: ${initError}`);
  } else if (inClient === null && phase === "idle") {
    indicatorParts.push("LIFF…");
  } else if (inClient === true) {
    if (profile?.displayName) {
      indicatorParts.push(profile.displayName);
    } else {
      indicatorParts.push("LINE");
    }
  } else {
    indicatorParts.push("Browser preview");
  }

  if (taskFirst) {
    return (
      <div className="min-h-screen min-w-0 bg-white">
        <header className="sticky top-0 z-40 border-b border-slate-100 bg-white/95 px-4 pb-3 pt-[max(env(safe-area-inset-top,0px),0.75rem)] backdrop-blur-md">
          <div className="mx-auto flex max-w-lg items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-[26px] font-bold tracking-[-0.025em] text-[#092a55]">Order Tracking</h1>
              {inClient === true && profile?.displayName ? (
                <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{profile.displayName}</p>
              ) : null}
            </div>
            <div className="flex size-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[#eef5fb] text-[#0b3b72] ring-1 ring-slate-200">
              {profile?.pictureUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={profile.pictureUrl} alt={profile.displayName || "LINE profile"} className="size-full object-cover" />
              ) : (
                <UserRound className="size-5" strokeWidth={1.9} aria-hidden />
              )}
            </div>
          </div>
        </header>
        {initError ? (
          <div
            className={cn(
              "mx-auto max-w-lg px-4 py-2 text-xs font-medium",
              configMissing ? "bg-amber-50 text-amber-900" : "bg-rose-50 text-rose-900"
            )}
            role="status"
            aria-live="polite"
          >
            {indicatorParts.join(" · ")}
          </div>
        ) : null}
        {children}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={cn(
          "sticky top-0 z-30 flex shrink-0 items-center gap-2 border-b border-slate-200/90 bg-slate-50/95 px-3 py-2 text-[11px] text-slate-700 backdrop-blur-sm",
          configMissing && "border-amber-200 bg-amber-50/95 text-amber-950",
          initError && !configMissing && "border-rose-200 bg-rose-50/95 text-rose-950"
        )}
        role="status"
        aria-live="polite"
      >
        <span className="font-semibold uppercase tracking-wide text-slate-500">LIFF</span>
        <span className="truncate">{indicatorParts.join(" · ")}</span>
        {profile?.pictureUrl ? (
          <span className="ml-auto size-6 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-slate-100">
            {/* LINE CDN avatar — avoid next/image remote config in Phase 1 */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={profile.pictureUrl} alt="" className="size-full object-cover" />
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
