import { ExternalLink } from "lucide-react";
import { getPublicSiteUrl } from "@/lib/site-url";

/** แสดงใน sidebar — ลิงก์มาจาก Vercel อัตโนมัติ หรือจาก NEXT_PUBLIC_APP_URL */
export function DeploySiteLink() {
  const url = getPublicSiteUrl();
  if (!url) {
    return (
      <p className="text-xs leading-relaxed text-muted-foreground">
        ตั้ง <code className="rounded bg-muted px-1 font-mono text-[0.65rem]">NEXT_PUBLIC_APP_URL</code> ใน Vercel
        เพื่อแสดงลิงก์เว็บที่นี่
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        เปิดเว็บที่ deploy
        <ExternalLink className="size-3 shrink-0 opacity-80" aria-hidden />
      </a>
      <p className="break-all font-mono text-[0.65rem] leading-snug text-muted-foreground" title={url}>
        {url}
      </p>
    </div>
  );
}
