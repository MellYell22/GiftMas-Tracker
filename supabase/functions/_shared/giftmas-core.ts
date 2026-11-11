// GiftMas Tracker payment logic shared by the live and sandbox Edge Functions.
//
// This file has no Deno or npm imports on purpose: everything it needs (the
// database, Stripe, the clock) is passed in, so the same code runs in the Edge
// Functions and under `node --test` (see tests/giftmas-core.test.ts).
//
// No Stripe secret is committed to Git. Secrets are read by the entrypoints.

export type Mode = 'live' | 'test'

export interface GiftmasConfig {
  mode: Mode
  livemode: boolean
  // The original Payment Link. Sessions from it are still honoured, but only
  // when they carry a verified account reference and a matching email.
  paymentLinkId: string
  // Fixed price for live. In the sandbox the price is read from the sandbox
  // Payment Link so no second price can drift from the real offer.
  priceId: string | null
  secretKeyEnv: string
  secretKeyPrefixes: string[]
  // Where buyers land after checkout when the request names no allowed origin.
  siteUrl: string
  // Every address the real app is served from. The return address must be one
  // of these so the buyer comes back to the same site they are signed in on.
  siteOrigins: string[]
  subscriptionsTable: string
  signingSecretRpc: string
}

// The live app's addresses. www redirects to the bare domain on Vercel.
const SITE_ORIGINS = ['https://giftmastracker.com', 'https://www.giftmastracker.com', 'https://giftmastracker.vercel.app']

export const CONFIG: Record<Mode, GiftmasConfig> = {
  live: {
    mode: 'live',
    livemode: true,
    paymentLinkId: 'plink_1UY9l7LxgEPijLi3lqaCVM5o',
    priceId: 'price_1UY9iFLxgEPijLi36KTDGZBa',
    secretKeyEnv: 'GIFTMAS_STRIPE_SECRET_KEY',
    secretKeyPrefixes: ['sk_live_', 'rk_live_'],
    siteUrl: 'https://giftmastracker.com',
    siteOrigins: SITE_ORIGINS,
    subscriptionsTable: 'giftmas_subscriptions',
    signingSecretRpc: 'giftmas_webhook_signing_secret',
  },
  test: {
    mode: 'test',
    livemode: false,
    paymentLinkId: 'plink_1UYDKoQ2TONkYzgN8dAUVr0v',
    priceId: null,
    secretKeyEnv: 'GIFTMAS_STRIPE_TEST_SECRET_KEY',
    secretKeyPrefixes: ['sk_test_', 'rk_test_'],
    siteUrl: 'https://giftmastracker.com',
    siteOrigins: SITE_ORIGINS,
    subscriptionsTable: 'giftmas_test_subscriptions',
    signingSecretRpc: 'giftmas_test_webhook_signing_secret',
  },
}

// The one offer GiftMas sells. Checkout refuses to start for anything else.
export const PRICE_CENTS = 1999
export const PRICE_CURRENCY = 'usd'
export const PRICE_INTERVAL = 'year'
export const APP_TAG = 'giftmas'

export interface SubRow {
  user_id: string
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  status: string
  current_period_end: string | null
  last_stripe_event_created: number
}

export interface AccountUser { id: string; email: string | null; confirmed: boolean }

export interface PaymentIssue {
  reason: string
  livemode: boolean
  stripe_event_id: string | null
  stripe_event_type: string | null
  stripe_session_id: string | null
  stripe_customer_id: string | null
  stripe_subscription_id: string | null
  payer_email: string | null
  client_reference_id: string | null
  amount_total: number | null
  currency: string | null
}

