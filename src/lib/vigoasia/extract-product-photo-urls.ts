/** ดึง product id จากหน้า details ของ vigoasia.com */

export function parseVigoasiaProductIdFromDetailsPageUrl(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (!/^(www\.)?vigoasia\.com$/i.test(u.hostname)) return null;
    const m = u.pathname.match(/^\/products\/(\d+)\/details\/?$/i);
    return m?.[1] ?? null;
  } catch {
    return null;
  }
}

/** ดึง URL รูปจาก HTML — เฉพาะโฟลเดอร์ของ ref นั้น (กันรูป similar cars คนละ id) */
export function extractVigoasiaProductPhotoUrlsFromHtml(html: string, productId: string): string[] {
  const re = new RegExp(
    `https://vigoasia\\.com/assets/product_photos/${productId}/[a-z0-9]+\\.(?:jpg|jpeg|png|webp)`,
    "gi"
  );
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of html.matchAll(re)) {
    const u = m[0];
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

/** URL รูปใต้ /assets/product_photos/ — ใช้กับ next/image ให้โหลดย่อที่เซิร์ฟเวอร์ */
export function isVigoasiaProductPhotoAssetUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(String(url).trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    const host = u.hostname.replace(/^www\./i, "");
    if (host !== "vigoasia.com") return false;
    return /^\/assets\/product_photos\/\d+\//i.test(u.pathname);
  } catch {
    return false;
  }
}

/** ราคาโชว์บนหน้า details (เช่น `<span class="dev-h-final-price">$ 29400</span>`) */
export function extractVigoasiaFinalPriceTextFromHtml(html: string): string | null {
  const m = html.match(
    /<span[^>]*\bclass=["'][^"']*\bdev-h-final-price\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i
  );
  if (!m?.[1]) return null;
  const inner = m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  return inner.length > 0 ? inner : null;
}

export type VigoasiaSpecificationRow = { label: string; value: string };

function vigoasiaSpecCellInnerToText(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\u00a0/g, " ")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .trim();
}

/** แถวจาก `<table class="specification">` บนหน้า details */
export function extractVigoasiaSpecificationRowsFromHtml(html: string): VigoasiaSpecificationRow[] {
  const m = html.match(/<table[^>]*\bspecification\b[^>]*>[\s\S]*?<\/table>/i);
  if (!m) return [];
  const tableHtml = m[0];
  const rows: VigoasiaSpecificationRow[] = [];
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch: RegExpExecArray | null;
  while ((trMatch = trRe.exec(tableHtml)) !== null) {
    const trInner = trMatch[1];
    const thM = trInner.match(/<th\b[^>]*>([\s\S]*?)<\/th>/i);
    const tdM = trInner.match(/<td\b[^>]*>([\s\S]*?)<\/td>/i);
    if (!thM || !tdM) continue;
    const label = vigoasiaSpecCellInnerToText(thM[1]);
    const value = vigoasiaSpecCellInnerToText(tdM[1]);
    if (!label && !value) continue;
    rows.push({ label: label.length > 0 ? label : "—", value: value.length > 0 ? value : "—" });
  }
  return rows;
}
