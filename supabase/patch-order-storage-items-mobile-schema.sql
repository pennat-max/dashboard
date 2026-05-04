-- Align `order_storage_items` with `/api/m/order-storage/upsert` + `fetchOrderStorageByCars`
-- Fixes: "order_storage_items table is not ready. Use schema draft first."
-- Run once in Supabase SQL Editor (safe to re-run; uses IF NOT EXISTS / guarded ALTER).

begin;

-- 1) Greenfield: full table if missing
create table if not exists public.order_storage_items (
  id uuid primary key default gen_random_uuid(),
  order_task_id uuid not null references public.order_tasks(id) on update cascade on delete cascade,
  order_item_id uuid null references public.order_items(id) on update cascade on delete set null,
  car_row_id text null,
  car_id bigint null references public.cars(id) on update cascade on delete set null,
  storage_name text null,
  item_name text not null default '',
  storage_type text not null default 'store_30_days',
  expire_date date null,
  status text not null default 'active',
  note text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2) Legacy phase1 table: add columns the mobile API expects
alter table public.order_storage_items add column if not exists order_item_id uuid null;
alter table public.order_storage_items add column if not exists car_row_id text null;
alter table public.order_storage_items add column if not exists car_id bigint null;
alter table public.order_storage_items add column if not exists storage_name text null;
alter table public.order_storage_items add column if not exists item_name text null;
alter table public.order_storage_items add column if not exists expire_date date null;
alter table public.order_storage_items add column if not exists created_by text null;
alter table public.order_storage_items add column if not exists updated_by text null;
alter table public.order_storage_items add column if not exists status text null;

-- item_label / due_date / place / ownership only exist on older phase1 schema — harmless if absent
alter table public.order_storage_items add column if not exists item_label text null;
alter table public.order_storage_items add column if not exists due_date date null;
alter table public.order_storage_items add column if not exists place text null;
alter table public.order_storage_items add column if not exists ownership_transfers_on_due boolean null;

-- 3) Drop old check constraints (names from order-tracking-phase1.sql)
alter table public.order_storage_items drop constraint if exists order_storage_items_storage_type_check;
alter table public.order_storage_items drop constraint if exists order_storage_items_place_check;
alter table public.order_storage_items drop constraint if exists order_storage_items_status_check;

-- 4) Relax NOT NULL / defaults so API rows can insert
do $$
begin
  alter table public.order_storage_items alter column note drop not null;
exception when others then null;
end $$;
do $$
begin
  alter table public.order_storage_items alter column note drop default;
exception when others then null;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_storage_items' and column_name = 'place'
  ) then
    alter table public.order_storage_items alter column place drop not null;
    alter table public.order_storage_items alter column place set default 'store';
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'order_storage_items' and column_name = 'item_label'
  ) then
    alter table public.order_storage_items alter column item_label drop not null;
  end if;
end $$;

-- 5) Backfill mobile columns from legacy columns
do $$
begin
  update public.order_storage_items
  set item_name = coalesce(nullif(trim(item_name), ''), nullif(trim(item_label), ''), 'ของฝาก')
  where item_name is null or trim(item_name) = '';
exception when others then
  update public.order_storage_items
  set item_name = coalesce(nullif(trim(item_name), ''), 'ของฝาก')
  where item_name is null or trim(item_name) = '';
end $$;

do $$
begin
  update public.order_storage_items
  set expire_date = coalesce(expire_date, due_date)
  where expire_date is null and due_date is not null;
exception when others then null;
end $$;

update public.order_storage_items
set status = 'active'
where status is null;

alter table public.order_storage_items alter column status set default 'active';
alter table public.order_storage_items alter column status set not null;

-- 6) New checks (mobile + legacy enum values)
alter table public.order_storage_items add constraint order_storage_items_storage_type_check
  check (storage_type in ('store_30_days', 'in_car', 'removed_part', 'customer_item'));

alter table public.order_storage_items add constraint order_storage_items_status_check
  check (status in ('active', 'expired', 'released', 'confiscated'));

alter table public.order_storage_items alter column item_name set not null;

-- 7) Optional FK for car_id if column added without constraint
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_storage_items_car_id_fkey'
      and conrelid = 'public.order_storage_items'::regclass
  ) then
    alter table public.order_storage_items
      add constraint order_storage_items_car_id_fkey
      foreign key (car_id) references public.cars(id) on update cascade on delete set null;
  end if;
exception when duplicate_object then null;
when others then null;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'order_storage_items_order_item_id_fkey'
      and conrelid = 'public.order_storage_items'::regclass
  ) then
    alter table public.order_storage_items
      add constraint order_storage_items_order_item_id_fkey
      foreign key (order_item_id) references public.order_items(id) on update cascade on delete set null;
  end if;
exception when duplicate_object then null;
when others then null;
end $$;

-- 8) Indexes used by mobile fetch / filters
create index if not exists order_storage_items_order_task_id_idx on public.order_storage_items(order_task_id);
drop index if exists order_storage_items_due_date_idx;
create index if not exists order_storage_items_expire_date_idx on public.order_storage_items(expire_date);
drop index if exists order_storage_items_place_idx;
create index if not exists order_storage_items_car_row_idx on public.order_storage_items(car_row_id);
create index if not exists order_storage_items_car_id_idx on public.order_storage_items(car_id);
create index if not exists order_storage_items_item_idx on public.order_storage_items(item_name);
create index if not exists order_storage_items_order_item_id_idx on public.order_storage_items(order_item_id);

-- 9) RLS + anon read (match phase1)
alter table public.order_storage_items enable row level security;
drop policy if exists "order_storage_items_select_anon" on public.order_storage_items;
create policy "order_storage_items_select_anon"
  on public.order_storage_items
  for select
  to anon
  using (true);

commit;
