import { CarsTable } from "@/components/cars/cars-table";
import { CarsToolbar } from "@/components/cars/cars-toolbar";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import {
  fetchCarsForDashboard,
  fetchCarsList,
  type CarsListParams,
} from "@/lib/data/cars";
import { uniqueDestinations, uniqueStatuses } from "@/lib/data/aggregate";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

function first(param: string | string[] | undefined): string | undefined {
  if (Array.isArray(param)) return param[0];
  return param;
}

export default async function CarsPage({ searchParams }: PageProps) {
  const params: CarsListParams = {
    q: first(searchParams.q),
    status: first(searchParams.status),
    destination: first(searchParams.destination),
    sort: first(searchParams.sort),
    order: first(searchParams.order),
  };

  const [listResult, dashResult] = await Promise.all([
    fetchCarsList(params),
    fetchCarsForDashboard(),
  ]);

  const cars = listResult.cars;
  const fetchError = listResult.error ?? dashResult.error;
  const allForFilters = dashResult.cars;

  const statuses = uniqueStatuses(allForFilters);
  const destinations = uniqueDestinations(allForFilters);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10">
      <section className="relative overflow-hidden rounded-2xl border border-border/80 bg-card/80 p-6 shadow-sm backdrop-blur-sm md:p-8">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-amber-400 to-rose-400"
          aria-hidden
        />
        <div className="relative">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            Inventory
          </p>
          <h1 className="mt-2 font-heading text-3xl font-semibold tracking-tight md:text-4xl">
            รายการรถ
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            ค้นหา กรอง และเรียงลำดับ — แสดง{" "}
            <span className="font-medium text-emerald-700 dark:text-emerald-300">
              {cars.length}
            </span>{" "}
            รายการ
          </p>
        </div>
      </section>

      {fetchError && <SupabaseErrorBanner message={fetchError} />}

      <section className="space-y-4">
        <div className="flex items-end gap-3">
          <span className="h-8 w-1 rounded-full bg-amber-500" aria-hidden />
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">ตัวกรอง</h2>
            <p className="text-sm text-muted-foreground">โซนสีเหลืองอำพัน — ปรับแล้วกดใช้ตัวกรอง</p>
          </div>
        </div>
        <div className="rounded-2xl border-2 border-amber-200/80 bg-tone-amber/60 p-4 shadow-md shadow-amber-500/5 dark:border-amber-500/25 dark:bg-tone-amber/40 md:p-6">
          <CarsToolbar
            q={params.q}
            status={params.status ?? "all"}
            destination={params.destination ?? "all"}
            sort={params.sort ?? "updated_at"}
            order={params.order ?? "desc"}
            statuses={statuses}
            destinations={destinations}
          />
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-end gap-3">
          <span className="h-8 w-1 rounded-full bg-emerald-500" aria-hidden />
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">ตารางรายการ</h2>
            <p className="text-sm text-muted-foreground">โซนสีเขียว — แตะลูกศรเพื่อดูรายละเอียด</p>
          </div>
        </div>
        <CarsTable cars={cars} />
      </section>
    </div>
  );
}
