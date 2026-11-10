-- Account-linked checkout: remember which Stripe events were handled so a
-- second delivery of the same event is skipped, and note whether a payment
-- issue came from live or sandbox. Additive only: no existing row changes.
create table if not exists public.giftmas_stripe_events (
  event_id text primary key,
  event_type text not null,
  event_created bigint not null,
  livemode boolean not null,
  processed_at timestamptz not null default now()
);
alter table public.giftmas_stripe_events enable row level security;
revoke all on public.giftmas_stripe_events from public, anon, authenticated;
grant select, insert on public.giftmas_stripe_events to service_role;
comment on table public.giftmas_stripe_events is
  'Stripe webhook events the GiftMas functions have finished handling. Service role only.';

alter table public.giftmas_payment_issues add column if not exists livemode boolean;
