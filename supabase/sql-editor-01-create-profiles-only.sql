-- ============================================================================
-- STEP 1 — RUN THIS FIRST (alone) in Supabase → SQL Editor → Run
-- Do NOT run any INSERT into profiles until this succeeds.
-- ============================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role smallint not null default 1 check (role >= 1 and role <= 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists profiles_role_idx on public.profiles (role);

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  to authenticated
  using (auth.uid() = id);

-- Existing Auth users get profile rows at role 1 (you will bump yours in step 2)
insert into public.profiles (id, role)
select id, 1 from auth.users
on conflict (id) do nothing;

create or replace function public.handle_new_user_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 1)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;

-- Postgres 14+ / Supabase hosted usually accepts EXECUTE FUNCTION:
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row
  execute function public.handle_new_user_profile();

-- If you get a syntax error on the line above, comment it out and run this instead:
-- create trigger on_auth_user_created_profile
--   after insert on auth.users
--   for each row execute procedure public.handle_new_user_profile();
