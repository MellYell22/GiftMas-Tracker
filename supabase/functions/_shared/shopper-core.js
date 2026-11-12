// The AI Gift Shopper Helper's logic, kept free of runtime specifics so the
// tests can run it with fake Supabase and OpenAI servers.

// Cheapest first (Nov 2026 prices): GPT-6 Luna, then the next-cheapest as backups
// in case this key can't use it. GIFTMAS_OPENAI_MODEL overrides the first choice.
export const MODELS = ['gpt-6-luna', 'gpt-5.4-nano', 'gpt-4.1-nano']
const MAX_TURNS = 20 // past messages sent to the AI each time
const MAX_STORED = 80 // past messages kept in memory per person
const MAX_FACTS = 25
const MAX_TEXT = 600
export const SHOPPER_ROW = '*' // memory row for things about the shopper, not one person

export const MESSAGES = {
  signedOut: 'Please sign in again to use the Gift Shopper Helper.',
  freeLimit: "You've used your 3 free helper questions. Subscribe for unlimited gift ideas!",
  slowDown: "Whoa, so many ideas! Give me a minute to catch my breath, then ask again. 🎄",
  dailyLimit: "That's a lot of shopping for one day! The helper will be ready again tomorrow.",
  notSetUp: "The Gift Shopper Helper isn't switched on yet. Please try again later.",
  failed: "The elves dropped that one — please try again in a moment.",
  badRequest: 'Please pick a person and type a question.',
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['reply', 'suggestions', 'person_facts', 'shopper_facts'],
  properties: {
    reply: { type: 'string', description: 'Warm, festive, 1-2 short sentences. May end with one quick follow-up question.' },
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'price', 'why'],
        properties: {
          name: { type: 'string', description: 'Specific gift, e.g. "Lodge 10-inch cast iron skillet"' },
          price: { type: 'number', description: 'Rough US price in whole dollars' },
          why: { type: 'string', description: 'Up to 8 words on why it fits' },
        },
      },
    },
    person_facts: {
      type: 'array',
      items: { type: 'string' },
      description: 'The COMPLETE updated list of short facts to remember about this person (age, likes, dislikes, sizes, hobbies, ideas they rejected or loved). Keep every earlier fact unless it was corrected.',
    },
    shopper_facts: {
      type: 'array',
      items: { type: 'string' },
      description: 'The COMPLETE updated list of short facts about the shopper themself that apply to all their gifts (favorite stores, gift style, shipping deadlines). Keep every earlier fact unless corrected.',
    },
  },
}

const money = (n) => Math.round((Number(n) || 0) * 100) / 100
const clip = (s, n) => String(s ?? '').trim().slice(0, n)

// Only the fields the helper needs, trimmed to sensible sizes.
export function cleanRequest(body) {
  if (!body || typeof body !== 'object') return null
  const p = body.person
  if (!p || typeof p !== 'object' || !clip(p.name, 80) || !clip(p.id, 100)) return null
  if (clip(p.id, 100) === SHOPPER_ROW) return null
  const gifts = Array.isArray(p.gifts) ? p.gifts.slice(0, 60) : []
  const person = {
    id: clip(p.id, 100),
    name: clip(p.name, 80),
    budget: money(p.budget),
    spent: money(p.spent),
    notes: clip(p.notes, 500),
    gifts: gifts
      .map((g) => ({ name: clip(g?.name, 120), price: money(g?.price), bought: !!g?.bought }))
      .filter((g) => g.name),
  }
  person.left = money(person.budget - person.spent)
  const question = clip(body.question, MAX_TEXT)
  if (!question) return null
  return { person, question }
}

// What was stored before, tidied (it came from the database, but be careful).
export function cleanFacts(list) {
  const seen = new Set()
  const out = []
  for (const f of Array.isArray(list) ? list : []) {
    const t = clip(f, 160)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
  }
  return out.slice(-MAX_FACTS)
}

// The AI returns its full updated list. Trust it for small changes (a
// corrected fact), but if it silently drops several old facts, keep them.
export function keepFacts(old, fresh) {
  const next = cleanFacts(fresh)
  if (!next.length) return old
  const dropped = old.filter((f) => !next.some((n) => n.toLowerCase() === f.toLowerCase()))
  return dropped.length > 2 ? cleanFacts([...dropped, ...next]) : next
}

export function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && clip(m.text, MAX_TEXT))
    .map((m) => ({
      role: m.role,
      text: clip(m.text, MAX_TEXT),
      ...(m.at ? { at: clip(m.at, 40) } : {}),
      ...(m.role === 'assistant' && Array.isArray(m.suggestions)
        ? { suggestions: m.suggestions.slice(0, 4).map((x) => ({ name: clip(x?.name, 120), price: Math.round(Number(x?.price)) || 0, why: clip(x?.why, 80) })).filter((x) => x.name) }
        : {}),
    }))
    .slice(-MAX_STORED)
}

