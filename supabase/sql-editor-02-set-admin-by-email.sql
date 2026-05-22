-- ============================================================================
-- STEP 2 — RUN ONLY AFTER step 1 (`sql-editor-01-create-profiles-only.sql`) OK
-- Change email if needed.
-- ============================================================================

insert into public.profiles (id, role)
select id, 4 from auth.users
where lower(email) = lower('pennat@gmail.com')
on conflict (id) do update set role = 4, updated_at = now();

-- Verify:
-- select u.email, p.role from auth.users u
-- left join public.profiles p on p.id = u.id
-- where lower(u.email) = lower('pennat@gmail.com');
