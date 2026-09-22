-- OPTIONAL — ไม่ต้องรันก็ได้ถ้าไม่ใช้ pg_cron
-- ใช้เมื่ออยาก reconcile เต็มชุดทุกคืน (ป้องกัน delta เพี้ยนเล็กน้อยหลัง bulk / ความผิดพลาด)
--
-- เตรียม: Supabase Dashboard → Database → Extensions → เปิด pg_cron (ต้องอยู่แพลนที่รองรับ)
-- แล้วเปิดไฟล์นี้ใน SQL Editor → Run

-- ลบ job เก่าชื่อเดียวกันก่อน (ถ้ามี) แล้วสร้างใหม่ — ป้องกัน schedule ซ้ำ
DO $do$
DECLARE
  r record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE '[order-tracking-summary] Extension pg_cron not installed — skip.';
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid FROM cron.job WHERE jobname = 'reconcile_order_tracking_summary_cache'
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  PERFORM cron.schedule(
    'reconcile_order_tracking_summary_cache',
    '0 3 * * *', -- 03:00 UTC ทุกวัน — เปลี่ยนเวลาได้ที่นี่ (syntax crontab มาตรฐาน)
    $$ SELECT public.refresh_order_tracking_summary_cache(); $$
  );

  RAISE NOTICE '[order-tracking-summary] Scheduled nightly reconcile job.';
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE '[order-tracking-summary] Cron setup skipped: %', SQLERRM;
END;
$do$;
