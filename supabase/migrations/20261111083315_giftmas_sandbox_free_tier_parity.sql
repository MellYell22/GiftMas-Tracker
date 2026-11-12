-- Already applied to the Giftmas Tracker Supabase project on 2026-11-11
-- (migration version 20261111083315). Kept here so the repo matches it.
--
-- The sandbox copies now follow the same plan rules as the live tables, so a
-- preview or local test behaves like the real app:
--   * any signed-in account can keep up to 2 people for free,
--   * more than 2 people needs an active (sandbox) subscription,
--   * the two owner accounts are always unlimited.
-- Before this, the sandbox list could not be read or saved at all without a
-- sandbox subscription, so the free plan could not be tested.
--
-- Sandbox objects only: giftmas_test_has_access and giftmas_test_lists.
-- The live objects (giftmas_has_access, gift_lists, giftmas_subscriptions)
-- are not touched. The free limit (2) also lives in src/App.jsx as
-- FREE_PEOPLE_LIMIT and in the gift_lists policies; keep the three in step.

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
        and lower(u.email) in ('contact@aa-designs.com', 's4smith528@gmail.com')
        and u.email_confirmed_at is not null)
    or exists (
      select 1 from public.giftmas_test_subscriptions s
      where s.user_id = p_user_id
        and s.status in ('active','trialing')
        and (s.current_period_end is null or s.current_period_end > now()));
end; $function$;

drop policy if exists own_test_list on public.giftmas_test_lists;
drop policy if exists own_test_lists_select on public.giftmas_test_lists;
drop policy if exists own_test_lists_insert on public.giftmas_test_lists;
drop policy if exists own_test_lists_update on public.giftmas_test_lists;
drop policy if exists own_test_lists_delete on public.giftmas_test_lists;

create policy own_test_lists_select on public.giftmas_test_lists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_test_lists_insert on public.giftmas_test_lists for insert to authenticated
  with check ((select auth.uid()) = user_id
    and (jsonb_array_length(people) <= 2 or (select public.giftmas_test_has_access(user_id))));
create policy own_test_lists_update on public.giftmas_test_lists for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id
    and (jsonb_array_length(people) <= 2 or (select public.giftmas_test_has_access(user_id))));
create policy own_test_lists_delete on public.giftmas_test_lists for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.giftmas_test_lists drop constraint if exists giftmas_test_lists_people_is_array;
alter table public.giftmas_test_lists
  add constraint giftmas_test_lists_people_is_array check (jsonb_typeof(people) = 'array');