export interface Store {
  signingSecret(): Promise<string | null>
  userById(id: string): Promise<AccountUser | null>
  eventProcessed(eventId: string): Promise<boolean>
  markEventProcessed(event: { id: string; type: string; created: number; livemode: boolean }): Promise<void>
  subByUser(userId: string): Promise<SubRow | null>
  subByStripeId(subscriptionId: string): Promise<SubRow | null>
  // Insert or replace the row for one user. Only the given fields change.
  upsertSub(row: Partial<SubRow> & { user_id: string }): Promise<void>
  // Update by Stripe subscription id, skipping rows that already saw a newer
  // event. Returns how many rows changed.
  updateSubByStripeId(subscriptionId: string, patch: Partial<SubRow>, eventCreated: number, opts?: { exceptCanceled?: boolean }): Promise<number>
  recordIssue(issue: PaymentIssue): Promise<boolean>
}

export type StripeCall = (method: 'GET' | 'POST', path: string, params?: Record<string, unknown>) => Promise<any>

export interface Reply { status: number; body: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ENTITLED = new Set(['active', 'trialing'])
const KNOWN_STATUSES = new Set(['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])
const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created', 'customer.subscription.updated', 'customer.subscription.deleted',
  'customer.subscription.paused', 'customer.subscription.resumed',
])
const encoder = new TextEncoder()

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

const asId = (value: unknown): string | null =>
  typeof value === 'string' ? value
    : value && typeof value === 'object' && typeof (value as any).id === 'string' ? (value as any).id
    : null

const toIso = (seconds: unknown): string | null =>
  typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null

// Newer Stripe API versions report the period on the subscription item.
const periodEnd = (sub: any): string | null =>
  toIso(sub?.current_period_end ?? sub?.items?.data?.[0]?.current_period_end)

export function hasEntitlement(row: SubRow | null, nowMs: number): boolean {
  if (!row || !ENTITLED.has(row.status)) return false
  return !row.current_period_end || Date.parse(row.current_period_end) > nowMs
}

export async function verifyStripeSignature(body: string, header: string, secret: string, nowMs = Date.now()): Promise<boolean> {
  const entries = header.split(',').map((part) => part.trim().split('='))
  const timestamp = entries.find((x) => x[0] === 't')?.[1]
  const signatures = entries.filter((x) => x[0] === 'v1').map((x) => x[1])
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)))
  return signatures.some((hex) => {
    if (!/^[0-9a-f]{64}$/i.test(hex ?? '')) return false
    const provided = new Uint8Array(hex.match(/.{2}/g)!.map((x) => parseInt(x, 16)))
    let diff = 0
    for (let n = 0; n < signed.length; n++) diff |= signed[n] ^ provided[n]
    return diff === 0
  })
}

export interface WebhookDeps {
  store: Store
  config: GiftmasConfig
  // Present only when a Stripe key is configured. Used to read the renewal date.
  stripe?: StripeCall | null
  now?: () => number
  log?: (...args: unknown[]) => void
}

