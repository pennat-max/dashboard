import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { BookedDistribution } from "@/components/dashboard/booked-distribution";
import { ShareAnchorButton } from "@/components/dashboard/share-anchor-button";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDictionary } from "@/i18n/dictionaries";
import {
  carTitleLine,
  daysSinceBookedDate,
  isBookedNotExported,
} from "@/lib/car-fields";
import {
  aggregateBySaleSupport,
  SALE_SUPPORT_UNKNOWN_LABEL,
} from "@/lib/data/aggregate";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { getLocale, numberFormatLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function BookedNotExportedPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);
  const p = dict.bookedPage;
  const c = dict.common;

  const { cars, error } = await fetchCarsForDashboard();
  const active = excludeCancelledCars(cars);
  const rows = active
    .filter(isBookedNotExported)
    .sort((a, b) => {
      const da = daysSinceBookedDate(a);
      const db = daysSinceBookedDate(b);
      if (da == null && db == null) return 0;
      if (da == null) return 1;
      if (db == null) return -1;
      return db - da;
    });
  const GROUP_STYLES = [
    {
      chartFill: "var(--chart-1)",
      headerClass: "bg-chart-1/100",
      rowClass: "border-l-4 border-l-chart-1 bg-tone-sky/10",
    },
    {
      chartFill: "var(--chart-2)",
      headerClass: "bg-chart-2/100",
      rowClass: "border-l-4 border-l-chart-2 bg-tone-emerald/10",
    },
    {
      chartFill: "var(--chart-3)",
      headerClass: "bg-chart-3/100",
      rowClass: "border-l-4 border-l-chart-3 bg-tone-amber/10",
    },
    {
      chartFill: "var(--chart-4)",
      headerClass: "bg-chart-4/100",
      rowClass: "border-l-4 border-l-chart-4 bg-tone-violet/10",
    },
    {
      chartFill: "var(--chart-5)",
      headerClass: "bg-chart-5/100",
      rowClass: "border-l-4 border-l-chart-5 bg-tone-rose/10",
    },
  ] as const;

  const bySaleSupport = aggregateBySaleSupport(rows, 500).map((d) => ({
    ...d,
    buyer:
      d.buyer === SALE_SUPPORT_UNKNOWN_LABEL ? c.saleSupportUnknown : d.buyer,
  }));
  const colorBySaleSupport = Object.fromEntries(
    bySaleSupport.map((owner, idx) => [
      owner.buyer,
      GROUP_STYLES[idx % GROUP_STYLES.length].chartFill,
    ])
  );
  const groupedRows = bySaleSupport.map((owner, idx) => {
    const style = GROUP_STYLES[idx % GROUP_STYLES.length];
    const carsInGroup = rows
      .filter(
        (car) =>
          ((car.sale_support ?? "").trim() || c.saleSupportUnknown) === owner.buyer
      )
      .sort((a, b) => {
        const da = daysSinceBookedDate(a);
        const db = daysSinceBookedDate(b);
        if (da == null && db == null) return 0;
        if (da == null) return 1;
        if (db == null) return -1;
        return db - da;
      });
    return {
      owner: owner.buyer,
      count: owner.count,
      cars: carsInGroup,
      headerClass: style.headerClass,
      rowClass: style.rowClass,
    };
  });

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8">
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
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      {rows.length > 0 && (
        <BookedDistribution
          bySaleSupport={bySaleSupport}
          colorBySaleSupport={colorBySaleSupport}
          units={dict.insights.units}
          title={p.chartTitle}
          chartTip={p.chartTip}
          chartEmpty={p.chartEmpty}
          over7DaysTemplate={p.chartOver7Days}
          countFormatLocale={nf}
        />
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[200px] pl-4">{p.colCar}</TableHead>
              <TableHead className="min-w-[100px] pr-4 text-right">{p.colDays}</TableHead>
              <TableHead className="min-w-[140px]">{p.colBuyer}</TableHead>
              <TableHead className="min-w-[120px]">{p.colStatus}</TableHead>
              <TableHead className="min-w-[160px] max-w-[280px]">{p.colRemarks}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              groupedRows.flatMap((group) => [
                <TableRow
                  key={`group-${group.owner}`}
                  id={`sale-support-${encodeURIComponent(group.owner)}`}
                >
                  <TableCell colSpan={5} className={`px-4 py-2 ${group.headerClass}`}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="flex items-center gap-2 font-semibold text-foreground">
                        <span>
                          {p.groupOwner}: {group.owner}
                        </span>
                        <ShareAnchorButton
                          anchorId={`sale-support-${encodeURIComponent(group.owner)}`}
                          shareLabel={p.shareLink}
                          copiedLabel={p.copiedLink}
                          toneClass={group.headerClass}
                        />
                      </span>
                      <span className="tabular-nums font-medium text-foreground">
                        {p.groupCount}: {fmt(group.count)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>,
                ...group.cars.map((car) => {
                  const days = daysSinceBookedDate(car);
                  const href = `/cars/${car.row_id ?? car.id}`;
                  return (
                    <TableRow key={String(car.row_id ?? car.id)} className={group.rowClass}>
                      <TableCell className="pl-4 align-top">
                        {(car.spec ?? "").trim() ? (
                          <Link
                            href={href}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {(car.spec ?? "").trim()}
                          </Link>
                        ) : (
                          <Link
                            href={href}
                            className="font-medium text-primary underline-offset-4 hover:underline"
                          >
                            {carTitleLine(car)}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell className="pr-4 text-right align-top">
                        {days != null ? (
                          <span className="font-medium tabular-nums text-foreground">
                            {fmt(days)} {p.daysUnit}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">{c.dash}</span>
                        )}
                      </TableCell>
                      <TableCell className="align-top text-foreground">
                        {(car.buyer ?? "").trim() || c.dash}
                      </TableCell>
                      <TableCell className="max-w-[140px] align-top text-sm text-muted-foreground">
                        {(car.status ?? "").trim() || c.statusUnknown}
                      </TableCell>
                      <TableCell className="max-w-[280px] min-w-0 align-top text-sm text-muted-foreground">
                        {(car.remarks ?? "").trim() ? (
                          <span className="block truncate" title={(car.remarks ?? "").trim()}>
                            {(car.remarks ?? "").trim().replace(/\s+/g, " ")}
                          </span>
                        ) : (
                          c.dash
                        )}
                      </TableCell>
                    </TableRow>
                  );
                }),
              ])
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
