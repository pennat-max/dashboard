-- [OrderTracking] Storage rows for /m/orders (mobile)
-- Apply via `supabase/patch-order-storage-items-mobile-schema.sql` (existing DB) or `order-tracking-phase1.sql` (new DB).

create table if not exists public.order_storage_items (
  id uuid primary key default gen_random_uuid(),
  order_task_id uuid not null,
  order_item_id uuid null,
  car_row_id text null,
  car_id bigint null,
  storage_name text null,
  item_name text not null,
  storage_type text not null check (storage_type in ('store_30_days', 'in_car', 'removed_part', 'customer_item')),
  expire_date date null,
  status text not null default 'active' check (status in ('active', 'expired', 'released', 'confiscated')),
  note text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_storage_items_task_idx on public.order_storage_items(order_task_id);
create index if not exists order_storage_items_car_row_idx on public.order_storage_items(car_row_id);
create index if not exists order_storage_items_car_id_idx on public.order_storage_items(car_id);
create index if not exists order_storage_items_item_idx on public.order_storage_items(item_name);
