# GiftMas secure checkout — draft implementation plan

Status: DRAFT ONLY. Do not merge or deploy until owner preview and end-to-end sandbox verification.

## Verified source behavior
- The React app currently opens a static Stripe Payment Link with `client_reference_id` and `locked_prefilled_email` query parameters.
- The sandbox webhook requires a verified Supabase user UUID in `checkout.session.completed.client_reference_id` and a matching verified email.
- A standalone test Payment Link opened without the app's signed-in context will not supply the required account reference. The successful sandbox charge alone does not establish an app unlock.
- The app's `giftmas_has_access` RPC is the access gate. Do not grant access from browser redirect parameters.

## Implementation
1. Add a Supabase Edge Function `giftmas-create-checkout` with JWT verification, accepting no arbitrary user ID or price from the browser.
2. Resolve the authenticated user from the Supabase access token; require a confirmed email.
3. Use the server-side Stripe secret for the correct environment to create a subscription Checkout Session with the GiftMas annual price, `client_reference_id=user.id`, `customer_email=user.email`, and subscription metadata containing the user ID. Set safe success/cancel URLs.
4. Return only the hosted Stripe Checkout URL to the client. Never expose the Stripe secret to Vite/browser.
5. Change only the subscribe action in `src/App.jsx` to request that session, then open the returned URL. Preserve the entire GiftMas layout, gift logic, AI helper, and owner access.
6. Verify the sandbox webhook signs, accepts and stores the completed session in `giftmas_test_subscriptions`, and verify sandbox access independently without changing live entitlement.
7. After owner preview and approval, repeat the equivalent checks in live configuration, including webhook event delivery, subscription creation and cancellation.
8. Keep the mother's free access and existing owner rules unchanged. Do not touch David's voice or the Bible app.

## Acceptance checks
- Checkout cannot be created for another user's UUID.
- Payment succeeds with test card; no real charge.
- Stripe session includes the verified signed-in user's UUID.
- Sandbox webhook returns success and creates the correct subscription row.
- Test entitlement is verified for the correct user; a different user stays locked.
- Missing reference and email mismatch are logged, not silently granted.
- Live settings remain untouched until separately approved.

## Important
The sandbox and live Stripe accounts use different secrets, prices, and webhook endpoints. Never swap them blindly. A new edge function needs an authenticated deployment and Stripe secret configuration before an actual sandbox end-to-end test is possible.

## Implementation status (2026-11-10)

Root cause, confirmed from the Supabase function logs: Stripe's sandbox delivered
the paid `checkout.session.completed` event to `giftmas-test-stripe-webhook`
with a valid signature, and the function answered 422 because the session had
no account reference. Nothing was stored, so nothing unlocked.

Implemented on this branch (not deployed):
- `supabase/functions/_shared/giftmas-core.ts`: checkout and webhook logic.
- `supabase/functions/_shared/giftmas-store.ts`, `giftmas-serve.ts`: database and runtime wiring.
- Four entrypoints: `giftmas-create-checkout`, `giftmas-test-create-checkout`,
  `giftmas-stripe-webhook`, `giftmas-test-stripe-webhook`.
- `supabase/migrations/20261110150000_giftmas_account_linked_checkout.sql` (additive).
- `src/App.jsx`: the Subscribe button requests a server-made checkout page.
- `tests/giftmas-core.test.ts`: 20 tests, all passing.

Still required before launch: deploy the sandbox functions and migration, set
`GIFTMAS_STRIPE_TEST_SECRET_KEY`, and run the real sandbox purchase end to end.

## Update (2026-11-11)

- Return address fixed. The live site is giftmastracker.com, but checkout only
  knew giftmastracker.vercel.app. From the real domain, the browser would have
  refused the checkout reply, and a buyer would have come back to a different
  address where they are not signed in. Both functions now accept
  giftmastracker.com, www.giftmastracker.com and giftmastracker.vercel.app, and
  send the buyer back to the one they started on.
- Previews are sandbox automatically. Any address other than the three live
  ones (a Vercel preview, localhost) uses the Stripe sandbox copies, with a
  small "Test mode" note on screen. VITE_GIFTMAS_STRIPE_MODE still overrides.
- After paying, the buyer sees "Your payment went through. Unlocking your
  yearly plan now…" while the app checks every 2.5 seconds.
- giftmas-test-create-checkout redeployed with this code (sandbox only).
- Still to do before live: deploy giftmas-create-checkout and the new
  giftmas-stripe-webhook, confirm GIFTMAS_STRIPE_SECRET_KEY is set, merge.
