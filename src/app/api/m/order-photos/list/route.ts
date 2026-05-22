import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TABLE = "order_tracking_photos";
const BUCKET = "order-tracking-photos";

type PhotoRow = {
  id: string;
  target_type: "car" | "item";
  order_item_id: string | null;
  car_row_id: string | null;
  car_id: number | null;
  storage_path: string;
  created_at: string | null;
};

function isMissingTableError(message: string): boolean {
  return (
    message.includes("order_tracking_photos") && message.includes("schema cache")
  ) || message.includes("does not exist") || message.includes("42P01");
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const carRowId = String(searchParams.get("car_row_id") ?? "").trim() || null;
    const carIdRaw = String(searchParams.get("car_id") ?? "").trim();
    const carId = carIdRaw && Number.isFinite(Number(carIdRaw)) ? Number(carIdRaw) : null;
    if (!carRowId && carId == null) {
      return NextResponse.json({ error: "car_row_id or car_id required" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();
    let query = supabase
      .from(TABLE)
      .select("id,target_type,order_item_id,car_row_id,car_id,storage_path,created_at")
      .order("created_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (carRowId) query = query.eq("car_row_id", carRowId);
    else if (carId != null) query = query.eq("car_id", carId);
    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          { carPhotos: [], itemPhotosByItemId: {}, error: "Photos table missing. Apply supabase/order-tracking-photos.sql" },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }

    const rows = (data ?? []) as PhotoRow[];
    const carPhotos: Array<{ id: string; url: string; created_at: string | null }> = [];
    const itemPhotosByItemId: Record<string, Array<{ id: string; url: string; created_at: string | null }>> = {};
    for (const row of rows) {
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(row.storage_path).data.publicUrl;
      const photo = { id: row.id, url: publicUrl, created_at: row.created_at };
      if (row.target_type === "car") {
        carPhotos.push(photo);
      } else if (row.order_item_id) {
        if (!itemPhotosByItemId[row.order_item_id]) itemPhotosByItemId[row.order_item_id] = [];
        itemPhotosByItemId[row.order_item_id].push(photo);
      }
    }
    return NextResponse.json({ carPhotos, itemPhotosByItemId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg, carPhotos: [], itemPhotosByItemId: {} }, { status: 500 });
  }
}
