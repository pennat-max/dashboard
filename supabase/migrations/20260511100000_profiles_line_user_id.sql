-- LINE user id (e.g. U123…) linked to auth user for LIFF auto sign-in.
-- Admin sets public.profiles.line_user_id from Dashboard → Users.

alter table public.profiles
  add column if not exists line_user_id text;

create unique index if not exists profiles_line_user_id_unique
  on public.profiles (line_user_id)
  where line_user_id is not null and length(trim(line_user_id)) > 0;

comment on column public.profiles.line_user_id is 'LINE userId (U…) for LIFF session exchange; set by admin only';