export function systemPrompt(person, memory = { personFacts: [], shopperFacts: [], pastIdeas: [] }) {
  const giftLines = person.gifts.length
    ? person.gifts.map((g) => `- ${g.name} ($${g.price}, ${g.bought ? 'bought' : 'not bought yet'})`).join('\n')
    : '- (none yet)'
  const planned = money(person.gifts.filter((g) => !g.bought).reduce((s, g) => s + g.price, 0))
  return [
    "You are the Giftmas Tracker AI Gift Shopper Helper: a warm, cheerful, festive Christmas shopping elf.",
    'Keep every reply SHORT: one or two friendly sentences, never a wall of text, no lists in the reply text, no markdown.',
    `You are helping pick gifts for ${person.name}.`,
    `Budget: $${person.budget}. Already spent (bought): $${person.spent}. Remaining budget: $${person.left}.`,
    planned > 0 ? `Gifts on the list but not bought yet add up to $${planned}; mention it if a suggestion would push past the budget once those are bought.` : '',
    `Gifts already on their list:\n${giftLines}`,
    person.notes ? `Notes the shopper saved about ${person.name}: ${person.notes}` : `No notes saved about ${person.name} yet.`,
    memory.personFacts.length
      ? `What you remember about ${person.name} from earlier chats:\n${memory.personFacts.map((f) => `- ${f}`).join('\n')}`
      : `You have no memories about ${person.name} yet.`,
    memory.shopperFacts.length
      ? `What you remember about the shopper (applies to every gift):\n${memory.shopperFacts.map((f) => `- ${f}`).join('\n')}`
      : '',
    memory.pastIdeas.length
      ? `Ideas you already suggested before (do not repeat them unless asked): ${memory.pastIdeas.join('; ')}`
      : '',
    'Rules:',
    `- Suggest 2 to 4 SPECIFIC gift ideas (real kinds of products, not vague categories) when you know enough. Each must have a rough US price in whole dollars that is at or below the remaining $${person.left}.`,
    '- Never suggest something already on their list.',
    '- If you know very little about the person (no age, hobbies or interests), it is fine to give 2 safe ideas AND ask one quick follow-up question (age, hobbies, interests). If you truly cannot suggest anything sensible, return no suggestions and ask the question.',
    `- If the remaining budget is $0 or less, kindly say the budget for ${person.name} is used up, return no suggestions, and suggest raising the budget if they want more ideas.`,
    '- Only talk about gift ideas and Christmas shopping. Politely steer anything else back to gifts.',
    '- Put gift ideas ONLY in "suggestions", not in "reply".',
    '- You have a memory. Use what you remember naturally (e.g. "Since she loves gardening..."), and never ask again for something you already know.',
    `- Return in "person_facts" the full updated list of everything worth remembering about ${person.name}, and in "shopper_facts" the full list about the shopper. Keep all earlier facts unless corrected, add new ones from this chat, each one short (under 15 words). At most ${MAX_FACTS} each.`,
  ].filter(Boolean).join('\n')
}

// Keep only ideas that fit what is left and are not already on the list.
export function tidySuggestions(list, person) {
  const have = new Set(person.gifts.map((g) => g.name.toLowerCase()))
  const seen = new Set()
  const out = []
  for (const s of Array.isArray(list) ? list : []) {
    const name = clip(s?.name, 120)
    const price = Math.round(Number(s?.price))
    const key = name.toLowerCase()
    if (!name || !Number.isFinite(price) || price <= 0 || price > person.left) continue
    if (have.has(key) || seen.has(key)) continue
    seen.add(key)
    out.push({ name, price, why: clip(s?.why, 80) })
    if (out.length === 4) break
  }
  return out
}

async function rpc(env, token, fn, args) {
  const r = await fetch(`${env.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.supabaseKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  if (r.status === 401 || r.status === 403) return { authError: true }
  if (!r.ok) throw new Error(`supabase ${fn} ${r.status}`)
  return { data: await r.json() }
}

const memoryUrl = (env) => `${env.supabaseUrl}/rest/v1/giftmas_helper_memory`
const restHeaders = (env, token) => ({ apikey: env.supabaseKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' })

// Rows are read with the user's own session, so RLS limits it to their rows.
async function loadMemory(env, token, personId) {
  const ids = [personId, SHOPPER_ROW].map((x) => `"${x.replace(/["\\]/g, '')}"`).join(',')
  const url = `${memoryUrl(env)}?select=person_id,messages,facts&test=eq.${env.test}&person_id=in.(${encodeURIComponent(ids)})`
  const r = await fetch(url, { headers: restHeaders(env, token) })
  if (!r.ok) throw new Error(`memory load ${r.status}`)
  const rows = await r.json()
  const own = rows.find((x) => x.person_id === personId)
  const shopper = rows.find((x) => x.person_id === SHOPPER_ROW)
  return {
    messages: cleanMessages(own?.messages),
    personFacts: cleanFacts(own?.facts),
    shopperFacts: cleanFacts(shopper?.facts),
  }
}

