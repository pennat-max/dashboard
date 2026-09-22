-- Hybrid C: incremental cache updates (per-row) + keep full refresh for reconcile / bulk safety.
-- Replaces statement-level triggers that ran refresh_order_tracking_summary_cache() on every write.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public._summary_jsonb_add(j jsonb, k text, delta int)
returns jsonb
language plpgsql
stable
as $$
declare
  base int;
  newc int;
  jj jsonb;
begin
  if k is null or delta = 0 then
    return coalesce(j, '{}'::jsonb);
  end if;
  jj := coalesce(j, '{}'::jsonb);
  base := coalesce((jj ->> k)::int, 0);
  newc := base + delta;
  if newc <= 0 then
    return jj - k;
  end if;
  return jsonb_set(jj, array[k], to_jsonb(newc), true);
end;
$$;

create or replace function public._car_derived_sale_status(
  p_shipped text,
  p_booked text,
  p_buyer text
)
returns text
language sql
stable
as $$
  select case
    when coalesce(trim(p_shipped), '') <> '' then 'ส่งแล้ว'
    when coalesce(trim(p_booked), '') <> '' then 'รอส่ง'
    when coalesce(trim(p_buyer), '') <> '' then 'จอง'
    else 'ว่าง'
  end;
$$;

create or replace function public._car_derived_sale_code(p_sale_support text)
returns text
language sql
stable
as $$
  select upper(trim(coalesce(p_sale_support, '')));
$$;

-- ---------------------------------------------------------------------------
-- Row triggers: order_items → staff / item status / total_items
-- ---------------------------------------------------------------------------

create or replace function public.trg_order_tracking_summary_from_order_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_staff jsonb;
  v_status jsonb;
  v_ti int;
  sk_old text;
  sk_new text;
  st_old text;
  st_new text;
begin
  insert into public.order_tracking_summary_cache (id) values (1)
  on conflict (id) do nothing;

  select staff_item_counts, item_status_counts, total_items
  into v_staff, v_status, v_ti
  from public.order_tracking_summary_cache
  where id = 1
  for update;

  sk_old := null;
  sk_new := null;
  st_old := null;
  st_new := null;

  if tg_op in ('DELETE', 'UPDATE') then
    sk_old := case
      when coalesce(trim(old.assignee_staff), '') <> '' then trim(old.assignee_staff)
      else 'ไม่ระบุชื่อ'
    end;
    st_old := trim(coalesce(old.status, ''));
    if st_old = '' then st_old := null; end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    sk_new := case
      when coalesce(trim(new.assignee_staff), '') <> '' then trim(new.assignee_staff)
      else 'ไม่ระบุชื่อ'
    end;
    st_new := trim(coalesce(new.status, ''));
    if st_new = '' then st_new := null; end if;
  end if;

  if tg_op = 'INSERT' then
    v_ti := v_ti + 1;
    v_staff := public._summary_jsonb_add(v_staff, sk_new, 1);
    if st_new is not null then
      v_status := public._summary_jsonb_add(v_status, st_new, 1);
    end if;
  elsif tg_op = 'DELETE' then
    v_ti := v_ti - 1;
    v_staff := public._summary_jsonb_add(v_staff, sk_old, -1);
    if st_old is not null then
      v_status := public._summary_jsonb_add(v_status, st_old, -1);
    end if;
  elsif tg_op = 'UPDATE' then
    if sk_old is distinct from sk_new then
      v_staff := public._summary_jsonb_add(v_staff, sk_old, -1);
      v_staff := public._summary_jsonb_add(v_staff, sk_new, 1);
    end if;
    if st_old is distinct from st_new then
      if st_old is not null then
        v_status := public._summary_jsonb_add(v_status, st_old, -1);
      end if;
      if st_new is not null then
        v_status := public._summary_jsonb_add(v_status, st_new, 1);
      end if;
    end if;
  end if;

  update public.order_tracking_summary_cache set
    staff_item_counts = v_staff,
    item_status_counts = v_status,
    total_items = v_ti,
    computed_at = now()
  where id = 1;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Row triggers: cars → sale status / sale code / total_orders
