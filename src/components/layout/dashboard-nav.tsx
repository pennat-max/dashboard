"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CarFront, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { href: "/dashboard", label: "ภาพรวม", icon: LayoutDashboard },
  { href: "/cars", label: "รายการรถ", icon: CarFront },
];

export function DashboardNavLinks({
  className,
  onNavigate,
}: {
  className?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <nav className={cn("flex flex-col gap-0.5", className)}>
      {nav.map(({ href, label, icon: Icon }) => {
        const active =
          pathname === href || (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="size-[1.05rem] shrink-0 opacity-90" aria-hidden />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
