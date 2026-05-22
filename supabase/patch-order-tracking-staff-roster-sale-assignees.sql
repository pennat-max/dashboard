-- เพิ่มคอลัมน์จับคู่เซลล์ → พนักงานรับผิดชอบ (JSON map)
-- รันใน Supabase SQL Editor ถ้ายังไม่มีคอลัมน์นี้

alter table public.order_tracking_staff_roster
  add column if not exists sale_assignees jsonb not null default '{}'::jsonb;
