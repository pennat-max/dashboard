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

function isBucketNotFoundError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("bucket not found") || m.includes("bucket") && m.includes("not found");
}

function isAlreadyExistsError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already exists") || m.includes("duplicate key");
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "x";
}

function extFromFile(file: File): string {
  const fromName = (file.name.split(".").pop() ?? "").toLowerCase();
  if (fromName && /^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  const mime = String(file.type ?? "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  try {
    const form = await request.formData();
    const targetType = String(form.get("target_type") ?? "").trim();
    if (targetType !== "car" && targetType !== "item") {
      return NextResponse.json({ error: "target_type must be car or item" }, { status: 400 });
    }
    const carRowId = String(form.get("car_row_id") ?? "").trim() || null;
    const carIdRaw = String(form.get("car_id") ?? "").trim();
    const carId = carIdRaw && Number.isFinite(Number(carIdRaw)) ? Number(carIdRaw) : null;
    const orderItemId = String(form.get("order_item_id") ?? "").trim() || null;
    if (!carRowId && carId == null) {
      return NextResponse.json({ error: "car_row_id or car_id required" }, { status: 400 });
    }
    if (targetType === "item" && !orderItemId) {
      return NextResponse.json({ error: "order_item_id required for item photos" }, { status: 400 });
    }

    const entries = form.getAll("files").filter((x): x is File => x instanceof File);
    if (!entries.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

    const supabase = createServiceRoleClient();
    const ensureBucket = await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: "15MB",
      allowedMimeTypes: ["image/*"],
    });
    if (ensureBucket.error && !isAlreadyExistsError(ensureBucket.error.message)) {
      throw new Error(ensureBucket.error.message);
    }
    const uploaded: Array<{ id: string; url: string }> = [];
    const base = targetType === "car" ? `car/${sanitizeSegment(carRowId ?? String(carId))}` : `item/${sanitizeSegment(orderItemId ?? "")}`;

    for (const file of entries) {
      if (!String(file.type ?? "").startsWith("image/")) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const ext = extFromFile(file);
      const path = `${base}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
      const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: file.type || "image/jpeg",
        upsert: false,
      });
      if (up.error) throw new Error(up.error.message);

      const insert = await supabase
        .from(TABLE)
        .insert({
          target_type: targetType,
          order_item_id: targetType === "item" ? orderItemId : null,
          car_row_id: carRowId,
          car_id: carId,
          storage_bucket: BUCKET,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: Number.isFinite(file.size) ? file.size : null,
          uploaded_by: gate.user.id,
        })
        .select("id")
        .single();
      if (insert.error) throw new Error(insert.error.message);
      const publicUrl = supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
      uploaded.push({ id: String(insert.data?.id ?? ""), url: publicUrl });
    }
    return NextResponse.json({ ok: true, uploaded });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json({ error: "Photos table missing. Apply supabase/order-tracking-photos.sql" }, { status: 503 });
    }
    if (isBucketNotFoundError(msg)) {
      return NextResponse.json(
        { error: "Bucket order-tracking-photos not found. Run supabase/order-tracking-photos.sql once." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
