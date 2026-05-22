import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { requireMutateRole } from "@/lib/auth/mutation-guard";
import { runAnalyzePendingJob } from "@/lib/line-inbox/analyze-pending-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type AnalyzePendingBody = {
  limit?: unknown;
  line_inbox_message_id?: unknown;
  use_ai?: unknown;
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

  const result = await runAnalyzePendingJob(body);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
