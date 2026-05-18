-- นโยบายต่อโค้ดสถานะรายการ (วันมอบ / เงื่อนไขชิปมาวันนี้ / ฝากสโตร์ / SLA)
alter table if exists public.order_tracking_item_status_prefs
  add column if not exists policies jsonb not null default '{}'::jsonb;
