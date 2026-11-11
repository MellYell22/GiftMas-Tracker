// Run with: npm test   (Node 22.18+ runs TypeScript directly)
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { allowedOrigin, CONFIG, formEncode, handleCreateCheckout, handleWebhook, hasEntitlement } from '../supabase/functions/_shared/giftmas-core.ts'
import type { AccountUser, PaymentIssue, Store, SubRow } from '../supabase/functions/_shared/giftmas-core.ts'

const SECRET = 'whsec_unit_test_only'
const ALICE = '11111111-1111-4111-8111-111111111111'
const BOB = '22222222-2222-4222-8222-222222222222'
const NOW = 1_800_000_000_000
const T = NOW / 1000
const YEAR = 365 * 24 * 3600
const config = CONFIG.test

function memoryStore(users: AccountUser[]) {
  const subs = new Map<string, SubRow>()
  const events = new Set<string>()
  const issues: PaymentIssue[] = []
  const store: Store = {
    async signingSecret() { return SECRET },
    async userById(id) { return users.find((u) => u.id === id) ?? null },
    async eventProcessed(id) { return events.has(id) },
    async markEventProcessed(event) { events.add(event.id) },
    async subByUser(id) { return subs.get(id) ?? null },
    async subByStripeId(id) { return [...subs.values()].find((r) => r.stripe_subscription_id === id) ?? null },
    async upsertSub(row) {
      const base: SubRow = subs.get(row.user_id) ?? { user_id: row.user_id, stripe_customer_id: null, stripe_subscription_id: null, status: 'inactive', current_period_end: null, last_stripe_event_created: 0 }
      subs.set(row.user_id, { ...base, ...row })
    },
    async updateSubByStripeId(id, patch, created, opts) {
      let n = 0
      for (const [uid, row] of subs) {
        if (row.stripe_subscription_id !== id || row.last_stripe_event_created > created) continue
        if (opts?.exceptCanceled && row.status === 'canceled') continue
        subs.set(uid, { ...row, ...patch }); n++
      }
      return n
    },
    async recordIssue(issue) { issues.push(issue); return true },
  }
  return { store, subs, events, issues }
}

const users = (): AccountUser[] => [
  { id: ALICE, email: 'alice@example.com', confirmed: true },
  { id: BOB, email: 'bob@example.com', confirmed: true },
]

let seq = 0
const evt = (type: string, object: any, extra: any = {}) => ({ id: `evt_${++seq}`, type, created: T, livemode: false, data: { object }, ...extra })
const session = (uid: string | null, over: any = {}) => ({
  id: 'cs_test_1', mode: 'subscription', payment_status: 'paid', client_reference_id: uid,
  subscription: 'sub_1', customer: 'cus_1', amount_total: 1999, currency: 'usd',
  customer_details: { email: 'alice@example.com' },
  metadata: uid ? { app: 'giftmas', giftmas_user_id: uid } : {}, ...over,
})
const subscription = (over: any = {}) => ({ id: 'sub_1', customer: 'cus_1', status: 'active', items: { data: [{ current_period_end: T + YEAR }] }, metadata: { app: 'giftmas', giftmas_user_id: ALICE }, ...over })

async function send(store: Store, event: any, opts: { secret?: string; at?: number } = {}) {
  const body = JSON.stringify(event)
  const t = Math.floor((opts.at ?? NOW) / 1000)
  const sig = createHmac('sha256', opts.secret ?? SECRET).update(`${t}.${body}`).digest('hex')
  return handleWebhook({ method: 'POST', body, signature: `t=${t},v1=${sig}` }, { store, config, now: () => NOW, log: () => {} })
}

test('paid checkout unlocks the signed-in account and nobody else', async () => {
  const m = memoryStore(users())
  const r = await send(m.store, evt('checkout.session.completed', session(ALICE)))
  assert.equal(r.status, 200)
  assert.equal(m.subs.get(ALICE)?.status, 'active')
  assert.equal(m.subs.get(ALICE)?.stripe_subscription_id, 'sub_1')
  assert.equal(m.subs.get(ALICE)?.stripe_customer_id, 'cus_1')
  assert.ok(hasEntitlement(m.subs.get(ALICE)!, NOW))
  assert.equal(m.subs.has(BOB), false)
  assert.ok(!hasEntitlement(m.subs.get(BOB) ?? null, NOW))
})

test('bad or stale signature is rejected and writes nothing', async () => {
  const m = memoryStore(users())
  assert.equal((await send(m.store, evt('checkout.session.completed', session(ALICE)), { secret: 'whsec_wrong' })).status, 400)
  assert.equal((await send(m.store, evt('checkout.session.completed', session(ALICE)), { at: NOW - 3_600_000 })).status, 400)
  assert.equal(m.subs.size, 0)
})

test('live event is refused by the sandbox function', async () => {
  const m = memoryStore(users())
  assert.equal((await send(m.store, evt('checkout.session.completed', session(ALICE), { livemode: true }))).status, 400)
  assert.equal(m.subs.size, 0)
})

