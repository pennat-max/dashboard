import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE } from "@/lib/locale-constants";

/** หน้าแดชบอร์ดราก `/dashboard` เปิดสาธารณะ (เห็น Key figures) — หน้าย่อย `/dashboard/...` ต้องล็อกอิน */
function isProtectedPath(pathname: string): boolean {
  if (pathname.startsWith("/login") || pathname.startsWith("/auth/")) return false;
  if (pathname === "/" || pathname === "") return false;
  /** Order Tracking มือถือ + LIFF — ไม่บังคับ login */
  if (pathname.startsWith("/liff") || pathname.startsWith("/m")) return false;
  if (pathname === "/dashboard/users" || pathname.startsWith("/dashboard/users/")) return true;
  if (pathname === "/dashboard" || pathname === "/dashboard/") return false;
  if (pathname.startsWith("/dashboard/")) return false;
  if (pathname.startsWith("/cars")) return false;
  return false;
}

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const pathname = request.nextUrl.pathname;
  const isApi = pathname.startsWith("/api");
  const signedIn = Boolean(request.headers.get("oai-authenticated-user-id") && request.headers.get("oai-authenticated-user-email"));

  if (!isApi && signedIn && pathname === "/login") {
    const next = request.nextUrl.searchParams.get("next");
    const dest = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    return NextResponse.redirect(new URL(dest, request.url));
  }
  if (!isApi && !signedIn && isProtectedPath(pathname)) {
    const signInUrl = new URL("/signin-with-chatgpt", request.url);
    signInUrl.searchParams.set("return_to", pathname);
    return NextResponse.redirect(signInUrl);
  }

  const current = request.cookies.get(LOCALE_COOKIE)?.value;
  if (current !== "en") {
    response.cookies.set(LOCALE_COOKIE, "en", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  return response;
}

export const proxyConfig = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
