-- Analyze the durable LINE inbox once daily from Supabase without exposing
-- Site or cron credentials in source control. Values live in Supabase Vault.
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

do $$
declare
  existing_job bigint;
begin
  select jobid into existing_job
  from cron.job
  where jobname = 'vigo4u-line-inbox-analyze'
  limit 1;

  if existing_job is not null then
    perform cron.unschedule(existing_job);
  end if;
end
$$;

select cron.schedule(
  'vigo4u-line-inbox-analyze',
  '0 1 * * *',
  $job$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'vigo4u_site_url'
      ) || '/api/cron/line-inbox/analyze-pending?limit=25&use_ai=false',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'vigo4u_line_cron_secret'
        ),
        'OAI-Sites-Authorization', 'Bearer ' || (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'vigo4u_site_bypass_token'
        )
      ),
      body := '{"use_ai":false,"limit":25}'::jsonb,
      timeout_milliseconds := 50000
    ) as request_id;
  $job$
);
