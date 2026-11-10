// GiftMas Tracker: live signed Stripe webhook. Logic lives in ../_shared so live and sandbox cannot drift.
import { serveWebhook } from '../_shared/giftmas-serve.ts'

export default serveWebhook('live')
