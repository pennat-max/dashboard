import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ExportedMonthlyCharts } from "@/components/dashboard/exported-monthly-charts";
import { EntityCountBarChart } from "@/components/dashboard/inventory-charts";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDictionary } from "@/i18n/dictionaries";
import { aggregateByModelYearBucket } from "@/lib/data/aggregate";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { isCarExported } from "@/lib/car-fields";
import { getLocale, numberFormatLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

function shippedMonthNumber(rawShipped: string): number | null {
  const raw = rawShipped.trim();
  if (!raw) return null;
  if (raw.includes(".")) {
    const last = raw.split(".").pop()?.trim() ?? "";
    const m = last.match(/^(\d{1,2})/);
    if (!m) return null;
    const month = Number(m[1]);
    return month >= 1 && month <= 12 ? month : null;
  }
  if (/^\d{1,2}$/.test(raw)) {
    const month = Number(raw);
    return month >= 1 && month <= 12 ? month : null;
  }
  return null;
}

export default async function ExportedByBuyerPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const nf = numberFormatLocale(locale);
  const monthLabelFmt = new Intl.DateTimeFormat(nf, { month: "short" });

  const { cars, error } = await fetchCarsForDashboard();
  const active = excludeCancelledCars(cars);
  const exportedRows = active.filter((c) => isCarExported(c));
  const p = dict.exportedPage;
  const c = dict.common;
  const monthlyTotalsMap = new Map<number, number>();
  const monthlyBuyerMap = new Map<string, number>();
  let unknownMonthCount = 0;
  for (const row of exportedRows) {
    const month = shippedMonthNumber(row.shipped ?? "");
    if (!month) {
      unknownMonthCount += 1;
      continue;
    }
    monthlyTotalsMap.set(month, (monthlyTotalsMap.get(month) ?? 0) + 1);
    const buyer = ((row.buyer ?? "").trim() || c.buyerUnknown) as string;
    const key = `${month}__${buyer}`;
    monthlyBuyerMap.set(key, (monthlyBuyerMap.get(key) ?? 0) + 1);
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, count]) => ({
      month,
      label: monthLabelFmt.format(new Date(2026, month - 1, 1)),
      count,
    }))
    .sort((a, b) => a.month - b.month);
  const monthlyBuyerCounts = Array.from(monthlyBuyerMap.entries())
    .map(([key, count]) => {
      const [monthPart, buyer] = key.split("__");
      return { month: Number(monthPart), buyer, count };
    })
    .sort((a, b) => a.month - b.month || b.count - a.count || a.buyer.localeCompare(b.buyer, locale));

  const byModelYear = aggregateByModelYearBucket(exportedRows, p.modelYearUnknown);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8">
      <div>
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {c.backToOverview}
        </Link>
        <header className="border-b border-border pb-6">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {c.breakdown}
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
            {p.title}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {p.introBefore}{" "}
            <code className="rounded border border-border bg-muted px-1 font-mono text-xs">shipped</code>{" "}
            {p.introMid}{" "}
            <code className="rounded border border-border bg-muted px-1 font-mono text-xs">
              booked_shipping
            </code>{" "}
            {p.introAfter}
          </p>
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <CardTitle className="text-base font-semibold">{p.modelYearChartTitle}</CardTitle>
          <CardDescription>{p.modelYearChartIntro}</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          {byModelYear.length === 0 ? (
            <p className="text-sm text-muted-foreground">{p.modelYearChartEmpty}</p>
          ) : (
            <EntityCountBarChart data={byModelYear} units={p.colCount} />
          )}
        </CardContent>
      </Card>

      <ExportedMonthlyCharts
        monthlyTotals={monthlyTotals}
        monthlyBuyerCounts={monthlyBuyerCounts}
        units={p.colCount}
        monthlyBuyerTitle={p.monthlyBuyerChartTitle}
        emptyText={p.monthlyChartEmpty}
        unknownMonthText={p.unknownMonthRows}
        unknownMonthCount={unknownMonthCount}
        otherBuyerText={p.otherBuyer}
        allLabel={p.allBar}
        buyerTableTitle={p.buyerDetailTitle}
        buyerColLabel={p.colBuyer}
        shareColLabel={p.colShare}
        clickHint={p.chartClickHint}
      />
    </div>
  );
}
