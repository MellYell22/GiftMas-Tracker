import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { MESSAGES, cleanRequest, helperCore, keepFacts, tidySuggestions } from '../supabase/functions/_shared/shopper-core.js'

const env = { supabaseUrl: 'https://sb.test', supabaseKey: 'pk', openaiKey: 'sk-fake', openaiModel: '', openaiBase: 'https://ai.test/v1', test: true }
const person = { id: 'p1', name: 'Grandma', budget: 100, spent: 40, notes: 'loves gardening', gifts: [{ name: 'Garden gloves', price: 40, bought: true }] }
const body = { person, question: 'Ideas please' }
const realFetch = globalThis.fetch
let calls
afterEach(() => { globalThis.fetch = realFetch })

function fakeFetch({ take = { ok: true, ticket: 't1', unlimited: false, freeLeft: 2 }, ai = [], authStatus = 200, memory = [], memoryStatus = 200 } = {}) {
  calls = []
  const aiQueue = [...ai]
  globalThis.fetch = async (url, init = {}) => {
    const payload = init.body ? JSON.parse(init.body) : null
    calls.push({ url, payload, headers: init.headers, method: init.method || 'GET' })
    if (url.includes('/rest/v1/giftmas_helper_memory')) {
      if (!init.method) return new Response(JSON.stringify(memory), { status: memoryStatus })
      return new Response('', { status: 201 })
    }
    if (url.endsWith('/rpc/giftmas_helper_take')) {
      return new Response(JSON.stringify(take), { status: authStatus })
    }
    if (url.endsWith('/rpc/giftmas_helper_refund')) return new Response('true')
    const next = aiQueue.shift()
    if (next.status) return new Response(next.text || '', { status: next.status })
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(next) } }] }))
  }
}

const run = (over = {}) => helperCore({ method: 'POST', authorization: 'Bearer user-jwt', body, env, ...over })

test('needs a signed-in user', async () => {
  const r = await run({ authorization: '' })
  assert.equal(r.status, 401)
})

test('says it is not set up when the deployment has no AI key', async () => {
  fakeFetch()
  const r = await run({ env: { ...env, openaiKey: '' } })
  assert.equal(r.status, 503)
  assert.equal(calls.length, 0)
})

test('free users past 3 questions get the upgrade answer and no AI call', async () => {
  fakeFetch({ take: { ok: false, reason: 'free_limit' } })
  const r = await run()
  assert.equal(r.status, 402)
  assert.equal(r.body.reason, 'free_limit')
  assert.equal(r.body.error, MESSAGES.freeLimit)
  assert.ok(!calls.some((c) => c.url.includes('ai.test')))
})

test('rate limited users are asked to slow down', async () => {
  fakeFetch({ take: { ok: false, reason: 'slow_down', unlimited: true } })
  assert.equal((await run()).status, 429)
})

test('expired session is reported as signed out', async () => {
  fakeFetch({ authStatus: 401 })
  assert.equal((await run()).status, 401)
})

test('answers with ideas that fit the remaining budget and skips ones already on the list', async () => {
  fakeFetch({ ai: [{ reply: 'Ho ho!', suggestions: [
    { name: 'Herb garden kit', price: 35, why: 'for a gardener' },
    { name: 'Garden gloves', price: 20, why: 'dup' },
    { name: 'Fancy greenhouse', price: 900, why: 'too much' },
    { name: 'Kneeling pad', price: 24.6, why: 'comfy' },
  ], person_facts: [], shopper_facts: [] }] })
  const r = await run()
  assert.equal(r.status, 200)
  assert.equal(r.body.reply, 'Ho ho!')
  assert.deepEqual(r.body.suggestions.map((s) => [s.name, s.price]), [['Herb garden kit', 35], ['Kneeling pad', 25]])
  assert.equal(r.body.freeLeft, 2)
  const ai = calls.find((c) => c.url.includes('ai.test'))
  assert.equal(ai.headers.Authorization, 'Bearer sk-fake')
  const system = ai.payload.messages[0].content
  assert.match(system, /Remaining budget: \$60/)
  assert.match(system, /Garden gloves \(\$40, bought\)/)
  assert.match(system, /loves gardening/)
  // The sandbox flag comes from the server, not the browser.
  assert.equal(calls[0].payload.p_test, true)
})

