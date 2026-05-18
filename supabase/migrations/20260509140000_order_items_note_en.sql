-- เก็บหมายเหตุรายการภาษาอังกฤษ (แปลอัตโนมัติ) สำหรับ UI สองภาษา — คู่กับ note / outside_note
alter table public.order_items
  add column if not exists note_en text null;

comment on column public.order_items.note_en is
  'Auto-translated English note/remark for bilingual UI display.';
