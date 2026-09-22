-- เก็บเวลาที่เปลี่ยน "สถานะ" ของรายการ (แยกจาก updated_at ที่อัปเดตทุกครั้งที่แก้ฟิลด์ใดก็ได้)
alter table public.order_items
  add column if not exists status_changed_at timestamptz null;

comment on column public.order_items.status_changed_at is 'Set when item status changes; app displays as calendar date in Asia/Bangkok';

-- แบ็กฟิลล์คร่าว ๆ จาก updated_at เมื่อยังไม่มีค่า
update public.order_items
set status_changed_at = coalesce(status_changed_at, updated_at)
where status_changed_at is null;