test('tries the next model when the first is not available', async () => {
  fakeFetch({ ai: [{ status: 404, text: 'model_not_found' }, { reply: 'Hi', suggestions: [], person_facts: [], shopper_facts: [] }] })
  const r = await run()
  assert.equal(r.status, 200)
  const models = calls.filter((c) => c.url.includes('ai.test')).map((c) => c.payload.model)
  assert.equal(models.length, 2)
  assert.notEqual(models[0], models[1])
})

test('gives the question back when the AI fails', async () => {
  fakeFetch({ ai: [{ status: 500, text: 'boom' }] })
  const r = await run()
  assert.equal(r.status, 502)
  const refund = calls.find((c) => c.url.endsWith('/rpc/giftmas_helper_refund'))
  assert.deepEqual(refund.payload, { p_test: true, p_ticket: 't1' })
})

test('rejects requests without a person or a question', () => {
  assert.equal(cleanRequest({ question: 'hi' }), null)
  assert.equal(cleanRequest({ person, question: '  ' }), null)
  assert.equal(cleanRequest({ person: { ...person, id: '' }, question: 'hi' }), null)
  assert.equal(cleanRequest({ person: { ...person, id: '*' }, question: 'hi' }), null)
})

test('remembers: uses earlier chats and facts, then saves the new turn and facts', async () => {
  fakeFetch({
    memory: [
      { person_id: 'p1', messages: [
        { role: 'user', text: 'She is 80' },
        { role: 'assistant', text: 'Lovely!', suggestions: [{ name: 'Seed tin', price: 20, why: '' }] },
      ], facts: ['Turns 80 this year', 'Loves roses'] },
      { person_id: '*', messages: [], facts: ['Shops at Target'] },
    ],
    ai: [{ reply: 'Roses it is!', suggestions: [{ name: 'Rose pruners', price: 30, why: 'roses' }],
      person_facts: ['Turns 80 this year', 'Loves roses', 'Has a small balcony'], shopper_facts: ['Shops at Target'] }],
  })
  const r = await run()
  assert.equal(r.status, 200)
  assert.equal(r.body.saved, true)
  assert.deepEqual(r.body.facts, ['Turns 80 this year', 'Loves roses', 'Has a small balcony'])
  const ai = calls.find((c) => c.url.includes('ai.test')).payload.messages
  assert.match(ai[0].content, /Loves roses/)
  assert.match(ai[0].content, /Shops at Target/)
  assert.match(ai[0].content, /Seed tin/) // past ideas, so it does not repeat them
  assert.deepEqual(ai.slice(1).map((m) => m.content), ['She is 80', 'Lovely!', 'Ideas please'])
  const save = calls.find((c) => c.url.includes('giftmas_helper_memory') && c.method === 'POST')
  assert.equal(save.payload.length, 1) // shopper facts unchanged, so only the person row
  assert.equal(save.payload[0].person_id, 'p1')
  assert.equal(save.payload[0].test, true)
  assert.deepEqual(save.payload[0].messages.map((m) => m.text), ['She is 80', 'Lovely!', 'Ideas please', 'Roses it is!'])
  assert.equal(save.payload[0].messages[3].suggestions[0].name, 'Rose pruners')
})

test('memory that cannot be read is never overwritten', async () => {
  fakeFetch({ memoryStatus: 500, ai: [{ reply: 'Hi', suggestions: [], person_facts: ['x'], shopper_facts: [] }] })
  const r = await run()
  assert.equal(r.status, 200)
  assert.equal(r.body.saved, false)
  assert.ok(!calls.some((c) => c.method === 'POST' && c.url.includes('giftmas_helper_memory')))
})

test('facts the AI silently drops are kept', () => {
  const old = ['a', 'b', 'c', 'd']
  assert.deepEqual(keepFacts(old, []), old)
  assert.deepEqual(keepFacts(old, ['a', 'b', 'c', 'D2']), ['a', 'b', 'c', 'D2']) // one corrected
  assert.deepEqual(keepFacts(old, ['e']), ['a', 'b', 'c', 'd', 'e'])
})

test('no ideas when the budget is used up', () => {
  const p = cleanRequest({ person: { ...person, spent: 100 }, question: 'x' }).person
  assert.deepEqual(tidySuggestions([{ name: 'Socks', price: 5, why: '' }], p), [])
})
