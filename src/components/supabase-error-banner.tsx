import type { Dictionary } from "@/i18n/dictionaries";

type Props = { message: string; labels: Dictionary["error"] };

/** แสดงเมื่อเรียก Supabase ไม่สำเร็จ — หน้า UI ยังโหลดได้ */
export function SupabaseErrorBanner({ message, labels }: Props) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <p className="font-medium">{labels.title}</p>
      <p className="mt-1 break-words opacity-90">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        {labels.hint1}{" "}
        <code className="rounded bg-muted px-1">column … does not exist</code> {labels.hint1b}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {labels.hint2} <code className="rounded bg-muted px-1">.env.local</code> {labels.hint2b}{" "}
        <code className="rounded bg-muted px-1">anon</code> {labels.hint2c}
      </p>
    </div>
  );
}
