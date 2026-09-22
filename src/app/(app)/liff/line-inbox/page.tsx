import { LiffOrdersShell } from "@/components/liff/liff-orders-shell";
import { LineInboxClient } from "@/components/liff/line-inbox-client";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: { car_row_id?: string | string[]; car_id?: string | string[] };
};

export default async function LiffLineInboxPage({ searchParams }: PageProps) {
  const cr = searchParams?.car_row_id;
  const cid = searchParams?.car_id;
  const carRowId = typeof cr === "string" ? cr : Array.isArray(cr) ? String(cr[0] ?? "") : "";
  const carIdRaw = typeof cid === "string" ? cid : Array.isArray(cid) ? String(cid[0] ?? "") : "";
  const carIdNum =
    carIdRaw.trim() && Number.isFinite(Number(carIdRaw)) ? Number(carIdRaw) : null;

  return (
    <LiffOrdersShell>
      <LineInboxClient initialCarRowId={carRowId} initialCarId={carIdNum} />
    </LiffOrdersShell>
  );
}
