-- รันครั้งเดียวใน Supabase SQL Editor ถ้าโปรเจกต์มีตาราง cars อยู่แล้วแต่ยังไม่มี policy ให้ anon อ่านได้
-- (แอปเปิดแดชบอร์ดโดยไม่ล็อกอิน — ใช้ anon key จึงต้องมี policy นี้)

create policy "cars_select_anon"
  on public.cars for select
  to anon
  using (true);
