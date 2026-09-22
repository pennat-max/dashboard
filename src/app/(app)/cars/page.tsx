import { CarsInventoryClient } from "@/components/cars/cars-inventory-client";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import { getDictionary } from "@/i18n/dictionaries";
import { getLocale } from "@/lib/locale";
import { carsInventoryStateFromSearchParams } from "@/lib/cars-inventory-filter";
import { fetchCarsForDashboard } from "@/lib/data/cars";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Record<string, string | string[] | undefined>;
};

export default async function CarsPage({ searchParams }: PageProps) {
  const locale = await getLocale();
  const dict = getDictionary(locale);

  const result = await fetchCarsForDashboard();
  const initialFilters = carsInventoryStateFromSearchParams(searchParams);

  return (
    <>
      {result.error && (
        <div className="mx-auto max-w-6xl pt-6">
          <SupabaseErrorBanner message={result.error} labels={dict.error} />
        </div>
      )}
      <CarsInventoryClient allCars={result.cars} initialFilters={initialFilters} />
    </>
  );
}
