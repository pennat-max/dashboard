import { NextResponse } from "next/server";
import { getD1 } from "../../../../../../db";

export const dynamic = "force-dynamic";

type IncomingRow = Record<string, unknown>;
type ExistingCarRow = Record<string, unknown> & { row_id: string };

const TEXT_COLUMNS = [
  "spec",
  "status",
  "picture",
  "advance_date",
  "income_date",
  "plate_number",
  "province",
  "brand",
  "drive_type",
  "engine_size",
  "grade",
  "gear_type",
  "cabin",
  "color",
  "manufacture",
  "registration",
  "engine_number",
  "chassis_number",
  "mileage",
  "agent",
  "inspector",
  "driver_location",
  "initial_document",
  "document_status",
  "doc_fee",
  "repair_cost",
  "repair_details",
  "advance",
  "buy_price",
  "total_cost",
  "part_accessories",
  "web_price_usd",
  "bf_on_web",
  "requested_modifications",
  "free",
  "booked_date",
  "sale_price_usd",
  "buyer",
  "sale_support",
  "remarks",
  "booked_shipping",
  "destination_port",
  "other",
  "shipped",
  "country",
  "month",
  "c_year",
  "model",
  "model_year",
] as const;

const WRITABLE_COLUMNS = ["row_id", ...TEXT_COLUMNS, "updated_at", "raw_data"] as const;

const SHEET_HEADER_ALIASES: Array<[readonly string[], (typeof TEXT_COLUMNS)[number]]> = [
  [["Spec"], "spec"],
  [["Status"], "status"],
  [["Picture"], "picture"],
  [["Advance Date"], "advance_date"],
  [["Income Date"], "income_date"],
  [["Plate Number"], "plate_number"],
  [["Province"], "province"],
  [["Brand", "Bland"], "brand"],
  [["Drive Type"], "drive_type"],
  [["Engine Size"], "engine_size"],
  [["Grade"], "grade"],
  [["Gear Type"], "gear_type"],
  [["Cabin"], "cabin"],
  [["Color"], "color"],
  [["Manufacture"], "manufacture"],
  [["Registration"], "registration"],
  [["Engine Number"], "engine_number"],
  [["Chassis Number", "ChassisNumber", "Chassis"], "chassis_number"],
  [["Mileage"], "mileage"],
  [["Agent"], "agent"],
  [["Inspector"], "inspector"],
  [["Driver Location"], "driver_location"],
  [["Initial Document"], "initial_document"],
  [["Document Status", "Doc Status"], "document_status"],
  [["Doc Fee"], "doc_fee"],
  [["Repair Cost"], "repair_cost"],
  [["Repair Details"], "repair_details"],
  [["Advance"], "advance"],
  [["Buy Price"], "buy_price"],
  [["Total Cost"], "total_cost"],
  [["Part&Accessories"], "part_accessories"],
  [["Web Price($)"], "web_price_usd"],
  [["BF On web", "Be_Status", "BE Status", "Be Status"], "bf_on_web"],
  [["Requested Modifications"], "requested_modifications"],
  [["Free"], "free"],
  [["Booked Date"], "booked_date"],
  [["Sale Price $"], "sale_price_usd"],
  [["Buyer"], "buyer"],
  [["Sale Support", "SaleSupport", "Sale SuppAORt", "Sale Support "], "sale_support"],
  [["Remarks"], "remarks"],
  [["Booked Shipping", "Booking", "Booking "], "booked_shipping"],
  [["Destination Port", "Port"], "destination_port"],
  [["Other", "Other ", "Comments", "Comments "], "other"],
  [["Shipped"], "shipped"],
  [["Country", "Country "], "country"],
  [["Month"], "month"],
  [["C_Year"], "c_year"],
  [["Model"], "model"],
  [["Model Year"], "model_year"],
];

function readBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return "";
  return rest.join(" ").trim();
}

