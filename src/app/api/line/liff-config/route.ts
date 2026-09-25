import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export function GET() {
  const liffId = (process.env.NEXT_PUBLIC_LINE_LIFF_ID ?? "").trim();
  return NextResponse.json(
    { liffId },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    }
  );
}
