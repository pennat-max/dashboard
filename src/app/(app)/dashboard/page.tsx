import Link from "next/link";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import type { KpiLinkMode } from "@/components/dashboard/kpi-cards";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { aggregateByAgent, aggregateByBuyer } from "@/lib/data/aggregate";
import { computeDashboardKpi, fetchCarsForDashboard } from "@/lib/data/cars";
import { getSessionAndRole } from "@/lib/auth/session-role";
import { canViewDashboardInsights } from "@/lib/auth/user-role";
import { getLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const { user, role } = await getSessionAndRole();
  const isAuthenticated = Boolean(user);
  const activeRole = role ?? undefined;
  const showInsights =
    isAuthenticated && activeRole != null && canViewDashboardInsights(activeRole);

  const kpiLinkMode: KpiLinkMode = !isAuthenticated
    ? "none"
    : activeRole == null
      ? "none"
      : activeRole >= 3
        ? "full"
        : activeRole === 1
          ? "subset"
          : "none";
  const dateLocale = "en-GB";
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const twoMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 2, 1);
  const agentPreviousMonthLabel = new Intl.DateTimeFormat(dateLocale, {
    month: "long",
    year: "numeric",
  }).format(previous);
  const agentTwoMonthsAgoLabel = new Intl.DateTimeFormat(dateLocale, {
    month: "long",
    year: "numeric",
  }).format(twoMonthsAgo);

  const { cars, error } = await fetchCarsForDashboard();
  const kpi = computeDashboardKpi(cars);
  const byBuyer = showInsights ? aggregateByBuyer(cars) : [];
  const byAgentCurrentMonthBeForward = showInsights ? aggregateByAgent(cars, "currentMonth", "beForward") : [];
  const byAgentPreviousMonthBeForward = showInsights ? aggregateByAgent(cars, "last3Months", "beForward") : [];
  const byAgentTwoMonthsAgoBeForward = showInsights ? aggregateByAgent(cars, "twoMonthsAgo", "beForward") : [];
  const byAgentAllMonthsBeForward = showInsights ? aggregateByAgent(cars, "all", "beForward") : [];
  const byAgentCurrentMonthStock = showInsights ? aggregateByAgent(cars, "currentMonth", "stock") : [];
  const byAgentPreviousMonthStock = showInsights ? aggregateByAgent(cars, "last3Months", "stock") : [];
  const byAgentTwoMonthsAgoStock = showInsights ? aggregateByAgent(cars, "twoMonthsAgo", "stock") : [];
  const byAgentAllMonthsStock = showInsights ? aggregateByAgent(cars, "all", "stock") : [];
  const byAgentCurrentMonthAllBuyer = showInsights ? aggregateByAgent(cars, "currentMonth", "all") : [];
  const byAgentPreviousMonthAllBuyer = showInsights ? aggregateByAgent(cars, "last3Months", "all") : [];
  const byAgentTwoMonthsAgoAllBuyer = showInsights ? aggregateByAgent(cars, "twoMonthsAgo", "all") : [];
  const byAgentAllMonthsAllBuyer = showInsights ? aggregateByAgent(cars, "all", "all") : [];

  return (
    <div className="dashboard-stack mx-auto flex max-w-6xl flex-col gap-12">
      <header className="border-b border-border pb-8">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {dict.dashboard.eyebrow}
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          {dict.dashboard.title}
        </h1>
      </header>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <section className="space-y-5">
        {isAuthenticated ? (
          <div className="flex justify-end border-b border-border pb-5">
            <Link
              href="/dashboard/statuses"
              className="shrink-0 text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary/90 hover:underline"
            >
              {dict.dashboard.statusesBreakdownLink}
            </Link>
          </div>
        ) : null}
        <KpiCards kpi={kpi} locale={locale} kpiDict={dict.kpi} kpiLinkMode={kpiLinkMode} />
      </section>

      {showInsights ? (
        <section className="space-y-5">
          <DashboardInsights
            byBuyer={byBuyer}
            byAgentCurrentMonthBeForward={byAgentCurrentMonthBeForward}
            byAgentPreviousMonthBeForward={byAgentPreviousMonthBeForward}
            byAgentTwoMonthsAgoBeForward={byAgentTwoMonthsAgoBeForward}
            byAgentAllMonthsBeForward={byAgentAllMonthsBeForward}
            byAgentCurrentMonthStock={byAgentCurrentMonthStock}
            byAgentPreviousMonthStock={byAgentPreviousMonthStock}
            byAgentTwoMonthsAgoStock={byAgentTwoMonthsAgoStock}
            byAgentAllMonthsStock={byAgentAllMonthsStock}
            byAgentCurrentMonthAllBuyer={byAgentCurrentMonthAllBuyer}
            byAgentPreviousMonthAllBuyer={byAgentPreviousMonthAllBuyer}
            byAgentTwoMonthsAgoAllBuyer={byAgentTwoMonthsAgoAllBuyer}
            byAgentAllMonthsAllBuyer={byAgentAllMonthsAllBuyer}
            insights={dict.insights}
            agentPreviousMonthLabel={agentPreviousMonthLabel}
            agentTwoMonthsAgoLabel={agentTwoMonthsAgoLabel}
          />
        </section>
      ) : null}
    </div>
  );
}
