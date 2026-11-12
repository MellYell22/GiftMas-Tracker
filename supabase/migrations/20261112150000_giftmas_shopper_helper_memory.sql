-- AI Gift Shopper Helper: memory.
--
-- One row per shopper per person (person_id = the person's id in the list),
-- plus one row per shopper with person_id = '*' for things that apply to all
-- of their shopping (e.g. "prefers handmade gifts").
--   messages: the conversation so far (newest last, capped by the function)
--   facts:    short notes the helper has learned and keeps for later
--
-- The giftmas-shopper-helper function reads and writes these rows with the
-- signed-in user's own session, so RLS limits everyone to their own rows. The
-- browser reads them to show past chats and deletes them for "Start fresh".
-- test = true is the Stripe-sandbox copy used by previews.

create table if not exists public.giftmas_helper_memory (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  test boolean not null default false,
  person_id text not null check (char_length(person_id) between 1 and 100),
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  facts jsonb not null default '[]'::jsonb check (jsonb_typeof(facts) = 'array'),
  updated_at timestamptz not null default now(),
  primary key (user_id, test, person_id),
  -- Keeps a single row from growing without limit (about 200 KB).
  constraint giftmas_helper_memory_size check (pg_column_size(messages) + pg_column_size(facts) < 200000)
);
alter table public.giftmas_helper_memory enable row level security;
revoke all on public.giftmas_helper_memory from anon;
grant select, insert, update, delete on public.giftmas_helper_memory to authenticated;

drop policy if exists own_helper_memory_select on public.giftmas_helper_memory;
drop policy if exists own_helper_memory_insert on public.giftmas_helper_memory;
drop policy if exists own_helper_memory_update on public.giftmas_helper_memory;
drop policy if exists own_helper_memory_delete on public.giftmas_helper_memory;
create policy own_helper_memory_select on public.giftmas_helper_memory
  for select to authenticated using (user_id = (select auth.uid()));
create policy own_helper_memory_insert on public.giftmas_helper_memory
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy own_helper_memory_update on public.giftmas_helper_memory
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy own_helper_memory_delete on public.giftmas_helper_memory
  for delete to authenticated using (user_id = (select auth.uid()));
