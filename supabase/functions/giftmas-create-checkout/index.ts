// GiftMas Tracker: live account-linked Stripe Checkout. Logic lives in ../_shared so live and sandbox cannot drift.
import { serveCreateCheckout } from '../_shared/giftmas-serve.ts'

export default serveCreateCheckout('live')
