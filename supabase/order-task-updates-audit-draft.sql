-- Draft only (DO NOT APPLY in this phase)
-- [OrderTracking] Extend order_task_updates for structured audit fields

alter table public.order_task_updates
  add column if not exists order_item_id uuid null,
  add column if not exists action_type text null,
  add column if not exists old_value text null,
  add column if not exists new_value text null,
  add column if not exists note text null,
  add column if not exists updated_by text null;

create index if not exists order_task_updates_task_idx
  on public.order_task_updates(order_task_id);

create index if not exists order_task_updates_item_idx
  on public.order_task_updates(order_item_id);

create index if not exists order_task_updates_action_idx
  on public.order_task_updates(action_type);
