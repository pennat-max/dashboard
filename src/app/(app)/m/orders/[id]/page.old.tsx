import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MobileOrderDetail } from "@/components/orders/mobile/mobile-order-detail";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { fetchMobileOrderDetail } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

export default async function MobileOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const dict = getDictionary("th");
  const c = dict.common;
  const p = dict.ordersMobile;
  const { id } = await params;
  const { data, error, tableReady } = await fetchMobileOrderDetail(id);
  const task = data.task;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-20 pt-4 md:px-6">
      <Link
        href="/m/orders"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {p.backToOrders}
      </Link>

      {error ? <SupabaseErrorBanner message={error} labels={dict.error} /> : null}

      {!tableReady ? (
        <p className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">{p.tableNotReady}</p>
      ) : null}

      {!task ? (
        <p className="rounded-xl border border-border/70 bg-card p-5 text-sm text-muted-foreground">{p.notFound}</p>
      ) : (
        <MobileOrderDetail
          task={task}
          items={data.items}
          updates={data.updates}
          mobileUrl={`/m/orders/${task.id}`}
          labels={{
            summary: p.tabSummary,
            items: p.tabItems,
            updates: p.tabUpdates,
            role: p.assignedRole,
            car: p.car,
            dueDate: p.dueDate,
            priority: p.priority,
            noItems: p.noItems,
            noUpdates: p.noUpdates,
            copySales: p.copySalesMessage,
            copyStore: p.copyStoreMessage,
            copyGarage: p.copyGarageMessage,
            copied: p.copied,
            roleLabels: {
              sales: p.roleSales,
              store: p.roleStore,
              garage: p.roleGarage,
            },
            statusLabels: {
              requested: p.statusRequested,
              stock_check: p.statusStockCheck,
              ordering: p.statusOrdering,
              received: p.statusReceived,
              pickup: p.statusPickup,
              installing: p.statusInstalling,
              done: p.statusDone,
              cancelled: p.statusCancelled,
            },
          }}
        />
      )}

      <p className="text-xs text-muted-foreground">{c.breakdown}</p>
    </div>
  );
}
