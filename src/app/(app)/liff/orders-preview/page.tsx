import { LiffOrdersShell } from "@/components/liff/liff-orders-shell";
import {
  MobileOrderTrackingHome,
  type LiffTaskFirstScope,
} from "@/components/orders/mobile-v2/mobile-order-tracking-home";
import { loadOrderTrackingPageData } from "@/lib/order-tracking/load-order-tracking-page";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: {
    order?: string | string[];
    scope?: string | string[];
    demo?: string | string[];
    load?: string | string[];
  };
};

function parseScope(value: string | string[] | undefined): LiffTaskFirstScope {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw === "shipped" || raw === "all") return raw;
  return "active";
}

export default async function LiffOrdersPreviewPage({ searchParams }: PageProps) {
  const scope = parseScope(searchParams?.scope);
  const demoRaw = Array.isArray(searchParams?.demo) ? searchParams.demo[0] : searchParams?.demo;
  const demo = demoRaw === "1";
  const loadRaw = Array.isArray(searchParams?.load) ? searchParams.load[0] : searchParams?.load;
  const isFullLoad = String(loadRaw ?? "").trim().toLowerCase() === "full";
  const initialSaleStatusFilters: Array<"จอง" | "รอส่ง" | "ส่งแล้ว" | "ว่าง"> =
    scope === "shipped" ? ["ส่งแล้ว"] : scope === "active" ? ["จอง", "รอส่ง", "ว่าง"] : [];
  const props = await loadOrderTrackingPageData(searchParams ?? {}, {
    summaryOnly: !isFullLoad,
    includeShipped: scope !== "active",
    shippedOnly: scope === "shipped",
    chipCacheExperiment: isFullLoad,
    initialDetailLimit: 6,
    leanInitialDetails: true,
    skipGlobalSummary: true,
    initialSaleStatusFilters,
    maxCars: scope === "all" ? 250 : 150,
  });

  return (
    <LiffOrdersShell taskFirst>
      <MobileOrderTrackingHome
        key={scope}
        carsData={props.carsData}
        orderItemsByCar={props.orderItemsByCar}
        orderUpdatesByCar={props.orderUpdatesByCar}
        orderItemFilterIndexByCar={props.orderItemFilterIndexByCar}
        orderChipCacheExperimentEnabled={!demo}
        experimentInitialHydratedCarKeys={props.experimentInitialHydratedCarKeys}
        saleStatusSummaryAllCars={props.saleStatusSummaryAllCars}
        summarySnapshotAllCars={props.summarySnapshotAllCars}
        disableDemoFallback={!demo}
        deferCarsHydration={!isFullLoad}
        dataWarnings={demo ? [] : props.dataWarnings}
        initialFocusedOrderId={props.initialFocusedOrderId}
        shareBaseUrl={props.shareBaseUrl}
        initialSaleStatusFilters={initialSaleStatusFilters}
        initialUiLang="th"
        taskFirstLiff
        taskFirstScope={scope}
      />
    </LiffOrdersShell>
  );
}
