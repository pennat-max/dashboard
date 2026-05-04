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
import { carPriceNumber, carTitleLine } from "@/lib/car-fields";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { formatThb } from "@/lib/format";
import { getLocale, numberFormatLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

type Props = {
  params: { date: string };
};

export default async function IncomeScheduleDatePage({ params }: Props) {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const p = dict.incomeSchedulePage;
  const c = dict.common;
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);

  const rawDate = decodeURIComponent(params.date ?? "").trim();
  const isValidDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate);

  const { cars, error } = await fetchCarsForDashboard();
  const rows = isValidDate
    ? excludeCancelledCars(cars).filter((car) => (car.income_date ?? "").trim().slice(0, 10) === rawDate)
    : [];

  const totalCars = rows.length;
  const totalValueThb = rows.reduce((sum, row) => sum + (carPriceNumber(row) || 0), 0);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
      <div>
        <Link
          href="/dashboard/income-schedule"
          className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {p.title}
        </Link>
        <header className="border-b border-border pb-6">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {c.breakdown}
          </p>
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">
            {p.colIncomeDate}: {isValidDate ? rawDate : c.dash}
          </h1>
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px] pl-4">{p.colCar}</TableHead>
              <TableHead className="min-w-[120px]">{p.colStatus}</TableHead>
              <TableHead className="min-w-[120px] pr-4 text-right">{p.colPayAmount}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!isValidDate || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const href = `/cars/${row.row_id ?? row.id}`;
                return (
                  <TableRow key={String(row.row_id ?? row.id)}>
                    <TableCell className="pl-4">
                      <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
                        {(row.spec ?? "").trim() || carTitleLine(row)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(row.status ?? "").trim() || c.statusUnknown}</TableCell>
                    <TableCell className="pr-4 text-right tabular-nums">{formatThb(carPriceNumber(row))}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
          {isValidDate && rows.length > 0 ? (
            <TableFooter>
              <TableRow>
                <TableCell className="pl-4 font-semibold text-foreground">{p.footerTotal}</TableCell>
                <TableCell className="text-muted-foreground">
                  {fmt(totalCars)} {p.colCount}
                </TableCell>
                <TableCell className="pr-4 text-right tabular-nums font-semibold text-foreground">
                  {formatThb(totalValueThb)}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>
    </div>
  );
}
