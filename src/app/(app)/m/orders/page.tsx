import { MobileOrderTrackingHome } from "@/components/orders/mobile-v2/mobile-order-tracking-home";
import { fetchCarsForOrderTracking } from "@/lib/data/cars";
import { fetchOrderItemsByCars, fetchOrderUpdatesByCars } from "@/lib/data/orders";

export const dynamic = "force-dynamic";

export default async function MobileOrdersPage() {
  const { cars, error: carsError } = await fetchCarsForOrderTracking();
  const { byCarKey, error: itemsError } = await fetchOrderItemsByCars(cars);
  const { byCarKey: updatesByCarKey, error: updatesError } = await fetchOrderUpdatesByCars(cars);
  const dataWarnings = [carsError, itemsError, updatesError].filter(
    (v): v is string => typeof v === "string" && v.length > 0
  );
  return (
    <MobileOrderTrackingHome
      carsData={cars}
      orderItemsByCar={byCarKey}
      orderUpdatesByCar={updatesByCarKey}
      dataWarnings={dataWarnings}
    />
  );
}
