import { CarsInventoryClient } from "@/components/cars/cars-inventory-client";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/lib/locale";
import { carsInventoryStateFromSearchParams } from "@/lib/cars-inventory-filter";
import { fetchCarsList } from "@/lib/data/cars";

export const dynamic = "force-dynamic";
const PUBLIC_CARS_CLIENT_LIMIT = 250;

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function CarsPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const dict = getDictionary(locale);

  const initialFilters = carsInventoryStateFromSearchParams(searchParams);
  const result = await fetchCarsList({
    q: initialFilters.q,
    status: initialFilters.status,
    brand: initialFilters.brand.join(","),
    destination: initialFilters.destination,
    driveType: initialFilters.driveType.join(","),
    engineSize: initialFilters.engineSize.join(","),
    grade: initialFilters.grade.join(","),
    gearType: initialFilters.gearType.join(","),
    cabin: initialFilters.cabin.join(","),
    color: initialFilters.color.join(","),
    cYear: initialFilters.cYear.join(","),
    sort: initialFilters.sort,
    order: initialFilters.order,
    maxRows: PUBLIC_CARS_CLIENT_LIMIT,
  });
  const initialCars = result.cars;

  return (
    <>
      {result.error && (
        <div className="mx-auto max-w-6xl pt-6">
          <SupabaseErrorBanner message={result.error} labels={dict.error} />
        </div>
      )}
      <CarsInventoryClient
        allCars={initialCars}
        totalCars={result.total ?? result.cars.length}
        initialFilters={initialFilters}
      />
    </>
  );
}
