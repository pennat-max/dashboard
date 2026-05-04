-- VIGO4U Order Tracking Phase 1 (schema design + read-only foundation)
-- Safe to run multiple times.

begin;

create table if not exists public.order_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  status text not null default 'requested' check (status in (
    'requested',
    'stock_check',
    'ordering',
    'received',
    'pickup',
    'installing',
    'done',
    'cancelled'
  )),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  requested_by_role text not null default 'sales' check (requested_by_role in ('sales', 'store', 'garage')),
  assigned_role text not null default 'sales' check (assigned_role in ('sales', 'store', 'garage')),
  car_id bigint null references public.cars(id) on update cascade on delete set null,
  car_row_id text null,
  due_date date null,
  line_thread_ref text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_tasks_status_idx on public.order_tasks(status);
create index if not exists order_tasks_assigned_role_idx on public.order_tasks(assigned_role);
create index if not exists order_tasks_requested_by_role_idx on public.order_tasks(requested_by_role);
create index if not exists order_tasks_updated_at_idx on public.order_tasks(updated_at desc);
create index if not exists order_tasks_car_id_idx on public.order_tasks(car_id);
create index if not exists order_tasks_car_row_id_idx on public.order_tasks(car_row_id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_task_id uuid not null references public.order_tasks(id) on update cascade on delete cascade,
  label text not null,
  qty numeric(12,2) not null default 1,
  unit text null,
  assignee_staff text null,
  outside_supplier text null,
  outside_eta_date date null,
  outside_price numeric(12,2) null,
  outside_note text null,
  status text not null default 'requested',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.order_items add column if not exists assignee_staff text null;
alter table public.order_items add column if not exists outside_supplier text null;
alter table public.order_items add column if not exists outside_eta_date date null;
alter table public.order_items add column if not exists outside_price numeric(12,2) null;
alter table public.order_items add column if not exists outside_note text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'order_items_status_check'
      and conrelid = 'public.order_items'::regclass
  ) then
    alter table public.order_items
      add constraint order_items_status_check
      check (status in (
        -- existing generic statuses
        'requested',
        'stock_check',
        'ordering',
        'received',
        'pickup',
        'installing',
        'done',
        'cancelled',
        -- short statuses used in mobile operations
        'เช็ค',
        'มี',
        'ต้องสั่ง',
        'สั่ง',
        'มา',
        'รถนอก',
        'ช่างนอก',
        'จบ',
        'ฝากสโตร์',
        'ฝากกับรถ'
      ));
  end if;
end
$$;

create index if not exists order_items_order_task_id_idx on public.order_items(order_task_id);
create index if not exists order_items_status_idx on public.order_items(status);
create index if not exists order_items_assignee_staff_idx on public.order_items(assignee_staff);
create index if not exists order_items_outside_eta_date_idx on public.order_items(outside_eta_date);

-- Mobile /m/orders: matches supabase/patch-order-storage-items-mobile-schema.sql + order-storage-items-draft.sql
create table if not exists public.order_storage_items (
  id uuid primary key default gen_random_uuid(),
  order_task_id uuid not null references public.order_tasks(id) on update cascade on delete cascade,
  order_item_id uuid null references public.order_items(id) on update cascade on delete set null,
  car_row_id text null,
  car_id bigint null references public.cars(id) on update cascade on delete set null,
  storage_name text null,
  item_name text not null default '',
  storage_type text not null default 'store_30_days' check (storage_type in ('store_30_days', 'in_car', 'removed_part', 'customer_item')),
  expire_date date null,
  status text not null default 'active' check (status in ('active', 'expired', 'released', 'confiscated')),
  note text null,
  created_by text null,
  updated_by text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_storage_items_order_task_id_idx on public.order_storage_items(order_task_id);
create index if not exists order_storage_items_car_row_idx on public.order_storage_items(car_row_id);
create index if not exists order_storage_items_car_id_idx on public.order_storage_items(car_id);
create index if not exists order_storage_items_item_idx on public.order_storage_items(item_name);
create index if not exists order_storage_items_order_item_id_idx on public.order_storage_items(order_item_id);
create index if not exists order_storage_items_expire_date_idx on public.order_storage_items(expire_date);

create table if not exists public.order_task_updates (
  id uuid primary key default gen_random_uuid(),
  order_task_id uuid not null references public.order_tasks(id) on update cascade on delete cascade,
  role text not null check (role in ('sales', 'store', 'garage')),
  message text not null,
  created_at timestamptz not null default now()
);

create index if not exists order_task_updates_order_task_id_idx on public.order_task_updates(order_task_id);
create index if not exists order_task_updates_created_at_idx on public.order_task_updates(created_at desc);

-- Keep updated_at current on write for order_tasks/order_items
create or replace function public.set_current_timestamp_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_order_tasks_set_updated_at on public.order_tasks;
create trigger trg_order_tasks_set_updated_at
before update on public.order_tasks
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_order_items_set_updated_at on public.order_items;
create trigger trg_order_items_set_updated_at
before update on public.order_items
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists trg_order_storage_items_set_updated_at on public.order_storage_items;
create trigger trg_order_storage_items_set_updated_at
before update on public.order_storage_items
for each row
execute function public.set_current_timestamp_updated_at();

-- RLS (read-only foundation)
alter table public.order_tasks enable row level security;
alter table public.order_items enable row level security;
alter table public.order_task_updates enable row level security;
alter table public.order_storage_items enable row level security;

drop policy if exists "order_tasks_select_anon" on public.order_tasks;
create policy "order_tasks_select_anon"
  on public.order_tasks
  for select
  to anon
  using (true);

drop policy if exists "order_items_select_anon" on public.order_items;
create policy "order_items_select_anon"
  on public.order_items
  for select
  to anon
  using (true);

drop policy if exists "order_task_updates_select_anon" on public.order_task_updates;
create policy "order_task_updates_select_anon"
  on public.order_task_updates
  for select
  to anon
  using (true);

drop policy if exists "order_storage_items_select_anon" on public.order_storage_items;
create policy "order_storage_items_select_anon"
  on public.order_storage_items
  for select
  to anon
  using (true);

commit;
