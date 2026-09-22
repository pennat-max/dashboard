-- แก้ error: Could not find the 'assignee_staff' column of 'order_items' in the schema cache
-- รันใน Supabase → SQL Editor (โปรเจกต์เดียวกับแอป) แล้วรันแบบครั้งเดียวหรือหลายครั้งก็ได้

alter table public.order_items add column if not exists assignee_staff text null;

-- ใช้โดย mobile order-items API / การอ่านรายการ (ถ้ายังไม่มีในตารางของคุณ)
alter table public.order_items add column if not exists due_date date null;
alter table public.order_items add column if not exists note text null;

create index if not exists order_items_assignee_staff_idx on public.order_items(assignee_staff);

-- หลัง ALTER ถ้า PostgREST ยัง cache เก่า รอ ~1 นาที หรือ Restart project ใน Supabase (ส่วนใหญ่ไม่จำเป็น)
