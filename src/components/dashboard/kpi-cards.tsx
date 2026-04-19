import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardKpi } from "@/lib/data/cars";
import { formatThb } from "@/lib/format";
import { CarFront, CircleDollarSign, Package, Ship, UserCheck } from "lucide-react";
import { cn } from "@/lib/utils";

export function KpiCards({ kpi }: { kpi: DashboardKpi }) {
  const items = [
    {
      title: "รถทั้งหมด",
      subtitle: "ทุกแถวในตาราง",
      value: new Intl.NumberFormat("th-TH").format(kpi.totalCars),
      icon: CarFront,
    },
    {
      title: "ส่งออกแล้ว",
      subtitle: "shipped ไม่ว่าง",
      value: new Intl.NumberFormat("th-TH").format(kpi.exportedCount),
      icon: Ship,
    },
    {
      title: "ระบุผู้ซื้อ",
      subtitle: "buyer ไม่ว่าง",
      value: new Intl.NumberFormat("th-TH").format(kpi.withBuyerCount),
      icon: UserCheck,
    },
    {
      title: "มูลค่ารวม (ป้ายราคา)",
      subtitle: "รวม buy_price",
      value: formatThb(kpi.totalValueThb),
      icon: CircleDollarSign,
    },
    {
      title: "พร้อมขาย / ในสต็อก",
      subtitle: "status ตามที่กำหนด",
      value: new Intl.NumberFormat("th-TH").format(kpi.availableCount),
      icon: Package,
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
      {items.map(({ title, subtitle, value, icon: Icon }) => (
        <Card
          key={title}
          size="sm"
          className={cn(
            "border border-border/80 bg-card shadow-sm transition-shadow hover:shadow-md"
          )}
        >
          <CardHeader className="flex flex-row items-start justify-between gap-2 pb-2">
            <div className="min-w-0 space-y-1">
              <CardTitle className="text-xs font-medium leading-snug text-muted-foreground">
                {title}
              </CardTitle>
              <p className="text-[0.65rem] leading-tight text-muted-foreground/80">{subtitle}</p>
            </div>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/50 text-muted-foreground">
              <Icon className="size-4" aria-hidden />
            </span>
          </CardHeader>
          <CardContent className="pt-0">
            <p className="font-heading text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
