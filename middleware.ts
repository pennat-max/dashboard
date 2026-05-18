import { createServerClient } from "@supabase/ssr";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { LOCALE_COOKIE } from "@/lib/locale-constants";

/** หน้าแดชบอร์ดราก `/dashboard` เปิดสาธารณะ (เห็น Key figures) — หน้าย่อย `/dashboard/...` ต้องล็อกอิน */
function isProtectedPath(pathname: string): boolean {
  if (pathname.startsWith("/login") || pathname.startsWith("/auth/")) return false;
  if (pathname === "/" || pathname === "") return false;
  /** Order Tracking มือถือ + LIFF — ไม่บังคับ login */
  if (pathname.startsWith("/liff") || pathname.startsWith("/m")) return false;
  if (pathname === "/dashboard" || pathname === "/dashboard/") return false;
  if (pathname.startsWith("/dashboard/")) return true;
  if (pathname.startsWith("/cars")) return true;
  return false;
}

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && anonKey) {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const pathname = request.nextUrl.pathname;
    const isApi = pathname.startsWith("/api");

    if (!isApi && user && pathname === "/login") {
      const next = request.nextUrl.searchParams.get("next");
      const dest =
        next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
      return NextResponse.redirect(new URL(dest, request.url));
    }

    if (!isApi && !user && isProtectedPath(pathname)) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname === "/" ? "/dashboard" : pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  const current = request.cookies.get(LOCALE_COOKIE)?.value;
  if (current !== "en") {
    supabaseResponse.cookies.set(LOCALE_COOKIE, "en", {
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "lax",
    });
  }

  return supabaseResponse;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
