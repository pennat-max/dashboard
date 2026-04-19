import { DashboardInsights } from "@/components/dashboard/dashboard-insights";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { MonthlyAreaChart, StatusBarChart } from "@/components/dashboard/inventory-charts";
import { SupabaseErrorBanner } from "@/components/supabase-error-banner";
import {
  aggregateByBuyer,
  aggregateByMonth,
  aggregateByStatus,
  computeModelYearInsight,
} from "@/lib/data/aggregate";
import { computeDashboardKpi, fetchCarsForDashboard } from "@/lib/data/cars";

export const dynamic = "force-dynamic";

function SectionTitle({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="border-b border-border pb-4">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {eyebrow}
      </p>
      <h2 className="mt-1.5 font-heading text-lg font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

export default async function DashboardPage() {
  const { cars, error } = await fetchCarsForDashboard();
  const kpi = computeDashboardKpi(cars);
  const byStatus = aggregateByStatus(cars);
  const byMonth = aggregateByMonth(cars, 12);
  const byBuyer = aggregateByBuyer(cars);
  const modelYearInsight = computeModelYearInsight(cars);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-12">
      <header className="border-b border-border pb-8">
        <p className="text-[0.65rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Dashboard
        </p>
        <h1 className="mt-2 font-heading text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          ภาพรวมสต็อก
        </h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          สรุปจากตาราง{" "}
          <code className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-xs">
            cars
          </code>{" "}
          — อัปเดตตามข้อมูลล่าสุดใน Supabase
        </p>
      </header>

      {error && <SupabaseErrorBanner message={error} />}

      <section className="space-y-5">
        <SectionTitle
          eyebrow="Metrics"
          title="ตัวเลขหลัก"
          description="จำนวนรวม การส่งออก ผู้ซื้อ มูลค่า และสต็อกที่พร้อมขาย"
        />
        <KpiCards kpi={kpi} />
      </section>

      <section className="space-y-5">
        <SectionTitle
          eyebrow="Sales & inventory"
          title="ผู้ซื้อและ model year"
          description="จัดกลุ่มตามผู้ซื้อ และปีรถที่ขายได้มากที่สุดเทียบกับของคงเหลือในสต็อก"
        />
        <DashboardInsights byBuyer={byBuyer} modelYear={modelYearInsight} />
      </section>

      <section className="space-y-5">
        <SectionTitle
          eyebrow="Analytics"
          title="กราฟและแนวโน้ม"
          description="การกระจายตามสถานะ และจำนวนรายการตามเดือน (จากวันที่อัปเดต / รับรถ)"
        />
        <div className="grid gap-6 lg:grid-cols-2">
          <StatusBarChart data={byStatus} />
          <MonthlyAreaChart data={byMonth} />
        </div>
      </section>
    </div>
  );
}
