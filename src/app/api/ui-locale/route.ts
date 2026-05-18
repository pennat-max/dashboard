import { NextResponse } from "next/server";
import { LOCALE_COOKIE, isSupportedLocale } from "@/lib/locale-constants";

type Body = {
  locale?: string;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const locale = String(body.locale ?? "").toLowerCase();
  if (!isSupportedLocale(locale)) {
    return NextResponse.json({ error: "Unsupported locale" }, { status: 400 });
  }

  const res = NextResponse.json({ ok: true, locale });
  res.cookies.set(LOCALE_COOKIE, locale, {
    path: "/",
    sameSite: "lax",
    httpOnly: false,
    maxAge: 60 * 60 * 24 * 365,
  });
  return res;
}
