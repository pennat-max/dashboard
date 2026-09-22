import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { normalizeSaleAssigneesMap } from "@/lib/orders/sale-assignees-shared";
import { normalizeStaffRosterNames } from "@/lib/orders/staff-roster-shared";

const TABLE = "order_tracking_staff_roster";
const ROW_ID = "default";

function isMissingTableError(message: string): boolean {
  return (
    message.includes("order_tracking_staff_roster") && message.includes("schema cache")
  ) || message.includes("does not exist") || message.includes("42P01");
}

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const full = await supabase.from(TABLE).select("names,sale_assignees").eq("id", ROW_ID).maybeSingle();
    if (full.error && /sale_assignees|column/i.test(full.error.message)) {
      const legacy = await supabase.from(TABLE).select("names").eq("id", ROW_ID).maybeSingle();
      if (legacy.error) {
        if (isMissingTableError(legacy.error.message)) {
          return NextResponse.json(
            {
              names: [] as string[],
              sale_assignees: {},
              error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor.",
            },
            { status: 503 }
          );
        }
        throw new Error(legacy.error.message);
      }
      const names = normalizeStaffRosterNames(legacy.data?.names);
      return NextResponse.json({ names, sale_assignees: normalizeSaleAssigneesMap({}) });
    }
    if (full.error) {
      if (isMissingTableError(full.error.message)) {
        return NextResponse.json(
          {
            names: [] as string[],
            sale_assignees: {},
            error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor.",
          },
          { status: 503 }
        );
      }
      throw new Error(full.error.message);
    }
    const names = normalizeStaffRosterNames(full.data?.names);
    const sale_assignees = normalizeSaleAssigneesMap(full.data?.sale_assignees);
    return NextResponse.json({ names, sale_assignees });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        {
          names: [] as string[],
          sale_assignees: {},
          error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg, names: [] as string[], sale_assignees: {} }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: { names?: unknown; sale_assignees?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const names = normalizeStaffRosterNames(body.names);
  const sale_assignees = normalizeSaleAssigneesMap(body.sale_assignees);
  try {
    const supabase = createServiceRoleClient();
    let error = (
      await supabase.from(TABLE).upsert({ id: ROW_ID, names, sale_assignees }, { onConflict: "id" })
    ).error;
    if (error && /sale_assignees|column/i.test(error.message)) {
      error = (await supabase.from(TABLE).upsert({ id: ROW_ID, names }, { onConflict: "id" })).error;
    }
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          { error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor." },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, names, sale_assignees });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        { error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
