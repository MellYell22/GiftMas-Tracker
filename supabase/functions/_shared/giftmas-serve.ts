// Wires the shared GiftMas payment logic to the Edge Function runtime.
// Each function folder is a two-line entrypoint that picks live or sandbox.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import { allowedOrigin, CONFIG, handleCreateCheckout, handleWebhook, stripeClient } from './giftmas-core.ts'
import type { Mode } from './giftmas-core.ts'
import { supabaseStore } from './giftmas-store.ts'

const serviceClient = () =>
  createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

const extraOrigins = () =>
  (Deno.env.get('GIFTMAS_ALLOWED_ORIGINS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function serveWebhook(mode: Mode) {
  const config = CONFIG[mode]
  return {
    async fetch(req: Request) {
      const key = Deno.env.get(config.secretKeyEnv) ?? ''
      const usable = config.secretKeyPrefixes.some((prefix) => key.startsWith(prefix))
      const result = await handleWebhook(
        { method: req.method, body: await req.text(), signature: req.headers.get('stripe-signature') ?? '' },
        { store: supabaseStore(serviceClient(), config), config, stripe: usable ? stripeClient(key) : null })
      return new Response(result.body, { status: result.status, headers: { 'content-type': 'text/plain' } })
    },
  }
}

export function serveCreateCheckout(mode: Mode) {
  const config = CONFIG[mode]
  return {
    async fetch(req: Request) {
      const origin = req.headers.get('origin')
      const cors = {
        'access-control-allow-origin': allowedOrigin(origin, config, extraOrigins()) ?? config.siteUrl,
        'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
        vary: 'Origin',
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      const store = supabaseStore(serviceClient(), config)
      const result = await handleCreateCheckout(
        { method: req.method, authorization: req.headers.get('authorization'), origin },
        {
          store, config,
          userFromToken: store.userFromToken,
          secretKey: Deno.env.get(config.secretKeyEnv) ?? null,
          stripeFor: (key) => stripeClient(key),
          allowedOrigins: extraOrigins(),
        })
      return new Response(JSON.stringify(result.json), { status: result.status, headers: { ...cors, 'content-type': 'application/json' } })
    },
  }
}
