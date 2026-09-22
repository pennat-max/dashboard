"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type TabKey = "summary" | "items" | "updates";

type Props = {
  labels: Record<TabKey, string>;
  summary: React.ReactNode;
  items: React.ReactNode;
  updates: React.ReactNode;
};

export function MobileOrderTabs({ labels, summary, items, updates }: Props) {
  const [active, setActive] = useState<TabKey>("summary");
  return (
    <div className="space-y-3">
      <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
        {(["summary", "items", "updates"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={active === key ? "default" : "outline"}
            onClick={() => setActive(key)}
            className={cn("h-9 rounded-full px-4 text-sm", active === key ? "shadow-sm" : "bg-background")}
          >
            {labels[key]}
          </Button>
        ))}
      </div>
      <div>{active === "summary" ? summary : active === "items" ? items : updates}</div>
    </div>
  );
}
