"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { OrderRole } from "@/types/order";

type Props = {
  active: OrderRole | "all";
  labels: { all: string; sales: string; store: string; garage: string };
};

const ROLE_ORDER: Array<OrderRole | "all"> = ["all", "sales", "store", "garage"];

export function RoleTabs({ active, labels }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  function onChange(role: OrderRole | "all") {
    const next = new URLSearchParams(params.toString());
    if (role === "all") next.delete("role");
    else next.set("role", role);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {ROLE_ORDER.map((role) => (
        <Button
          key={role}
          type="button"
          size="sm"
          variant={active === role ? "default" : "outline"}
          onClick={() => onChange(role)}
          className={cn("h-9 rounded-full px-4 text-sm", active === role ? "shadow-sm" : "bg-background")}
        >
          {labels[role]}
        </Button>
      ))}
    </div>
  );
}
