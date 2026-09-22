import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

const TABLE = "order_tracking_photos";
const BUCKET = "order-tracking-photos";
const MAX_BYTES = 15 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 25_000;
const MAX_URLS = 6;

function isMissingTableError(message: string): boolean {
  return (
    (message.includes("order_tracking_photos") && message.includes("schema cache")) ||
    message.includes("does not exist") ||
    message.includes("42P01")
  );
}

function isBucketNotFoundError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("bucket not found") || (m.includes("bucket") && m.includes("not found"));
}

function isAlreadyExistsError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already exists") || m.includes("duplicate key");
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80) || "x";
}

/** กัน SSRF — เฉพาะ https โฮสต์สาธารณะที่ดูสมเหตุสมผล */
function urlIsSafePublicHttps(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    if (u.username || u.password) return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return false;
    if (host === "metadata.google.internal" || host.endsWith(".internal")) return false;

    const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const m = host.match(ipv4);
    if (m) {
      const a = Number(m[1]);
      const b = Number(m[2]);
      const c = Number(m[3]);
      const d = Number(m[4]);
      if ([a, b, c, d].some((x) => x > 255)) return false;
      if (a === 10) return false;
      if (a === 127) return false;
      if (a === 0) return false;
      if (a === 169 && b === 254) return false;
      if (a === 172 && b >= 16 && b <= 31) return false;
      if (a === 192 && b === 168) return false;
      if (a === 100 && b >= 64 && b <= 127) return false;
    }
    if (host.startsWith("[") && host.includes("::1")) return false;
    return true;
  } catch {
    return false;
  }
}

function extFromContentTypeAndUrl(contentType: string, href: string): string {
  const mime = String(contentType ?? "").toLowerCase().split(";")[0].trim();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  try {
    const path = new URL(href).pathname.toLowerCase();
    const ext = (path.split(".").pop() ?? "").slice(0, 5);
    if (ext && /^[a-z0-9]{2,5}$/.test(ext)) return ext;
  } catch {
    /* ignore */
  }
  return "jpg";
}

type Body = {
  target_type?: string;
  car_row_id?: string | null;
  car_id?: number | null;
  order_item_id?: string | null;
  urls?: unknown;
};

export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const targetType = String(body.target_type ?? "").trim();
  if (targetType !== "car" && targetType !== "item") {
    return NextResponse.json({ error: "target_type must be car or item" }, { status: 400 });
  }
  const carRowId = String(body.car_row_id ?? "").trim() || null;
  const carIdRaw = String(body.car_id ?? "").trim();
  const carId = carIdRaw && Number.isFinite(Number(carIdRaw)) ? Number(carIdRaw) : null;
  const orderItemId = String(body.order_item_id ?? "").trim() || null;
  if (!carRowId && carId == null) {
    return NextResponse.json({ error: "car_row_id or car_id required" }, { status: 400 });
  }
  if (targetType === "item" && !orderItemId) {
    return NextResponse.json({ error: "order_item_id required for item photos" }, { status: 400 });
  }

  const rawUrls = Array.isArray(body.urls) ? body.urls.map((x) => String(x ?? "").trim()).filter(Boolean) : [];
  const unique = Array.from(new Set(rawUrls)).slice(0, MAX_URLS);
  const safe = unique.filter(urlIsSafePublicHttps);
  if (!safe.length) {
    return NextResponse.json({ error: "No valid https image URLs" }, { status: 400 });
  }

  try {
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
    const base =
      targetType === "car" ? `car/${sanitizeSegment(carRowId ?? String(carId))}` : `item/${sanitizeSegment(orderItemId ?? "")}`;

    for (const src of safe) {
      const res = await fetch(src, {
        redirect: "follow",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          "User-Agent": "used-car-export-dashboard/1.0 (order-photos fetch-url)",
          Accept: "image/*,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${src.slice(0, 80)}`);

      let finalHref = src;
      try {
        finalHref = new URL(res.url).href;
      } catch {
        /* keep src */
      }
      if (!urlIsSafePublicHttps(finalHref)) {
        throw new Error("Redirect blocked: URL not allowed");
      }

      const ctRaw = String(res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!ctRaw.startsWith("image/")) {
        throw new Error(`Not an image (${ctRaw || "no content-type"})`);
      }
      const cl = res.headers.get("content-length");
      if (cl && Number(cl) > MAX_BYTES) throw new Error("Image too large");
      const buf = await res.arrayBuffer();
      if (buf.byteLength > MAX_BYTES) throw new Error("Image too large");
      const bytes = new Uint8Array(buf);
      const ext = extFromContentTypeAndUrl(ctRaw, finalHref);
      const path = `${base}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;

      const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
        contentType: ctRaw || "image/jpeg",
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
          mime_type: ctRaw || null,
          size_bytes: bytes.byteLength,
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
