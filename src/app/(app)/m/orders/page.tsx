import { MobileOrderTrackingHome } from "@/components/orders/mobile-v2/mobile-order-tracking-home";
import { loadOrderTrackingPageData } from "@/lib/order-tracking/load-order-tracking-page";

export const dynamic = "force-dynamic";

type InitialSaleStatusFilter = "จอง" | "รอส่ง" | "ส่งแล้ว" | "ว่าง";

type PageProps = {
  searchParams: {
    order?: string | string[];
    load?: string | string[];
    scope?: string | string[];
    saleStatus?: string | string[];
  };
};

export default async function MobileOrdersPage({ searchParams }: PageProps) {
  const loadRaw = searchParams?.load;
  const loadMode = typeof loadRaw === "string" ? loadRaw : Array.isArray(loadRaw) ? String(loadRaw[0] ?? "") : "";
  const isFullLoad = loadMode.trim().toLowerCase() === "full";
  const scopeRaw = searchParams?.scope;
  const scopeMode = typeof scopeRaw === "string" ? scopeRaw : Array.isArray(scopeRaw) ? String(scopeRaw[0] ?? "") : "";
  const isAllScope = scopeMode.trim().toLowerCase() === "all";
  const saleStatusRaw = searchParams?.saleStatus;
  const initialSaleStatus =
    typeof saleStatusRaw === "string" ? saleStatusRaw : Array.isArray(saleStatusRaw) ? String(saleStatusRaw[0] ?? "") : "";
  const initialSaleStatusFilters: InitialSaleStatusFilter[] | undefined =
    initialSaleStatus === "ส่งแล้ว" ? ["ส่งแล้ว"] : isAllScope ? undefined : ["จอง", "รอส่ง", "ว่าง"];
  const props = await loadOrderTrackingPageData(searchParams ?? {}, {
    summaryOnly: !isFullLoad,
    includeShipped: isAllScope,
  });
  return (
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
      initialSaleStatusFilters={initialSaleStatusFilters}
      initialUiLang="th"
    />
  );
}
