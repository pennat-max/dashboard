import { redirect } from "next/navigation";

/** ลิงก์สั้นสำหรับแชร์ LINE → `/m/orders?order=…` */
export default function ShortOrderDeepLinkPage({
  searchParams,
}: {
  searchParams: { o?: string | string[]; order?: string | string[] };
}) {
  const raw = searchParams.o ?? searchParams.order;
  const id = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = String(id ?? "").trim();
  if (!trimmed) redirect("/m/orders");
  redirect(`/m/orders?order=${encodeURIComponent(trimmed)}`);
}