-- ---------------------------------------------------------------------------

create or replace function public.trg_order_tracking_summary_from_cars()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sale jsonb;
  v_code jsonb;
  v_ord int;
  ss_old text;
  ss_new text;
  sc_old text;
  sc_new text;
begin
  insert into public.order_tracking_summary_cache (id) values (1)
  on conflict (id) do nothing;

  select sale_status_counts, sale_code_counts, total_orders
  into v_sale, v_code, v_ord
  from public.order_tracking_summary_cache
  where id = 1
  for update;

  ss_old := null;
  ss_new := null;
  sc_old := null;
  sc_new := null;

  if tg_op in ('DELETE', 'UPDATE') then
    ss_old := public._car_derived_sale_status(old.shipped, old.booked_shipping, old.buyer);
    sc_old := public._car_derived_sale_code(old.sale_support);
    if sc_old = '' then sc_old := null; end if;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    ss_new := public._car_derived_sale_status(new.shipped, new.booked_shipping, new.buyer);
    sc_new := public._car_derived_sale_code(new.sale_support);
    if sc_new = '' then sc_new := null; end if;
  end if;

  if tg_op = 'INSERT' then
    v_ord := v_ord + 1;
    v_sale := public._summary_jsonb_add(v_sale, 'ทั้งหมด', 1);
    v_sale := public._summary_jsonb_add(v_sale, ss_new, 1);
    if sc_new is not null then
      v_code := public._summary_jsonb_add(v_code, sc_new, 1);
    end if;
  elsif tg_op = 'DELETE' then
    v_ord := v_ord - 1;
    v_sale := public._summary_jsonb_add(v_sale, 'ทั้งหมด', -1);
    v_sale := public._summary_jsonb_add(v_sale, ss_old, -1);
    if sc_old is not null then
      v_code := public._summary_jsonb_add(v_code, sc_old, -1);
    end if;
  elsif tg_op = 'UPDATE' then
    if ss_old is distinct from ss_new then
      v_sale := public._summary_jsonb_add(v_sale, ss_old, -1);
      v_sale := public._summary_jsonb_add(v_sale, ss_new, 1);
    end if;
    if sc_old is distinct from sc_new then
      if sc_old is not null then
        v_code := public._summary_jsonb_add(v_code, sc_old, -1);
      end if;
      if sc_new is not null then
        v_code := public._summary_jsonb_add(v_code, sc_new, 1);
      end if;
    end if;
  end if;

  update public.order_tracking_summary_cache set
    sale_status_counts = v_sale,
    sale_code_counts = v_code,
    total_orders = v_ord,
    computed_at = now()
  where id = 1;

  return coalesce(new, old);
end;
$$;

-- ---------------------------------------------------------------------------
-- Swap triggers: remove full refresh per statement, attach row-level deltas
-- ---------------------------------------------------------------------------

drop trigger if exists trg_refresh_order_tracking_summary_cache_cars on public.cars;
drop trigger if exists trg_refresh_order_tracking_summary_cache_order_items on public.order_items;

drop function if exists public.refresh_order_tracking_summary_cache_trigger();

drop trigger if exists trg_order_tracking_summary_delta_order_items on public.order_items;
drop trigger if exists trg_order_tracking_summary_delta_cars on public.cars;

create trigger trg_order_tracking_summary_delta_order_items
after insert or update or delete on public.order_items
for each row
execute function public.trg_order_tracking_summary_from_order_items();

create trigger trg_order_tracking_summary_delta_cars
after insert or update or delete on public.cars
for each row
execute function public.trg_order_tracking_summary_from_cars();

comment on function public.refresh_order_tracking_summary_cache() is
  'Full recompute of order_tracking_summary_cache — run after bulk imports, manual fixes, or periodic reconcile (e.g. pg_cron nightly).';

-- Resync snapshot (safe after trigger swap)
select public.refresh_order_tracking_summary_cache();
