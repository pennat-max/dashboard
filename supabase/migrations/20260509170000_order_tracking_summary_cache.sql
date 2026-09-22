-- Summary cache for fast /m/orders chips
-- Recomputed automatically after changes in source tables.

create table if not exists public.order_tracking_summary_cache (
  id int primary key default 1,
  sale_status_counts jsonb not null default '{}'::jsonb,
  sale_code_counts jsonb not null default '{}'::jsonb,
  staff_item_counts jsonb not null default '{}'::jsonb,
  item_status_counts jsonb not null default '{}'::jsonb,
  total_orders int not null default 0,
  total_items int not null default 0,
  computed_at timestamptz not null default now()
);

comment on table public.order_tracking_summary_cache is
  'Precomputed counters for order tracking dashboard chips.';

create or replace function public.refresh_order_tracking_summary_cache()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  sale_status_json jsonb;
  sale_code_json jsonb;
  staff_item_json jsonb;
  item_status_json jsonb;
  total_orders_val int;
  total_items_val int;
begin
  with sale_rows as (
    select
      case
        when coalesce(trim(c.shipped), '') <> '' then 'ส่งแล้ว'
        when coalesce(trim(c.booked_shipping), '') <> '' then 'รอส่ง'
        when coalesce(trim(c.buyer), '') <> '' then 'จอง'
        else 'ว่าง'
      end as sale_status
    from public.cars c
  ),
  sale_count as (
    select sale_status, count(*)::int as c
    from sale_rows
    group by sale_status
  )
  select coalesce(
    jsonb_build_object(
      'ทั้งหมด', (select count(*)::int from sale_rows),
      'จอง', coalesce((select c from sale_count where sale_status = 'จอง'), 0),
      'รอส่ง', coalesce((select c from sale_count where sale_status = 'รอส่ง'), 0),
      'ส่งแล้ว', coalesce((select c from sale_count where sale_status = 'ส่งแล้ว'), 0),
      'ว่าง', coalesce((select c from sale_count where sale_status = 'ว่าง'), 0)
    ),
    '{}'::jsonb
  )
  into sale_status_json;

  with sale_code_rows as (
    select upper(trim(coalesce(c.sale_support, ''))) as sale_code
    from public.cars c
  ),
  sale_code_count as (
    select sale_code, count(*)::int as c
    from sale_code_rows
    where sale_code <> ''
    group by sale_code
  )
  select coalesce(
    (select jsonb_object_agg(sale_code, c) from sale_code_count),
    '{}'::jsonb
  )
  into sale_code_json;

  with staff_rows as (
    select
      case
        when coalesce(trim(oi.assignee_staff), '') <> '' then trim(oi.assignee_staff)
        else 'ไม่ระบุชื่อ'
      end as staff_name
    from public.order_items oi
  ),
  staff_count as (
    select staff_name, count(*)::int as c
    from staff_rows
    group by staff_name
  )
  select coalesce(
    (select jsonb_object_agg(staff_name, c) from staff_count),
    '{}'::jsonb
  )
  into staff_item_json;

  with status_rows as (
    select trim(coalesce(oi.status, '')) as item_status
    from public.order_items oi
  ),
  status_count as (
    select item_status, count(*)::int as c
    from status_rows
    where item_status <> ''
    group by item_status
  )
  select coalesce(
    (select jsonb_object_agg(item_status, c) from status_count),
    '{}'::jsonb
  )
  into item_status_json;

  select count(*)::int into total_orders_val from public.cars;
  select count(*)::int into total_items_val from public.order_items;

  insert into public.order_tracking_summary_cache (
    id,
    sale_status_counts,
    sale_code_counts,
    staff_item_counts,
    item_status_counts,
    total_orders,
    total_items,
    computed_at
  ) values (
    1,
    coalesce(sale_status_json, '{}'::jsonb),
    coalesce(sale_code_json, '{}'::jsonb),
    coalesce(staff_item_json, '{}'::jsonb),
    coalesce(item_status_json, '{}'::jsonb),
    coalesce(total_orders_val, 0),
    coalesce(total_items_val, 0),
    now()
  )
  on conflict (id) do update set
    sale_status_counts = excluded.sale_status_counts,
    sale_code_counts = excluded.sale_code_counts,
    staff_item_counts = excluded.staff_item_counts,
    item_status_counts = excluded.item_status_counts,
    total_orders = excluded.total_orders,
    total_items = excluded.total_items,
    computed_at = excluded.computed_at;
end;
$$;

create or replace function public.refresh_order_tracking_summary_cache_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.refresh_order_tracking_summary_cache();
  return null;
end;
$$;

drop trigger if exists trg_refresh_order_tracking_summary_cache_cars on public.cars;
create trigger trg_refresh_order_tracking_summary_cache_cars
after insert or update or delete on public.cars
for each statement
execute function public.refresh_order_tracking_summary_cache_trigger();

drop trigger if exists trg_refresh_order_tracking_summary_cache_order_items on public.order_items;
create trigger trg_refresh_order_tracking_summary_cache_order_items
after insert or update or delete on public.order_items
for each statement
execute function public.refresh_order_tracking_summary_cache_trigger();

-- Seed initial snapshot
select public.refresh_order_tracking_summary_cache();

