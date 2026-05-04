"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { MonthlyCount, StatusCount } from "@/lib/data/aggregate";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BuyerCount } from "@/lib/data/aggregate";
import { formatThb } from "@/lib/format";

function formatBookedOver7Line(
  count: number,
  template: string,
  units: string,
  locale: string
): string {
  const fmt = new Intl.NumberFormat(locale).format(count);
  return template.replace(/\{\{count\}\}/g, fmt).replace(/\{\{units\}\}/g, units);
}

const CHART_ACCENT = "#2563eb";

/** วนสีจากธีม — แยกแต่ละแท่งให้ชัด */
const BAR_FILLS = [
  "#2563eb",
  "#0ea5e9",
  "#14b8a6",
  "#22c55e",
  "#84cc16",
  "#eab308",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#d946ef",
  "#a855f7",
  "#8b5cf6",
  "#6366f1",
  "#06b6d4",
] as const;

/** แท่งแนวนอน EntityCountBarChart — โทนอ่อน แยกแถวอ่านง่าย */
const ENTITY_COUNT_BAR_FILLS = [
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#84cc16",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#a855f7",
  "#6366f1",
] as const;

function compactAgentLabelSingleLine(name: string, maxChars = 24): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxChars) return trimmed;
  return `${trimmed.slice(0, maxChars - 1)}…`;
}

type EndOfBarLabelProps = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  value?: number | string;
};

function EndOfBarCountLabel({ x, y, width, height, value }: EndOfBarLabelProps) {
  if (typeof x !== "number" || typeof y !== "number" || typeof width !== "number" || typeof height !== "number") {
    return null;
  }
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return null;
  return (
    <text
      x={x + width + 8}
      y={y + height / 2}
      dominantBaseline="middle"
      textAnchor="start"
      fill="#111827"
      fontSize={13}
      fontWeight={700}
      style={{ fontVariantNumeric: "tabular-nums" }}
    >
      {n}
    </text>
  );
}

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

