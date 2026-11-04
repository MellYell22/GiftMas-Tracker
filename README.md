# Christmas App — by AA Designs

A Christmas shopping app for people who shop a lot: add each person you're
shopping for, set a budget per person, and keep a simple gift list per person
showing what still needs to be bought, what's bought, and what's wrapped — so
nothing (and no matching piece, like the shirt that goes with the jeans) gets
forgotten.

**Price:** $19.99/year (Stripe subscription — see Stripe details below).

## Features

- Create account / sign in (client-side, per-device — see the honest note below)
- Add all your people first: name + budget, gifts later
- One simple line per gift: gift name, price, where bought, with four small
  checkboxes — To buy, Bought, Wrapped, Return
- Product link per gift ("View product") and a link/notes on each person,
  with small transparent "optional" labels on optional fields
- Gift photo via file picker (for people who'd rather show it than type it)
- Barcode number typed or pasted in (live camera scanning is not in this
  web version)
- Export PDF / Print and Share buttons (browser print / share sheet)
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

1. Import the GitHub repo `MellYell22/christmas-app` into Vercel.
2. Framework preset: **Vite**. Build command: `npm run build`. Output: `dist`.
3. No environment variables are needed for this version.

## Stripe (already set up — do not duplicate)

Account: **Double AA Designs** (live)

- Product: Christmas App — `prod_VZII3mGQn6UXsL`
- Yearly price: $19.99 USD/year — `price_1UY9iFLxgEPijLi36KTDGZBa`
- Payment Link (live, active): https://buy.stripe.com/6oU6oIgB9dCm8Sy7BY4sE00
  (`plink_1UY9l7LxgEPijLi3lqaCVM5o`)

The app's **Subscribe — $19.99/year** button links to that Payment Link.
Paying through the link creates the Stripe subscription; it does not by
itself unlock anything inside the app yet — account/payment wiring is a
later step (see below).

## Honest note about accounts

Sign-in in this version is **client-side only**: accounts and lists are
stored in the browser's local storage on that device, per account email.
That means:

- A person's list does **not** sync to their other devices yet.
- Passwords are not stored on a server and this is **not** production-grade
  security — do not reuse an important password here.

Real cloud accounts (a backend with a database, secure password hashing,
password reset, and checking Stripe subscriptions before unlocking the
yearly plan) are the next step before charging the public at scale.
