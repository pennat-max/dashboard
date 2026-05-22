-- รูปจาก LINE (ดึงผ่าน Messaging API แล้วเก็บ path ใน Storage)
ALTER TABLE public.line_inbox_messages
ADD COLUMN IF NOT EXISTS image_storage_path text,
ADD COLUMN IF NOT EXISTS image_mime_type text;

COMMENT ON COLUMN public.line_inbox_messages.image_storage_path IS 'order-tracking-photos bucket path, e.g. line-inbox/{uuid}/....jpg';
