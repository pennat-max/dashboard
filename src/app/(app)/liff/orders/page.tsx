import { LiffOrdersShell } from "@/components/liff/liff-orders-shell";
import { MobileOrderTrackingHome } from "@/components/orders/mobile-v2/mobile-order-tracking-home";
import { loadOrderTrackingPageData } from "@/lib/order-tracking/load-order-tracking-page";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: { order?: string | string[]; load?: string | string[] };
};

export default async function LiffOrdersPage({ searchParams }: PageProps) {
  const loadRaw = searchParams?.load;
  const loadMode = typeof loadRaw === "string" ? loadRaw : Array.isArray(loadRaw) ? String(loadRaw[0] ?? "") : "";
  const isFullLoad = loadMode.trim().toLowerCase() === "full";
  const props = await loadOrderTrackingPageData(searchParams ?? {}, { summaryOnly: !isFullLoad });
  return (
    <LiffOrdersShell>
      <MobileOrderTrackingHome
        carsData={props.carsData}
        initialDetailCarsData={props.initialDetailCarsData}
        orderItemsByCar={props.orderItemsByCar}
        orderUpdatesByCar={props.orderUpdatesByCar}
        progressiveDetailsEnabled={props.progressiveDetailsEnabled}
        progressiveDetailBatchSize={props.progressiveDetailBatchSize}
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
