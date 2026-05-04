"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type IncomeDailyRow = {
  date: string;
  label: string;
  count: number;
  totalValueThb: number;
};

type Props = {
  rows: IncomeDailyRow[];
  title: string;
  emptyText: string;
  payAmountLabel: string;
  countLabel: string;
  /** When set (e.g. `income-day`), clicking a bar scrolls to `#${prefix}-${isoDate}`. */
  detailAnchorPrefix?: string;
};

type BarLabelProps = {
  x?: number;
  y?: number;
  width?: number;
  viewBox?: { x?: number; y?: number; width?: number; height?: number };
  payload?: { count?: number };
  value?: number | string;
};

function CountOnBarLabel({ x, y, width, viewBox, payload, value }: BarLabelProps) {
  const lx = typeof x === "number" ? x : viewBox?.x;
  const ly = typeof y === "number" ? y : viewBox?.y;
  const lw = typeof width === "number" ? width : viewBox?.width;
  if (typeof lx !== "number" || typeof ly !== "number" || typeof lw !== "number") return null;
  const count = Number(payload?.count ?? value ?? 0);
  if (!Number.isFinite(count) || count <= 0) return null;
  return (
    <text
      x={lx + lw / 2}
      y={ly + 4}
      dominantBaseline="hanging"
      textAnchor="middle"
      fill="#000000"
      fontSize={11}
      fontWeight={700}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {count}
    </text>
  );
}

export function IncomeScheduleChart({
  rows,
  title,
  emptyText,
  payAmountLabel,
  countLabel,
  detailAnchorPrefix,
}: Props) {
  const chartData = rows.map((row) => ({
    date: row.date,
    label: row.label,
    amount: row.totalValueThb,
    count: row.count,
  }));

  return (
    <Card className="border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="h-[320px] min-h-[320px] pt-4">
        {chartData.length === 0 ? (
          <p className="text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 32, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis
                tick={{ fontSize: 11 }}
                width={52}
                allowDecimals={false}
                domain={[0, (dataMax: number) => Math.max(1, Math.ceil(dataMax * 1.12))]}
              />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "amount") return [Number(value ?? 0).toLocaleString("th-TH"), payAmountLabel];
                  return [String(value ?? 0), countLabel];
                }}
                labelFormatter={(_, payload) => String(payload?.[0]?.payload?.label ?? "")}
                cursor={{ fill: "var(--muted)", opacity: 0.2 }}
              />
              <Bar
                dataKey="amount"
                name="amount"
                fill="#2563eb"
                radius={[6, 6, 0, 0]}
                maxBarSize={52}
                className={detailAnchorPrefix ? "cursor-pointer" : undefined}
                onClick={(barItem) => {
                  if (!detailAnchorPrefix || typeof document === "undefined") return;
                  const date = (barItem?.payload as { date?: string } | undefined)?.date;
                  if (!date) return;
                  document
                    .getElementById(`${detailAnchorPrefix}-${date}`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                }}
              >
                <LabelList dataKey="count" content={<CountOnBarLabel />} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
