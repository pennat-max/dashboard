import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { translateCarSummaryBlocksToEnglish } from "@/lib/orders/item-name-translation";

type Body = {
  cost_detail?: string | null;
  repair_detail?: string | null;
  document_detail?: string | null;
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

  try {
    const out = await translateCarSummaryBlocksToEnglish({
      cost_detail: String(body.cost_detail ?? ""),
      repair_detail: String(body.repair_detail ?? ""),
      document_detail: String(body.document_detail ?? ""),
    });
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
