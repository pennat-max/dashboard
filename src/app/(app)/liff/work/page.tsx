import { LiffOrdersShell } from "@/components/liff/liff-orders-shell";
import { LineWorkSinglePage } from "@/components/line-work/line-work-single-page";

export const dynamic = "force-dynamic";

export default function LiffWorkPage() {
  return (
    <LiffOrdersShell>
      <LineWorkSinglePage />
    </LiffOrdersShell>
  );
}
