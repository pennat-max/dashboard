import { NextResponse } from "next/server";

import { requireMutateRole } from "@/lib/auth/mutation-guard";

import { createServiceRoleClient } from "@/lib/supabase/service-role";

import { formatZodIssues, lineInboxConfirmBodySchema } from "@/lib/line-inbox/api-schemas";

import type { PersistConfirmRow } from "@/lib/line-inbox/persist-line-inbox-confirm";

import { persistLineInboxConfirmations } from "@/lib/line-inbox/persist-line-inbox-confirm";
import { deleteLineInboxMessageById } from "@/lib/line-inbox/line-inbox-messages";



/**

 * POST /api/line-inbox/confirm

 * Creates/updates order_items only after explicit user confirmation.

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



  const parsed = lineInboxConfirmBodySchema.safeParse(raw);

  if (!parsed.success) {

    return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });

  }



  const car_row_id = parsed.data.car_row_id != null ? String(parsed.data.car_row_id).trim() : "";

  const car_id = parsed.data.car_id ?? null;

  const lineInboxMsgRef = parsed.data.line_inbox_message_id?.trim() ?? "";



  const confirmations: PersistConfirmRow[] = parsed.data.confirmations.map((r) => ({

    action: r.action,

    order_item_id: r.order_item_id != null ? String(r.order_item_id).trim() : "",

    item_name: String(r.item_name ?? "").trim(),

    item_status: r.item_status != null ? String(r.item_status).trim() : "",

    note: r.note != null ? String(r.note).trim() : "",

  }));



  const actionable = confirmations.filter((c) => c.action !== "skip");



  if (actionable.length === 0) {

    return NextResponse.json({ ok: true, order_task_id: null, saved: [], skipped_all: true });

  }



  try {

    const supabase = createServiceRoleClient();



    const { order_task_id, saved } = await persistLineInboxConfirmations(supabase, {

      car_row_id: car_row_id || "",

      car_id,

      actionable,

      line_inbox_msg_ref_for_audit: lineInboxMsgRef || undefined,

    });

    if (saved.length > 0 && lineInboxMsgRef) {
      try {
        await deleteLineInboxMessageById(supabase, lineInboxMsgRef);
      } catch (err) {
        console.error(
          "[line-inbox/confirm] delete inbox row after save:",
          err instanceof Error ? err.message : err
        );
      }
    }

    return NextResponse.json({

      ok: true,

      order_task_id,

      saved,

      line_inbox_message_id: lineInboxMsgRef || undefined,

    });

  } catch (e) {

    const msg = e instanceof Error ? e.message : String(e);

    return NextResponse.json({ error: msg }, { status: 500 });

  }

}

