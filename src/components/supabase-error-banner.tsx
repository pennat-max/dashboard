type Props = { message: string };

/** แสดงเมื่อเรียก Supabase ไม่สำเร็จ — หน้า UI ยังโหลดได้ */
export function SupabaseErrorBanner({ message }: Props) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
    >
      <p className="font-medium">เชื่อมต่อฐานข้อมูลไม่ได้</p>
      <p className="mt-1 break-words opacity-90">{message}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        ถ้าข้อความบอกว่า <code className="rounded bg-muted px-1">column … does not exist</code> แปลว่าชื่อคอลัมน์ในโค้ดไม่ตรงตารางจริง — อัปเดตโค้ดหรือใช้ SQL view ให้ตรงกัน
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        นอกนั้น: ตรวจ <code className="rounded bg-muted px-1">.env.local</code> และ RLS ให้ role{" "}
        <code className="rounded bg-muted px-1">anon</code> อ่านตาราง cars ได้
      </p>
    </div>
  );
}
