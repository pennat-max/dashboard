-- Reference schema for used-car-export-dashboard
-- Run in Supabase SQL Editor or via CLI if you need to create the table from scratch.
-- If your project already has public.cars, compare columns and add missing ones or use a VIEW.

create extension if not exists "pgcrypto";

create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  stock_code text,
  make text,
  model text,
  year integer,
  mileage_km integer,
  price_thb numeric(14, 2),
  color text,
  fuel_type text,
  transmission text,
  status text default 'available',
  destination_country text,
  vin text,
  image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz default now()
);

create index if not exists cars_status_idx on public.cars (status);
create index if not exists cars_destination_country_idx on public.cars (destination_country);
create index if not exists cars_created_at_idx on public.cars (created_at desc);

alter table public.cars enable row level security;

-- Public read (anon key, ไม่ต้องล็อกอิน) — จำเป็นสำหรับแดชบอร์ดแบบเปิดได้เลย
create policy "cars_select_anon"
  on public.cars for select
  to anon
  using (true);

-- Authenticated users can read/write (tune for your org)
create policy "cars_select_authenticated"
  on public.cars for select
  to authenticated
  using (true);

create policy "cars_insert_authenticated"
  on public.cars for insert
  to authenticated
  with check (true);

create policy "cars_update_authenticated"
  on public.cars for update
  to authenticated
  using (true)
  with check (true);

create policy "cars_delete_authenticated"
  on public.cars for delete
  to authenticated
  using (true);
