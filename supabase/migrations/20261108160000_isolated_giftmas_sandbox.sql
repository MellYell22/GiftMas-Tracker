create table public.giftmas_test_subscriptions (like public.giftmas_subscriptions including all);
create table public.giftmas_test_lists (user_id uuid primary key references auth.users(id) on delete cascade, people jsonb not null default '[]'::jsonb);
alter table public.giftmas_test_subscriptions enable row level security;
alter table public.giftmas_test_lists enable row level security;
revoke all on public.giftmas_test_subscriptions,public.giftmas_test_lists from anon, authenticated;
grant select on public.giftmas_test_subscriptions to authenticated;
grant select,insert,update,delete on public.giftmas_test_lists to authenticated;
grant all on public.giftmas_test_subscriptions,public.giftmas_test_lists to service_role;
create function public.giftmas_test_has_access(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
select p_user_id = (select auth.uid()) and exists(select 1 from public.giftmas_test_subscriptions s where s.user_id=p_user_id and s.status in ('active','trialing') and (s.current_period_end is null or s.current_period_end>now()));
$$;
revoke all on function public.giftmas_test_has_access(uuid) from public,anon;
grant execute on function public.giftmas_test_has_access(uuid) to authenticated,service_role;
create policy read_own_test_subscription on public.giftmas_test_subscriptions for select to authenticated using ((select auth.uid())=user_id);
create policy own_test_list on public.giftmas_test_lists for all to authenticated using ((select auth.uid())=user_id and public.giftmas_test_has_access(user_id)) with check ((select auth.uid())=user_id and public.giftmas_test_has_access(user_id));
create function public.giftmas_test_webhook_signing_secret() returns text language sql stable security definer set search_path='' as $$
select decrypted_secret from vault.decrypted_secrets where name='giftmas_test_stripe_webhook_secret' order by created_at desc limit 1;
$$;
revoke all on function public.giftmas_test_webhook_signing_secret() from public,anon,authenticated;
grant execute on function public.giftmas_test_webhook_signing_secret() to service_role;