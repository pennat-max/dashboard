import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineCopyButton } from "@/components/orders/mobile/line-copy-button";
import { MobileOrderTabs } from "@/components/orders/mobile/mobile-order-tabs";
import { StickyBottomActions } from "@/components/orders/mobile/sticky-bottom-actions";
import { statusColorClass } from "@/lib/order-fields";
import { buildGarageInstallLineMessage, buildSalesRequestLineMessage, buildStoreUpdateLineMessage } from "@/lib/orders/line-message";
import { cn } from "@/lib/utils";
import type { OrderItem, OrderTaskUpdate, OrderTaskWithCar } from "@/types/order";

type Props = {
  task: OrderTaskWithCar;
  items: OrderItem[];
  updates: OrderTaskUpdate[];
  mobileUrl: string;
  labels: {
    summary: string;
    items: string;
    updates: string;
    role: string;
    car: string;
    dueDate: string;
    priority: string;
    noItems: string;
    noUpdates: string;
    copySales: string;
    copyStore: string;
    copyGarage: string;
    copied: string;
    roleLabels: {
      sales: string;
      store: string;
      garage: string;
    };
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

export function MobileOrderDetail({ task, items, updates, mobileUrl, labels }: Props) {
  const salesMessage = buildSalesRequestLineMessage(task, items, mobileUrl);
  const storeMessage = buildStoreUpdateLineMessage(task, items, mobileUrl);
  const garageMessage = buildGarageInstallLineMessage(task, items, mobileUrl);
  const statusText = labels.statusLabels[task.status] ?? task.status;
  const assignedRoleText = labels.roleLabels[task.assigned_role] ?? task.assigned_role;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl border border-border/80">
        <CardHeader className="space-y-2 pb-2">
          <CardTitle className="text-lg">{task.title}</CardTitle>
          <div className="flex items-center gap-2">
            <span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", statusColorClass(task.status))}>
              {statusText}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">{task.priority}</span>
          </div>
        </CardHeader>
        <CardContent className="space-y-2 pt-0 text-sm">
          <p>
            <span className="text-muted-foreground">{labels.car}: </span>
            <span className="font-medium">{task.carLabel}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{labels.role}: </span>
            <span className="font-medium">{assignedRoleText}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{labels.dueDate}: </span>
            <span className="font-medium tabular-nums">{(task.due_date ?? "").slice(0, 10) || "-"}</span>
          </p>
          <p>
            <span className="text-muted-foreground">{labels.priority}: </span>
            <span className="font-medium">{task.priority}</span>
          </p>
        </CardContent>
      </Card>

      <MobileOrderTabs
        labels={{ summary: labels.summary, items: labels.items, updates: labels.updates }}
        summary={<p className="rounded-xl border border-border/70 bg-card p-3 text-sm">{task.description || "-"}</p>}
        items={
          items.length === 0 ? (
            <p className="rounded-xl border border-border/70 bg-card p-3 text-sm text-muted-foreground">{labels.noItems}</p>
          ) : (
            <div className="space-y-2">
              {items.map((item) => (
                <div key={item.id} className="rounded-xl border border-border/70 bg-card p-3 text-sm">
                  <p className="font-medium">{item.label}</p>
                  <p className="text-muted-foreground">
                    {item.qty}
                    {item.unit ? ` ${item.unit}` : ""} - {item.status}
                  </p>
                </div>
              ))}
            </div>
          )
        }
        updates={
          updates.length === 0 ? (
            <p className="rounded-xl border border-border/70 bg-card p-3 text-sm text-muted-foreground">{labels.noUpdates}</p>
          ) : (
            <div className="space-y-2">
              {updates.map((update) => (
                <div key={update.id} className="rounded-xl border border-border/70 bg-card p-3 text-sm">
                  <p className="font-medium">{labels.roleLabels[update.role] ?? update.role}</p>
                  <p>{update.message || "-"}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{(update.created_at ?? "").slice(0, 16) || "-"}</p>
                </div>
              ))}
            </div>
          )
        }
      />

      <StickyBottomActions>
        <LineCopyButton text={salesMessage} label={labels.copySales} copiedLabel={labels.copied} className="h-11" />
        <LineCopyButton text={storeMessage} label={labels.copyStore} copiedLabel={labels.copied} className="h-11" />
        <LineCopyButton text={garageMessage} label={labels.copyGarage} copiedLabel={labels.copied} className="h-11" />
      </StickyBottomActions>
    </div>
  );
}
