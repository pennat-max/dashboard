import { NextResponse } from "next/server";
import { fetchCarsForOrderTrackingDetailsByKeys } from "@/lib/data/cars";
import { fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";
import { ORDER_TRACKING_DETAIL_BATCH_SIZE } from "@/lib/order-tracking/load-order-tracking-page";

type RequestCarKey = {
  rowId?: string | null;
  id?: string | number | null;
};

function normalizeRequestCars(value: unknown): RequestCarKey[] {
  if (!Array.isArray(value)) return [];
  const out: RequestCarKey[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const rowId = String(row.rowId ?? row.row_id ?? "").trim();
    const idRaw = row.id ?? row.carId ?? row.car_id ?? null;
    const id = idRaw == null ? "" : String(idRaw).trim();
    if (!rowId && !id) continue;
    out.push({ rowId: rowId || null, id: id || null });
    if (out.length >= ORDER_TRACKING_DETAIL_BATCH_SIZE) break;
  }
  return out;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as { cars?: unknown };
    const requestedCars = normalizeRequestCars(body.cars);
    if (requestedCars.length === 0) {
      return NextResponse.json({
        carsData: [],
        orderItemsByCar: {},
        orderUpdatesByCar: {},
        dataWarnings: [],
      });
    }

    const detailPack = await fetchCarsForOrderTrackingDetailsByKeys(requestedCars);
    const cars = detailPack.cars;
    const itemsPack = await fetchOrderItemsAndUpdatesByCars(cars);
    const dataWarnings = [detailPack.error, itemsPack.itemsError, itemsPack.updatesError].filter(
      (v): v is string => typeof v === "string" && v.length > 0
    );

    return NextResponse.json({
      carsData: cars,
      orderItemsByCar: itemsPack.orderItemsByCar,
      orderUpdatesByCar: itemsPack.orderUpdatesByCar,
      dataWarnings,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        carsData: [],
        orderItemsByCar: {},
        orderUpdatesByCar: {},
        dataWarnings: [message],
      },
      { status: 500 }
    );
  }
}
