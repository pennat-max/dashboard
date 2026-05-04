import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
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
    const { data, error } = await supabase.from(TABLE).select("names").eq("id", ROW_ID).maybeSingle();
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          {
            names: [] as string[],
            error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor.",
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }
    const names = normalizeStaffRosterNames(data?.names);
    return NextResponse.json({ names });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        {
          names: [] as string[],
          error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg, names: [] as string[] }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  let body: { names?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const names = normalizeStaffRosterNames(body.names);
  try {
    const supabase = createServiceRoleClient();
    const { error } = await supabase.from(TABLE).upsert(
      { id: ROW_ID, names },
      { onConflict: "id" }
    );
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          { error: "Staff roster table missing. Apply supabase/order-tracking-staff-roster.sql in Supabase SQL Editor." },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({ ok: true, names });
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