export async function handleWebhook(input: { method: string; body: string; signature: string }, deps: WebhookDeps): Promise<Reply> {
  const { store, config } = deps
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args))
  const reply = (body: string, status = 200): Reply => ({ status, body })

  if (input.method !== 'POST') return reply('Method not allowed', 405)
  const secret = await store.signingSecret().catch(() => null)
  if (!secret) { log('Giftmas webhook signing secret unavailable'); return reply('Webhook not configured', 503) }
  if (!await verifyStripeSignature(input.body, input.signature, secret, now())) return reply('Invalid Stripe signature', 400)

  let event: any
  try { event = JSON.parse(input.body) } catch { return reply('Invalid event', 400) }
  const obj = event?.data?.object
  if (!obj || typeof event.id !== 'string' || typeof event.type !== 'string' || typeof event.created !== 'number') return reply('Invalid event', 400)
  // A sandbox event must never unlock a live account, and the reverse.
  if (event.livemode !== config.livemode) return reply(config.livemode ? 'Live events only' : 'Sandbox events only', 400)

  try {
    // Stripe delivers the same event more than once. The second copy stops here.
    if (await store.eventProcessed(event.id)) return reply('Duplicate event ignored')

    const issue = async (reason: string, session: any): Promise<Reply> => {
      const saved = await store.recordIssue({
        reason,
        livemode: config.livemode,
        stripe_event_id: event.id,
        stripe_event_type: event.type,
        stripe_session_id: asId(session?.id),
        stripe_customer_id: asId(session?.customer),
        stripe_subscription_id: asId(session?.subscription),
        payer_email: (session?.customer_details?.email || session?.customer_email || '').trim().toLowerCase() || null,
        client_reference_id: typeof session?.client_reference_id === 'string' ? session.client_reference_id : null,
        amount_total: typeof session?.amount_total === 'number' ? session.amount_total : null,
        currency: typeof session?.currency === 'string' ? session.currency : null,
      }).catch(() => false)
      log('Giftmas payment needs attention:', reason, event.id)
      // Once it is written down, 200 stops Stripe retrying something a retry cannot fix.
      if (saved) await store.markEventProcessed(event)
      return reply(saved ? 'Recorded for review' : reason, saved ? 200 : 422)
    }

    let outcome = 'ok'

    if (event.type === 'checkout.session.completed') {
      const serverCreated = obj.metadata?.app === APP_TAG
      if (!serverCreated && obj.payment_link !== config.paymentLinkId) return reply('Ignored')
      if (obj.mode !== 'subscription' || !['paid', 'no_payment_required'].includes(obj.payment_status)) return reply('Ignored')

      const uid = obj.client_reference_id
      const subscriptionId = asId(obj.subscription)
      const customerId = asId(obj.customer)
      const payerEmail = (obj.customer_details?.email || obj.customer_email || '').trim().toLowerCase()
      if (!isUuid(uid) || !subscriptionId || !customerId) return issue('Missing verified account reference', obj)
      // Sessions made by giftmas-create-checkout carry the id twice. They must agree.
      if (serverCreated && obj.metadata?.giftmas_user_id !== uid) return issue('Account reference does not match checkout', obj)

      const account = await store.userById(uid)
      if (!account || !account.confirmed) return issue('No verified account for this payment', obj)
      // A Payment Link takes its reference from the browser, so the payer's
      // email has to match the account too. Server-made sessions do not need
      // this: the account was authenticated before Stripe was ever called.
      if (!serverCreated && (!payerEmail || account.email?.toLowerCase() !== payerEmail)) {
        return issue('Payment email does not match verified account', obj)
      }

      const owner = await store.subByStripeId(subscriptionId)
      if (owner && owner.user_id !== uid) return issue('Subscription already belongs to another account', obj)

      const current = await store.subByUser(uid)
      if ((current?.last_stripe_event_created ?? 0) > event.created) {
        outcome = 'Ignored stale event'
      } else {
        const row: Partial<SubRow> & { user_id: string } = {
          user_id: uid, stripe_customer_id: customerId, stripe_subscription_id: subscriptionId,
          status: 'active', last_stripe_event_created: event.created,
        }
        // A different subscription than the one on file starts a new period.
        if (current && current.stripe_subscription_id !== subscriptionId) row.current_period_end = null
        if (deps.stripe) {
          try {
            const end = periodEnd(await deps.stripe('GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`))
            if (end) row.current_period_end = end
          } catch (err) { log('Giftmas could not read the renewal date', (err as Error)?.message) }
        }
        await store.upsertSub(row)
      }
    } else if (SUBSCRIPTION_EVENTS.has(event.type)) {
      const subscriptionId = asId(obj.id)
      if (!subscriptionId) return reply('Missing subscription', 422)
      const status = event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status
      if (!KNOWN_STATUSES.has(status)) return reply('Ignored status')
      const patch: Partial<SubRow> = { status, last_stripe_event_created: event.created, current_period_end: periodEnd(obj) }
      const changed = await store.updateSubByStripeId(subscriptionId, patch, event.created)
      // This Stripe account also sells other apps. Their subscriptions never
      // match a GiftMas row and are skipped quietly. A GiftMas subscription
      // that arrives before its own checkout event is linked from the account
      // id that giftmas-create-checkout stamped on it.
      const uid = obj.metadata?.giftmas_user_id
      if (!changed && obj.metadata?.app === APP_TAG && isUuid(uid) && ENTITLED.has(status)) {
        const known = await store.subByStripeId(subscriptionId)
        const current = await store.subByUser(uid)
        const account = known ? null : await store.userById(uid)
        const replacesLiveSub = current && current.stripe_subscription_id && current.stripe_subscription_id !== subscriptionId && hasEntitlement(current, now())
        if (!known && account?.confirmed && !replacesLiveSub && (current?.last_stripe_event_created ?? 0) <= event.created) {
          await store.upsertSub({ user_id: uid, stripe_customer_id: asId(obj.customer), stripe_subscription_id: subscriptionId, ...patch })
        }
      }
    } else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed') {
      const subscriptionId = asId(obj.subscription) ?? asId(obj.parent?.subscription_details?.subscription)
      if (!subscriptionId) return reply('Ignored invoice without subscription')
      const patch: Partial<SubRow> = { status: event.type === 'invoice.paid' ? 'active' : 'past_due', last_stripe_event_created: event.created }
      if (event.type === 'invoice.paid') {
        // A renewal pushes the access date forward.
        const end = toIso(Math.max(0, ...(obj.lines?.data ?? []).map((line: any) => Number(line?.period?.end) || 0)))
        if (end) patch.current_period_end = end
      }
      // A late invoice must not bring a cancelled subscription back to life.
      await store.updateSubByStripeId(subscriptionId, patch, event.created, { exceptCanceled: true })
    } else {
      return reply('Ignored')
    }

    await store.markEventProcessed(event)
    return reply(outcome)
  } catch (err) {
    // A real fault, not a mismatch: 500 asks Stripe to deliver this again.
    log('Giftmas Stripe webhook processing error', (err as Error)?.message ?? err)
    return reply('Processing failed', 500)
  }
}

