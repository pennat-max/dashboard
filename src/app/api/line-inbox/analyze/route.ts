import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import type { LineInboxAnalyzeResponse } from "@/lib/line-inbox/types";
import { formatZodIssues, lineInboxAnalyzeBodySchema } from "@/lib/line-inbox/api-schemas";
import { runLineInboxAnalyzeCore } from "@/lib/line-inbox/run-analyze-core";

export const dynamic = "force-dynamic";

/**
 * POST /api/line-inbox/analyze
 * Read-only suggestions — **never** writes order_items.
 */
export async function POST(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = lineInboxAnalyzeBodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
  }

  const {
    raw_text,
    car_row_id: car_row_id_opt,
    car_id: car_id_in,
    attachments,
    line_inbox_message_id: msgIdOpt,
  } = parsed.data;

  const car_row_id_in = car_row_id_opt?.trim() ?? "";

  try {
    const supabase = createServiceRoleClient();

    const core = await runLineInboxAnalyzeCore(supabase, {
      raw_text,
      car_row_id: car_row_id_in || null,
      car_id: car_id_in ?? null,
      attachmentsCount: attachments.length,
    });

    const payload: LineInboxAnalyzeResponse & {
      line_inbox_message_id?: string;
      attachments_meta_count?: number;
    } = {
      ...core,
      line_inbox_message_id: msgIdOpt?.trim() ? msgIdOpt.trim() : undefined,
    };

    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
