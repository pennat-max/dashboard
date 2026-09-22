-- sync constraint ให้ตรง mobile /m/orders (รองรับ ฝากสโตร์ / ฝากกับรถ)
-- ใช้เมื่อเจอ violates check constraint "order_items_status_check"

alter table public.order_items drop constraint if exists order_items_status_check;

alter table public.order_items add constraint order_items_status_check check (status in (
  'requested',
  'stock_check',
  'ordering',
  'received',
  'pickup',
  'installing',
  'done',
  'cancelled',
  'เช็ค',
  'มี',
  'ต้องสั่ง',
  'สั่ง',
  'มา',
  'รถนอก',
  'ช่างนอก',
  'จบ',
  'ฝากสโตร์',
  'ฝากกับรถ'
));
