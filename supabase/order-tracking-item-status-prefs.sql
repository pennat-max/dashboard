-- ตั้งค่าการแสดงสถานะรายการใน /m/orders (ลำดับ + ชื่อแสดงผล) แบบ singleton
-- อ่าน/เขียนผ่าน API service role เท่านั้น
-- รันใน Supabase SQL Editor

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.order_tracking_item_status_prefs (
  id text primary key default 'default',
  roster jsonb not null default '["เช็ค","มี","ต้องสั่ง","สั่ง","มา","รถนอก","ช่างนอก","ฝากสโตร์","ฝากกับรถ","จบ"]'::jsonb,
  labels jsonb not null default '{}'::jsonb,
  policies jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint order_tracking_item_status_prefs_singleton check (id = 'default')
);

drop trigger if exists trg_order_tracking_item_status_prefs_updated_at on public.order_tracking_item_status_prefs;
create trigger trg_order_tracking_item_status_prefs_updated_at
  before update on public.order_tracking_item_status_prefs
  for each row
  execute function public.set_current_timestamp_updated_at();

insert into public.order_tracking_item_status_prefs (id)
values ('default')
on conflict (id) do nothing;

alter table public.order_tracking_item_status_prefs enable row level security;
