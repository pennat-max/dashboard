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
  const scope = (typeof scopeRaw === "string" ? scopeRaw : Array.isArray(scopeRaw) ? String(scopeRaw[0] ?? "") : "").trim().toLowerCase();
  const props = await loadOrderTrackingPageData(searchParams ?? {}, {
    summaryOnly: !isFullLoad,
    includeShipped: scope !== "active",
    shippedOnly: scope === "shipped",
    maxCars: scope === "active" || scope === "shipped" ? 150 : undefined,
  });
  return (
    <LiffOrdersShell>
      <MobileOrderTrackingHome
        carsData={props.carsData}
        orderItemsByCar={props.orderItemsByCar}
        orderUpdatesByCar={props.orderUpdatesByCar}
        saleStatusSummaryAllCars={props.saleStatusSummaryAllCars}
        summarySnapshotAllCars={props.summarySnapshotAllCars}
        disableDemoFallback
        deferCarsHydration={!isFullLoad}
        dataWarnings={props.dataWarnings}
        initialFocusedOrderId={props.initialFocusedOrderId}
        shareBaseUrl={props.shareBaseUrl}
        initialUiLang="th"
      />
    </LiffOrdersShell>
  );
}
