import { LiffOrdersShell } from "@/components/liff/liff-orders-shell";
import { MobileOrderTrackingHome } from "@/components/orders/mobile-v2/mobile-order-tracking-home";
import { loadOrderTrackingPageData } from "@/lib/order-tracking/load-order-tracking-page";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: {
    order?: string | string[];
    load?: string | string[];
    scope?: string | string[];
    search?: string | string[];
  };
};

export default async function LiffOrdersPage({ searchParams }: PageProps) {
  const loadRaw = searchParams?.load;
  const loadMode = typeof loadRaw === "string" ? loadRaw : Array.isArray(loadRaw) ? String(loadRaw[0] ?? "") : "";
  const isFullLoad = loadMode.trim().toLowerCase() === "full";
  const scopeRaw = searchParams?.scope;
  const requestedScope = (typeof scopeRaw === "string" ? scopeRaw : Array.isArray(scopeRaw) ? String(scopeRaw[0] ?? "") : "").trim().toLowerCase();
  const scope = requestedScope === "shipped" || requestedScope === "all" ? requestedScope : "active";
  const searchRaw = searchParams?.search;
  const search = (typeof searchRaw === "string" ? searchRaw : Array.isArray(searchRaw) ? String(searchRaw[0] ?? "") : "").trim();
  const focusedSearch = search.length > 0;
  const taskFirstMode = !isFullLoad;
  const initialSaleStatusFilters =
    scope === "active" ? (["จอง", "รอส่ง", "ว่าง"] as const) : scope === "shipped" ? (["ส่งแล้ว"] as const) : ([] as const);
  const props = await loadOrderTrackingPageData(searchParams ?? {}, {
    summaryOnly: !isFullLoad,
    includeShipped: scope !== "active",
    shippedOnly: scope === "shipped",
    chipCacheExperiment: taskFirstMode,
    initialDetailLimit: 10,
    initialSaleStatusFilters: [...initialSaleStatusFilters],
    leanInitialDetails: taskFirstMode,
    maxCars: focusedSearch ? 20 : scope === "active" || scope === "shipped" ? 150 : undefined,
    search: focusedSearch ? search : undefined,
    skipGlobalSummary: focusedSearch,
  });
  return (
    <LiffOrdersShell>
      <MobileOrderTrackingHome
        carsData={props.carsData}
        orderItemsByCar={props.orderItemsByCar}
        orderUpdatesByCar={props.orderUpdatesByCar}
        orderItemFilterIndexByCar={props.orderItemFilterIndexByCar}
        orderChipCacheExperimentEnabled={taskFirstMode}
        orderChipCacheBadgeLabel={taskFirstMode ? "โหลดแบบเบา" : null}
        experimentInitialHydratedCarKeys={props.experimentInitialHydratedCarKeys}
        saleStatusSummaryAllCars={props.saleStatusSummaryAllCars}
        summarySnapshotAllCars={props.summarySnapshotAllCars}
        disableDemoFallback
        deferCarsHydration={!isFullLoad}
        initialSaleStatusFilters={[...initialSaleStatusFilters]}
        dataWarnings={props.dataWarnings}
        initialFocusedOrderId={props.initialFocusedOrderId}
        shareBaseUrl={props.shareBaseUrl}
        initialUiLang="th"
        taskFirstLiff={taskFirstMode}
        taskFirstScope={scope}
        taskFirstInitialCount={10}
      />
    </LiffOrdersShell>
  );
}
