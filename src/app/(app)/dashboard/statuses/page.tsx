import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDictionary } from "@/i18n/dictionaries";
import { aggregateByStatus } from "@/lib/data/aggregate";
import {
  computeDashboardKpi,
  excludeCancelledCars,
  fetchCarsForDashboard,
} from "@/lib/data/cars";
import { getLocale, numberFormatLocale } from "@/lib/locale";
import { formatThb } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CarStatusesPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);

  const { cars, error } = await fetchCarsForDashboard();
  const active = excludeCancelledCars(cars);
  const byStatus = aggregateByStatus(active);
  const total = active.length;
  const kpi = computeDashboardKpi(cars);
  const p = dict.statusesPage;
  const c = dict.common;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8">
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
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">{p.intro}</p>
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <div className="overflow-x-auto overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">{p.colStatus}</TableHead>
              <TableHead className="text-right">{p.colCount}</TableHead>
              <TableHead className="text-right">{p.colValue}</TableHead>
              <TableHead className="pr-4 text-right">{p.colShare}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {byStatus.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {c.noData}
                </TableCell>
              </TableRow>
            ) : (
              byStatus.map(({ status, count, totalValueThb }) => (
                <TableRow key={status}>
                  <TableCell className="pl-4 font-medium text-foreground">
                    {status === "unknown" ? c.statusUnknown : status}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{fmt(count)}</TableCell>
                  <TableCell className="text-right tabular-nums text-foreground">
                    {formatThb(totalValueThb)}
                  </TableCell>
                  <TableCell className="pr-4 text-right text-muted-foreground tabular-nums">
                    {total > 0 ? `${((count / total) * 100).toFixed(1)}%` : c.dash}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {total > 0 && (
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4">{c.total}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt(total)}</TableCell>
                <TableCell className="text-right tabular-nums font-medium">
                  {formatThb(kpi.totalValueThb)}
                </TableCell>
                <TableCell className="pr-4 text-right">{c.percent100}</TableCell>
              </TableRow>
            </TableFooter>
          )}
        </Table>
      </div>
    </div>
  );
}
