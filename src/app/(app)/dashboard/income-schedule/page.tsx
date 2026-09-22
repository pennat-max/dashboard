import Link from "next/link";
import { ArrowLeft, ChevronUp } from "lucide-react";
import { IncomeScheduleChart } from "@/components/dashboard/income-schedule-chart";
import { ShareAnchorButton } from "@/components/dashboard/share-anchor-button";
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
import { buttonVariants } from "@/components/ui/button";
import { getDictionary } from "@/i18n/dictionaries";
import { carPriceNumber, carTitleLine } from "@/lib/car-fields";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { formatThb } from "@/lib/format";
import { getLocale, numberFormatLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function IncomeSchedulePage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const p = dict.incomeSchedulePage;
  const c = dict.common;
  const labels = p as typeof p & { colBuyer?: string; colAgent?: string; colStockSameModelYear?: string };
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);

  const { cars, error } = await fetchCarsForDashboard();
  const rows = excludeCancelledCars(cars);
  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const map = new Map<string, { count: number; totalValueThb: number }>();
  const skipStatuses = new Set(["comming", "coming"]);
  const toChartDateLabel = (isoDate: string) => {
    const [y, m, d] = isoDate.split("-");
    if (!y || !m || !d) return isoDate;
    return `${d}-${m}-${y.slice(-2)}`;
  };
  const toDisplayDate = (isoDate: string) => {
    const [y, m, d] = isoDate.split("-");
    if (!y || !m || !d) return isoDate;
    return `${d}-${m}-${y.slice(-2)}`;
  };
  const displayIncomeDate = (value?: string | null) => {
    const key = (value ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return c.dash;
    return toDisplayDate(key);
  };
  const normalizedBuyer = (value?: string | null) => (value ?? "").trim().toLowerCase();
  const ageDaysFromIncomeDate = (value?: string | null) => {
    const key = (value ?? "").trim().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const [y, m, d] = key.split("-").map((part) => Number(part));
    const source = new Date(y, (m ?? 1) - 1, d ?? 1);
    if (Number.isNaN(source.getTime())) return null;
    const today = new Date();
    const nowDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const diffMs = nowDate.getTime() - source.getTime();
    return Math.floor(diffMs / 86400000);
  };
  const stockAgeIncomeDateClass = (row: (typeof rows)[number]) => {
    if (normalizedBuyer(row.buyer)) return "";
    const age = ageDaysFromIncomeDate(row.income_date);
    if (age === null) return "";
    if (age >= 365) return "bg-red-100/80 text-red-900";
    if (age >= 180) return "bg-orange-100/80 text-orange-900";
    if (age >= 90) return "bg-yellow-100/90 text-yellow-900";
    return "";
  };
  const buyerRank = (value?: string | null) => {
    const key = normalizedBuyer(value);
    if (key === "be forward") return 0;
    if (!key) return 1;
    return 2;
  };
  const buyerDisplayName = (value?: string | null) => {
    const trimmed = (value ?? "").trim();
    return trimmed || "STOCK";
  };
  const modelYearKey = (value?: string | number | null) => String(value ?? "").trim();
  const inferColorClass = (row: (typeof rows)[number]) => {
    const text = `${row.color ?? ""} ${(row.spec ?? "").trim() || carTitleLine(row)}`.toUpperCase();
    if (text.includes("WHITE")) return "bg-slate-100 text-slate-900";
    if (text.includes("BLACK")) return "bg-slate-900 text-white";
    if (text.includes("SILVER") || text.includes("GRAY") || text.includes("GREY")) {
      return "bg-slate-300 text-slate-900";
    }
    if (text.includes("RED")) return "bg-red-500 text-white";
    if (text.includes("BLUE")) return "bg-blue-500 text-white";
    if (text.includes("GREEN")) return "bg-green-500 text-white";
    if (text.includes("YELLOW")) return "bg-yellow-300 text-slate-900";
    if (text.includes("ORANGE")) return "bg-orange-400 text-slate-900";
    if (text.includes("BROWN")) return "bg-amber-700 text-white";
    if (text.includes("GOLD")) return "bg-amber-300 text-slate-900";
    if (text.includes("PURPLE")) return "bg-purple-500 text-white";
    if (text.includes("PINK")) return "bg-pink-400 text-slate-900";
    return "bg-muted text-foreground";
  };
  const COLOR_KEYWORDS = [
    "WHITE",
    "BLACK",
    "SILVER",
    "GRAY",
    "GREY",
    "RED",
    "BLUE",
    "GREEN",
    "YELLOW",
    "ORANGE",
    "BROWN",
    "GOLD",
    "PURPLE",
    "PINK",
  ] as const;
  const findColorKeyword = (text: string) => {
    const upper = text.toUpperCase();
    return COLOR_KEYWORDS.find((k) => upper.includes(k)) ?? null;
  };
  const detailRowsByDate = new Map<string, typeof rows>();
  const sameModelYearCount = new Map<string, number>();
  const stockCountByModelYear = new Map<string, number>();
  const rowsByModelYear = new Map<string, typeof rows>();
  const receiveRowIds = new Set<string>();
  for (const row of rows) {
    const yearKey = modelYearKey(row.model_year);
    if (!yearKey) continue;
    sameModelYearCount.set(yearKey, (sameModelYearCount.get(yearKey) ?? 0) + 1);
    if (!normalizedBuyer(row.buyer)) {
      stockCountByModelYear.set(yearKey, (stockCountByModelYear.get(yearKey) ?? 0) + 1);
    }
    const allRows = rowsByModelYear.get(yearKey) ?? [];
    allRows.push(row);
    rowsByModelYear.set(yearKey, allRows);
  }
  for (const row of rows) {
    const incomeDate = (row.income_date ?? "").trim().slice(0, 10);
    const normalizedStatus = (row.status ?? "").trim().toLowerCase();
    if (!incomeDate) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(incomeDate)) continue;
    if (incomeDate <= todayKey) continue;
    if (skipStatuses.has(normalizedStatus)) continue;
    receiveRowIds.add(String(row.row_id ?? row.id));
    const prev = map.get(incomeDate) ?? { count: 0, totalValueThb: 0 };
    map.set(incomeDate, {
      count: prev.count + 1,
      totalValueThb: prev.totalValueThb + (carPriceNumber(row) || 0),
    });
    const groupRows = detailRowsByDate.get(incomeDate) ?? [];
    groupRows.push(row);
    detailRowsByDate.set(incomeDate, groupRows);
  }

  const dailyRows = Array.from(map.entries())
    .map(([date, v]) => ({ date, count: v.count, totalValueThb: v.totalValueThb }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const detailGroups = Array.from(detailRowsByDate.entries())
    .map(([date, groupedRows]) => ({
      date,
      rows: [...groupedRows].sort((a, b) => {
        const rankDiff = buyerRank(a.buyer) - buyerRank(b.buyer);
        if (rankDiff !== 0) return rankDiff;
        const buyerDiff = buyerDisplayName(a.buyer).localeCompare(buyerDisplayName(b.buyer), locale);
        if (buyerDiff !== 0) return buyerDiff;
        return String(a.row_id ?? a.id).localeCompare(String(b.row_id ?? b.id), locale);
      }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const chartRows = dailyRows
    .map((v) => ({
      date: v.date,
      label: toChartDateLabel(v.date),
      count: v.count,
      totalValueThb: v.totalValueThb,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const totalCars = dailyRows.reduce((sum, row) => sum + row.count, 0);
  const totalValueThb = dailyRows.reduce((sum, row) => sum + row.totalValueThb, 0);

  return (
    <div
      id="income-schedule-top"
      className="mx-auto flex max-w-5xl flex-col gap-8 scroll-mt-6 rounded-2xl border border-border/60 bg-gradient-to-b from-sky-50/40 via-background to-violet-50/30 p-4 shadow-sm md:p-6"
    >
      <div>
        <Link
          href="/dashboard"
          className="mb-6 inline-flex items-center gap-2 rounded-full border border-border/70 bg-background/80 px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {c.backToOverview}
        </Link>
        <header className="rounded-xl border border-border/70 bg-card/80 px-4 py-4 shadow-sm backdrop-blur-sm md:px-5">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {c.breakdown}
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">{p.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{p.intro}</p>
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <IncomeScheduleChart
        rows={chartRows}
        title={p.title}
        emptyText={p.empty}
        payAmountLabel={p.colPayAmount}
        countLabel={p.colCount}
        detailAnchorPrefix="income-day"
      />

      <div className="overflow-hidden rounded-xl border border-sky-200/60 bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-gradient-to-r from-sky-100/70 via-sky-50/70 to-cyan-100/60">
              <TableHead className="pl-4 font-semibold text-foreground">{p.colIncomeDate}</TableHead>
              <TableHead className="text-right font-semibold text-foreground">{p.colCount}</TableHead>
              <TableHead className="pr-4 text-right font-semibold text-foreground">{p.colPayAmount}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {dailyRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              dailyRows.map((row) => (
                <TableRow key={row.date} className="hover:bg-sky-50/80">
                  <TableCell colSpan={3} className="p-0">
                    <a
                      href={`#income-day-${row.date}`}
                      className="flex w-full items-center gap-4 px-4 py-3 text-sm text-foreground transition-colors hover:bg-sky-100/60"
                    >
                      <span className="min-w-0 flex-1 text-left font-medium">{toDisplayDate(row.date)}</span>
                      <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                        {fmt(row.count)} {dict.kpi.unitsCars}
                      </span>
                      <span className="shrink-0 text-right tabular-nums font-medium text-foreground">
                        {formatThb(row.totalValueThb)}
                      </span>
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {dailyRows.length > 0 ? (
            <TableFooter>
              <TableRow className="bg-gradient-to-r from-emerald-50/70 via-background to-blue-50/60">
                <TableCell className="pl-4 font-semibold">{p.footerTotal}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {fmt(totalCars)} {dict.kpi.unitsCars}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums font-semibold">{formatThb(totalValueThb)}</TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>

      <div className="overflow-x-auto rounded-xl border border-indigo-200/60 bg-gradient-to-b from-card via-card to-indigo-50/30 shadow-sm">
        <Table>
          <TableHeader>
            <TableRow className="bg-gradient-to-r from-indigo-100/75 via-violet-100/50 to-sky-100/70">
              <TableHead className="pl-4 text-foreground">{p.colCar}</TableHead>
              <TableHead className="text-foreground">{labels.colBuyer ?? "Buyer"}</TableHead>
              <TableHead className="text-foreground">{labels.colAgent ?? "Agent"}</TableHead>
              <TableHead className="pr-4 text-right text-foreground">{p.colPayAmount}</TableHead>
              <TableHead className="pr-4 text-right text-foreground">{labels.colStockSameModelYear ?? "Car history"}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {detailGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              detailGroups.flatMap((group) => [
                <TableRow key={`date-${group.date}`}>
                  <TableCell
                    id={`income-day-${group.date}`}
                    colSpan={5}
                    className="scroll-mt-8 bg-gradient-to-r from-primary/15 via-sky-100/50 to-violet-100/50 px-4 py-2 text-sm font-semibold tracking-wide text-primary"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        {p.colIncomeDate}: {toDisplayDate(group.date)}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <a
                          href="#income-schedule-top"
                          className={cn(
                            buttonVariants({ variant: "outline", size: "xs" }),
                            "h-6 border-foreground/20 bg-transparent text-foreground hover:bg-foreground/10"
                          )}
                        >
                          <ChevronUp className="size-3" aria-hidden />
                          {p.scrollToTop}
                        </a>
                        <ShareAnchorButton
                          anchorId={`income-day-${group.date}`}
                          shareLabel={p.shareLink}
                          copiedLabel={p.copiedLink}
                        />
                      </div>
                    </div>
                  </TableCell>
                </TableRow>,
                ...group.rows.map((row) => (
                  <TableRow key={String(row.row_id ?? row.id)} className="odd:bg-background/90 even:bg-muted/20 align-top">
                    <TableCell className="text-foreground">{(row.spec ?? "").trim() || carTitleLine(row)}</TableCell>
                    <TableCell className="text-muted-foreground">{buyerDisplayName(row.buyer)}</TableCell>
                    <TableCell className="text-muted-foreground">{(row.agent ?? "").trim() || c.dash}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums text-foreground">
                      {formatThb(carPriceNumber(row))}
                    </TableCell>
                    <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">
                      {(() => {
                        const yearKey = modelYearKey(row.model_year);
                        const modelYearCount = sameModelYearCount.get(yearKey) ?? 0;
                        const stockCount = stockCountByModelYear.get(yearKey) ?? 0;
                        const modelYearRows = [...(rowsByModelYear.get(yearKey) ?? [])].sort((a, b) => {
                          const aPrice = carPriceNumber(a) ?? 0;
                          const bPrice = carPriceNumber(b) ?? 0;
                          return aPrice - bPrice;
                        });
                        if (modelYearCount > 0) {
                          return (
                            <details className="relative inline-block text-left">
                              <summary className="cursor-pointer list-none text-right font-medium text-foreground">
                                {fmt(stockCount)}/{fmt(modelYearCount)} <span className="pl-1 text-xs">▼</span>
                              </summary>
                              <div className="absolute right-0 z-20 mt-2 w-[min(58rem,calc(100vw-1rem))] max-h-[60vh] overflow-x-auto overflow-y-auto rounded-md border border-border bg-background p-2 text-xs leading-5 shadow-lg">
                                <div className="ml-auto w-max">
                                  <table className="w-max border-collapse text-xs text-foreground">
                                    <thead className="[&_tr]:border-b">
                                      <tr className="border-b border-border hover:bg-transparent">
                                        <th
                                          scope="col"
                                          className="h-8 px-1 py-1 text-left align-middle font-semibold whitespace-nowrap"
                                        >
                                          {p.colCar}
                                        </th>
                                        <th
                                          scope="col"
                                          className="h-8 px-1 py-1 text-left align-middle font-semibold whitespace-nowrap"
                                        >
                                          {labels.colBuyer ?? "Buyer"}
                                        </th>
                                        <th
                                          scope="col"
                                          className="h-8 px-1 py-1 text-left align-middle font-semibold whitespace-nowrap"
                                        >
                                          {labels.colAgent ?? "Agent"}
                                        </th>
                                        <th
                                          scope="col"
                                          className="h-8 px-1 py-1 text-left align-middle font-semibold whitespace-nowrap"
                                        >
                                          {p.colIncomeDate}
                                        </th>
                                        <th
                                          scope="col"
                                          className="h-8 px-1 py-1 text-right align-middle font-semibold whitespace-nowrap"
                                        >
                                          {p.colPayAmount}
                                        </th>
                                      </tr>
                                    </thead>
                                    <tbody className="[&_tr:last-child]:border-0">
                                      {modelYearRows.map((modelYearRow) => (
                                        <tr
                                          key={`model-year-${String(modelYearRow.row_id ?? modelYearRow.id)}`}
                                          className={cn(
                                            "border-b border-border transition-colors hover:bg-transparent",
                                            receiveRowIds.has(String(modelYearRow.row_id ?? modelYearRow.id))
                                              ? "bg-red-100/70"
                                              : !normalizedBuyer(modelYearRow.buyer)
                                                ? "bg-emerald-100/70"
                                                : ""
                                          )}
                                        >
                                          <td className="px-1 py-1 align-middle whitespace-nowrap text-muted-foreground">
                                            <span className="block">
                                              {(() => {
                                                const vehicleText =
                                                  (modelYearRow.spec ?? "").trim() || carTitleLine(modelYearRow);
                                                const colorKeyword = findColorKeyword(vehicleText);
                                                if (!colorKeyword) return vehicleText;
                                                const parts = vehicleText.split(new RegExp(`(${colorKeyword})`, "i"));
                                                return parts.map((part, idx) =>
                                                  part.toUpperCase() === colorKeyword ? (
                                                    <span
                                                      key={`color-${idx}`}
                                                      className={`mx-0.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${inferColorClass(
                                                        modelYearRow
                                                      )}`}
                                                    >
                                                      {part}
                                                    </span>
                                                  ) : (
                                                    <span key={`txt-${idx}`}>{part}</span>
                                                  )
                                                );
                                              })()}
                                            </span>
                                          </td>
                                          <td className="px-1 py-1 align-middle whitespace-nowrap text-muted-foreground">
                                            {buyerDisplayName(modelYearRow.buyer)}
                                          </td>
                                          <td className="px-1 py-1 align-middle whitespace-nowrap text-muted-foreground">
                                            {(modelYearRow.agent ?? "").trim() || c.dash}
                                          </td>
                                          <td
                                            className={cn(
                                              "px-1 py-1 align-middle whitespace-nowrap text-muted-foreground",
                                              stockAgeIncomeDateClass(modelYearRow)
                                            )}
                                          >
                                            {displayIncomeDate(modelYearRow.income_date)}
                                          </td>
                                          <td className="px-1 py-1 text-right align-middle whitespace-nowrap tabular-nums text-foreground">
                                            {formatThb(carPriceNumber(modelYearRow))}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </div>
                            </details>
                          );
                        }
                        return `${fmt(stockCount)}/${fmt(modelYearCount)}`;
                      })()}
                    </TableCell>
                  </TableRow>
                )),
              ])
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
