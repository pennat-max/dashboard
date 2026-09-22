import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TABLE = "order_tracking_photos";
const BUCKET = "order-tracking-photos";

function isMissingTableError(message: string): boolean {
  return (
    message.includes("order_tracking_photos") && message.includes("schema cache")
  ) || message.includes("does not exist") || message.includes("42P01");
}

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  try {
    const body = (await request.json()) as { photo_id?: string };
    const photoId = String(body.photo_id ?? "").trim();
    if (!photoId) return NextResponse.json({ error: "photo_id required" }, { status: 400 });
    const supabase = createServiceRoleClient();
    const current = await supabase.from(TABLE).select("id,storage_path").eq("id", photoId).maybeSingle();
    if (current.error) throw new Error(current.error.message);
    if (!current.data?.id) return NextResponse.json({ ok: true });

    const removeStorage = await supabase.storage.from(BUCKET).remove([String(current.data.storage_path ?? "")]);
    if (removeStorage.error) throw new Error(removeStorage.error.message);
    const del = await supabase.from(TABLE).delete().eq("id", photoId);
    if (del.error) throw new Error(del.error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json({ error: "Photos table missing. Apply supabase/order-tracking-photos.sql" }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
