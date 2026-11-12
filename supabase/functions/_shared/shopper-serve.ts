// Wires the AI Gift Shopper Helper (shopper-core.js) to the Edge Function
// runtime. The OpenAI key is the OPENAI_API_KEY function secret and never
// leaves the server. Live counts against the live subscription, the sandbox
// function against the Stripe sandbox one; each folder picks its mode.
// Self-contained on purpose (no payment code imported), so it deploys alone.
import { helperCore } from './shopper-core.js'

type Mode = 'live' | 'test'
const SITE = 'https://giftmastracker.com'
// Same addresses as the checkout functions (giftmas-core.ts SITE_ORIGINS).
const SITE_ORIGINS = [SITE, 'https://www.giftmastracker.com', 'https://giftmastracker.vercel.app']

function allowedOrigin(origin: string | null, mode: Mode): string {
  if (!origin) return SITE
  const extra = (Deno.env.get('GIFTMAS_ALLOWED_ORIGINS') ?? '').split(',').map((x) => x.trim()).filter(Boolean)
  if (SITE_ORIGINS.includes(origin) || extra.includes(origin)) return origin
  // The sandbox may also be driven from a local dev server or a Vercel preview.
  if (mode === 'test') {
    if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin
    if (/^https:\/\/[a-z0-9-]*gift-?mas[a-z0-9-]*\.vercel\.app$/i.test(origin)) return origin
  }
  return SITE
}

// OPENAI_API_KEY first; otherwise any secret whose name mentions OpenAI and
// whose value looks like an OpenAI key (the owner saved it under another name).
// Only secret NAMES are ever logged, never values.
let keyNote = ''
function openaiKey(): string {
  const direct = (Deno.env.get('OPENAI_API_KEY') ?? '').trim()
  if (direct) return direct
  let all: Record<string, string> = {}
  try { all = Deno.env.toObject() } catch { /* env listing not allowed */ }
  const names = Object.keys(all).filter((n) => /open_?ai/i.test(n))
  const hit = names.find((n) => /^sk-/.test((all[n] ?? '').trim()))
  const note = hit ? `using secret ${hit}` : `no OpenAI key found; OpenAI-like secret names: ${names.join(', ') || '(none)'}`
  if (note !== keyNote) { keyNote = note; console.log(`shopper-helper: ${note}`) }
  return hit ? all[hit].trim() : ''
}

export function serveShopperHelper(mode: Mode) {
  return {
    async fetch(req: Request) {
      const cors = {
        'access-control-allow-origin': allowedOrigin(req.headers.get('origin'), mode),
        'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
        'access-control-allow-methods': 'POST, OPTIONS',
        vary: 'Origin',
      }
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
      let body = null
      try { body = await req.json() } catch { /* answered as a bad request below */ }
      const result = await helperCore({
        method: req.method,
        authorization: req.headers.get('authorization') ?? '',
        body,
        env: {
          supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '',
          supabaseKey: Deno.env.get('SUPABASE_ANON_KEY') || req.headers.get('apikey') || '',
          openaiKey: openaiKey(),
          openaiModel: Deno.env.get('GIFTMAS_OPENAI_MODEL') ?? '',
          openaiBase: 'https://api.openai.com/v1',
          test: mode === 'test',
        },
      })
      return new Response(JSON.stringify(result.body), {
        status: result.status,
        headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' },
      })
    },
  }
}
