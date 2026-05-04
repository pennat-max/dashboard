 "use client";

import { useEffect, useMemo, useState } from "react";
import { BuyerBarChart, EntityCountBarChart } from "@/components/dashboard/inventory-charts";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { Dictionary } from "@/i18n/dictionaries";
import type { BuyerCount } from "@/lib/data/aggregate";

type Props = {
  byBuyer: BuyerCount[];
  byAgentCurrentMonthBeForward: BuyerCount[];
  byAgentPreviousMonthBeForward: BuyerCount[];
  byAgentTwoMonthsAgoBeForward: BuyerCount[];
  byAgentAllMonthsBeForward: BuyerCount[];
  byAgentCurrentMonthStock: BuyerCount[];
  byAgentPreviousMonthStock: BuyerCount[];
  byAgentTwoMonthsAgoStock: BuyerCount[];
  byAgentAllMonthsStock: BuyerCount[];
  byAgentCurrentMonthAllBuyer: BuyerCount[];
  byAgentPreviousMonthAllBuyer: BuyerCount[];
  byAgentTwoMonthsAgoAllBuyer: BuyerCount[];
  byAgentAllMonthsAllBuyer: BuyerCount[];
  insights: Dictionary["insights"];
  agentPreviousMonthLabel: string;
  agentTwoMonthsAgoLabel: string;
};

type AgentRangeKey = "currentMonth" | "last3Months" | "twoMonthsAgo" | "all";
type AgentBuyerKey = "all" | "beForward" | "stock";

