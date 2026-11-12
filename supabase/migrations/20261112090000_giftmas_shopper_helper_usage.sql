-- AI Gift Shopper Helper: question counting and rate limits.
--
-- Free accounts get 3 helper questions in total. Subscribers and the owner
-- accounts are unlimited. Everyone is rate limited (per minute and per day) so
-- the AI bill cannot run away.
--
-- The counts live in giftmas_helper_usage, which nobody can read or write
-- directly (RLS on, no policies). Only the two SECURITY DEFINER functions below
-- touch it, and they only ever act on the signed-in user (auth.uid()).
--
-- How the giftmas-shopper-helper function (supabase/functions/_shared/shopper-core.js) uses them:
--   1. giftmas_helper_take(p_test) before calling the AI. It checks the limits,
--      counts the question and returns a one-time ticket.
--   2. If the AI call fails, giftmas_helper_refund(p_test, ticket) gives the
--      question back. The ticket never reaches the browser, so a successful
--      answer cannot be refunded. Calling take+refund directly gains nothing.
-- giftmas_helper_status(p_test) is for the browser to show "N free questions left".
--
-- p_test = true uses the Stripe sandbox subscription table (previews/local),
-- false uses the live one. The server decides this from where it runs, never
-- from the browser.

create table if not exists public.giftmas_helper_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  test boolean not null default false,
  free_used integer not null default 0,
  minute_start timestamptz not null default now(),
  minute_count integer not null default 0,
  day_start date not null default current_date,
  day_count integer not null default 0,
  ticket uuid,
  ticket_at timestamptz,
  ticket_counted_free boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, test)
);
alter table public.giftmas_helper_usage enable row level security;
revoke all on public.giftmas_helper_usage from anon, authenticated;

create or replace function public.giftmas_helper_unlimited(p_test boolean)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if p_test then return public.giftmas_test_has_access((select auth.uid())); end if;
  return public.giftmas_has_access((select auth.uid()));
end; $function$;

create or replace function public.giftmas_helper_status(p_test boolean default false)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_used integer;
begin
  if v_uid is null then return jsonb_build_object('signedIn', false); end if;
  if public.giftmas_helper_unlimited(p_test) then
    return jsonb_build_object('signedIn', true, 'unlimited', true);
  end if;
  select free_used into v_used from public.giftmas_helper_usage where user_id = v_uid and test = p_test;
  return jsonb_build_object('signedIn', true, 'unlimited', false,
    'freeLeft', greatest(0, 3 - coalesce(v_used, 0)));
end; $function$;

create or replace function public.giftmas_helper_take(p_test boolean default false)
 returns jsonb
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_unlimited boolean;
  v_row public.giftmas_helper_usage;
  v_ticket uuid := gen_random_uuid();
  c_free constant integer := 3;
  c_per_minute constant integer := 6;
  c_per_day constant integer := 120;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'reason', 'signed_out'); end if;
  v_unlimited := public.giftmas_helper_unlimited(p_test);

  insert into public.giftmas_helper_usage (user_id, test) values (v_uid, p_test)
    on conflict (user_id, test) do nothing;
  select * into v_row from public.giftmas_helper_usage
    where user_id = v_uid and test = p_test for update;

  if v_row.minute_start < now() - interval '1 minute' then
    v_row.minute_start := now(); v_row.minute_count := 0;
  end if;
  if v_row.day_start <> current_date then
    v_row.day_start := current_date; v_row.day_count := 0;
  end if;

  if not v_unlimited and v_row.free_used >= c_free then
    return jsonb_build_object('ok', false, 'reason', 'free_limit', 'unlimited', false, 'freeLeft', 0);
  end if;
  if v_row.minute_count >= c_per_minute then
    return jsonb_build_object('ok', false, 'reason', 'slow_down', 'unlimited', v_unlimited);
  end if;
  if v_row.day_count >= c_per_day then
    return jsonb_build_object('ok', false, 'reason', 'daily_limit', 'unlimited', v_unlimited);
  end if;

  update public.giftmas_helper_usage set
    free_used = free_used + case when v_unlimited then 0 else 1 end,
    minute_start = v_row.minute_start,
    minute_count = v_row.minute_count + 1,
    day_start = v_row.day_start,
    day_count = v_row.day_count + 1,
    ticket = v_ticket,
    ticket_at = now(),
    ticket_counted_free = not v_unlimited,
    updated_at = now()
  where user_id = v_uid and test = p_test;

  return jsonb_build_object('ok', true, 'ticket', v_ticket, 'unlimited', v_unlimited,
    'freeLeft', case when v_unlimited then null else greatest(0, c_free - v_row.free_used - 1) end);
end; $function$;

create or replace function public.giftmas_helper_refund(p_test boolean, p_ticket uuid)
 returns boolean
 language plpgsql
 volatile security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or p_ticket is null then return false; end if;
  update public.giftmas_helper_usage set
    free_used = greatest(0, free_used - case when ticket_counted_free then 1 else 0 end),
    minute_count = greatest(0, minute_count - 1),
    day_count = greatest(0, day_count - 1),
    ticket = null, ticket_at = null, ticket_counted_free = false,
    updated_at = now()
  where user_id = v_uid and test = p_test and ticket = p_ticket
    and ticket_at > now() - interval '5 minutes';
  return found;
end; $function$;

revoke all on function public.giftmas_helper_unlimited(boolean) from public, anon, authenticated;
revoke all on function public.giftmas_helper_status(boolean) from public, anon;
revoke all on function public.giftmas_helper_take(boolean) from public, anon;
revoke all on function public.giftmas_helper_refund(boolean, uuid) from public, anon;
grant execute on function public.giftmas_helper_status(boolean) to authenticated;
grant execute on function public.giftmas_helper_take(boolean) to authenticated;
grant execute on function public.giftmas_helper_refund(boolean, uuid) to authenticated;

-- info@aa-designs.com is an owner account too. The live access check already
-- includes it; bring the sandbox copy in line (otherwise unchanged from
-- 20261111083315).
create or replace function public.giftmas_test_has_access(p_user_id uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
begin
  if p_user_id is null or p_user_id is distinct from (select auth.uid()) then return false; end if;
  return exists (
      select 1 from auth.users u
      where u.id = p_user_id
        and lower(u.email) in ('contact@aa-designs.com', 'info@aa-designs.com', 's4smith528@gmail.com')
        and u.email_confirmed_at is not null)
    or exists (
      select 1 from public.giftmas_test_subscriptions s
      where s.user_id = p_user_id
        and s.status in ('active','trialing')
        and (s.current_period_end is null or s.current_period_end > now()));
end; $function$;
