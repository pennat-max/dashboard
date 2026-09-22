-- =============================================================================
-- Admin user (role 4) for used-car-export-dashboard
-- Run in: Supabase → SQL Editor
-- Prerequisite: public.profiles exists (see migrations/20260502120000_profiles_roles.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- METHOD 1 (recommended): Create the user in the Dashboard, then only set role
-- -----------------------------------------------------------------------------
-- 1) Supabase → Authentication → Users → "Add user" → Email + Password
--    (or Invite user)
-- 2) Run the UPDATE below (change the email).

update public.profiles
set role = 4, updated_at = now()
where id = (
  select id from auth.users
  where lower(email) = lower('admin@yourdomain.com')  -- <-- change email
);

-- If no row in profiles yet (trigger not run), insert:
-- insert into public.profiles (id, role)
-- select id, 4 from auth.users where lower(email) = lower('admin@yourdomain.com')
-- on conflict (id) do update set role = 4, updated_at = now();

-- -----------------------------------------------------------------------------
-- METHOD 2 (optional): Create email/password user entirely in SQL
-- Supabase versions differ: if this fails, use Method 1 and check column names
-- in Table editor → auth.users / auth.identities
-- Requires: create extension if not exists pgcrypto;
-- Password: use a strong unique password; do not commit this file with a real one.
-- -----------------------------------------------------------------------------
/*
create extension if not exists pgcrypto;

do $$
declare
  new_user_id uuid := gen_random_uuid();
  admin_email text := 'admin@yourdomain.com';   -- change
  plain_password text := 'ChangeMe_Strong_123'; -- change, then rotate after first login
begin
  insert into auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  )
  values (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    admin_email,
    crypt(plain_password, gen_salt('bf')),
    now(),
    '{"provider":"email","providers":["email"]}',
    '{}',
    now(),
    now(),
    '',
    '',
    '',
    ''
  );

  insert into auth.identities (
    id,
    user_id,
    provider_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  )
  values (
    gen_random_uuid(),
    new_user_id,
    new_user_id::text,
    jsonb_build_object('sub', new_user_id::text, 'email', admin_email, 'email_verified', true, 'phone_verified', false),
    'email',
    now(),
    now(),
    now()
  );

  insert into public.profiles (id, role)
  values (new_user_id, 4)
  on conflict (id) do update set role = 4, updated_at = now();
end $$;
*/