// ---------------------------------------------------------------------------
// Checkout

export interface CheckoutDeps {
  store: Pick<Store, 'subByUser'>
  config: GiftmasConfig
  // Resolves the signed-in account from its Supabase access token. This is the
  // only source of the account id. Nothing in the request body is trusted.
  userFromToken(token: string): Promise<AccountUser | null>
  secretKey: string | null
  stripeFor(secretKey: string): StripeCall
  allowedOrigins?: string[]
  now?: () => number
  log?: (...args: unknown[]) => void
}

export interface JsonReply { status: number; json: Record<string, unknown> }

export function allowedOrigin(origin: string | null, config: GiftmasConfig, extra: string[] = []): string | null {
  if (!origin) return null
  if (origin === config.siteUrl || config.siteOrigins.includes(origin) || extra.includes(origin)) return origin
  // The sandbox may also be driven from a local dev server or a Vercel preview.
  if (config.mode === 'test') {
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
    if (/^https:\/\/[a-z0-9-]*gift-?mas[a-z0-9-]*\.vercel\.app$/i.test(origin)) return origin
  }
  return null
}

export async function resolvePrice(stripe: StripeCall, config: GiftmasConfig): Promise<string> {
  const price = config.priceId
    ? await stripe('GET', `/v1/prices/${config.priceId}`)
    : (await stripe('GET', `/v1/payment_links/${config.paymentLinkId}/line_items`, { limit: 1 }))?.data?.[0]?.price
  if (!price?.id || price.active === false || price.unit_amount !== PRICE_CENTS || price.currency !== PRICE_CURRENCY ||
      price.recurring?.interval !== PRICE_INTERVAL || (price.recurring?.interval_count ?? 1) !== 1 ||
      price.livemode !== config.livemode) {
    throw new Error('The GiftMas price is not the expected $19.99 yearly price')
  }
  return price.id
}

