"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function num(v: string | number | undefined): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

type LabelRenderProps = Record<string, unknown>;

/** Recharts 3 ไม่ส่ง `payload` เข้า Label (ถูก strip ออกจาก svgPropertiesAndEvents) — ใช้ value จาก valueAccessor แทน */
function chartRowFromLabelProps(p: LabelRenderProps): Record<string, string | number> | undefined {
  const v = p.value;
  if (v != null && typeof v === "object" && !Array.isArray(v) && "total" in v) {
    return v as Record<string, string | number>;
  }
  const pay = p.payload;
  if (pay != null && typeof pay === "object" && !Array.isArray(pay) && "total" in pay) {
    return pay as Record<string, string | number>;
  }
  return undefined;
}

function coordsFromLabelRenderProps(p: LabelRenderProps) {
  const vb = p.viewBox as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } | undefined;
  const x = num(p.x as string | number | undefined) ?? num(vb?.x as string | number | undefined);
  const y = num(p.y as string | number | undefined) ?? num(vb?.y as string | number | undefined);
  const width = num(p.width as string | number | undefined) ?? num(vb?.width as string | number | undefined);
  const height = num(p.height as string | number | undefined) ?? num(vb?.height as string | number | undefined);
  return { x, y, width, height };
}

/** แสดงจำนวนรวมบนสุดแท่ง — วาดเฉพาะบนเซกเมนต์บนสุดที่มีค่า (รองรับกรณีชั้นบนสุดเป็น 0) */
function StackedBarTotalLabel({
  buyerKey,
  buyerOrder,
  labelProps,
}: {
  buyerKey: string;
  buyerOrder: readonly string[];
  labelProps: LabelRenderProps;
}) {
  const payload = chartRowFromLabelProps(labelProps);
  const { x, y, width, height } = coordsFromLabelRenderProps(labelProps);
  if (x == null || y == null || width == null || !payload) return null;
  let topIdx = -1;
  for (let i = buyerOrder.length - 1; i >= 0; i--) {
    const v = Number(payload[buyerOrder[i]] ?? 0);
    if (v > 0) {
      topIdx = i;
      break;
    }
  }
  const myIdx = buyerOrder.indexOf(buyerKey);
  if (topIdx < 0 || myIdx !== topIdx) return null;
  const total = Number(payload.total ?? 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  const topY = height != null && height < 0 ? y + height : y;
  return (
    <text
      x={x + width / 2}
      y={topY - 8}
      textAnchor="middle"
      dominantBaseline="auto"
      pointerEvents="none"
      fill="var(--foreground)"
      stroke="var(--background)"
      strokeWidth={2.5}
      paintOrder="stroke fill"
      style={{ fontSize: 12, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}
    >
      {total}
    </text>
  );
}

type MonthlyTotal = { month: number; label: string; count: number };
type MonthlyBuyerCount = { month: number; buyer: string; count: number };

type Props = {
  monthlyTotals: MonthlyTotal[];
  monthlyBuyerCounts: MonthlyBuyerCount[];
  units: string;
  monthlyBuyerTitle: string;
  emptyText: string;
  unknownMonthText: string;
  unknownMonthCount: number;
  otherBuyerText: string;
  allLabel: string;
  buyerTableTitle: string;
  buyerColLabel: string;
  shareColLabel: string;
  clickHint: string;
};

const STACK_COLORS = [
  "#2563eb",
  "#06b6d4",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#a855f7",
] as const;
const TOP_BUYERS_LIMIT = 8;

export function ExportedMonthlyCharts({
  monthlyTotals,
  monthlyBuyerCounts,
  units,
  monthlyBuyerTitle,
  emptyText,
  unknownMonthText,
  unknownMonthCount,
  otherBuyerText,
  allLabel,
  buyerTableTitle,
  buyerColLabel,
  shareColLabel,
  clickHint,
}: Props) {
  const [selectedKey, setSelectedKey] = useState<string>("all");

  const buyerTotals = new Map<string, number>();
  for (const row of monthlyBuyerCounts) buyerTotals.set(row.buyer, (buyerTotals.get(row.buyer) ?? 0) + row.count);
  const topBuyers = Array.from(buyerTotals.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "th"))
    .slice(0, TOP_BUYERS_LIMIT)
    .map(([name]) => name);
  const topBuyerSet = new Set(topBuyers);

  const monthLabelMap = new Map<number, string>();
  for (const row of monthlyTotals) monthLabelMap.set(row.month, row.label);

  const stackedRows = monthlyTotals.map((row) => {
    const base: Record<string, string | number> = { key: String(row.month), month: row.month, label: row.label, total: row.count };
    for (const buyer of topBuyers) base[buyer] = 0;
    base[otherBuyerText] = 0;
    return base;
  });
  const monthToRow = new Map<number, Record<string, string | number>>();
  for (const row of stackedRows) monthToRow.set(Number(row.month), row);
  for (const row of monthlyBuyerCounts) {
    const target = monthToRow.get(row.month);
    if (!target) continue;
    const buyerKey = topBuyerSet.has(row.buyer) ? row.buyer : otherBuyerText;
    target[buyerKey] = Number(target[buyerKey] ?? 0) + row.count;
  }

  const allRow: Record<string, string | number> = { key: "all", month: 0, label: allLabel, total: monthlyTotals.reduce((s, r) => s + r.count, 0) };
  for (const buyer of topBuyers) allRow[buyer] = buyerTotals.get(buyer) ?? 0;
  allRow[otherBuyerText] = Array.from(buyerTotals.entries())
    .filter(([name]) => !topBuyerSet.has(name))
    .reduce((sum, [, count]) => sum + count, 0);
  const chartRows = [allRow, ...stackedRows];

  const filteredBuyerRows = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of monthlyBuyerCounts) {
      if (selectedKey !== "all" && String(row.month) !== selectedKey) continue;
      map.set(row.buyer, (map.get(row.buyer) ?? 0) + row.count);
    }
    return Array.from(map.entries())
      .map(([buyer, count]) => ({ buyer, count }))
      .sort((a, b) => b.count - a.count || a.buyer.localeCompare(b.buyer, "th"));
  }, [monthlyBuyerCounts, selectedKey]);
  const filteredTotal = filteredBuyerRows.reduce((sum, row) => sum + row.count, 0);
  const selectedLabel = selectedKey === "all" ? allLabel : monthLabelMap.get(Number(selectedKey)) ?? selectedKey;
  const hasData = monthlyTotals.length > 0;
  const buyerStackOrder = [...topBuyers, otherBuyerText] as const;

  return (
    <div className="grid gap-6">
      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <CardTitle className="text-base font-semibold">{monthlyBuyerTitle}</CardTitle>
        </CardHeader>
        <CardContent className="h-[360px] min-h-[360px] pt-4">
          {!hasData ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartRows} margin={{ top: 40, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={42} />
                <Tooltip
                  formatter={(value, name, item) => {
                    const monthNum = Number(item?.payload?.month ?? 0);
                    const label = monthNum > 0 ? (monthLabelMap.get(monthNum) ?? String(item?.payload?.label ?? "")) : allLabel;
                    return [`${value} ${units}`, `${name} (${label})`];
                  }}
                  cursor={{ fill: "var(--muted)", opacity: 0.2 }}
                />
                {[...topBuyers, otherBuyerText].map((buyer, i) => (
                  <Bar
                    key={buyer}
                    dataKey={buyer}
                    stackId="buyers"
                    fill={STACK_COLORS[i % STACK_COLORS.length]}
                    radius={i === topBuyers.length ? [4, 4, 0, 0] : undefined}
                    className="cursor-pointer"
                    isAnimationActive={false}
                    onClick={(state) => setSelectedKey(String(state?.payload?.key ?? "all"))}
                  >
                    <LabelList
                      valueAccessor={(entry) => {
                        const row = (entry as { payload?: Record<string, string | number> }).payload;
                        /* Recharts ชนิด RenderableText ไม่รวม object — ส่งแถวข้อมูลผ่าน value เพื่อให้ content อ่านได้ */
                        return row as unknown as string;
                      }}
                      content={(labelProps) => (
                        <StackedBarTotalLabel
                          buyerKey={buyer}
                          buyerOrder={buyerStackOrder}
                          labelProps={labelProps as LabelRenderProps}
                        />
                      )}
                    />
                  </Bar>
                ))}
                <Legend />
              </BarChart>
            </ResponsiveContainer>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{clickHint}</p>
          {unknownMonthCount > 0 ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {unknownMonthText}: {unknownMonthCount}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border border-border/80 bg-card shadow-sm">
        <CardHeader className="border-b border-border/80 pb-4">
          <CardTitle className="text-base font-semibold">
            {buyerTableTitle}: {selectedLabel}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          {!hasData || filteredBuyerRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border/70">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">{buyerColLabel}</TableHead>
                    <TableHead className="text-right">{units}</TableHead>
                    <TableHead className="pr-4 text-right">{shareColLabel}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBuyerRows.map((row) => (
                    <TableRow key={row.buyer}>
                      <TableCell className="pl-4 font-medium text-foreground">{row.buyer}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.count}</TableCell>
                      <TableCell className="pr-4 text-right tabular-nums text-muted-foreground">
                        {filteredTotal > 0 ? `${((row.count / filteredTotal) * 100).toFixed(1)}%` : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
