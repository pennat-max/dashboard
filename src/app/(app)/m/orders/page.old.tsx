import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { MobileOrderCard } from "@/components/orders/mobile/mobile-order-card";
import { MobileOrderFilterChips } from "@/components/orders/mobile/mobile-order-filter-chips";
import { RoleTabs } from "@/components/orders/mobile/role-tabs";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { fetchMobileOrders } from "@/lib/data/orders";
import type { MobileOrderFilter } from "@/types/order";

export const dynamic = "force-dynamic";

function parseRole(raw: string | string[] | undefined): MobileOrderFilter["role"] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === "sales" || value === "store" || value === "garage") return value;
  return "all";
}

function parseStatus(raw: string | string[] | undefined): MobileOrderFilter["status"] {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const valid: MobileOrderFilter["status"][] = [
    "requested",
    "stock_check",
    "ordering",
    "received",
    "pickup",
    "installing",
    "done",
    "cancelled",
  ];
  if (value && valid.includes(value as MobileOrderFilter["status"])) return value as MobileOrderFilter["status"];
  return "all";
}

export default async function MobileOrdersPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const dict = getDictionary("th");
  const c = dict.common;
  const p = dict.ordersMobile;
  const params = (await searchParams) ?? {};
  const filter: MobileOrderFilter = {
    role: parseRole(params.role),
    status: parseStatus(params.status),
  };

  const { data, error, tableReady } = await fetchMobileOrders(filter);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 pb-20 pt-4 md:px-6">
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {c.backToOverview}
      </Link>

      <header className="space-y-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{p.title}</h1>
        <p className="text-sm text-muted-foreground">{p.intro}</p>
      </header>

      {error ? <SupabaseErrorBanner message={error} labels={dict.error} /> : null}

      {!tableReady ? (
        <p className="rounded-xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">{p.tableNotReady}</p>
      ) : null}

      <RoleTabs
        active={filter.role}
        labels={{ all: p.roleAll, sales: p.roleSales, store: p.roleStore, garage: p.roleGarage }}
      />

      <MobileOrderFilterChips
        active={filter.status}
        labels={{
          all: p.statusAll,
          requested: p.statusRequested,
          stock_check: p.statusStockCheck,
          ordering: p.statusOrdering,
          received: p.statusReceived,
          pickup: p.statusPickup,
          installing: p.statusInstalling,
          done: p.statusDone,
          cancelled: p.statusCancelled,
        }}
      />

      <section className="space-y-3">
        {data.length === 0 ? (
          <p className="rounded-xl border border-border/70 bg-card p-5 text-sm text-muted-foreground">{p.empty}</p>
        ) : (
          data.map((task) => (
            <MobileOrderCard
              key={task.id}
              task={task}
              labels={{
                sales: p.roleSales,
                store: p.roleStore,
                garage: p.roleGarage,
                dueDate: p.dueDate,
                open: p.assignedRole,
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
          ))
        )}
      </section>
    </div>
  );
}
