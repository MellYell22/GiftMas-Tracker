-- Applied to Giftmas Tracker via migration create_private_gift_lists.
create table public.gift_lists (
  user_id uuid primary key references auth.users(id) on delete cascade,
  people jsonb not null default '[]'::jsonb check (jsonb_typeof(people) = 'array')
);
alter table public.gift_lists enable row level security;
revoke all on public.gift_lists from anon;
grant select, insert, update, delete on public.gift_lists to authenticated;
create policy own_gift_lists_select on public.gift_lists for select to authenticated
  using ((select auth.uid()) = user_id);
create policy own_gift_lists_insert on public.gift_lists for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy own_gift_lists_update on public.gift_lists for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy own_gift_lists_delete on public.gift_lists for delete to authenticated
  using ((select auth.uid()) = user_id);
