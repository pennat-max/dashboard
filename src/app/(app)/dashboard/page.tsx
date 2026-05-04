import Link from "next/link";
import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { aggregateByAgent, aggregateByBuyer } from "@/lib/data/aggregate";
import { computeDashboardKpi, fetchCarsForDashboard } from "@/lib/data/cars";
import { getLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const dateLocale = locale === "th" ? "th-TH" : "en-GB";
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
  const byBuyer = aggregateByBuyer(cars);
  const byAgentCurrentMonthBeForward = aggregateByAgent(cars, "currentMonth", "beForward");
  const byAgentPreviousMonthBeForward = aggregateByAgent(cars, "last3Months", "beForward");
  const byAgentTwoMonthsAgoBeForward = aggregateByAgent(cars, "twoMonthsAgo", "beForward");
  const byAgentAllMonthsBeForward = aggregateByAgent(cars, "all", "beForward");
  const byAgentCurrentMonthStock = aggregateByAgent(cars, "currentMonth", "stock");
  const byAgentPreviousMonthStock = aggregateByAgent(cars, "last3Months", "stock");
  const byAgentTwoMonthsAgoStock = aggregateByAgent(cars, "twoMonthsAgo", "stock");
  const byAgentAllMonthsStock = aggregateByAgent(cars, "all", "stock");
  const byAgentCurrentMonthAllBuyer = aggregateByAgent(cars, "currentMonth", "all");
  const byAgentPreviousMonthAllBuyer = aggregateByAgent(cars, "last3Months", "all");
  const byAgentTwoMonthsAgoAllBuyer = aggregateByAgent(cars, "twoMonthsAgo", "all");
  const byAgentAllMonthsAllBuyer = aggregateByAgent(cars, "all", "all");

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
        <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {dict.dashboard.sectionMetricsEyebrow}
            </p>
            <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              {dict.dashboard.sectionMetricsTitle}
            </h2>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              {dict.dashboard.sectionMetricsDesc}
            </p>
          </div>
          <Link
            href="/dashboard/statuses"
            className="shrink-0 text-sm font-medium text-primary underline-offset-4 transition-colors hover:text-primary/90 hover:underline"
          >
            {dict.dashboard.statusesBreakdownLink}
          </Link>
        </div>
        <KpiCards kpi={kpi} locale={locale} kpiDict={dict.kpi} />
      </section>

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
    </div>
  );
}