async function saveMemory(env, token, rows) {
  const r = await fetch(`${memoryUrl(env)}?on_conflict=user_id,test,person_id`, {
    method: 'POST',
    headers: { ...restHeaders(env, token), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(rows.map((x) => ({ ...x, test: env.test, updated_at: new Date().toISOString() }))),
  })
  if (!r.ok) throw new Error(`memory save ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
}

async function askOpenAI(env, person, turns, memory) {
  const models = env.openaiModel ? [env.openaiModel, ...MODELS.filter((m) => m !== env.openaiModel)] : MODELS
  const messages = [
    { role: 'system', content: systemPrompt(person, memory) },
    ...turns.map((t) => ({ role: t.role, content: t.text })),
  ]
  let lastError
  for (const model of models) {
    const r = await fetch(`${env.openaiBase}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        max_completion_tokens: 2000,
        response_format: { type: 'json_schema', json_schema: { name: 'gift_helper_reply', strict: true, schema: SCHEMA } },
      }),
      signal: AbortSignal.timeout(45000),
    })
    if (r.ok) {
      const data = await r.json()
      const text = data?.choices?.[0]?.message?.content
      const parsed = JSON.parse(text)
      return {
        reply: clip(parsed.reply, 600),
        suggestions: parsed.suggestions,
        personFacts: parsed.person_facts,
        shopperFacts: parsed.shopper_facts,
        model,
      }
    }
    const detail = await r.text().catch(() => '')
    lastError = new Error(`openai ${model} ${r.status} ${detail.slice(0, 300)}`)
    // Try the next model only when this one is unknown or unavailable to the key.
    if (!(r.status === 404 || (r.status === 400 && /model/i.test(detail)))) break
  }
  throw lastError
}

export async function helperCore({ method, authorization, body, env }) {
  if (method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]
  if (!token) return { status: 401, body: { error: MESSAGES.signedOut, reason: 'signed_out' } }
  const req = cleanRequest(body)
  if (!req) return { status: 400, body: { error: MESSAGES.badRequest } }
  if (!env.openaiKey) {
    console.error('shopper-helper: no OpenAI key is set for this deployment')
    return { status: 503, body: { error: MESSAGES.notSetUp, reason: 'not_set_up' } }
  }

  let take
  try {
    take = await rpc(env, token, 'giftmas_helper_take', { p_test: env.test })
  } catch (e) {
    console.error('shopper-helper: take failed', e)
    return { status: 502, body: { error: MESSAGES.failed } }
  }
  if (take.authError || take.data?.reason === 'signed_out') {
    return { status: 401, body: { error: MESSAGES.signedOut, reason: 'signed_out' } }
  }
  const t = take.data
  if (!t?.ok) {
    if (t?.reason === 'free_limit') return { status: 402, body: { error: MESSAGES.freeLimit, reason: 'free_limit', freeLeft: 0 } }
    if (t?.reason === 'daily_limit') return { status: 429, body: { error: MESSAGES.dailyLimit, reason: 'daily_limit' } }
    return { status: 429, body: { error: MESSAGES.slowDown, reason: 'slow_down' } }
  }

  // Memory: if it cannot be read, still answer, but do not save over it.
  let memory = { messages: [], personFacts: [], shopperFacts: [] }
  let memoryOk = true
  try { memory = await loadMemory(env, token, req.person.id) } catch (e) {
    memoryOk = false
    console.error('shopper-helper: could not load memory', e)
  }
  const pastIdeas = [...new Set(memory.messages.flatMap((m) => (m.suggestions || []).map((x) => x.name)))].slice(-30)
  const turns = [...memory.messages.slice(-MAX_TURNS), { role: 'user', text: req.question }]

  let answer
  try {
    answer = await askOpenAI(env, req.person, turns, { ...memory, pastIdeas })
    console.log(`shopper-helper: answered with ${answer.model}`)
  } catch (e) {
    console.error('shopper-helper: AI call failed', e)
    try { await rpc(env, token, 'giftmas_helper_refund', { p_test: env.test, p_ticket: t.ticket }) } catch (r) {
      console.error('shopper-helper: refund failed', r)
    }
    return { status: 502, body: { error: MESSAGES.failed } }
  }

  const suggestions = tidySuggestions(answer.suggestions, req.person)
  // A model that forgets to repeat old facts must not wipe them: keep the old
  // ones when it returns nothing, otherwise trust its updated list.
  const personFacts = keepFacts(memory.personFacts, answer.personFacts)
  const shopperFacts = keepFacts(memory.shopperFacts, answer.shopperFacts)
  const now = new Date().toISOString()
  const messages = cleanMessages([
    ...memory.messages,
    { role: 'user', text: req.question, at: now },
    { role: 'assistant', text: answer.reply, suggestions, at: now },
  ])

  let saved = false
  if (memoryOk) {
    const rows = [{ person_id: req.person.id, messages, facts: personFacts }]
    if (JSON.stringify(shopperFacts) !== JSON.stringify(memory.shopperFacts)) {
      rows.push({ person_id: SHOPPER_ROW, messages: [], facts: shopperFacts })
    }
    try { await saveMemory(env, token, rows); saved = true } catch (e) {
      console.error('shopper-helper: could not save memory', e)
    }
  }

  return {
    status: 200,
    body: {
      reply: answer.reply,
      suggestions,
      facts: personFacts,
      saved,
      unlimited: !!t.unlimited,
      freeLeft: t.unlimited ? null : t.freeLeft,
    },
  }
}
