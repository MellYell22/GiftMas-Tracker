import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'

import { MESSAGES, cleanRequest, helperCore, tidySuggestions } from '../supabase/functions/_shared/shopper-core.js'

const env = { supabaseUrl: 'https://sb.test', supabaseKey: 'pk', openaiKey: 'sk-fake', openaiModel: '', openaiBase: 'https://ai.test/v1', test: true }
const person = { name: 'Grandma', budget: 100, spent: 40, notes: 'loves gardening', gifts: [{ name: 'Garden gloves', price: 40, bought: true }] }
const body = { person, messages: [{ role: 'user', text: 'Ideas please' }] }
const realFetch = globalThis.fetch
let calls
afterEach(() => { globalThis.fetch = realFetch })

function fakeFetch({ take = { ok: true, ticket: 't1', unlimited: false, freeLeft: 2 }, ai = [], authStatus = 200 } = {}) {
  calls = []
  const aiQueue = [...ai]
  globalThis.fetch = async (url, init) => {
    const payload = JSON.parse(init.body)
    calls.push({ url, payload, headers: init.headers })
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
  ] }] })
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
  fakeFetch({ ai: [{ status: 404, text: 'model_not_found' }, { reply: 'Hi', suggestions: [] }] })
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
  assert.equal(cleanRequest({ messages: [{ role: 'user', text: 'hi' }] }), null)
  assert.equal(cleanRequest({ person, messages: [] }), null)
  assert.equal(cleanRequest({ person, messages: [{ role: 'assistant', text: 'hi' }] }), null)
})

test('no ideas when the budget is used up', () => {
  const p = cleanRequest({ person: { ...person, spent: 100 }, messages: [{ role: 'user', text: 'x' }] }).person
  assert.deepEqual(tidySuggestions([{ name: 'Socks', price: 5, why: '' }], p), [])
})
