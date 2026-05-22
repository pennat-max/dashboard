import Link from "next/link";
import { ArrowLeft } from "lucide-react";
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
import { carTitleLine, isAwaitingShipExport } from "@/lib/car-fields";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { getLocale, numberFormatLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function AwaitingShipPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const nf = numberFormatLocale(locale);
  const fmt = (n: number) => new Intl.NumberFormat(nf).format(n);
  const p = dict.awaitingShipPage;
  const c = dict.common;

  const { cars, error } = await fetchCarsForDashboard();
  const active = excludeCancelledCars(cars);
  const rows = active
    .filter(isAwaitingShipExport)
    .sort((a, b) => String(a.row_id ?? a.id).localeCompare(String(b.row_id ?? b.id), locale));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8">
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
          <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground">{p.title}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">{p.intro}</p>
        </header>
      </div>

      {error && <SupabaseErrorBanner message={error} labels={dict.error} />}

      <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[220px] pl-4">{p.colCar}</TableHead>
              <TableHead className="min-w-[140px]">{p.colBuyer}</TableHead>
              <TableHead className="min-w-[200px] pr-4">{p.colBookedShipping}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={3} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((car) => {
                const href = `/cars/${car.row_id ?? car.id}`;
                const title = (car.spec ?? "").trim() ? (car.spec ?? "").trim() : carTitleLine(car);
                return (
                  <TableRow key={String(car.row_id ?? car.id)}>
                    <TableCell className="pl-4 align-top">
                      <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
                        {title}
                      </Link>
                    </TableCell>
                    <TableCell className="align-top text-sm text-foreground">
                      {(car.buyer ?? "").trim() || c.dash}
                    </TableCell>
                    <TableCell className="pr-4 align-top text-sm text-muted-foreground">
                      {(car.booked_shipping ?? "").trim() || c.dash}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {rows.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          {c.total}: {fmt(rows.length)} {dict.insights.units}
        </p>
      ) : null}
    </div>
  );
}
