"use client";

import { RotateCcw, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CarsInventoryFilterState } from "@/lib/cars-inventory-filter";
import { cn } from "@/lib/utils";

type Props = {
  filters: CarsInventoryFilterState;
  onFiltersChange: (patch: Partial<CarsInventoryFilterState>) => void;
  onReset: () => void;
  brands: string[];
  driveTypes: string[];
  engineSizes: string[];
  gearTypes: string[];
  cabins: string[];
  colors: string[];
  cYears: string[];
};

const toggleValue = (values: string[], value: string): string[] =>
  values.includes(value) ? values.filter((v) => v !== value) : [...values, value];

const pillBase =
  "inline-flex min-h-8 items-center justify-center rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function CarsToolbar({
  filters,
  onFiltersChange,
  onReset,
  brands,
  driveTypes,
  engineSizes,
  gearTypes,
  cabins,
  colors,
  cYears,
}: Props) {
  const quickFilters = {
    brand: filters.brand,
    driveType: filters.driveType,
    engineSize: filters.engineSize,
    gearType: filters.gearType,
    cabin: filters.cabin,
    color: filters.color,
    cYear: filters.cYear,
  };

  function applyQuick(patch: Partial<typeof quickFilters>) {
    onFiltersChange({ ...filters, ...patch });
  }

  function QuickGroup({
    label,
    keyName,
    current,
    values,
  }: {
    label: string;
    keyName: keyof typeof quickFilters;
    current: string[];
    values: string[];
  }) {
    const activeCount = current.length;
    return (
      <div
        className={cn(
          "rounded-xl border border-amber-200/70 bg-background/80 p-3 shadow-sm",
          "dark:border-amber-500/20 dark:bg-background/50"
        )}
      >
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 shadow-sm" aria-hidden />
          <span className="text-sm font-semibold tracking-tight text-foreground">{label}</span>
          {activeCount > 0 ? (
            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-amber-900 dark:bg-amber-500/25 dark:text-amber-100">
              เลือก {activeCount} ค่า
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => applyQuick({ [keyName]: [] })}
            className={cn(
              pillBase,
              current.length === 0
                ? "border-amber-500/80 bg-gradient-to-b from-amber-500/20 to-amber-500/10 text-foreground shadow-sm dark:from-amber-500/25 dark:to-amber-500/10"
                : "border-border/80 bg-muted/40 text-muted-foreground hover:border-amber-400/50 hover:bg-muted/70"
            )}
          >
            ทั้งหมด
          </button>
          {values.map((v) => {
            const on = current.includes(v);
            return (
              <button
                key={`${keyName}-${v}`}
                type="button"
                title={v}
                onClick={() =>
                  applyQuick({
                    [keyName]: toggleValue(current, v),
                  })
                }
                className={cn(
                  pillBase,
                  "max-w-[220px] truncate sm:max-w-[260px]",
                  on
                    ? "border-amber-500/90 bg-gradient-to-b from-amber-500/25 to-amber-500/10 text-foreground shadow-sm ring-1 ring-amber-500/20 dark:from-amber-500/30 dark:to-amber-500/15"
                    : "border-border/70 bg-background/90 text-muted-foreground hover:border-amber-300/60 hover:bg-amber-500/5 hover:text-foreground"
                )}
              >
                {v}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="relative overflow-hidden rounded-2xl border-2 border-amber-200/90 bg-gradient-to-b from-tone-amber/70 via-background to-background shadow-md shadow-amber-500/10 dark:border-amber-500/30 dark:from-tone-amber/40 dark:via-card dark:to-card dark:shadow-amber-950/20">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400 opacity-90"
        aria-hidden
      />
      <div className="relative p-4 pt-5 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-amber-300/60 bg-amber-500/10 text-amber-800 shadow-inner dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
              <SlidersHorizontal className="size-5" aria-hidden />
            </div>
            <div>
              <p className="font-heading text-base font-semibold tracking-tight text-foreground">Quick filters</p>
              <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-muted-foreground">
                กรองทันทีในหน้านี้ (client-side) — เลือกได้หลายค่าในแต่ละหมวด กดซ้ำเพื่อยกเลิก
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onReset}
            className="shrink-0 gap-1.5 border-amber-400/50 bg-background/80 hover:bg-amber-500/10 dark:border-amber-500/40"
          >
            <RotateCcw className="size-3.5" aria-hidden />
            ล้างตัวกรอง
          </Button>
        </div>

        <div className="space-y-3">
          <QuickGroup label="Brand" keyName="brand" current={quickFilters.brand} values={brands} />
          <QuickGroup
            label="Drive type"
            keyName="driveType"
            current={quickFilters.driveType}
            values={driveTypes}
          />
          <QuickGroup
            label="Engine size"
            keyName="engineSize"
            current={quickFilters.engineSize}
            values={engineSizes}
          />
          <QuickGroup
            label="Gear type"
            keyName="gearType"
            current={quickFilters.gearType}
            values={gearTypes}
          />
          <QuickGroup label="Cabin" keyName="cabin" current={quickFilters.cabin} values={cabins} />
          <QuickGroup label="Color" keyName="color" current={quickFilters.color} values={colors} />
          <QuickGroup label="C_year" keyName="cYear" current={quickFilters.cYear} values={cYears} />
        </div>
      </div>
    </div>
  );
}
