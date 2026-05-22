import type { SupabaseClient } from "@supabase/supabase-js";
import { extensionFromMime } from "@/lib/line/fetch-line-message-image";

const BUCKET = "order-tracking-photos";

function isAlreadyExistsError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("already exists") || m.includes("duplicate key");
}

/** เก็บรูปจาก LINE ใน bucket เดียวกับ order photos — ไม่สร้างแถว order_tracking_photos */
export async function uploadLineInboxImageToBucket(
  supabase: SupabaseClient,
  inboxRowId: string,
  lineMessageId: string,
  bytes: Uint8Array,
  contentType: string
): Promise<string | null> {
  const ensureBucket = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "15MB",
    allowedMimeTypes: ["image/*"],
  });
  if (ensureBucket.error && !isAlreadyExistsError(ensureBucket.error.message)) {
    console.error("[line-inbox-image] bucket:", ensureBucket.error.message);
    return null;
  }
  const ext = extensionFromMime(contentType);
  const safeInbox = inboxRowId.replace(/[^a-zA-Z0-9-]/g, "_");
  const safeMid = lineMessageId.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 80);
  const path = `line-inbox/${safeInbox}/${safeMid}.${ext}`;
  const up = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: contentType || "image/jpeg",
    upsert: true,
  });
  if (up.error) {
    console.error("[line-inbox-image] upload:", up.error.message);
    return null;
  }
  return path;
}

export function publicUrlForLineInboxStoragePath(supabase: SupabaseClient, storagePath: string): string {
  return supabase.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
}