export function DashboardInsights({
  byBuyer,
  byAgentCurrentMonthBeForward,
  byAgentPreviousMonthBeForward,
  byAgentTwoMonthsAgoBeForward,
  byAgentAllMonthsBeForward,
  byAgentCurrentMonthStock,
  byAgentPreviousMonthStock,
  byAgentTwoMonthsAgoStock,
  byAgentAllMonthsStock,
  byAgentCurrentMonthAllBuyer,
  byAgentPreviousMonthAllBuyer,
  byAgentTwoMonthsAgoAllBuyer,
  byAgentAllMonthsAllBuyer,
  insights,
  agentPreviousMonthLabel,
  agentTwoMonthsAgoLabel,
}: Props) {
  const [agentRange, setAgentRange] = useState<AgentRangeKey>("all");
  const [agentBuyer, setAgentBuyer] = useState<AgentBuyerKey>("all");
  const [agentChartFullscreen, setAgentChartFullscreen] = useState(false);
  const [comparedAgents, setComparedAgents] = useState<string[]>([]);
  const openAgentChartFullscreen = () => {
    if (typeof window !== "undefined" && window.innerWidth < 768) {
      setAgentChartFullscreen(true);
    }
  };
  const closeAgentChartFullscreen = () => setAgentChartFullscreen(false);
  const toggleComparedAgent = (agentName: string) => {
    if (!agentName) return;
    setComparedAgents((prev) => {
      if (prev.includes(agentName)) return prev.filter((v) => v !== agentName);
      return [...prev, agentName];
    });
  };

  useEffect(() => {
    if (!agentChartFullscreen || typeof window === "undefined") return;

    const orientation = window.screen.orientation as (ScreenOrientation & {
      lock?: (orientation: "landscape") => Promise<void>;
      unlock?: () => void;
    }) | null;

    void orientation?.lock?.("landscape").catch(() => undefined);

    return () => {
      orientation?.unlock?.();
    };
  }, [agentChartFullscreen]);
  const selectedAgents = useMemo(() => {
    if (agentBuyer === "beForward") {
      if (agentRange === "currentMonth") return byAgentCurrentMonthBeForward;
      if (agentRange === "last3Months") return byAgentPreviousMonthBeForward;
      if (agentRange === "twoMonthsAgo") return byAgentTwoMonthsAgoBeForward;
      return byAgentAllMonthsBeForward;
    }
    if (agentBuyer === "stock") {
      if (agentRange === "currentMonth") return byAgentCurrentMonthStock;
      if (agentRange === "last3Months") return byAgentPreviousMonthStock;
      if (agentRange === "twoMonthsAgo") return byAgentTwoMonthsAgoStock;
      return byAgentAllMonthsStock;
    }
    if (agentRange === "currentMonth") return byAgentCurrentMonthAllBuyer;
    if (agentRange === "last3Months") return byAgentPreviousMonthAllBuyer;
    if (agentRange === "twoMonthsAgo") return byAgentTwoMonthsAgoAllBuyer;
    return byAgentAllMonthsAllBuyer;
  }, [
    agentBuyer,
    agentRange,
    byAgentCurrentMonthBeForward,
    byAgentPreviousMonthBeForward,
    byAgentTwoMonthsAgoBeForward,
    byAgentAllMonthsBeForward,
    byAgentCurrentMonthStock,
    byAgentPreviousMonthStock,
    byAgentTwoMonthsAgoStock,
    byAgentAllMonthsStock,
    byAgentCurrentMonthAllBuyer,
    byAgentPreviousMonthAllBuyer,
    byAgentTwoMonthsAgoAllBuyer,
    byAgentAllMonthsAllBuyer,
  ]);
  const comparedRows = useMemo(
    () => selectedAgents.filter((row) => comparedAgents.includes(row.buyer)),
    [selectedAgents, comparedAgents],
  );

  return (
    <div className="space-y-5">
      <div className="space-y-5">
      <Card className="border border-border/80 bg-card shadow-sm">
        <CardContent className="pt-4">
          <h3 className="mb-3 text-sm font-semibold text-foreground">{insights.buyerTitle}</h3>
          {byBuyer.length === 0 ? (
            <p className="text-sm text-muted-foreground">{insights.buyerEmpty}</p>
          ) : (
            <BuyerBarChart data={byBuyer} units={insights.units} />
          )}
        </CardContent>
      </Card>
      <Card className="relative overflow-hidden border-2 border-amber-200/80 bg-card shadow-md shadow-amber-500/10 dark:border-amber-500/30">
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-amber-400 via-amber-500 to-orange-400"
          aria-hidden
        />
        <CardContent className="pt-4">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            {insights.agentTitle}
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({insights.agentInteractionHint})
            </span>
          </h3>

          <div className="mb-4 grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-2 md:grid-cols-2">
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {insights.agentBuyerScopeLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "all" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("all")}
                >
                  {insights.agentBuyerAll}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "beForward" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("beForward")}
                >
                  {insights.agentBuyerBeForward}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "stock" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("stock")}
                >
                  {insights.agentBuyerStock}
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {insights.agentMonthRangeLabel}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "currentMonth" ? "default" : "outline"}
                  onClick={() => setAgentRange("currentMonth")}
                >
                  {insights.agentFilterCurrent}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "last3Months" ? "default" : "outline"}
                  onClick={() => setAgentRange("last3Months")}
                >
                  {agentPreviousMonthLabel}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "twoMonthsAgo" ? "default" : "outline"}
                  onClick={() => setAgentRange("twoMonthsAgo")}
                >
                  {agentTwoMonthsAgoLabel}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "all" ? "default" : "outline"}
                  onClick={() => setAgentRange("all")}
                >
                  {insights.agentFilterAll}
                </Button>
              </div>
            </div>
          </div>

          {selectedAgents.length === 0 ? (
            <p className="text-sm text-muted-foreground">{insights.agentEmpty}</p>
          ) : (
            <>
              <div className="mb-2 flex items-center justify-end md:hidden">
                <Button type="button" size="xs" variant="outline" onClick={openAgentChartFullscreen}>
                  {insights.agentFullscreenButton}
                </Button>
              </div>
              <div className="block w-full text-start">
                <EntityCountBarChart
                  data={selectedAgents}
                  units={insights.units}
                  selectedAgentNames={comparedAgents}
                  onAgentSelect={toggleComparedAgent}
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground md:hidden">
                {insights.agentMobileHint}
              </p>
              <div className="mt-2 rounded-md border border-border/70 bg-muted/20 px-2 py-1.5 text-xs">
                {comparedRows.length === 0 ? (
                  <p className="text-muted-foreground">{insights.agentCompareHint}</p>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {comparedRows.map((row) => (
                      <span key={row.buyer} className="font-medium text-foreground">
                        {row.buyer}: <span className="tabular-nums">{row.count}</span> {insights.units}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </div>

      {agentChartFullscreen && selectedAgents.length > 0 ? (
        <div className="fixed inset-0 z-50 bg-background p-3 md:hidden">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">{insights.agentTitle}</h3>
            <Button type="button" size="xs" variant="outline" onClick={closeAgentChartFullscreen}>
              {insights.agentFullscreenClose}
            </Button>
          </div>
          <p className="mb-2 text-[11px] text-muted-foreground">{insights.agentFullscreenLandscapeHint}</p>
          <div className="mb-2 grid gap-2 rounded-lg border border-border/70 bg-muted/30 p-2">
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {insights.agentBuyerScopeLabel}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "all" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("all")}
                >
                  {insights.agentBuyerAll}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "beForward" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("beForward")}
                >
                  {insights.agentBuyerBeForward}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentBuyer === "stock" ? "default" : "outline"}
                  onClick={() => setAgentBuyer("stock")}
                >
                  {insights.agentBuyerStock}
                </Button>
              </div>
            </div>
            <div>
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {insights.agentMonthRangeLabel}
              </p>
              <div className="flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "currentMonth" ? "default" : "outline"}
                  onClick={() => setAgentRange("currentMonth")}
                >
                  {insights.agentFilterCurrent}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "last3Months" ? "default" : "outline"}
                  onClick={() => setAgentRange("last3Months")}
                >
                  {agentPreviousMonthLabel}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "twoMonthsAgo" ? "default" : "outline"}
                  onClick={() => setAgentRange("twoMonthsAgo")}
                >
                  {agentTwoMonthsAgoLabel}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant={agentRange === "all" ? "default" : "outline"}
                  onClick={() => setAgentRange("all")}
                >
                  {insights.agentFilterAll}
                </Button>
              </div>
            </div>
          </div>
          <div className="h-[calc(100vh-12.5rem)] overflow-hidden">
            <EntityCountBarChart
              data={selectedAgents}
              units={insights.units}
              selectedAgentNames={comparedAgents}
              onAgentSelect={toggleComparedAgent}
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
