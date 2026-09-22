-- Emergency rollback for 20260922081936_harden_vigo4u_public_access.sql.
-- Run only if the verified server/API write paths unexpectedly regress.

alter table public.cars_backup disable row level security;
grant all on table public.cars_backup to anon, authenticated;

alter table public.chat_history disable row level security;
grant all on table public.chat_history to anon, authenticated;

drop policy if exists "cars_role_3_insert" on public.cars;
drop policy if exists "cars_role_3_update" on public.cars;
drop policy if exists "cars_role_3_delete" on public.cars;

create policy "allow_all_temp"
on public.cars
for all
to public
using (true);

create policy "allow_authenticated_read"
on public.cars
for select
to authenticated
using (true);

create policy "auth_write"
on public.cars
for all
to authenticated
using (true)
with check (true);

create policy "order_items_insert_anon"
on public.order_items
for insert
to anon
with check (true);

create policy "order_items_update_anon"
on public.order_items
for update
to anon
using (true)
with check (true);

create policy "order_tasks_insert_anon"
on public.order_tasks
for insert
to anon
with check (true);

create policy "order_tasks_update_anon"
on public.order_tasks
for update
to anon
using (true)
with check (true);

grant execute on function public.handle_new_user() to public;
grant execute on function public.handle_new_user_profile() to public;
grant execute on function public.trg_order_tracking_summary_from_cars() to public;
grant execute on function public.trg_order_tracking_summary_from_order_items() to public;
grant execute on function public.trigger_refresh_order_tracking_summary_stmt() to public;
grant execute on function public.refresh_order_tracking_summary() to public;
grant execute on function public.refresh_order_tracking_summary_cache() to public;
grant execute on function public.is_org_member(uuid) to public;
grant execute on function public.is_org_owner_or_staff(uuid) to public;
grant execute on function public.is_super_admin() to public;
