import { NextResponse } from "next/server";
import type { Car } from "@/types/car";
import { fetchOrderItemsAndUpdatesByCars } from "@/lib/data/orders";

const MAX_CARD_DETAILS_PER_REQUEST = 50;

type CardDetailRequestCar = {
  id?: string | number | null;
  row_id?: string | null;
};

type CardDetailRequestBody = {
  cars?: CardDetailRequestCar[];
};

function isExperimentEnabled(): boolean {
  return String(process.env.NEXT_PUBLIC_ORDER_CHIP_CACHE_ENABLED ?? "").trim().toLowerCase() === "true";
}

function carKeys(car: CardDetailRequestCar): string[] {
  const keys: string[] = [];
  const rowId = String(car.row_id ?? "").trim();
  const id = String(car.id ?? "").trim();
  if (rowId) keys.push(`row:${rowId}`);
  if (id) keys.push(`id:${id}`);
  return keys;
}

export async function POST(req: Request) {
  if (!isExperimentEnabled()) {
    return NextResponse.json(
      {
        enabled: false,
        orderItemsByCar: {},
        orderUpdatesByCar: {},
        hydratedCarKeys: [],
      },
      { status: 404 }
    );
  }

  let body: CardDetailRequestBody;
  try {
    body = (await req.json()) as CardDetailRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const inputCars = Array.isArray(body.cars) ? body.cars : [];
  const cars = inputCars
    .slice(0, MAX_CARD_DETAILS_PER_REQUEST)
    .map((car, index) => {
      const rowId = String(car.row_id ?? "").trim();
      const rawId = car.id == null ? "" : String(car.id).trim();
      return {
        id: rawId || `client:${index}`,
        row_id: rowId || null,
      } as Car;
    })
    .filter((car) => String(car.row_id ?? "").trim() || String(car.id ?? "").trim());

  if (cars.length === 0) {
    return NextResponse.json({
      enabled: true,
      orderItemsByCar: {},
      orderUpdatesByCar: {},
      hydratedCarKeys: [],
      itemsError: null,
      updatesError: null,
    });
  }

  const pack = await fetchOrderItemsAndUpdatesByCars(cars);
  return NextResponse.json({
    enabled: true,
    orderItemsByCar: pack.orderItemsByCar,
    orderUpdatesByCar: pack.orderUpdatesByCar,
    hydratedCarKeys: Array.from(new Set(inputCars.slice(0, MAX_CARD_DETAILS_PER_REQUEST).flatMap(carKeys))),
    itemsError: pack.itemsError,
    updatesError: pack.updatesError,
  });
}
