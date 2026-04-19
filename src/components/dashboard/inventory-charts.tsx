"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyCount, StatusCount } from "@/lib/data/aggregate";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const CHART_ACCENT = "var(--chart-1)";

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value?: number }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-popover px-2 py-1.5 text-xs text-popover-foreground shadow-md">
      <div className="font-medium">{label}</div>
      <div className="tabular-nums text-muted-foreground">{payload[0]?.value ?? 0}</div>
    </div>
  );
}

export function StatusBarChart({ data }: { data: StatusCount[] }) {
  const chartData = data.map((d) => ({
    name: d.status,
    count: d.count,
  }));

  return (
    <Card className="min-h-[320px] border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-base font-semibold">สถานะสต็อก</CardTitle>
        <CardDescription>จำนวนคันตามคอลัมน์ status</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] min-h-[260px] min-w-0 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={48} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.25 }} />
            <Bar dataKey="count" fill={CHART_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={40} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function MonthlyAreaChart({ data }: { data: MonthlyCount[] }) {
  const chartData = data.map((d) => ({
    label: d.label,
    count: d.count,
  }));

  return (
    <Card className="min-h-[320px] border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-base font-semibold">รายการตามเดือน</CardTitle>
        <CardDescription>จากวันที่อัปเดต / รับรถ — สูงสุด 12 เดือนล่าสุด</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] min-h-[260px] min-w-0 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFillDashboard" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.22} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={52} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="var(--chart-1)"
              fill="url(#areaFillDashboard)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
