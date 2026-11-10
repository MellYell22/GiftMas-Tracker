// Supabase-backed storage for the GiftMas payment functions.
// Uses the service role, which bypasses row level security, so it is only
// ever created inside an Edge Function. A database error throws, which makes
// the webhook answer 500 so Stripe delivers the event again.
import type { AccountUser, GiftmasConfig, Store, SubRow } from './giftmas-core.ts'

const COLUMNS = 'user_id,stripe_customer_id,stripe_subscription_id,status,current_period_end,last_stripe_event_created'

const toAccount = (user: any): AccountUser | null =>
  user?.id ? { id: user.id, email: user.email ?? null, confirmed: !!user.email_confirmed_at } : null

export function supabaseStore(db: any, config: GiftmasConfig): Store & { userFromToken(token: string): Promise<AccountUser | null> } {
  const subs = () => db.from(config.subscriptionsTable)
  const stamp = () => new Date().toISOString()
  return {
    async signingSecret() {
      const { data, error } = await db.rpc(config.signingSecretRpc)
      if (error) throw error
      return typeof data === 'string' && data ? data : null
    },
    async userById(id) {
      const { data, error } = await db.auth.admin.getUserById(id)
      // "No such user" is an answer, not a fault.
      if (error) { if (error.status === 404 || /not found/i.test(error.message ?? '')) return null; throw error }
      return toAccount(data?.user)
    },
    async userFromToken(token) {
      const { data, error } = await db.auth.getUser(token)
      return error ? null : toAccount(data?.user)
    },
    async eventProcessed(eventId) {
      const { data, error } = await db.from('giftmas_stripe_events').select('event_id').eq('event_id', eventId).maybeSingle()
      if (error) throw error
      return !!data
    },
    async markEventProcessed(event) {
      const { error } = await db.from('giftmas_stripe_events').upsert(
        { event_id: event.id, event_type: event.type, event_created: event.created, livemode: event.livemode },
        { onConflict: 'event_id', ignoreDuplicates: true })
      if (error) throw error
    },
    async subByUser(userId) {
      const { data, error } = await subs().select(COLUMNS).eq('user_id', userId).maybeSingle()
      if (error) throw error
      return (data as SubRow) ?? null
    },
    async subByStripeId(subscriptionId) {
      const { data, error } = await subs().select(COLUMNS).eq('stripe_subscription_id', subscriptionId).maybeSingle()
      if (error) throw error
      return (data as SubRow) ?? null
    },
    async upsertSub(row) {
      const { error } = await subs().upsert({ ...row, updated_at: stamp() }, { onConflict: 'user_id' })
      if (error) throw error
    },
    async updateSubByStripeId(subscriptionId, patch, eventCreated, opts) {
      let query = subs().update({ ...patch, updated_at: stamp() })
        .eq('stripe_subscription_id', subscriptionId).lte('last_stripe_event_created', eventCreated)
      if (opts?.exceptCanceled) query = query.neq('status', 'canceled')
      const { data, error } = await query.select('user_id')
      if (error) throw error
      return data?.length ?? 0
    },
    async recordIssue(issue) {
      const { error } = await db.from('giftmas_payment_issues').upsert(issue, { onConflict: 'stripe_event_id', ignoreDuplicates: true })
      if (error) throw error
      return true
    },
  }
}
