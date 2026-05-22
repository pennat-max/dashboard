"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Link to `/login` with `next` = current path (skipped on login/auth routes). */
export function AuthLoginLink({ className }: { className?: string }) {
  const pathname = usePathname() ?? "/dashboard";
  const next = pathname.startsWith("/login") || pathname.startsWith("/auth/") ? "/dashboard" : pathname;
  return (
    <Link
      href={`/login?next=${encodeURIComponent(next)}`}
      className={cn(buttonVariants({ variant: "default", size: "sm" }), className)}
    >
      Sign in / Create account
    </Link>
  );
}
