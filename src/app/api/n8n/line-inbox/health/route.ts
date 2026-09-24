import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/site/data";
import { LINE_INBOX_MESSAGES_TABLE } from "@/lib/line-inbox/line-inbox-messages";
import {
  acceptedLineN8nSecrets,
  authorizeLineN8nRequest,
  lineN8nRuntimeFlags,
} from "@/lib/n8n/line-inbox-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = authorizeLineN8nRequest(request);
  if (auth) return auth;

  const flags = lineN8nRuntimeFlags();
  const supabase = createServiceRoleClient();
  const pending = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("workflow_status", "pending");
  const analyzePending = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("workflow_status", "pending")
    .eq("analyze_status", "pending");
  const analyzeError = await supabase
    .from(LINE_INBOX_MESSAGES_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("workflow_status", "pending")
    .eq("analyze_status", "error");

  return NextResponse.json({
    ok: !pending.error && !analyzePending.error && !analyzeError.error,
    service: "line-inbox-n8n",
    flags,
    auth: {
      bearer_configured: acceptedLineN8nSecrets().length > 0,
    },
    readiness: {
      line_channel_secret_configured: Boolean(process.env.LINE_CHANNEL_SECRET?.trim()),
      line_channel_access_token_configured: Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN?.trim()),
      line_allowed_groups_configured: Boolean(process.env.LINE_ALLOWED_GROUP_IDS?.trim()),
      line_webhook_receipt_reply_enabled: process.env.LINE_WEBHOOK_RECEIPT_REPLY_ENABLED === "true",
      line_auto_save_enabled: process.env.LINE_AUTO_SAVE_ENABLED === "true",
      line_auto_save_reply_enabled: process.env.LINE_AUTO_SAVE_REPLY_ENABLED === "true",
      line_auto_save_allowed_groups_configured: Boolean(process.env.LINE_AUTO_SAVE_ALLOWED_GROUP_IDS?.trim()),
    },
    queue: {
      pending_messages: pending.count ?? 0,
      analyze_pending_messages: analyzePending.count ?? 0,
      analyze_error_messages: analyzeError.count ?? 0,
    },
    errors: [pending.error?.message, analyzePending.error?.message, analyzeError.error?.message].filter(Boolean),
  });
}
