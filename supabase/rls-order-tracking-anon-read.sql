-- ถ้า UI อ่าน cars ได้ แต่ order_items / order_tasks ไม่ขึ้น (มีข้อมูลในฐานแล้ว)
-- มักเป็นเพราะ RLS ไม่อนุญาตให้ role `anon` SELECT
-- รันใน Supabase SQL Editor — สอดคล้อง order-tracking-phase1.sql (ถ้าเคยรัน phase1 แล้ว จะเป็น drop/create ซ้ำได้)

alter table if exists public.order_tasks enable row level security;
alter table if exists public.order_items enable row level security;
alter table if exists public.order_task_updates enable row level security;

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
