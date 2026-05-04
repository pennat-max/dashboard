import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { statusColorClass } from "@/lib/order-fields";
import { cn } from "@/lib/utils";
import type { OrderTaskWithCar } from "@/types/order";

type Props = {
  task: OrderTaskWithCar;
  labels: {
    sales: string;
    store: string;
    garage: string;
    dueDate: string;
    open: string;
    statusLabels: {
      requested: string;
      stock_check: string;
      ordering: string;
      received: string;
      pickup: string;
      installing: string;
      done: string;
      cancelled: string;
    };
  };
};

function roleLabel(role: OrderTaskWithCar["assigned_role"], labels: Props["labels"]): string {
  if (role === "store") return labels.store;
  if (role === "garage") return labels.garage;
  return labels.sales;
}

export function MobileOrderCard({ task, labels }: Props) {
  const statusText = labels.statusLabels[task.status] ?? task.status;
  return (
    <Link href={`/m/orders/${task.id}`} className="block">
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
        <CardHeader className="space-y-2 pb-2">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="line-clamp-1 text-sm font-semibold">{task.title}</CardTitle>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", statusColorClass(task.status))}>
              {statusText}
            </span>
          </div>
          <p className="line-clamp-1 text-xs text-muted-foreground">{task.carLabel}</p>
        </CardHeader>
        <CardContent className="space-y-2 pt-0">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{labels.open}</span>
            <span className="font-medium">{roleLabel(task.assigned_role, labels)}</span>
          </div>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">{labels.dueDate}</span>
            <span className="font-medium tabular-nums">{(task.due_date ?? "").slice(0, 10) || "-"}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
