import { NextResponse } from "next/server";
import {
  extractVigoasiaFinalPriceTextFromHtml,
  extractVigoasiaSpecificationRowsFromHtml,
  extractVigoasiaProductPhotoUrlsFromHtml,
  parseVigoasiaProductIdFromDetailsPageUrl,
} from "@/lib/vigoasia/extract-product-photo-urls";

/** แคชตาม URL — ลดโหลด vigoasia ซ้ำเมื่อกริด marketplace ยิงหลาย tile */
export const revalidate = 300;

/**
 * GET ?url=https://vigoasia.com/products/1692/details
 * โหลด HTML แล้วคืนรายการ URL รูปใน /assets/product_photos/{id}/, ราคา span.dev-h-final-price (ถ้ามี),
 * และแถวจาก table.specification (ถ้ามี)
 * — ไม่บันทึกลง database (ไม่มี Supabase read/write)
 * — ไม่ตรวจสิทธิ์ผู้ใช้: ใช้ร่วมกับ Order Tracking สาธารณะ (/m, /liff) และทุก role ที่โหลดหน้าได้
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const raw = searchParams.get("url")?.trim();
  if (!raw) return NextResponse.json({ error: "missing url" }, { status: 400 });

  let detailsUrl: URL;
  try {
    detailsUrl = new URL(raw);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (detailsUrl.protocol !== "http:" && detailsUrl.protocol !== "https:") {
    return NextResponse.json({ error: "only http(s) supported" }, { status: 400 });
  }

  const productId = parseVigoasiaProductIdFromDetailsPageUrl(raw);
  if (!productId) {
    return NextResponse.json({ error: "not a vigoasia product details URL" }, { status: 400 });
  }

  const upstream = await fetch(raw, {
    headers: {
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "User-Agent":
        "Mozilla/5.0 (compatible; UsedCarExportDashboard/1.0; +https://vigo4u-os.com) AppleWebKit/537.36",
    },
    redirect: "follow",
    next: { revalidate: 300 },
  });

  if (!upstream.ok) {
    return NextResponse.json({ error: `upstream ${upstream.status}` }, { status: 502 });
  }

  const html = await upstream.text();
  const urls = extractVigoasiaProductPhotoUrlsFromHtml(html, productId);
  const finalPriceText = extractVigoasiaFinalPriceTextFromHtml(html);
  const specification = extractVigoasiaSpecificationRowsFromHtml(html);
  return NextResponse.json(
    { urls, finalPriceText, specification },
    {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    }
  );
}
