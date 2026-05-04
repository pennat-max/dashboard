import "./globals.css";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Inter } from "next/font/google";
import { CRITICAL_APP_CSS } from "@/lib/critical-app-fallback-css";
import { getLocale } from "@/lib/locale";
import { cn } from "@/lib/utils";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

function metadataBaseUrl(): URL {
  // dev: ใช้ localhost เท่านั้น — ถ้าใช้ URL deploy ใน .env จะไม่กระทบการโหลด /_next/static
  if (process.env.NODE_ENV === "development") {
    return new URL("http://localhost:3000");
  }
  const manual = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (manual) {
    const u = manual.replace(/\/$/, "");
    return new URL(u.startsWith("http") ? u : `https://${u}`);
  }
  if (process.env.VERCEL_URL?.trim()) {
    return new URL(`https://${process.env.VERCEL_URL.trim()}`);
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: metadataBaseUrl(),
  title: "Export Cars Dashboard",
  description: "แดชบอร์ดจัดการรถมือสองส่งออก — Supabase + Next.js",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  /** iOS / notch — ให้พื้นหลังล้ำไปถึงขอบจริงของจอ */
  viewportFit: "cover",
  /** Chrome Android — แถบที่อยู่ทับ viewport แทนการหดความสูง */
  interactiveWidget: "overlays-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f1f5f9" },
    { media: "(prefers-color-scheme: dark)", color: "#0f172a" },
  ],
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  return (
    <html lang={locale === "en" ? "en" : "th"} className={cn("font-sans", inter.variable)}>
      <body
        data-app-root
        className={cn(
          `${geistSans.variable} ${geistMono.variable} antialiased`,
          "min-h-screen bg-background text-foreground"
        )}
      >
        {/* สำรองทันทีที่ body — App Router ไม่แนะนำแทรก <head> ใน layout; :where() ไม่แย่ง specificity กับ Tailwind */}
        <style
          dangerouslySetInnerHTML={{
            __html: CRITICAL_APP_CSS,
          }}
        />
        {children}
      </body>
    </html>
  );
}
