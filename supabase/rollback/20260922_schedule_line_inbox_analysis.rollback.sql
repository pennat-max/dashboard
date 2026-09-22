-- Stops the scheduled analyzer. Vault credentials are retained so rollback is
-- recoverable and does not unexpectedly destroy credentials.
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
