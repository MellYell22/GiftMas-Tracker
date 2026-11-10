# Christmas App — by AA Designs

A Christmas shopping app for people who shop a lot: add each person you're
shopping for, set a budget per person, and keep a simple gift list per person
showing what still needs to be bought, what's bought, and what's wrapped — so
nothing (and no matching piece, like the shirt that goes with the jeans) gets
forgotten.

**Price:** $19.99/year (Stripe subscription — see Stripe details below).

## Features

- Supabase email/password accounts and private cloud gift lists
- Add all your people first: name + budget, gifts later
- One simple line per gift: gift name, price, where bought, with four small
  checkboxes — To buy, Bought, Wrapped, Return
- Product link per gift ("View product") and a link/notes on each person,
  with small transparent "optional" labels on optional fields
- Gift photo via file picker (for people who'd rather show it than type it)
- Barcode number typed or pasted in (live camera scanning is not in this
  web version)
- Export PDF / Print and Share buttons (browser print / share sheet)
- Over-budget alerts: a home-screen "⚠️ Over budget" notice naming who is
  over and by how much (tap it to jump to their list), plus the same
  warning on that person's card
- AI Gift Helper: a small green tab running longways down the right side
  of each person's card — tap it to open a chat that suggests gift ideas
  within the money left in that person's budget, each with a one-tap
  "+ Add to their list" button. Honest note: in this web version the
  helper runs **locally in the browser** (rules based on the person's
  notes and budget) — there is no external AI API key and no live model
  call, so it costs nothing per use; if it cannot answer it says plainly
  "The gift helper couldn't answer just now — please try again in a
  moment."
- Countdown to Christmas
- Design: candy apple red Add-person button and countdown, deep pine green
  accents, door-with-wreath + tree motif only as a soft transparent background

## Run it locally

```bash
npm install
npm run dev      # local dev server
npm run build    # production build into dist/
npm run preview  # preview the production build
```

## Deploy (Vercel)

1. Import the GitHub repo `MellYell22/GiftMas-Tracker` into Vercel.
2. Framework preset: **Vite**. Build command: `npm run build`. Output: `dist`.
3. The public Supabase project configuration is included. Optional overrides: `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never use a service-role key in browser code.
4. Configure Supabase Authentication Site URL and allowed redirect URLs to match the deployed app before testing confirmation and password-reset emails.

## Stripe (already set up — do not duplicate)

Account: **Double AA Designs** (live)

- Product: Christmas App — `prod_VZII3mGQn6UXsL`
- Yearly price: $19.99 USD/year — `price_1UY9iFLxgEPijLi36KTDGZBa`
- Payment Link (live, active): https://buy.stripe.com/6oU6oIgB9dCm8Sy7BY4sE00
  (`plink_1UY9l7LxgEPijLi3lqaCVM5o`)

### How a payment unlocks an account

1. The signed-in customer taps **Subscribe — $19.99/year**. The app calls the
   Edge Function `giftmas-create-checkout` with the customer's Supabase
   session. Nothing in the request names a user or a price.
2. The function resolves the account from the session token, requires a
   confirmed email, checks the price is the $19.99 yearly price, and creates a
   Stripe Checkout Session stamped with that account's id.
3. Stripe sends signed events to `giftmas-stripe-webhook`, which records the
   subscription in `giftmas_subscriptions` for that account. Renewals, failed
   payments and cancellations update the same row. Each event is handled once
   (`giftmas_stripe_events`).
4. The app's access check (`giftmas_has_access`) sees the row and opens the
   tracker. A payment that cannot be matched to an account is written to
   `giftmas_payment_issues` and never unlocks anything.

The Payment Link above is no longer used by the app. The webhook still accepts
it, but only with a valid account reference and a matching email.

Sandbox copies (`giftmas-test-create-checkout`, `giftmas-test-stripe-webhook`,
`giftmas_test_subscriptions`, `giftmas_test_lists`) are used when the app is
built with `VITE_GIFTMAS_STRIPE_MODE=test`. Sandbox and live never share
keys, tables or entitlement.

Edge Function secrets (set in Supabase, never in Git or Vite):

- `GIFTMAS_STRIPE_SECRET_KEY`: live key, used by the live functions only.
- `GIFTMAS_STRIPE_TEST_SECRET_KEY`: sandbox key, used by the sandbox
  functions only. A key of the wrong mode is refused.
- `GIFTMAS_ALLOWED_ORIGINS` (optional): extra site addresses, comma separated,
  allowed as the return address after checkout.

Payment logic tests: `npm test`.

## Supabase connection

Organization: aadesigns. Project: Giftmas Tracker (`czuxtspeuvfcqxsxqmho`).

Accounts use Supabase Auth; passwords are no longer stored by the app. The
`public.gift_lists` table stores each user's list, including gift details and
photos. Row-level policies restrict reading and writing to the owning user.
Cloud lists load after login and edits save automatically. Failed loads block
editing; failed saves display an error and a retry button. Concurrent devices
use last-write-wins for the whole list; realtime merging is not implemented.

Older device-only accounts must register a real cloud account. After signing
in, use **Import my older list from this device** to copy a local list into the
new account. The original device data is retained. Import only on your own
trusted device, because legacy local storage was not protected authentication.

## Remaining launch checks

- Verify account confirmation and password-reset emails on the final deployed
  domain after configuring Supabase redirect URLs.
- Run the full sandbox purchase check, then the same check in live, before
  relying on the subscription gate (see docs/secure-checkout-draft.md).
- The gift helper remains the existing local rules-based helper.

Validation: production build, lint (warnings only), database insert/update and
cross-user isolation in a rolled-back transaction, and Supabase security advisors.
