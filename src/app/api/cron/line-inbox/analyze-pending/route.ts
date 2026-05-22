import { timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import {
  AnalyzePendingOptions,
  runAnalyzePendingJob,
} from "@/lib/line-inbox/analyze-pending-job";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

function acceptedCronSecrets(): string[] {
  const secrets = [
    process.env.LINE_INBOX_CRON_SECRET?.trim() ?? "",
    process.env.CRON_SECRET?.trim() ?? "",
  ].filter(Boolean);
  return Array.from(new Set(secrets));
}

function authorizeCronRequest(request: Request) {
  const secrets = acceptedCronSecrets();
  if (!secrets.length) {
    return NextResponse.json(
      { error: "Cron secret is not configured" },
      { status: 503 }
    );
  }

  const token = readBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { error: "Unauthorized: bearer token required" },
      { status: 401 }
    );
  }

  if (!secrets.some((secret) => safeTokenEquals(token, secret))) {
    return NextResponse.json(
      { error: "Forbidden: invalid bearer token" },
      { status: 403 }
    );
  }

  return null;
}

function optionsFromUrl(request: Request): AnalyzePendingOptions {
  const url = new URL(request.url);
  const limit = url.searchParams.get("limit") ?? undefined;
  const lineInboxMessageId = url.searchParams.get("line_inbox_message_id") ?? undefined;
  const useAiParam = url.searchParams.get("use_ai");

  return {
    limit,
    line_inbox_message_id: lineInboxMessageId,
    use_ai: useAiParam === null ? undefined : useAiParam !== "false",
  };
}

async function optionsFromRequest(request: Request): Promise<AnalyzePendingOptions> {
  const options = optionsFromUrl(request);
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return options;

  try {
    const body = (await request.json()) as AnalyzePendingOptions;
    return { ...options, ...body };
  } catch {
    return options;
  }
}

async function handleCronAnalyzePending(request: Request) {
  const authResponse = authorizeCronRequest(request);
  if (authResponse) return authResponse;

  const options = await optionsFromRequest(request);
  const result = await runAnalyzePendingJob(options);
  return NextResponse.json(
    {
      ...result,
      cron: {
        path: "/api/cron/line-inbox/analyze-pending",
        schedule: "*/5 * * * *",
      },
    },
    { status: result.ok ? 200 : 500 }
  );
}

export async function GET(request: Request) {
  return handleCronAnalyzePending(request);
}

export async function POST(request: Request) {
  return handleCronAnalyzePending(request);
}