export async function handleCreateCheckout(input: { method: string; authorization: string | null; origin: string | null }, deps: CheckoutDeps): Promise<JsonReply> {
  const { config } = deps
  const now = deps.now ?? Date.now
  const log = deps.log ?? ((...args: unknown[]) => console.error(...args))
  const reply = (status: number, json: Record<string, unknown>): JsonReply => ({ status, json })

  if (input.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  const token = /^Bearer\s+(.+)$/i.exec(input.authorization ?? '')?.[1]?.trim()
  if (!token) return reply(401, { error: 'Sign in to subscribe.' })
  const user = await deps.userFromToken(token).catch(() => null)
  if (!user || !isUuid(user.id)) return reply(401, { error: 'Sign in to subscribe.' })
  if (!user.confirmed || !user.email) return reply(403, { error: 'Confirm your email before subscribing.' })

  try {
    const current = await deps.store.subByUser(user.id)
    // Never charge an account twice for the same plan.
    if (hasEntitlement(current, now())) return reply(200, { alreadySubscribed: true })

    const key = deps.secretKey
    if (!key || !config.secretKeyPrefixes.some((prefix) => key.startsWith(prefix))) {
      log(`Giftmas checkout is not configured: ${config.secretKeyEnv} is missing or is not a ${config.mode} key`)
      return reply(503, { error: 'Checkout is not available right now. Please try again later.' })
    }
    const stripe = deps.stripeFor(key)
    const priceId = await resolvePrice(stripe, config)
    const base = allowedOrigin(input.origin, config, deps.allowedOrigins) ?? config.siteUrl
    const tags = { app: APP_TAG, giftmas_user_id: user.id }
    const params: Record<string, unknown> = {
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: user.id,
      metadata: tags,
      subscription_data: { metadata: tags },
      success_url: `${base}/?checkout=success`,
      cancel_url: `${base}/?checkout=cancelled`,
    }
    // Reuse the Stripe customer on file so a returning subscriber keeps one record.
    if (current?.stripe_customer_id) params.customer = current.stripe_customer_id
    else params.customer_email = user.email

    const session = await stripe('POST', '/v1/checkout/sessions', params)
    if (typeof session?.url !== 'string' || session.livemode !== config.livemode) throw new Error('Stripe did not return a checkout page')
    return reply(200, { url: session.url })
  } catch (err) {
    log('Giftmas checkout could not be started', (err as Error)?.message ?? err)
    return reply(502, { error: 'Could not start checkout. Please try again.' })
  }
}

// Stripe takes form-encoded bodies with bracketed keys for nested values.
export function formEncode(params: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue
    const name = prefix ? `${prefix}[${key}]` : key
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        if (item && typeof item === 'object') out.push(...formEncode(item as Record<string, unknown>, `${name}[${index}]`))
        else out.push(`${encodeURIComponent(`${name}[${index}]`)}=${encodeURIComponent(String(item))}`)
      })
    } else if (typeof value === 'object') {
      out.push(...formEncode(value as Record<string, unknown>, name))
    } else {
      out.push(`${encodeURIComponent(name)}=${encodeURIComponent(String(value))}`)
    }
  }
  return out
}

export function stripeClient(secretKey: string, fetchImpl: typeof fetch = fetch): StripeCall {
  return async (method, path, params) => {
    const query = params ? formEncode(params).join('&') : ''
    const url = 'https://api.stripe.com' + path + (method === 'GET' && query ? `?${query}` : '')
    const res = await fetchImpl(url, {
      method,
      headers: { authorization: `Bearer ${secretKey}`, ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: method === 'POST' ? query : undefined,
    })
    const data = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`Stripe ${method} ${path} failed: ${res.status} ${data?.error?.code ?? data?.error?.type ?? ''}`.trim())
    return data
  }
}
