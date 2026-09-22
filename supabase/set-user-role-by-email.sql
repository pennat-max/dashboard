-- รันหลัง apply migration `20260502120000_profiles_roles.sql` และสร้างบัญชีใน Auth แล้ว
-- ตั้งบัญชีเป็นระดับ 4 (ผู้ดูแล — สร้าง user ได้)
-- แก้อีเมลตามต้องการ

update public.profiles
set role = 4, updated_at = now()
where id = (select id from auth.users where lower(email) = lower('pennat@gmail.com'));
