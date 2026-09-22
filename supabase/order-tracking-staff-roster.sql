-- รายชื่อพนักงานสำหรับกรอง /m/orders — แถวเดียว เก็บ JSON array ของชื่อ
-- อ่าน/เขียนผ่าน API ที่ใช้ service role เท่านั้น (ไม่เปิด anon policy)
-- รันใน Supabase SQL Editor (ไฟล์นี้ใช้ trigger function เดียวกับ order-tracking-phase1 ถ้ายังไม่มีจะสร้างให้)

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.order_tracking_staff_roster (
  id text primary key default 'default',
  names jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  constraint order_tracking_staff_roster_singleton check (id = 'default')
);

drop trigger if exists trg_order_tracking_staff_roster_updated_at on public.order_tracking_staff_roster;
create trigger trg_order_tracking_staff_roster_updated_at
  before update on public.order_tracking_staff_roster
  for each row
  execute function public.set_current_timestamp_updated_at();

insert into public.order_tracking_staff_roster (id, names)
values ('default', '[]'::jsonb)
on conflict (id) do nothing;

alter table public.order_tracking_staff_roster enable row level security;