test('duplicate delivery changes nothing the second time', async () => {
  const m = memoryStore(users())
  const event = evt('checkout.session.completed', session(ALICE))
  await send(m.store, event)
  const before = JSON.stringify([...m.subs])
  const again = await send(m.store, event)
  assert.equal(again.status, 200)
  assert.equal(again.body, 'Duplicate event ignored')
  assert.equal(JSON.stringify([...m.subs]), before)
  assert.equal(m.subs.size, 1)
})

test('payment with no account reference is recorded for review, not granted', async () => {
  const m = memoryStore(users())
  const r = await send(m.store, evt('checkout.session.completed', session(null, { payment_link: config.paymentLinkId })))
  assert.equal(r.status, 200)
  assert.equal(m.subs.size, 0)
  assert.equal(m.issues[0].reason, 'Missing verified account reference')
  assert.equal(m.issues[0].livemode, false)
})

test('a tampered reference cannot unlock another account', async () => {
  const m = memoryStore(users())
  // Server-made session whose reference was swapped to Bob.
  await send(m.store, evt('checkout.session.completed', session(ALICE, { client_reference_id: BOB })))
  // Payment Link with Bob's id in the URL but Alice's email on the payment.
  await send(m.store, evt('checkout.session.completed', session(BOB, { metadata: {}, payment_link: config.paymentLinkId })))
  assert.equal(m.subs.size, 0)
  assert.deepEqual(m.issues.map((i) => i.reason), ['Account reference does not match checkout', 'Payment email does not match verified account'])
})

test('one subscription cannot be claimed by a second account', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  await send(m.store, evt('checkout.session.completed', session(BOB, { customer_details: { email: 'bob@example.com' } })))
  assert.equal(m.subs.has(BOB), false)
  assert.equal(m.issues.at(-1)?.reason, 'Subscription already belongs to another account')
})

test('unconfirmed or unknown account is not unlocked', async () => {
  const m = memoryStore([{ id: ALICE, email: 'alice@example.com', confirmed: false }])
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  await send(m.store, evt('checkout.session.completed', session(BOB)))
  assert.equal(m.subs.size, 0)
  assert.equal(m.issues.length, 2)
})

test('unrelated checkout on the same Stripe account is ignored', async () => {
  const m = memoryStore(users())
  const r = await send(m.store, evt('checkout.session.completed', session(ALICE, { metadata: {}, payment_link: 'plink_other_app' })))
  assert.equal(r.body, 'Ignored')
  assert.equal(m.subs.size + m.issues.length, 0)
})

test('failed renewal locks, a paid retry unlocks and extends the date', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  await send(m.store, evt('invoice.payment_failed', { subscription: 'sub_1' }, { created: T + 10 }))
  assert.equal(m.subs.get(ALICE)?.status, 'past_due')
  assert.ok(!hasEntitlement(m.subs.get(ALICE)!, NOW))
  await send(m.store, evt('invoice.paid', { parent: { subscription_details: { subscription: 'sub_1' } }, lines: { data: [{ period: { end: T + 2 * YEAR } }] } }, { created: T + 20 }))
  assert.equal(m.subs.get(ALICE)?.status, 'active')
  assert.equal(m.subs.get(ALICE)?.current_period_end, new Date((T + 2 * YEAR) * 1000).toISOString())
})

test('cancellation locks and a late invoice cannot undo it', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  // Cancel at period end: still active until the period really ends.
  await send(m.store, evt('customer.subscription.updated', subscription({ cancel_at_period_end: true }), { created: T + 5 }))
  assert.ok(hasEntitlement(m.subs.get(ALICE)!, NOW))
  assert.ok(!hasEntitlement(m.subs.get(ALICE)!, NOW + (YEAR + 1) * 1000))
  await send(m.store, evt('customer.subscription.deleted', subscription({ status: 'canceled' }), { created: T + 10 }))
  assert.equal(m.subs.get(ALICE)?.status, 'canceled')
  await send(m.store, evt('invoice.paid', { subscription: 'sub_1' }, { created: T + 20 }))
  assert.equal(m.subs.get(ALICE)?.status, 'canceled')
  assert.ok(!hasEntitlement(m.subs.get(ALICE)!, NOW))
})

test('an older event arriving late does not overwrite newer state', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  await send(m.store, evt('customer.subscription.deleted', subscription(), { created: T + 50 }))
  await send(m.store, evt('customer.subscription.updated', subscription(), { created: T + 5 }))
  assert.equal(m.subs.get(ALICE)?.status, 'canceled')
})

test('subscription event that beats the checkout event still links the right account', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('customer.subscription.created', subscription()))
  assert.equal(m.subs.get(ALICE)?.status, 'active')
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  assert.equal(m.subs.size, 1)
  assert.equal(m.subs.get(ALICE)?.current_period_end, new Date((T + YEAR) * 1000).toISOString())
})

test("another app's subscription events never create a GiftMas row", async () => {
  const m = memoryStore(users())
  await send(m.store, evt('customer.subscription.updated', subscription({ id: 'sub_bible', metadata: {} })))
  await send(m.store, evt('invoice.paid', { subscription: 'sub_bible' }))
  assert.equal(m.subs.size, 0)
})