function safeTokenEquals(input: string, expected: string): boolean {
  if (input.length !== expected.length) return false;
  let mismatch = 0;
  for (let index = 0; index < input.length; index += 1) {
    mismatch |= input.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return mismatch === 0;
}

function acceptedSecrets(): string[] {
  const secrets = [
    process.env.SHEET_SYNC_SECRET?.trim() ?? "",
    process.env.LINE_INBOX_CRON_SECRET?.trim() ?? "",
  ].filter(Boolean);
  return Array.from(new Set(secrets));
}

function authorize(request: Request) {
  const secrets = acceptedSecrets();
  if (!secrets.length) {
    return NextResponse.json({ error: "Sheet sync secret is not configured" }, { status: 503 });
  }

  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ error: "Unauthorized: bearer token required" }, { status: 401 });
  }

  if (!secrets.some((secret) => safeTokenEquals(token, secret))) {
    return NextResponse.json({ error: "Forbidden: invalid bearer token" }, { status: 403 });
  }

  return null;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value.toISOString();
  const text = String(value).trim();
  return text === "" ? null : text;
}

function rawValue(value: unknown): unknown {
  if (value === undefined || value === "") return null;
  return value;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value ?? null;
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function pickAlias(row: IncomingRow, aliases: readonly string[]): unknown {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(row, alias)) return row[alias];
  }
  return undefined;
}

function normalizeIncomingRow(row: IncomingRow, now: string) {
  const rowId = asText(row.row_id ?? row.rowId ?? row["row_id"]);
  const rawInput = row.raw_data && typeof row.raw_data === "object"
    ? row.raw_data
    : SHEET_HEADER_ALIASES.reduce<Record<string, unknown>>((acc, [aliases]) => {
        const value = pickAlias(row, aliases);
        if (value !== undefined) acc[aliases[0]] = rawValue(value);
        return acc;
      }, {});

  const payload: Record<string, unknown> = {
    row_id: rowId,
    updated_at: asText(row.updated_at) ?? now,
    raw_data: rawInput,
  };

  for (const column of TEXT_COLUMNS) {
    if (Object.prototype.hasOwnProperty.call(row, column)) {
      payload[column] = asText(row[column]);
    }
  }

  for (const [aliases, column] of SHEET_HEADER_ALIASES) {
    if (!Object.prototype.hasOwnProperty.call(payload, column)) {
      payload[column] = asText(pickAlias(row, aliases));
    }
  }

  return payload;
}

function payloadChanged(existing: ExistingCarRow | undefined, incoming: Record<string, unknown>): boolean {
  if (!existing) return true;
  for (const column of TEXT_COLUMNS) {
    if ((existing[column] ?? null) !== (incoming[column] ?? null)) return true;
  }
  return stableJson(existing.raw_data) !== stableJson(incoming.raw_data);
}

async function fetchExistingByRowId(rowIds: string[]) {
  const db = getD1();
  const existing = new Map<string, ExistingCarRow>();
  for (let index = 0; index < rowIds.length; index += 80) {
    const chunk = rowIds.slice(index, index + 80);
    if (!chunk.length) continue;
    const placeholders = chunk.map(() => "?").join(",");
    const result = await db
      .prepare(`SELECT ${WRITABLE_COLUMNS.map((column) => `"${column}"`).join(",")} FROM cars WHERE row_id IN (${placeholders})`)
      .bind(...chunk)
      .all<ExistingCarRow>();
    for (const row of result.results ?? []) {
      existing.set(row.row_id, {
        ...row,
        raw_data: typeof row.raw_data === "string" ? JSON.parse(row.raw_data) : row.raw_data,
      });
    }
  }
  return existing;
}

