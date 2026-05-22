-- รูปแนบสำหรับงานติดตามรถ: รองรับทั้งระดับการ์ดรถ (car) และระดับรายการงาน (item)
-- ใช้คู่กับ Supabase Storage bucket: order-tracking-photos

create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table if not exists public.order_tracking_photos (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('car','item')),
  order_item_id text null,
  car_row_id text null,
  car_id bigint null,
  storage_bucket text not null default 'order-tracking-photos',
  storage_path text not null unique,
  mime_type text null,
  size_bytes bigint null,
  uploaded_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint order_tracking_photos_item_ref_ck check (
    (target_type = 'item' and order_item_id is not null) or
    (target_type = 'car')
  ),
  constraint order_tracking_photos_car_ref_ck check (car_row_id is not null or car_id is not null)
);

drop trigger if exists trg_order_tracking_photos_updated_at on public.order_tracking_photos;
create trigger trg_order_tracking_photos_updated_at
  before update on public.order_tracking_photos
  for each row
  execute function public.set_current_timestamp_updated_at();

alter table public.order_tracking_photos enable row level security;

insert into storage.buckets (id, name, public)
values ('order-tracking-photos', 'order-tracking-photos', true)
on conflict (id) do update set public = excluded.public;
