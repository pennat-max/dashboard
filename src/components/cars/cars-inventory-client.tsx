"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { CarsTable } from "@/components/cars/cars-table";
import { CarsToolbar } from "@/components/cars/cars-toolbar";
import { buttonVariants } from "@/components/ui/button";
import {
  DEFAULT_CARS_INVENTORY_FILTERS,
  type CarsInventoryFilterState,
  filterCarsForInventory,
  sortCarsForInventory,
} from "@/lib/cars-inventory-filter";
import type { Car } from "@/types/car";

function uniqueByField(
  rows: Car[],
  pick: (c: Car) => string | number | null | undefined
): string[] {
  const set = new Set<string>();
  for (const c of rows) {
    const raw = pick(c);
    const v = String(raw ?? "").trim();
    if (v) set.add(v);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "th"));
}

type Props = {
  allCars: Car[];
  initialFilters: CarsInventoryFilterState;
};

export function CarsInventoryClient({ allCars, initialFilters }: Props) {
  const [filters, setFilters] = useState<CarsInventoryFilterState>(initialFilters);

  const options = useMemo(
    () => ({
      brands: uniqueByField(allCars, (c) => c.brand),
      driveTypes: uniqueByField(allCars, (c) => c.drive_type),
      engineSizes: uniqueByField(allCars, (c) => c.engine_size),
      gearTypes: uniqueByField(allCars, (c) => c.gear_type),
      cabins: uniqueByField(allCars, (c) => c.cabin),
      colors: uniqueByField(allCars, (c) => c.color),
      cYears: uniqueByField(allCars, (c) => c.c_year),
    }),
    [allCars]
  );

  const displayed = useMemo(() => {
    const rows = filterCarsForInventory(allCars, filters);
    return sortCarsForInventory(rows, filters.sort, filters.order);
  }, [allCars, filters]);

  function patchFilters(patch: Partial<CarsInventoryFilterState>) {
    setFilters((prev) => ({ ...prev, ...patch }));
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <section className="rounded border border-border bg-card p-4">
        <div className="mb-3">
          <Link href="/dashboard" className={buttonVariants({ variant: "outline", size: "sm" })}>
            ← หน้าแรก
          </Link>
        </div>
        <p className="text-xs text-muted-foreground">Inventory</p>
        <h1 className="text-2xl font-semibold">รายการรถ</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          แสดง <span className="font-medium text-foreground">{displayed.length}</span> รายการ
          {filters.q.trim() ||
          filters.brand.length ||
          filters.driveType.length ||
          filters.status !== "all" ||
          filters.destination !== "all"
            ? ` (จากทั้งหมด ${allCars.length})`
            : null}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">ตัวกรอง</h2>
        <div>
          <CarsToolbar
            filters={filters}
            onFiltersChange={patchFilters}
            onReset={() => setFilters({ ...DEFAULT_CARS_INVENTORY_FILTERS })}
            {...options}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">ตารางรายการ</h2>
        <CarsTable cars={displayed} />
      </section>
    </div>
  );
}