async function upsertRows(rows: Record<string, unknown>[]) {
  const db = getD1();
  const nonKeyColumns = WRITABLE_COLUMNS.filter((column) => column !== "row_id");
  const sql = `
    INSERT INTO cars (${WRITABLE_COLUMNS.map((column) => `"${column}"`).join(",")})
    VALUES (${WRITABLE_COLUMNS.map(() => "?").join(",")})
    ON CONFLICT(row_id) DO UPDATE SET
      ${nonKeyColumns.map((column) => `"${column}" = excluded."${column}"`).join(", ")}
  `;

  for (const row of rows) {
    await db
      .prepare(sql)
      .bind(
        ...WRITABLE_COLUMNS.map((column) => {
          const value = row[column];
          return column === "raw_data" ? stableJson(value ?? {}) : value ?? null;
        })
      )
      .run();
  }
}

async function writeAudit(value: unknown) {
  await getD1()
    .prepare(`
      INSERT INTO migration_state (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `)
    .bind("sheet_sync:cars:last_apply", stableJson(value))
    .run();
}

export async function POST(request: Request) {
  const authResponse = authorize(request);
  if (authResponse) return authResponse;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const incomingRows = (Array.isArray(body.rows) ? body.rows : body.cars) as unknown;
  if (!Array.isArray(incomingRows)) {
    return NextResponse.json({ error: "Expected rows array" }, { status: 400 });
  }

  const mode = String(body.mode ?? (body.dry_run === false ? "apply" : "dry_run")).toLowerCase();
  const applyRequested = mode === "apply";
  const writeEnabled = process.env.SHEET_SYNC_WRITE_ENABLED?.trim().toLowerCase() === "true";
  if (applyRequested && (!writeEnabled || body.confirm !== "APPLY_SHEET_TO_D1")) {
    return NextResponse.json(
      {
        error: "Apply mode is disabled",
        dry_run: true,
        required: {
          env: "SHEET_SYNC_WRITE_ENABLED=true",
          confirm: "APPLY_SHEET_TO_D1",
        },
      },
      { status: 409 }
    );
  }

  const normalized = incomingRows.map((row) => normalizeIncomingRow((row ?? {}) as IncomingRow, now));
  const seen = new Set<string>();
  const valid: Record<string, unknown>[] = [];
  const invalid: Array<{ index: number; reason: string }> = [];

  normalized.forEach((row, index) => {
    const rowId = asText(row.row_id);
    if (!rowId) {
      invalid.push({ index, reason: "missing row_id" });
      return;
    }
    if (seen.has(rowId)) {
      invalid.push({ index, reason: "duplicate row_id in request" });
      return;
    }
    seen.add(rowId);
    valid.push({ ...row, row_id: rowId });
  });

  const existing = await fetchExistingByRowId(valid.map((row) => String(row.row_id)));
  const inserts: string[] = [];
  const updates: string[] = [];
  const unchanged: string[] = [];
  const changedRows: Record<string, unknown>[] = [];

  for (const row of valid) {
    const rowId = String(row.row_id);
    const current = existing.get(rowId);
    if (!current) {
      inserts.push(rowId);
      changedRows.push(row);
    } else if (payloadChanged(current, row)) {
      updates.push(rowId);
      changedRows.push(row);
    } else {
      unchanged.push(rowId);
    }
  }

  if (applyRequested && changedRows.length) {
    await upsertRows(changedRows);
    await writeAudit({
      source: body.source ?? "google_sheet",
      applied_at: now,
      batch_id: body.batch_id ?? null,
      received: incomingRows.length,
      inserts: inserts.length,
      updates: updates.length,
      unchanged: unchanged.length,
      invalid: invalid.length,
    });
  }

  return NextResponse.json({
    ok: true,
    dry_run: !applyRequested,
    source: body.source ?? "google_sheet",
    batch_id: body.batch_id ?? null,
    received: incomingRows.length,
    valid: valid.length,
    invalid: invalid.length,
    inserts: inserts.length,
    updates: updates.length,
    unchanged: unchanged.length,
    samples: {
      insert_row_ids: inserts.slice(0, 20),
      update_row_ids: updates.slice(0, 20),
      invalid: invalid.slice(0, 20),
    },
  });
}
