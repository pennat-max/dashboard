"use client";

import { BuyerBarChart } from "@/components/dashboard/inventory-charts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { BuyerCount } from "@/lib/data/aggregate";
import { PieChart } from "lucide-react";

type Props = {
  bySaleSupport: BuyerCount[];
  colorBySaleSupport?: Record<string, string>;
  units: string;
  title: string;
  /** คำอธิบายการใช้งาน: คลิกชื่อ → เลื่อนไปกลุ่ม / ปุ่มแชร์ */
  chartTip: string;
  chartEmpty: string;
  /** แทนที่มูลค่า THB — ใช้ {{count}} และ {{units}} */
  over7DaysTemplate: string;
  countFormatLocale: string;
};

export function BookedDistribution({
  bySaleSupport,
  colorBySaleSupport,
  units,
  title,
  chartTip,
  chartEmpty,
  over7DaysTemplate,
  countFormatLocale,
}: Props) {
  return (
    <Card className="border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <div className="flex items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
            <PieChart className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 space-y-2">
            <CardTitle className="text-base font-semibold">{title}</CardTitle>
            <CardDescription className="text-xs leading-relaxed">{chartTip}</CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        {bySaleSupport.length === 0 ? (
          <p className="text-sm text-muted-foreground">{chartEmpty}</p>
        ) : (
          <BuyerBarChart
            data={bySaleSupport}
            units={units}
            anchorIdPrefix="sale-support-"
            colorByBuyer={colorBySaleSupport}
            hideValueThb
            over7DaysTemplate={over7DaysTemplate}
            countFormatLocale={countFormatLocale}
          />
        )}
      </CardContent>
    </Card>
  );
}
