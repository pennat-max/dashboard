import "server-only";
import { getD1, getR2 } from "../../../db";

type Row = Record<string, unknown>;
type Result<T = unknown> = { data: T; error: { message: string; code?: string } | null; count?: number | null };
type Operation = "select" | "insert" | "update" | "upsert" | "delete";

const JSON_COLUMNS: Record<string, Set<string>> = {
  cars: new Set(["raw_data"]),
  line_inbox_messages: new Set(["analyze_payload"]),
  order_tracking_staff_roster: new Set(["names", "sale_assignees"]),
  order_tracking_item_status_prefs: new Set(["roster", "labels", "policies"]),
  order_tracking_summary_cache: new Set(["sale_status_counts", "sale_code_counts", "staff_item_counts", "item_status_counts"]),
  migration_state: new Set(["value"]),
};

const BOOLEAN_COLUMNS: Record<string, Set<string>> = {
  line_inbox_messages: new Set(["needs_human_review"]),
  order_storage_items: new Set(["ownership_transfers_on_due"]),
};

const UUID_TABLES = new Set([
  "order_tasks", "order_items", "order_task_updates", "order_storage_items", "order_tracking_photos", "line_inbox_messages",
]);

function ident(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Invalid database identifier: ${value}`);
  return `"${value}"`;
}

function dbValue(table: string, column: string, value: unknown): unknown {
  if (value == null) return null;
  if (JSON_COLUMNS[table]?.has(column)) return typeof value === "string" ? value : JSON.stringify(value);
  if (BOOLEAN_COLUMNS[table]?.has(column) && typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "object") return JSON.stringify(value);
  return value;
}

function appRow(table: string, row: Row): Row {
  const out = { ...row };
  for (const column of JSON_COLUMNS[table] ?? []) {
    const value = out[column];
    if (typeof value === "string") {
      try { out[column] = JSON.parse(value); } catch { /* retain malformed legacy JSON */ }
    }
  }
  for (const column of BOOLEAN_COLUMNS[table] ?? []) {
    if (out[column] != null) out[column] = Boolean(out[column]);
  }
  return out;
}

function splitOr(value: string): string[] {
  return value.split(",").map((part) => part.trim()).filter(Boolean);
}

function decodeFilterValue(value: string): string {
  if (value === '""') return "";
  try { return decodeURIComponent(value); } catch { return value; }
}

class SiteQuery implements PromiseLike<Result<any>> {
  private operation: Operation = "select";
  private selectColumns = "*";
  private countMode = false;
  private head = false;
  private payload: Row | Row[] | null = null;
  private conflictColumns: string[] = [];
  private where: string[] = [];
  private binds: unknown[] = [];
  private orders: string[] = [];
  private rowLimit: number | null = null;
  private rowOffset = 0;
  private one: "single" | "maybe" | null = null;

  constructor(private readonly table: string) { ident(table); }

  select(columns = "*", options?: { count?: string; head?: boolean }) {
    this.selectColumns = columns;
    this.countMode = Boolean(options?.count);
    this.head = Boolean(options?.head);
    return this;
  }
  insert(values: Row | Row[]) { this.operation = "insert"; this.payload = values; return this; }
  update(values: Row) { this.operation = "update"; this.payload = values; return this; }
  upsert(values: Row | Row[], options?: { onConflict?: string }) {
    this.operation = "upsert"; this.payload = values;
    this.conflictColumns = (options?.onConflict ?? "id").split(",").map((v) => v.trim()).filter(Boolean);
    return this;
  }
  delete() { this.operation = "delete"; return this; }
  eq(column: string, value: unknown) { return this.compare(column, "=", value); }
  neq(column: string, value: unknown) { return this.compare(column, "!=", value); }
  gt(column: string, value: unknown) { return this.compare(column, ">", value); }
  gte(column: string, value: unknown) { return this.compare(column, ">=", value); }
  lt(column: string, value: unknown) { return this.compare(column, "<", value); }
  lte(column: string, value: unknown) { return this.compare(column, "<=", value); }
  ilike(column: string, value: string) { return this.compare(column, "LIKE", value); }
  is(column: string, value: unknown) {
    this.where.push(`${ident(column)} IS ${value == null ? "NULL" : "?"}`);
    if (value != null) this.binds.push(dbValue(this.table, column, value));
    return this;
  }
  in(column: string, values: unknown[]) {
    ident(column);
    if (!values.length) { this.where.push("0 = 1"); return this; }
    this.where.push(`${ident(column)} IN (${values.map(() => "?").join(",")})`);
    this.binds.push(...values.map((value) => dbValue(this.table, column, value)));
    return this;
  }
  or(expression: string) {
    const clauses: string[] = [];
    for (const part of splitOr(expression)) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)\.(eq|neq|is|ilike|gt|gte|lt|lte)\.(.*)$/.exec(part);
      if (!match) throw new Error(`Unsupported OR filter: ${part}`);
      const [, column, op, raw] = match;
      ident(column);
      if (op === "is" && raw === "null") clauses.push(`${ident(column)} IS NULL`);
      else {
        const sqlOp = ({ eq: "=", neq: "!=", ilike: "LIKE", gt: ">", gte: ">=", lt: "<", lte: "<=" } as const)[op as Exclude<typeof op, "is">];
        clauses.push(`${ident(column)} ${sqlOp} ?`);
        this.binds.push(dbValue(this.table, column, decodeFilterValue(raw)));
      }
    }
    if (clauses.length) this.where.push(`(${clauses.join(" OR ")})`);
    return this;
  }
  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) {
    const direction = options?.ascending === false ? "DESC" : "ASC";
    const nullRank = options?.nullsFirst ? "DESC" : "ASC";
    this.orders.push(`(${ident(column)} IS NULL) ${nullRank}`, `${ident(column)} ${direction}`);
    return this;
  }
  limit(value: number) { this.rowLimit = Math.max(0, Math.trunc(value)); return this; }
  range(from: number, to: number) { this.rowOffset = Math.max(0, Math.trunc(from)); this.rowLimit = Math.max(0, Math.trunc(to) - this.rowOffset + 1); return this; }
  single() { this.one = "single"; this.rowLimit ??= 2; return this; }
  maybeSingle() { this.one = "maybe"; this.rowLimit ??= 2; return this; }

  private compare(column: string, operator: string, value: unknown) {
    ident(column);
    if (value == null && (operator === "=" || operator === "!=")) {
      this.where.push(`${ident(column)} IS ${operator === "!=" ? "NOT " : ""}NULL`);
    } else {
      this.where.push(`${ident(column)} ${operator} ?`);
      this.binds.push(dbValue(this.table, column, value));
    }
    return this;
  }

  then<TResult1 = Result<any>, TResult2 = never>(
    onfulfilled?: ((value: Result<any>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private whereSql(): string { return this.where.length ? ` WHERE ${this.where.join(" AND ")}` : ""; }
  private returningSql(): string {
    const cols = this.selectColumns.trim();
    if (!cols || cols === "*") return "*";
    return cols.split(",").map((column) => ident(column.trim())).join(",");
  }

  private async execute(): Promise<Result<any>> {
    try {
      if (this.operation === "select") return await this.executeSelect();
      if (this.operation === "insert" || this.operation === "upsert") return await this.executeInsert();
      if (this.operation === "update") return await this.executeUpdate();
      return await this.executeDelete();
    } catch (error) {
      return { data: null, error: { message: error instanceof Error ? error.message : String(error) }, count: null };
    }
  }

  private async executeSelect(): Promise<Result<any>> {
    const db = getD1();
    if (this.countMode) {
      const counted = await db.prepare(`SELECT count(*) AS count FROM ${ident(this.table)}${this.whereSql()}`).bind(...this.binds).first<{ count: number }>();
      const count = Number(counted?.count ?? 0);
      if (this.head) return { data: null, error: null, count };
    }
    const limitSql = this.rowLimit == null ? "" : ` LIMIT ${this.rowLimit} OFFSET ${this.rowOffset}`;
    const orderSql = this.orders.length ? ` ORDER BY ${this.orders.join(",")}` : "";
    const result = await db.prepare(`SELECT ${this.returningSql()} FROM ${ident(this.table)}${this.whereSql()}${orderSql}${limitSql}`).bind(...this.binds).all<Row>();
    const rows = (result.results ?? []).map((row) => appRow(this.table, row));
    return this.shape(rows, this.countMode ? rows.length : undefined);
  }

  private normalizeRows(): Row[] {
    const values = Array.isArray(this.payload) ? this.payload : [this.payload ?? {}];
    return values.map((value) => {
      const row = { ...value };
      if (UUID_TABLES.has(this.table) && !row.id) row.id = crypto.randomUUID();
      return row;
    });
  }

  private async executeInsert(): Promise<Result<any>> {
    const db = getD1();
    const rows = this.normalizeRows();
    const returned: Row[] = [];
    for (const row of rows) {
      const columns = Object.keys(row);
      if (!columns.length) throw new Error("Cannot insert an empty row");
      const values = columns.map((column) => dbValue(this.table, column, row[column]));
      let conflict = "";
      if (this.operation === "upsert") {
        const keys = this.conflictColumns.length ? this.conflictColumns : ["id"];
        const updates = columns.filter((column) => !keys.includes(column));
        conflict = ` ON CONFLICT (${keys.map(ident).join(",")}) DO ${updates.length ? `UPDATE SET ${updates.map((column) => `${ident(column)}=excluded.${ident(column)}`).join(",")}` : "NOTHING"}`;
      }
      const sql = `INSERT INTO ${ident(this.table)} (${columns.map(ident).join(",")}) VALUES (${columns.map(() => "?").join(",")})${conflict} RETURNING ${this.returningSql()}`;
      const inserted = await db.prepare(sql).bind(...values).first<Row>();
      if (inserted) returned.push(appRow(this.table, inserted));
    }
    return this.shape(returned);
  }

  private async executeUpdate(): Promise<Result<any>> {
    const row = (this.payload ?? {}) as Row;
    const columns = Object.keys(row);
    if (!columns.length) return { data: null, error: null };
    const values = columns.map((column) => dbValue(this.table, column, row[column]));
    const sql = `UPDATE ${ident(this.table)} SET ${columns.map((column) => `${ident(column)}=?`).join(",")}${this.whereSql()} RETURNING ${this.returningSql()}`;
    const result = await getD1().prepare(sql).bind(...values, ...this.binds).all<Row>();
    return this.shape((result.results ?? []).map((item) => appRow(this.table, item)));
  }

  private async executeDelete(): Promise<Result<any>> {
    const sql = `DELETE FROM ${ident(this.table)}${this.whereSql()} RETURNING ${this.returningSql()}`;
    const result = await getD1().prepare(sql).bind(...this.binds).all<Row>();
    return this.shape((result.results ?? []).map((item) => appRow(this.table, item)));
  }

  private shape(rows: Row[], count?: number): Result<any> {
    if (this.one === "single") {
      if (rows.length !== 1) return { data: null, error: { message: rows.length ? "JSON object requested, multiple rows returned" : "JSON object requested, no rows returned", code: "PGRST116" }, count: count ?? null };
      return { data: rows[0], error: null, count: count ?? null };
    }
    if (this.one === "maybe") {
      if (rows.length > 1) return { data: null, error: { message: "JSON object requested, multiple rows returned", code: "PGRST116" }, count: count ?? null };
      return { data: rows[0] ?? null, error: null, count: count ?? null };
    }
    return { data: rows, error: null, count: count ?? null };
  }
}

function storageBucket() {
  return {
    async upload(path: string, value: ArrayBuffer | ArrayBufferView | Blob | ReadableStream, options?: { contentType?: string; cacheControl?: string; upsert?: boolean }) {
      try {
        if (!options?.upsert && await getR2().head(path)) return { data: null, error: { message: "The resource already exists" } };
        await getR2().put(path, value as Parameters<R2Bucket["put"]>[1], { httpMetadata: { contentType: options?.contentType, cacheControl: options?.cacheControl } });
        return { data: { path }, error: null };
      } catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
    },
    async remove(paths: string[]) {
      try { await getR2().delete(paths); return { data: paths.map((name) => ({ name })), error: null }; }
      catch (error) { return { data: null, error: { message: error instanceof Error ? error.message : String(error) } }; }
    },
    getPublicUrl(path: string) { return { data: { publicUrl: `/api/files/${path.split("/").map(encodeURIComponent).join("/")}` } }; },
  };
}

export function createSiteDataClient() {
  return {
    from(table: string) { return new SiteQuery(table); },
    storage: {
      from(_bucket: string) { return storageBucket(); },
      async createBucket(_bucket: string, _options?: Record<string, unknown>): Promise<{ data: { name: string }; error: { message: string } | null }> {
        return { data: { name: _bucket }, error: null };
      },
    },
  };
}

export type SiteDataClient = ReturnType<typeof createSiteDataClient>;
