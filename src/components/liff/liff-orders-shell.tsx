"use client";

import { useEffect, useRef, useState } from "react";
import { getLineLiffId } from "@/lib/line/liff-config";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { cn } from "@/lib/utils";

type LineProfileLite = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

type Props = {
  children: React.ReactNode;
};

/**
 * LIFF wrapper: init SDK; show context strip; optional auto sign-in to Supabase
 * when profiles.line_user_id matches LINE user id (magic link exchange).
 */
export function LiffOrdersShell({ children }: Props) {
  const [phase, setPhase] = useState<"idle" | "ready" | "skipped">("idle");
  const [initError, setInitError] = useState<string | null>(null);
  const [inClient, setInClient] = useState<boolean | null>(null);
  const [profile, setProfile] = useState<LineProfileLite | null>(null);
  const [lineSessionHint, setLineSessionHint] = useState<string | null>(null);
  const lineExchangeAttempted = useRef(false);

  useEffect(() => {
    const liffId = getLineLiffId();
    if (!liffId) {
      setPhase("skipped");
      return;
    }
    const liffIdForInit: string = liffId;

    let cancelled = false;

    async function run() {
      try {
        const { default: liff } = await import("@line/liff");
        await liff.init({ liffId: liffIdForInit });
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

  /** After LIFF ready: if no Supabase session, exchange LINE id_token for magic link once. */
  useEffect(() => {
    if (phase !== "ready" || initError) return;
    if (inClient !== true) return;
    if (lineExchangeAttempted.current) return;

    let cancelled = false;

    async function exchangeLineSession() {
      const liffId = getLineLiffId();
      if (!liffId) return;

      try {
        const { default: liff } = await import("@line/liff");
        if (!liff.isLoggedIn()) return;

        const supabase = createBrowserSupabase();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session) return;

        lineExchangeAttempted.current = true;

        let idToken: string;
        try {
          const t = liff.getIDToken();
          if (!t) {
            lineExchangeAttempted.current = false;
            return;
          }
          idToken = t;
        } catch {
          lineExchangeAttempted.current = false;
          return;
        }

        const next = encodeURIComponent("/liff/orders?load=full");
        const res = await fetch(`/api/m/auth/line-session?next=${next}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id_token: idToken }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          error?: string;
          action_link?: string;
          line_user_id?: string;
        };

        if (cancelled) return;

        if (res.ok && json.action_link) {
          window.location.assign(json.action_link);
          return;
        }

        lineExchangeAttempted.current = false;

        if (res.status === 404) {
          const uid = json.line_user_id ? ` (${json.line_user_id})` : "";
          setLineSessionHint(
            `บัญชี LINE นี้ยังไม่ผูกกับผู้ใช้ในระบบ${uid} — ให้แอดมินใส่ LINE user id ที่เมนูผู้ใช้ (ระดับ 4) แล้วเปิด LIFF อีกครั้ง`
          );
          return;
        }
        if (res.status === 503) {
          setLineSessionHint(json.error ?? "เซิร์ฟเวอร์ยังไม่ตั้ง LINE channel id สำหรับยืนยันโทเค็น");
          return;
        }
        setLineSessionHint(json.error ?? `LINE เข้าระบบไม่สำเร็จ (${res.status})`);
      } catch (e) {
        lineExchangeAttempted.current = false;
        if (!cancelled) {
          setLineSessionHint(e instanceof Error ? e.message : "LINE session exchange failed");
        }
      }
    }

    void exchangeLineSession();
    return () => {
      cancelled = true;
    };
  }, [phase, initError, inClient]);

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
      {lineSessionHint ? (
        <div
          className="border-b border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-snug text-amber-950"
          role="status"
        >
          {lineSessionHint}
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
