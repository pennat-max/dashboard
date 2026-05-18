-- เก็บชื่อรายการภาษาอังกฤษ (แปลอัตโนมัติ) สำหรับ UI สองภาษา
alter table public.order_items
  add column if not exists label_en text null;

comment on column public.order_items.label_en is
  'Auto-translated English label for bilingual UI display.';
