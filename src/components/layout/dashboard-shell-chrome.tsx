"use client";

import Link from "next/link";
import { AuthLoginLink } from "@/components/auth/auth-login-link";
import { AuthSignOutButton } from "@/components/auth/auth-sign-out-button";
import type { UserRole } from "@/lib/auth/user-role";
import { cn } from "@/lib/utils";
import { Users } from "lucide-react";
import { usePathname } from "next/navigation";

type Props = {
  children: React.ReactNode;
  userEmail?: string | null;
  userRole?: UserRole | null;
};

/** `/m/*` — full-bleed mobile layout + safe-area */
export function DashboardShellChrome({ children, userEmail = null, userRole = null }: Props) {
  const pathname = usePathname() ?? "";
  const mobileStandalone = pathname.startsWith("/m") || pathname.startsWith("/liff");

  return (
    <>
      {mobileStandalone && userEmail ? (
        <div className="flex justify-end border-b border-slate-200/80 bg-slate-100 px-3 py-2 md:hidden">
          <AuthSignOutButton email={userEmail} />
        </div>
      ) : null}
      {!mobileStandalone ? (
        <div className="flex flex-wrap items-start justify-end gap-3 px-4 pt-4 md:px-8 lg:px-10">
          {userEmail ? (
            <>
              {userRole === 4 ? (
                <Link
                  href="/dashboard/users"
                  className={cn(
                    "inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm",
                    "transition-colors hover:bg-muted/80"
                  )}
                >
                  <Users className="size-4 opacity-80" aria-hidden />
                  Users
                </Link>
              ) : null}
              <AuthSignOutButton email={userEmail} />
            </>
          ) : (
            <AuthLoginLink />
          )}
        </div>
      ) : null}
      <main
        data-mobile-fullscreen={mobileStandalone ? "" : undefined}
        className={cn(
          mobileStandalone
            ? "max-md:m-0 max-md:max-w-none max-md:min-h-[100dvh] max-md:min-h-[100svh] max-md:w-full max-md:overflow-x-clip max-md:p-0 md:px-8 md:py-8 lg:px-10"
            : "px-4 py-6 md:px-8 md:py-8 lg:px-10"
        )}
      >
        {mobileStandalone ? (
          <div className="box-border flex min-h-[100dvh] min-h-[100svh] w-full flex-col bg-slate-100 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)] pr-[env(safe-area-inset-right,0px)] md:min-h-0 md:bg-transparent md:p-0 md:pt-0 md:pb-0 md:pl-0 md:pr-0">
            {children}
          </div>
        ) : (
          children
        )}
      </main>
    </>
  );
}
