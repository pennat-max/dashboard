import { NextResponse } from "next/server";
import { runAnalyzePendingJob } from "@/lib/line-inbox/analyze-pending-job";
import {
  authorizeLineN8nRequest,
  lineN8nAuditHeaders,
  lineN8nRuntimeFlags,
} from "@/lib/n8n/line-inbox-auth";

export const dynamic = "force-dynamic";

type AnalyzePendingBody = {
  limit?: unknown;
  line_inbox_message_id?: unknown;
  use_ai?: unknown;
};

async function readBody(request: Request): Promise<AnalyzePendingBody> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return (await request.json()) as AnalyzePendingBody;
  } catch {
    return {};
  }
}

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(String(value ?? "").trim());
}

export async function POST(request: Request) {
  const auth = authorizeLineN8nRequest(request);
  if (auth) return auth;

  const flags = lineN8nRuntimeFlags();
  if (!flags.auto_save && isTruthy(process.env.LINE_AUTO_SAVE_ENABLED)) {
    return NextResponse.json(
      {
        ok: false,
        error: "Refusing to run n8n analyze while LINE auto-save env is enabled but LINE_N8N_AUTO_SAVE is false",
      },
      { status: 409 }
    );
  }

  const body = await readBody(request);
  const result = await runAnalyzePendingJob({
    limit: body.limit ?? 10,
    line_inbox_message_id: body.line_inbox_message_id,
    use_ai: flags.use_ai && body.use_ai !== false,
  });

  return NextResponse.json(
    {
      ...result,
      n8n: {
        dry_run: flags.dry_run,
        auto_save: flags.auto_save,
        line_reply: flags.line_reply,
        use_ai: flags.use_ai && body.use_ai !== false,
        audit: lineN8nAuditHeaders(request),
      },
      safety: {
        auto_save_runtime_env_required: "LINE_AUTO_SAVE_ENABLED=true",
        line_reply_runtime_env_required: "LINE_AUTO_SAVE_REPLY_ENABLED=true or manual approval reply flag",
      },
    },
    { status: result.ok ? 200 : 500 }
  );
}
