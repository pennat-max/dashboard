import { NextResponse } from "next/server";

function isTruthy(value: string | undefined): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(String(value ?? "").trim());
}

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

export function isLineN8nEnabled(): boolean {
  return isTruthy(process.env.LINE_N8N_ENABLED);
}

export function lineN8nRuntimeFlags() {
  return {
    enabled: isLineN8nEnabled(),
    dry_run: !/^(0|false|no|off|disabled)$/i.test(String(process.env.LINE_N8N_DRY_RUN ?? "true").trim()),
    auto_save: isTruthy(process.env.LINE_N8N_AUTO_SAVE),
    line_reply: isTruthy(process.env.LINE_N8N_LINE_REPLY),
    use_ai: isTruthy(process.env.LINE_N8N_USE_AI),
  };
}

export function acceptedLineN8nSecrets(): string[] {
  const secrets = [
    process.env.LINE_N8N_WORKER_SECRET?.trim() ?? "",
    process.env.LINE_INBOX_CRON_SECRET?.trim() ?? "",
  ].filter(Boolean);
  return Array.from(new Set(secrets));
}

export function authorizeLineN8nRequest(request: Request) {
  if (!isLineN8nEnabled()) {
    return NextResponse.json(
      {
        ok: false,
        error: "LINE n8n endpoints are disabled",
        enable_hint: "Set LINE_N8N_ENABLED=true after owner approval.",
      },
      { status: 503 }
    );
  }

  const secrets = acceptedLineN8nSecrets();
  if (!secrets.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "LINE n8n worker secret is not configured",
        secret_hint: "Set LINE_N8N_WORKER_SECRET or reuse LINE_INBOX_CRON_SECRET.",
      },
      { status: 503 }
    );
  }

  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, error: "Unauthorized: bearer token required" }, { status: 401 });
  }

  if (!secrets.some((secret) => safeTokenEquals(token, secret))) {
    return NextResponse.json({ ok: false, error: "Forbidden: invalid bearer token" }, { status: 403 });
  }

  return null;
}

export function lineN8nAuditHeaders(request: Request) {
  return {
    user_agent: request.headers.get("user-agent") ?? "",
    idempotency_key: request.headers.get("idempotency-key") ?? "",
  };
}