// --- checkout -------------------------------------------------------------

const price = { id: 'price_test', active: true, unit_amount: 1999, currency: 'usd', livemode: false, recurring: { interval: 'year', interval_count: 1 } }
function checkout(over: any = {}) {
  const calls: any[] = []
  const m = over.memory ?? memoryStore(users())
  const deps = {
    store: m.store, config, now: () => NOW, log: () => {},
    userFromToken: async (token: string) => token === 'alice-token' ? users()[0] : token === 'unconfirmed' ? { id: BOB, email: 'bob@example.com', confirmed: false } : null,
    secretKey: 'sk_test_unit',
    stripeFor: () => async (method: string, path: string, params: any) => {
      calls.push({ method, path, params })
      if (path.includes('line_items')) return { data: [{ price: over.price ?? price }] }
      return { url: 'https://checkout.stripe.com/c/pay/cs_test_1', livemode: false }
    },
    ...over.deps,
  }
  const run = (authorization: string | null, origin: string | null = 'http://localhost:5173') =>
    handleCreateCheckout({ method: 'POST', authorization, origin }, deps as any)
  return { run, calls, m }
}

test('checkout is created for the authenticated account only', async () => {
  const c = checkout()
  const r = await c.run('Bearer alice-token')
  assert.equal(r.status, 200)
  assert.match(String(r.json.url), /^https:\/\/checkout\.stripe\.com\//)
  const params = c.calls.at(-1).params
  assert.equal(params.client_reference_id, ALICE)
  assert.deepEqual(params.metadata, { app: 'giftmas', giftmas_user_id: ALICE })
  assert.deepEqual(params.subscription_data.metadata, { app: 'giftmas', giftmas_user_id: ALICE })
  assert.deepEqual(params.line_items, [{ price: 'price_test', quantity: 1 }])
  assert.equal(params.customer_email, 'alice@example.com')
  assert.equal(params.success_url, 'http://localhost:5173/?checkout=success')
})

test('checkout refuses anonymous, invalid and unconfirmed callers', async () => {
  const c = checkout()
  assert.equal((await c.run(null)).status, 401)
  assert.equal((await c.run('Bearer forged')).status, 401)
  assert.equal((await c.run('Bearer unconfirmed')).status, 403)
  assert.equal(c.calls.length, 0)
})

test('checkout will not charge an account that is already subscribed', async () => {
  const m = memoryStore(users())
  await send(m.store, evt('checkout.session.completed', session(ALICE)))
  const c = checkout({ memory: m })
  assert.deepEqual((await c.run('Bearer alice-token')).json, { alreadySubscribed: true })
  assert.equal(c.calls.length, 0)
})

test('checkout refuses a wrong price, a live key in the sandbox, or a missing key', async () => {
  assert.equal((await checkout({ price: { ...price, unit_amount: 999 } }).run('Bearer alice-token')).status, 502)
  assert.equal((await checkout({ price: { ...price, livemode: true } }).run('Bearer alice-token')).status, 502)
  assert.equal((await checkout({ deps: { secretKey: 'sk_live_oops' } }).run('Bearer alice-token')).status, 503)
  assert.equal((await checkout({ deps: { secretKey: null } }).run('Bearer alice-token')).status, 503)
})

test('an unknown origin cannot steer the return address', async () => {
  const c = checkout()
  await c.run('Bearer alice-token', 'https://evil.example')
  assert.equal(c.calls.at(-1).params.success_url, `${config.siteUrl}/?checkout=success`)
})

test('buyers return to the site they started on, including giftmastracker.com', async () => {
  for (const origin of ['https://giftmastracker.com', 'https://www.giftmastracker.com', 'https://giftmastracker.vercel.app']) {
    const c = checkout()
    await c.run('Bearer alice-token', origin)
    assert.equal(c.calls.at(-1).params.success_url, `${origin}/?checkout=success`)
    assert.equal(c.calls.at(-1).params.cancel_url, `${origin}/?checkout=cancelled`)
  }
  assert.equal(allowedOrigin('https://giftmastracker.com', CONFIG.live), 'https://giftmastracker.com')
  assert.equal(CONFIG.live.siteUrl, 'https://giftmastracker.com')
  // Previews and localhost may use the sandbox only, never live.
  assert.equal(allowedOrigin('https://giftmastracker-abc123-team.vercel.app', CONFIG.live), null)
  assert.equal(allowedOrigin('http://localhost:5173', CONFIG.live), null)
  assert.equal(allowedOrigin('https://giftmastracker-abc123-team.vercel.app', CONFIG.test), 'https://giftmastracker-abc123-team.vercel.app')
})

test('form encoding matches what Stripe expects', () => {
  assert.deepEqual(formEncode({ mode: 'subscription', line_items: [{ price: 'p', quantity: 1 }], metadata: { app: 'giftmas' } }),
    ['mode=subscription', 'line_items%5B0%5D%5Bprice%5D=p', 'line_items%5B0%5D%5Bquantity%5D=1', 'metadata%5Bapp%5D=giftmas'])
})
