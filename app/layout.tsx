import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VIGO4U Operations",
  description: "Used car export operations dashboard",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body className="antialiased">{children}</body>
    </html>
  );
}
