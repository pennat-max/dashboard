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
import { carTitleLine, isWebsitePending } from "@/lib/car-fields";
import { excludeCancelledCars, fetchCarsForDashboard } from "@/lib/data/cars";
import { getLocale } from "@/lib/locale";

export const dynamic = "force-dynamic";

export default async function WebsitePendingPage() {
  const locale = await getLocale();
  const dict = getDictionary(locale);
  const p = dict.websitePendingPage;
  const c = dict.common;

  const { cars, error } = await fetchCarsForDashboard();
  const rows = excludeCancelledCars(cars).filter(isWebsitePending);
  const sortedRows = [...rows].sort((a, b) => {
    const ai = (a.income_date ?? "").trim();
    const bi = (b.income_date ?? "").trim();
    return ai.localeCompare(bi);
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
              <TableHead className="min-w-[120px]">{p.colStatus}</TableHead>
              <TableHead className="min-w-[140px]">{p.colIncomeDate}</TableHead>
              <TableHead className="min-w-[120px]">{p.colPicture}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  {p.empty}
                </TableCell>
              </TableRow>
            ) : (
              sortedRows.map((car) => {
                const href = `/cars/${car.row_id ?? car.id}`;
                return (
                  <TableRow key={String(car.row_id ?? car.id)}>
                    <TableCell className="pl-4">
                      <Link href={href} className="font-medium text-primary underline-offset-4 hover:underline">
                        {(car.spec ?? "").trim() || carTitleLine(car)}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(car.status ?? "").trim() || c.statusUnknown}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {(car.income_date ?? "").trim() ? (car.income_date ?? "").trim().slice(0, 10) : c.dash}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{(car.picture ?? "").trim() || c.dash}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
