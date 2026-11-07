// Giftmas Tracker: signed Stripe webhook. No Stripe secret is committed to Git.
// The Stripe signing secret is stored in Supabase Vault and is returned only
// to the service role by giftmas_webhook_signing_secret().
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'

const PAYMENT_LINK_ID = 'plink_1UY9l7LxgEPijLi3lqaCVM5o'
const encoder = new TextEncoder()
const allowedStatuses = new Set(['active', 'trialing', 'past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])
const response = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/plain' } })
const asId = (value: unknown): string | null => typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : null
const periodEnd = (data: any): string | null => {
  const seconds = data?.current_period_end ?? data?.items?.data?.[0]?.current_period_end
  return typeof seconds === 'number' && seconds > 0 ? new Date(seconds * 1000).toISOString() : null
}
async function verifyStripeSignature(body: string, header: string, secret: string) {
  const entries = header.split(',').map(x => x.trim().split('='))
  const timestamp = entries.find(x => x[0] === 't')?.[1]
  const signatures = entries.filter(x => x[0] === 'v1').map(x => x[1])
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(timestamp + '.' + body)))
  return signatures.some(hex => {
    if (!/^[0-9a-f]{64}$/i.test(hex)) return false
    const provided = new Uint8Array(hex.match(/.{2}/g)!.map(x => parseInt(x, 16)))
    let diff = 0
    for (let n = 0; n < signed.length; n++) diff |= signed[n] ^ provided[n]
    return diff === 0
  })
}

export default {
  async fetch(req: Request) {
    if (req.method !== 'POST') return response('Method not allowed', 405)
    const body = await req.text()
    const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const { data: signingSecret, error: secretError } = await db.rpc('giftmas_webhook_signing_secret')
    if (secretError || !signingSecret) {
      console.error('Giftmas webhook signing secret unavailable', secretError?.message)
      return response('Webhook not configured', 503)
    }
    if (!await verifyStripeSignature(body, req.headers.get('stripe-signature') ?? '', signingSecret)) {
      return response('Invalid Stripe signature', 400)
    }

    try {
      const event = JSON.parse(body)
      const obj = event.data?.object
      if (!obj || typeof event.created !== 'number') return response('Invalid event', 400)
      if (event.type === 'checkout.session.completed') {
        if (obj.payment_link !== PAYMENT_LINK_ID || obj.mode !== 'subscription' ||
            !['paid', 'no_payment_required'].includes(obj.payment_status)) return response('Ignored')
        const uid = obj.client_reference_id
        const stripeSubscriptionId = asId(obj.subscription)
        const stripeCustomerId = asId(obj.customer)
        const payerEmail = (obj.customer_details?.email || obj.customer_email || '').trim().toLowerCase()
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uid ?? '') ||
            !stripeSubscriptionId || !stripeCustomerId || !payerEmail) return response('Missing verified account reference', 422)
        const { data: account, error: accountError } = await db.auth.admin.getUserById(uid)
        if (accountError || !account?.user || !account.user.email_confirmed_at ||
            account.user.email?.toLowerCase() !== payerEmail) return response('Payment email does not match verified account', 422)
        const { data: current, error: lookupError } = await db.from('giftmas_subscriptions')
          .select('last_stripe_event_created').eq('user_id', uid).maybeSingle()
        if (lookupError) throw lookupError
        if ((current?.last_stripe_event_created ?? 0) > event.created) return response('Ignored stale event')
        const { error } = await db.from('giftmas_subscriptions').upsert({
          user_id: uid, stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId, status: 'active',
          last_stripe_event_created: event.created, updated_at: new Date().toISOString()
        }, { onConflict: 'user_id' })
        if (error) throw error
      } else if (['customer.subscription.updated', 'customer.subscription.deleted', 'customer.subscription.paused', 'customer.subscription.resumed'].includes(event.type)) {
        const subscriptionId = asId(obj.id)
        if (!subscriptionId) return response('Missing subscription', 422)
        const status = event.type === 'customer.subscription.deleted' ? 'canceled' : obj.status
        if (!allowedStatuses.has(status)) return response('Ignored status')
        const patch: Record<string, unknown> = {
          status, last_stripe_event_created: event.created,
          current_period_end: periodEnd(obj), updated_at: new Date().toISOString()
        }
        const { error } = await db.from('giftmas_subscriptions').update(patch)
          .eq('stripe_subscription_id', subscriptionId).lte('last_stripe_event_created', event.created)
        if (error) throw error
      } else if (['invoice.paid', 'invoice.payment_failed'].includes(event.type)) {
        const subscriptionId = asId(obj.subscription) ?? asId(obj.parent?.subscription_details?.subscription)
        if (!subscriptionId) return response('Ignored invoice without subscription')
        const { error } = await db.from('giftmas_subscriptions').update({
          status: event.type === 'invoice.paid' ? 'active' : 'past_due',
          last_stripe_event_created: event.created, updated_at: new Date().toISOString()
        }).eq('stripe_subscription_id', subscriptionId).lte('last_stripe_event_created', event.created)
        if (error) throw error
      }
      return response('ok')
    } catch (err) {
      console.error('Giftmas Stripe webhook processing error', err)
      return response('Processing failed', 500)
    }
  }
}
