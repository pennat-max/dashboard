"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import type { MobileOrderFilter } from "@/types/order";

type Props = {
  active: MobileOrderFilter["status"];
  labels: Record<MobileOrderFilter["status"], string>;
};

const STATUS_ORDER: MobileOrderFilter["status"][] = [
  "all",
  "requested",
  "stock_check",
  "ordering",
  "received",
  "pickup",
  "installing",
  "done",
  "cancelled",
];

export function MobileOrderFilterChips({ active, labels }: Props) {
  const pathname = usePathname();
  const params = useSearchParams();
  const router = useRouter();

  function onChange(status: MobileOrderFilter["status"]) {
    const next = new URLSearchParams(params.toString());
    if (status === "all") next.delete("status");
    else next.set("status", status);
    router.replace(`${pathname}?${next.toString()}`);
  }

  return (
    <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
      {STATUS_ORDER.map((status) => (
        <Button
          key={status}
          type="button"
          size="sm"
          variant={active === status ? "default" : "outline"}
          onClick={() => onChange(status)}
          className="h-8 rounded-full px-3 text-xs"
        >
          {labels[status]}
        </Button>
      ))}
    </div>
  );
}
