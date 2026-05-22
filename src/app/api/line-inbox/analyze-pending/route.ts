import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import {
  LINE_INBOX_MESSAGES_TABLE,
  updateLineInboxMessageAnalyze,
} from "@/lib/line-inbox/line-inbox-messages";
import { runLineInboxAnalyzeCore } from "@/lib/line-inbox/run-analyze-core";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyzePendingBody = {
  limit?: unknown;
  line_inbox_message_id?: unknown;
  use_ai?: unknown;
};

type PendingInboxRow = {
  id: string;
  raw_text: string;
  car_row_id?: string | null;
};

function readBearerToken(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  const [scheme, ...rest] = header.trim().split(/\s+/);
  if (scheme?.toLowerCase() !== "bearer") return "";
  return rest.join(" ").trim();
}

function safeTokenEquals(input: string, expected: string): boolean {
  const inputBytes = Buffer.from(input);
  const expectedBytes = Buffer.from(expected);
  if (inputBytes.length !== expectedBytes.length) return false;
  return timingSafeEqual(inputBytes, expectedBytes);
}

async function authorizeAnalyzePending(request: Request) {
  const cronSecret = process.env.LINE_INBOX_CRON_SECRET?.trim() ?? "";
  if (cronSecret) {
    const token = readBearerToken(request);
    if (!token) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "Unauthorized: bearer token required" }, { status: 401 }),
      };
    }
    if (!safeTokenEquals(token, cronSecret)) {
      return {
        ok: false as const,
        response: NextResponse.json({ error: "Forbidden: invalid bearer token" }, { status: 403 }),
      };
    }
    return { ok: true as const };
  }

  const gate = await requireMutateRole();
  if (!gate.ok) return { ok: false as const, response: gate.response };
  return { ok: true as const };
}

function clampLimit(value: unknown): number {
  const n = Number(value ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.max(1, Math.min(20, Math.floor(n)));
}

function cleanErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/\s+/g, " ").trim().slice(0, 500) || "Analyze failed";
}

function isMissingTableError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    (m.includes("relation") && m.includes("does not exist")) ||
    (m.includes("schema cache") && m.includes("could not find"))
  );
}

/**
 * POST /api/line-inbox/analyze-pending
 * Analyzes pending webhook captures outside the LINE webhook request.
 *
 * This route is advisory only: it updates line_inbox_messages analyze fields
 * and never creates order_items or replies to LINE.
 */
export async function POST(request: Request) {
  const auth = await authorizeAnalyzePending(request);
  if (!auth.ok) return auth.response;

  let body: AnalyzePendingBody = {};
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    try {
      body = (await request.json()) as AnalyzePendingBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
  }

  const limit = clampLimit(body.limit);
  const targetId = String(body.line_inbox_message_id ?? "").trim();
  const useAi = body.use_ai !== false;
  const supabase = createServiceRoleClient();

  try {
    let query = supabase
      .from(LINE_INBOX_MESSAGES_TABLE)
      .select("id,raw_text,car_row_id")
      .eq("workflow_status", "pending")
      .eq("analyze_status", "pending")
      .order("received_at", { ascending: true })
      .limit(limit);

    if (targetId) {
      query = query.eq("id", targetId).limit(1);
    }

    const { data, error } = await query;
    if (error) {
      if (isMissingTableError(error.message)) {
        return NextResponse.json(
          {
            ok: false,
            error: "line_inbox_messages table is not available",
            table_missing_hint: LINE_INBOX_MESSAGES_TABLE,
          },
          { status: 500 }
        );
      }
      throw new Error(error.message);
    }

    const rows = ((data ?? []) as PendingInboxRow[]).filter((row) => row.id && row.raw_text);
    const results: Array<{
      inbox_message_id: string;
      analyze_status: "ok" | "error";
      item_count?: number;
      needs_human_review?: boolean;
      car_row_id?: string | null;
      error?: string;
    }> = [];

    for (const row of rows) {
      const inboxId = String(row.id).trim();
      const rawText = String(row.raw_text ?? "").trim();
      const existingCarRowId = String(row.car_row_id ?? "").trim();

      try {
        const payload = await runLineInboxAnalyzeCore(supabase, {
          raw_text: rawText,
          car_row_id: existingCarRowId || null,
          attachmentsCount: 0,
          useAi,
        });
        const detectedCarRowId = String(payload.detected_car.car_row_id ?? "").trim();
        const carRowId = detectedCarRowId || existingCarRowId || null;

        await updateLineInboxMessageAnalyze(supabase, inboxId, {
          analyze_status: "ok",
          analyze_error: null,
          analyze_payload: payload,
          needs_human_review: payload.needs_human_review,
          car_row_id: carRowId,
        });

        results.push({
          inbox_message_id: inboxId,
          analyze_status: "ok",
          item_count: payload.items.length,
          needs_human_review: payload.needs_human_review,
          car_row_id: carRowId,
        });
      } catch (error) {
        const msg = cleanErrorMessage(error);
        await updateLineInboxMessageAnalyze(supabase, inboxId, {
          analyze_status: "error",
          analyze_error: msg,
          analyze_payload: null,
          needs_human_review: true,
          car_row_id: existingCarRowId || null,
        });
        results.push({
          inbox_message_id: inboxId,
          analyze_status: "error",
          error: msg,
          car_row_id: existingCarRowId || null,
        });
      }
    }

    const analyzedCount = results.filter((result) => result.analyze_status === "ok").length;
    const errorCount = results.filter((result) => result.analyze_status === "error").length;

    return NextResponse.json({
      ok: true,
      requested_limit: limit,
      processed_count: results.length,
      analyzed_count: analyzedCount,
      error_count: errorCount,
      results,
    });
  } catch (error) {
    const msg = cleanErrorMessage(error);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
