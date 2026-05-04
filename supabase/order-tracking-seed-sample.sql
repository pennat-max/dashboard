-- Sample data for Order Tracking Phase 1 (read-only demo)
-- Safe re-run: old sample rows are removed first.

begin;

delete from public.order_task_updates
where order_task_id in (
  select id from public.order_tasks where title like '[SAMPLE] %'
);

delete from public.order_items
where order_task_id in (
  select id from public.order_tasks where title like '[SAMPLE] %'
);

delete from public.order_tasks
where title like '[SAMPLE] %';

with seed_tasks as (
  select *
  from (
    values
      (
        '[SAMPLE] Rear camera + sensor install',
        'Customer requested rear camera and reverse sensor kit.',
        'requested',
        'high',
        'sales',
        'store',
        2346::bigint,
        '41a55542-0def-479f-8e0b-b48fbb300c69',
        (current_date + 2)::date
      ),
      (
        '[SAMPLE] Seat cover order (premium black)',
        'Order premium black seat cover set and prepare for install.',
        'stock_check',
        'normal',
        'sales',
        'store',
        3387096::bigint,
        '87648920-5b3f-461c-901c-7b2c0b54aa54',
        (current_date + 4)::date
      ),
      (
        '[SAMPLE] Side step replacement',
        'Replace side step and check mounting bolts.',
        'ordering',
        'normal',
        'store',
        'store',
        2345::bigint,
        'e3ad12f0-845c-4c98-b692-96c70fa4bd2c',
        (current_date + 5)::date
      ),
      (
        '[SAMPLE] Tint film rework',
        'Parts received. Waiting garage pickup for install.',
        'received',
        'high',
        'sales',
        'garage',
        3387094::bigint,
        '689870dc-5ba4-4d04-ba80-844602121224',
        (current_date + 1)::date
      ),
      (
        '[SAMPLE] Roof rack install',
        'Garage has picked up rack and starts installation.',
        'installing',
        'urgent',
        'store',
        'garage',
        2344::bigint,
        '6f388b4d-998b-4c5c-a06b-69d9e8f03b14',
        (current_date + 1)::date
      ),
      (
        '[SAMPLE] Dashcam setup complete',
        'Job complete and tested.',
        'done',
        'low',
        'garage',
        'garage',
        2343::bigint,
        'f9ac1e76-ffae-4464-bf8d-f4d004ecb487',
        (current_date - 1)::date
      )
  ) as t(title, description, status, priority, requested_by_role, assigned_role, car_id, car_row_id, due_date)
),
inserted_tasks as (
  insert into public.order_tasks (
    title,
    description,
    status,
    priority,
    requested_by_role,
    assigned_role,
    car_id,
    car_row_id,
    due_date
  )
  select
    title,
    description,
    status::text,
    priority::text,
    requested_by_role::text,
    assigned_role::text,
    car_id,
    car_row_id,
    due_date
  from seed_tasks
  returning id, title
)
insert into public.order_items (order_task_id, label, qty, unit, status)
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Camera set', 1::numeric, 'set'::text, 'requested'::text),
    ('Installation labor', 1::numeric, 'job'::text, 'requested'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Rear camera + sensor install'
union all
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Seat cover front+rear', 1::numeric, 'set'::text, 'stock_check'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Seat cover order (premium black)'
union all
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Side step LH', 1::numeric, 'piece'::text, 'ordering'::text),
    ('Side step RH', 1::numeric, 'piece'::text, 'ordering'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Side step replacement'
union all
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Tint film', 1::numeric, 'roll'::text, 'received'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Tint film rework'
union all
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Roof rack', 1::numeric, 'set'::text, 'pickup'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Roof rack install'
union all
select i.id, x.label, x.qty, x.unit, x.status
from inserted_tasks i
join lateral (
  values
    ('Dashcam unit', 1::numeric, 'set'::text, 'done'::text),
    ('Wiring + calibration', 1::numeric, 'job'::text, 'done'::text)
) as x(label, qty, unit, status)
  on i.title = '[SAMPLE] Dashcam setup complete';

insert into public.order_task_updates (order_task_id, role, message)
select id, 'sales', 'Request created by sales.' from public.order_tasks where title = '[SAMPLE] Rear camera + sensor install'
union all
select id, 'store', 'Stock check in progress.' from public.order_tasks where title = '[SAMPLE] Seat cover order (premium black)'
union all
select id, 'store', 'Parts are ordered from supplier.' from public.order_tasks where title = '[SAMPLE] Side step replacement'
union all
select id, 'store', 'Parts received and ready for pickup.' from public.order_tasks where title = '[SAMPLE] Tint film rework'
union all
select id, 'garage', 'Garage started installation today.' from public.order_tasks where title = '[SAMPLE] Roof rack install'
union all
select id, 'garage', 'Installation complete and verified.' from public.order_tasks where title = '[SAMPLE] Dashcam setup complete';

commit;
