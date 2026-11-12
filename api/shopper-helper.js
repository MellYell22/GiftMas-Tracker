// AI Gift Shopper Helper — server side only (Vercel Function).
//
// The browser sends the signed-in user's Supabase token, the chosen person
// (name, budget, spent, gifts, notes) and the chat so far. This route:
//   1. asks Supabase to count the question (free = 3 total, subscribers and
//      owner accounts unlimited, everyone rate limited) — giftmas_helper_take,
//   2. calls OpenAI with OPENAI_API_KEY (never sent to the browser),
//   3. gives the question back if the AI call fails — giftmas_helper_refund.
//
// Live vs sandbox: the production deployment counts against the live
// subscription, every other deployment against the Stripe sandbox one,
// decided here from VERCEL_ENV, never from anything the browser sends.

import { helperCore } from './_lib/shopper-core.js'

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://czuxtspeuvfcqxsxqmho.supabase.co'
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_CesTjgyG0uWQtNmHsVFB7w_H14P7JIk'

export default async function handler(req, res) {
  const result = await helperCore({
    method: req.method,
    authorization: req.headers.authorization || '',
    body: typeof req.body === 'string' ? safeJson(req.body) : req.body,
    env: {
      supabaseUrl: SUPABASE_URL,
      supabaseKey: SUPABASE_KEY,
      openaiKey: process.env.OPENAI_API_KEY || '',
      openaiModel: process.env.OPENAI_MODEL || '',
      openaiBase: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      test: process.env.VERCEL_ENV !== 'production',
    },
  })
  res.setHeader('Cache-Control', 'no-store')
  res.status(result.status).json(result.body)
}

function safeJson(text) {
  try { return JSON.parse(text) } catch { return null }
}
