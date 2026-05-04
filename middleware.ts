import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE } from "@/lib/locale-constants";

export function middleware(request: NextRequest) {
  const res = NextResponse.next();
  const current = request.cookies.get(LOCALE_COOKIE)?.value;
  if (current !== "en" && current !== "th") {
    res.cookies.set(LOCALE_COOKIE, "en", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
