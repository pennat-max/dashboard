import { NextResponse } from "next/server";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import {
  ORDER_TRACKING_ITEM_STATUSES,
  normalizeItemStatusPoliciesRaw,
  normalizedItemPoliciesToStoredJson,
  type ItemStatusPoliciesInput,
} from "@/lib/orders/item-status-policies";

const TABLE = "order_tracking_item_status_prefs";
const ROW_ID = "default";
const ALLOWED_ITEM_STATUSES = ORDER_TRACKING_ITEM_STATUSES;

type ItemStatusValue = (typeof ALLOWED_ITEM_STATUSES)[number];
type ItemStatusLabelMap = Partial<Record<ItemStatusValue, string>>;

function isMissingTableError(message: string): boolean {
  return (
    (message.includes("order_tracking_item_status_prefs") && message.includes("schema cache")) ||
    message.includes("does not exist") ||
    message.includes("42P01") ||
    (message.includes("column") && message.includes("does not exist") && message.includes("policies"))
  );
}

function normalizeRoster(raw: unknown): ItemStatusValue[] {
  const input = Array.isArray(raw) ? raw : [];
  const seen = new Set<ItemStatusValue>();
  const picked: ItemStatusValue[] = [];
  for (const row of input) {
    const s = String(row ?? "").trim();
    if (!ALLOWED_ITEM_STATUSES.includes(s as ItemStatusValue)) continue;
    const st = s as ItemStatusValue;
    if (seen.has(st)) continue;
    seen.add(st);
    picked.push(st);
  }
  const ordered = ALLOWED_ITEM_STATUSES.filter((st) => seen.has(st));
  const extras = picked.filter((st) => !ordered.includes(st));
  return (ordered.length ? [...ordered, ...extras] : [...ALLOWED_ITEM_STATUSES]) as ItemStatusValue[];
}

function normalizeLabels(raw: unknown): ItemStatusLabelMap {
  if (!raw || typeof raw !== "object") return {};
  const map = raw as Record<string, unknown>;
  const out: ItemStatusLabelMap = {};
  for (const st of ALLOWED_ITEM_STATUSES) {
    const value = map[st];
    if (value == null) continue;
    const label = String(value).trim();
    if (!label || label === st) continue;
    out[st] = label;
  }
  return out;
}

/** บันทึกเฉพาะส่วนที่ต่างจาก default เพื่อ JSON เล็ก */
function sanitizePoliciesPersist(rawPolicies: unknown): ItemStatusPoliciesInput {
  const norm = normalizeItemStatusPoliciesRaw(rawPolicies);
  return normalizedItemPoliciesToStoredJson(norm);
}

export async function GET() {
  try {
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.from(TABLE).select("roster,labels,policies").eq("id", ROW_ID).maybeSingle();
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          {
            roster: [...ALLOWED_ITEM_STATUSES],
            labels: {} as ItemStatusLabelMap,
            policies: {} satisfies ItemStatusPoliciesInput,
            error: "Item-status prefs missing or outdated. Apply supabase migrations / order-tracking-item-status-prefs.sql.",
          },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }
    const roster = normalizeRoster(data?.roster);
    const labels = normalizeLabels(data?.labels);
    const policiesStored = sanitizePoliciesPersist(data?.policies);
    return NextResponse.json({ roster, labels, policies: policiesStored });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        {
          roster: [...ALLOWED_ITEM_STATUSES],
          labels: {} as ItemStatusLabelMap,
          policies: {} satisfies ItemStatusPoliciesInput,
          error: "Item-status prefs missing or outdated. Apply supabase migrations / order-tracking-item-status-prefs.sql.",
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: msg, roster: [...ALLOWED_ITEM_STATUSES], labels: {} as ItemStatusLabelMap, policies: {} },
      { status: 500 }
    );
  }
}

export async function PUT(request: Request) {
  const gate = await requireMutateRole();
  if (!gate.ok) return gate.response;

  let body: { roster?: unknown; labels?: unknown; policies?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const roster = normalizeRoster(body.roster);
  const labels = normalizeLabels(body.labels);
  const policiesStored = body.policies === undefined ? undefined : sanitizePoliciesPersist(body.policies);
  try {
    const supabase = createServiceRoleClient();
    const row: Record<string, unknown> = { id: ROW_ID, roster, labels };
    if (policiesStored !== undefined) row.policies = policiesStored;
    const { error } = await supabase.from(TABLE).upsert(row, { onConflict: "id" });
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          { error: "Item-status prefs missing or outdated. Apply supabase migrations / order-tracking-item-status-prefs.sql." },
          { status: 503 }
        );
      }
      throw new Error(error.message);
    }
    return NextResponse.json({
      ok: true,
      roster,
      labels,
      ...(policiesStored !== undefined ? { policies: policiesStored } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isMissingTableError(msg)) {
      return NextResponse.json(
        { error: "Item-status prefs missing or outdated. Apply supabase migrations / order-tracking-item-status-prefs.sql." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