function BuyerTooltip({
  active,
  payload,
  units,
  hideValueThb,
  over7DaysTemplate,
  countFormatLocale,
}: {
  active?: boolean;
  payload?: {
    name?: string;
    value?: number;
    payload?: {
      name: string;
      count: number;
      fill: string;
      pct: number;
      totalValueThb: number;
      countBookedOver7Days: number;
    };
  }[];
  units: string;
  hideValueThb?: boolean;
  over7DaysTemplate?: string;
  countFormatLocale?: string;
}) {
  if (!active || !payload?.length) return null;
  const item = payload[0];
  const inner = item.payload;
  const row =
    inner && typeof inner === "object" && "fill" in inner
      ? inner
      : {
          name: String(item.name ?? ""),
          count: Number(item.value ?? 0),
          fill: "var(--chart-1)",
          pct: 0,
          totalValueThb: 0,
          countBookedOver7Days: 0,
        };
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 size-2.5 shrink-0 rounded-sm ring-1 ring-border/80"
          style={{ backgroundColor: row.fill }}
          aria-hidden
        />
        <div className="min-w-0 space-y-1">
          <div className="font-semibold leading-snug text-foreground">{row.name}</div>
          {!hideValueThb ? (
            <div className="font-medium tabular-nums text-foreground">{formatThb(row.totalValueThb)}</div>
          ) : null}
          {hideValueThb && over7DaysTemplate && countFormatLocale ? (
            <div className="font-medium tabular-nums text-foreground">
              {formatBookedOver7Line(
                row.countBookedOver7Days,
                over7DaysTemplate,
                units,
                countFormatLocale
              )}
            </div>
          ) : null}
          <div className="tabular-nums text-muted-foreground">
            <span className="font-medium text-foreground">{row.count}</span> {units}{" "}
            <span className="text-muted-foreground/90">({row.pct}%)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ป้ายกราฟสถานะ/เดือน — ใช้เมื่อนำคอมโพเนนต์ไปแสดงที่อื่น */
export type StatusMonthlyChartLabels = {
  statusTitle: string;
  statusDesc: string;
  monthlyTitle: string;
  monthlyDesc: string;
};

export function StatusBarChart({
  data,
  labels,
}: {
  data: StatusCount[];
  labels: StatusMonthlyChartLabels;
}) {
  const chartData = data.map((d) => ({
    name: d.status,
    count: d.count,
  }));

  return (
    <Card className="min-h-[320px] border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-base font-semibold">{labels.statusTitle}</CardTitle>
        <CardDescription>{labels.statusDesc}</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] min-h-[260px] min-w-0 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <BarChart data={chartData} margin={{ top: 28, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-12} textAnchor="end" height={48} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--muted)", opacity: 0.25 }} />
            <Bar dataKey="count" fill={CHART_ACCENT} radius={[4, 4, 0, 0]} maxBarSize={40}>
              <LabelList
                dataKey="count"
                position="top"
                fill="var(--foreground)"
                stroke="var(--background)"
                strokeWidth={2.25}
                fontSize={11}
                fontWeight={600}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}

export function BuyerBarChart({
  data,
  units,
  anchorIdPrefix,
  colorByBuyer,
  hideValueThb = false,
  over7DaysTemplate,
  countFormatLocale,
}: {
  data: BuyerCount[];
  /** e.g. คัน / units */
  units: string;
  /** ถ้าระบุ: กดชื่อ/ชิ้นกราฟแล้วเลื่อนไป element id นี้ + encodeURIComponent(name) */
  anchorIdPrefix?: string;
  /** map ชื่อ buyer/sale_support -> สีคงที่ */
  colorByBuyer?: Record<string, string>;
  /** ซ่อนมูลค่า THB (เช่น กราฟ Booked by sale support) */
  hideValueThb?: boolean;
  /** แทนที่บรรทัด THB ด้วยข้อความนี้ — ใช้ {{count}} และ {{units}} */
  over7DaysTemplate?: string;
  /** locale สำหรับเลขใน {{count}} */
  countFormatLocale?: string;
}) {
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const chartData = data.map((d, i) => ({
    name: d.buyer,
    count: d.count,
    totalValueThb: d.totalValueThb,
    countBookedOver7Days: d.countBookedOver7Days ?? 0,
    fill: colorByBuyer?.[d.buyer] ?? BAR_FILLS[i % BAR_FILLS.length],
    pct: total > 0 ? Math.round((d.count / total) * 1000) / 10 : 0,
  }));
  const jumpToName = (name: string) => {
    if (!anchorIdPrefix) return;
    const id = `${anchorIdPrefix}${encodeURIComponent(name)}`;
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    window.history.replaceState(null, "", `#${id}`);
  };

  return (
    <div
      className="flex w-full min-w-0 flex-col gap-6 sm:flex-row sm:items-center sm:justify-center sm:gap-8"
      role="img"
      aria-label="Buyer distribution chart"
    >
      <div className="mx-auto h-[min(300px,72vw)] w-[min(300px,72vw)] shrink-0 sm:mx-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Pie
              data={chartData}
              dataKey="count"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius="48%"
              outerRadius="78%"
              paddingAngle={1.5}
              stroke="var(--background)"
              strokeWidth={2}
              onClick={(slice) => jumpToName(String(slice?.name ?? ""))}
            >
              {chartData.map((entry, i) => (
                <Cell
                  key={`${entry.name}-${i}`}
                  fill={entry.fill}
                  className={anchorIdPrefix ? "cursor-pointer" : undefined}
                />
              ))}
            </Pie>
            <Tooltip
              content={
                <BuyerTooltip
                  units={units}
                  hideValueThb={hideValueThb}
                  over7DaysTemplate={over7DaysTemplate}
                  countFormatLocale={countFormatLocale}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="max-h-56 w-full list-none space-y-1.5 overflow-y-auto pr-1 text-xs sm:max-h-72 sm:min-w-[260px] sm:max-w-xl sm:flex-1">
        {chartData.map((d) => (
          <li
            key={d.name}
            className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 border-b border-border/50 pb-2 last:border-0"
          >
            <span className="flex min-w-0 items-start gap-2">
              <span
                className="mt-1 size-2.5 shrink-0 rounded-full ring-1 ring-border/60"
                style={{ backgroundColor: d.fill }}
                aria-hidden
              />
              {anchorIdPrefix ? (
                <button
                  type="button"
                  className="leading-snug text-foreground underline-offset-4 hover:underline"
                  title={d.name}
                  onClick={() => jumpToName(d.name)}
                >
                  {d.name}
                </button>
              ) : (
                <span className="leading-snug text-foreground" title={d.name}>
                  {d.name}
                </span>
              )}
            </span>
            <span className="flex shrink-0 flex-col items-end gap-0.5 text-end sm:flex-row sm:items-baseline sm:gap-2">
              {!hideValueThb ? (
                <span className="font-medium tabular-nums text-foreground">{formatThb(d.totalValueThb)}</span>
              ) : null}
              {hideValueThb && over7DaysTemplate && countFormatLocale ? (
                <span className="font-medium tabular-nums text-foreground">
                  {formatBookedOver7Line(
                    d.countBookedOver7Days,
                    over7DaysTemplate,
                    units,
                    countFormatLocale
                  )}
                </span>
              ) : null}
              <span className="tabular-nums text-muted-foreground">
                {d.count} {units}{" "}
                <span className="text-muted-foreground/85">({d.pct}%)</span>
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function EntityCountBarChart({
  data,
  units,
  selectedAgentNames = [],
  onAgentSelect,
}: {
  data: BuyerCount[];
  units: string;
  selectedAgentNames?: string[];
  onAgentSelect?: (agentName: string) => void;
}) {
  const selectedSet = new Set(selectedAgentNames);
  const longestNameLength = data.reduce((max, row) => Math.max(max, row.buyer.length), 0);
  const nameColumnWidth = Math.min(230, Math.max(150, Math.round(longestNameLength * 7.2) + 12));
  const maxLabelChars = Math.max(14, Math.floor((nameColumnWidth - 12) / 7.2));
  const baseRows = data.map((d, i) => ({
    name: d.buyer,
    count: d.count,
    fill: ENTITY_COUNT_BAR_FILLS[i % ENTITY_COUNT_BAR_FILLS.length],
    selected: selectedSet.has(d.buyer),
  }));
  const chartData =
    selectedSet.size === 0
      ? baseRows
      : [...baseRows].sort((a, b) => {
          if (a.selected !== b.selected) return a.selected ? -1 : 1;
          if (b.count !== a.count) return b.count - a.count;
          return a.name.localeCompare(b.name, "th");
        });
  const barRowHeight = 36;
  const visibleBars = 8;
  const dynamicChartHeight = Math.max(560, chartData.length * barRowHeight);
  const viewportHeight = Math.max(320, Math.min(chartData.length, visibleBars) * barRowHeight + 56);

  return (
    <div className="min-w-0 w-full pt-2">
      <div
        className="overflow-y-auto rounded-lg border border-border/70 bg-background/40 p-2 pl-0"
        style={{ maxHeight: `${viewportHeight}px` }}
      >
        <div style={{ height: `${dynamicChartHeight}px`, width: "100%" }}>
          <ResponsiveContainer width="100%" height="100%" minHeight={dynamicChartHeight}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 10, right: 52, left: -4, bottom: 10 }}
              barCategoryGap={4}
            >
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={true} vertical={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
              <YAxis
                type="category"
                dataKey="name"
                width={nameColumnWidth}
                tick={({ x, y, payload }) => {
                  const fullName = String(payload?.value ?? "");
                  const isSelected = selectedSet.has(fullName);
                  const shortName = compactAgentLabelSingleLine(fullName, maxLabelChars);
                  return (
                    <g transform={`translate(${x},${y})`}>
                      <text
                        x={0}
                        y={0}
                        dy={4}
                        textAnchor="end"
                        className={`fill-foreground ${onAgentSelect ? "cursor-pointer" : ""}`}
                        fontSize={13}
                        fontWeight={isSelected ? 800 : 600}
                        onClick={() => onAgentSelect?.(fullName)}
                      >
                        <title>{fullName}</title>
                        {shortName}
                      </text>
                    </g>
                  );
                }}
              />
              <Tooltip
                formatter={(value) => [`${value} ${units}`, units]}
                labelFormatter={(label) => String(label)}
                cursor={{ fill: "var(--muted)", opacity: 0.2 }}
              />
              <Bar
                dataKey="count"
                radius={[0, 6, 6, 0]}
                maxBarSize={30}
                isAnimationActive={false}
                onClick={(state) => onAgentSelect?.(String(state?.name ?? state?.payload?.name ?? ""))}
              >
                <LabelList dataKey="count" content={<EndOfBarCountLabel />} />
                {chartData.map((entry, idx) => (
                  <Cell
                    key={`${entry.name}-${idx}`}
                    fill={entry.fill}
                    fillOpacity={selectedSet.size === 0 || entry.selected ? 1 : 0.35}
                    className={onAgentSelect ? "cursor-pointer" : undefined}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export function MonthlyAreaChart({
  data,
  labels,
}: {
  data: MonthlyCount[];
  labels: StatusMonthlyChartLabels;
}) {
  const chartData = data.map((d) => ({
    label: d.label,
    count: d.count,
  }));

  return (
    <Card className="min-h-[320px] border border-border/80 bg-card shadow-sm">
      <CardHeader className="border-b border-border/80 pb-4">
        <CardTitle className="text-base font-semibold">{labels.monthlyTitle}</CardTitle>
        <CardDescription>{labels.monthlyDesc}</CardDescription>
      </CardHeader>
      <CardContent className="h-[260px] min-h-[260px] min-w-0 w-full pt-4">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="areaFillDashboard" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563eb" stopOpacity={0.28} />
                <stop offset="100%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-10} textAnchor="end" height={52} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={36} />
            <Tooltip content={<ChartTooltip />} />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#2563eb"
              fill="url(#areaFillDashboard)"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}
