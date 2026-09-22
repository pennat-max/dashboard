-- Remove temporary/public write paths while preserving the read-only dashboard.
-- Server mutations continue through the service-role client after role checks.

drop policy if exists "allow_all_temp" on public.cars;
drop policy if exists "allow_authenticated_read" on public.cars;
drop policy if exists "auth_write" on public.cars;

create policy "cars_role_3_insert"
on public.cars
for insert
to authenticated
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role >= 3
  )
);

create policy "cars_role_3_update"
on public.cars
for update
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role >= 3
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role >= 3
  )
);

create policy "cars_role_3_delete"
on public.cars
for delete
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.role >= 3
  )
);

drop policy if exists "order_items_insert_anon" on public.order_items;
drop policy if exists "order_items_update_anon" on public.order_items;
drop policy if exists "order_tasks_insert_anon" on public.order_tasks;
drop policy if exists "order_tasks_update_anon" on public.order_tasks;

alter table public.cars_backup enable row level security;
revoke all on table public.cars_backup from anon, authenticated;

alter table public.chat_history enable row level security;
revoke all on table public.chat_history from anon, authenticated;

-- Trigger functions never need to be callable as public RPC endpoints.
revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.handle_new_user_profile() from public, anon, authenticated;
revoke all on function public.trg_order_tracking_summary_from_cars() from public, anon, authenticated;
revoke all on function public.trg_order_tracking_summary_from_order_items() from public, anon, authenticated;
revoke all on function public.trigger_refresh_order_tracking_summary_stmt() from public, anon, authenticated;

-- Maintenance RPCs are server-only.
revoke all on function public.refresh_order_tracking_summary() from public, anon, authenticated;
revoke all on function public.refresh_order_tracking_summary_cache() from public, anon, authenticated;
grant execute on function public.refresh_order_tracking_summary() to service_role;
grant execute on function public.refresh_order_tracking_summary_cache() to service_role;

-- Tenant authorization helpers remain available only to signed-in users and
-- the service role because RLS policies depend on them.
revoke all on function public.is_org_member(uuid) from public, anon;
revoke all on function public.is_org_owner_or_staff(uuid) from public, anon;
revoke all on function public.is_super_admin() from public, anon;
grant execute on function public.is_org_member(uuid) to authenticated, service_role;
grant execute on function public.is_org_owner_or_staff(uuid) to authenticated, service_role;
grant execute on function public.is_super_admin() to authenticated, service_role;
