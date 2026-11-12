import { useEffect, useRef, useState } from 'react'

import { supabase } from './supabase'

// The AI Gift Shopper Helper chat panel. The AI runs on the server
// (Supabase function giftmas-shopper-helper); this panel only sends the chosen person's details
// and the conversation, and shows the answers.

export const HELPER_FREE_QUESTIONS = 3

function spentOn(person) {
  return person.gifts.filter((g) => g.checks?.bought).reduce((s, g) => s + (Number(g.price) || 0), 0)
}

function greeting(person) {
  const budget = Number(person.budget) || 0
  const left = budget - spentOn(person)
  if (!budget) return `Ho ho ho! Let's find something lovely for ${person.name}. What do they enjoy? (Tip: set a budget so I can keep ideas in range.)`
  if (left <= 0) return `${person.name}'s budget is all used up! Raise it on their card if you'd like more ideas.`
  return `Ho ho ho! You have $${Math.round(left * 100) / 100} left for ${person.name}. Tell me a little about them, or tap “Suggest gifts”.`
}

export default function ShopperHelper({
  people, personId, onPickPerson, chats, setChats, onClose, onAddGift,
  sandbox, unlimitedPlan, onSubscribe, checkoutBusy, checkoutMessage,
}) {
  const person = people.find((p) => p.id === personId) || null
  const chat = (person && chats[person.id]) || []
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [freeLeft, setFreeLeft] = useState(null)
  const [limitHit, setLimitHit] = useState(false)
  const scroller = useRef(null)
  const inputRef = useRef(null)
  const unlimited = unlimitedPlan || freeLeft === Infinity
  const helperFunction = sandbox ? 'giftmas-test-shopper-helper' : 'giftmas-shopper-helper'

  // How many free questions are left (shown to free accounts only).
  useEffect(() => {
    let live = true
    supabase.rpc('giftmas_helper_status', { p_test: sandbox }).then(({ data, error: e }) => {
      if (!live || e || !data?.signedIn) return
      if (data.unlimited) setFreeLeft(Infinity)
      else { setFreeLeft(data.freeLeft); if (data.freeLeft <= 0) setLimitHit(true) }
    })
    return () => { live = false }
  }, [sandbox])

  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('helper-open')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('helper-open') }
  }, [onClose])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [chat.length, busy, limitHit, personId])

  function updateChat(id, fn) {
    setChats((all) => ({ ...all, [id]: fn(all[id] || []) }))
  }

  async function send(text) {
    const q = text.trim()
    if (!q || !person || busy) return
    if (limitHit && !unlimited) return
    setError('')
    setInput('')
    const id = person.id
    const history = [...chat, { role: 'user', text: q }]
    updateChat(id, () => history)
    setBusy(true)
    try {
      const { data: answer, error: failure } = await supabase.functions.invoke(helperFunction, {
        body: {
          person: {
            name: person.name,
            budget: Number(person.budget) || 0,
            spent: spentOn(person),
            notes: person.notes || '',
            gifts: person.gifts.map((g) => ({ name: g.name, price: Number(g.price) || 0, bought: !!g.checks?.bought })),
          },
          messages: history.map((m) => ({ role: m.role, text: m.text })),
        },
      })
      let data = answer || {}
      if (failure) {
        try { data = (await failure.context?.json()) || {} } catch { data = {} }
      }
      if (data.reason === 'free_limit') {
        // The question was not answered, so take it back out of the chat.
        updateChat(id, (m) => m.slice(0, -1))
        setInput(q)
        setFreeLeft(0)
        setLimitHit(true)
        return
      }
      if (failure || !data.reply) throw new Error(data.error || '')
      updateChat(id, (m) => [...m, { role: 'assistant', text: data.reply, suggestions: data.suggestions || [] }])
      if (data.unlimited) setFreeLeft(Infinity)
      else if (typeof data.freeLeft === 'number') {
        setFreeLeft(data.freeLeft)
        if (data.freeLeft <= 0) setLimitHit(true)
      }
    } catch (e) {
      updateChat(id, (m) => m.slice(0, -1))
      setInput(q)
      setError(e?.message || 'The elves dropped that one — please try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  function addIdea(msgIndex, idea) {
    onAddGift(person.id, {
      id: crypto.randomUUID(),
      name: idea.name,
      price: idea.price,
      store: '', link: '', barcode: '', photo: '',
      checks: { toBuy: true, bought: false, wrapped: false, needReturn: false },
    })
    updateChat(person.id, (m) => m.map((msg, i) => (i === msgIndex
      ? { ...msg, suggestions: msg.suggestions.map((s) => (s.name === idea.name ? { ...s, added: true } : s)) }
      : msg)))
  }

  const showUpgrade = limitHit && !unlimited

  return (
    <div className="shopper-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className="shopper" role="dialog" aria-modal="true" aria-labelledby="shopper-title">
        <header className="shopper-head">
          <div>
            <h2 id="shopper-title">✨ Gift Shopper Helper</h2>
            {!unlimited && freeLeft !== null && !showUpgrade && (
              <p className="shopper-count">{freeLeft} free question{freeLeft === 1 ? '' : 's'} left</p>
            )}
          </div>
          <button type="button" className="shopper-close" onClick={onClose} aria-label="Close the Gift Shopper Helper">×</button>
        </header>

        {people.length === 0 ? (
          <div className="shopper-body"><p className="shopper-bubble">Add someone to your list first, then I'll help you find the perfect gift! 🎁</p></div>
        ) : (<>
          <div className="shopper-people" role="group" aria-label="Who are you shopping for?">
            {people.map((p) => (
              <button key={p.id} type="button" aria-pressed={p.id === personId}
                className={p.id === personId ? 'shopper-chip is-on' : 'shopper-chip'}
                onClick={() => { setError(''); onPickPerson(p.id) }}>
                {p.name}
              </button>
            ))}
          </div>

          <div className="shopper-body" ref={scroller} aria-live="polite">
            {!person ? (
              <p className="shopper-bubble">Who are we shopping for? Tap a name above. 🎄</p>
            ) : (<>
              <p className="shopper-bubble">{greeting(person)}</p>
              {chat.map((m, i) => (
                m.role === 'user' ? (
                  <p key={i} className="shopper-bubble is-you">{m.text}</p>
                ) : (
                  <div key={i} className="shopper-answer">
                    <p className="shopper-bubble">{m.text}</p>
                    {m.suggestions?.length > 0 && (
                      <ul className="shopper-ideas">
                        {m.suggestions.map((s) => (
                          <li key={s.name}>
                            <div>
                              <strong>{s.name}</strong>
                              <span>about ${s.price}{s.why ? ` · ${s.why}` : ''}</span>
                            </div>
                            <button type="button" className="shopper-add" disabled={s.added}
                              onClick={() => addIdea(i, s)}>
                              {s.added ? '✓ Added' : 'Add to list'}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              ))}
              {busy && <p className="shopper-bubble is-typing" aria-label="The helper is thinking"><span /><span /><span /></p>}
              {showUpgrade && (
                <div className="shopper-upgrade">
                  <p><strong>You've used your {HELPER_FREE_QUESTIONS} free questions! 🎁</strong></p>
                  <p>Unlock unlimited gift ideas and unlimited people for $19.99 a year.</p>
                  {checkoutMessage && <p role="status" className="shopper-small">{checkoutMessage}</p>}
                  <a className="subscribe-btn" href="#subscribe" role="button" aria-busy={checkoutBusy} onClick={onSubscribe}>Subscribe — $19.99/year</a>
                </div>
              )}
            </>)}
          </div>

          {error && <p className="shopper-error" role="alert">{error}</p>}

          {person && !showUpgrade && (
            <form className="shopper-form" onSubmit={(e) => { e.preventDefault(); send(input) }}>
              {chat.length === 0 && (
                <button type="button" className="shopper-quick" disabled={busy}
                  onClick={() => send(`Suggest some gift ideas for ${person.name}.`)}>Suggest gifts</button>
              )}
              <div className="shopper-row">
                <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} maxLength={600}
                  placeholder={`Ask about gifts for ${person.name}…`} aria-label="Ask the Gift Shopper Helper" enterKeyHint="send" />
                <button type="submit" className="shopper-send" disabled={busy || !input.trim()}>Send</button>
              </div>
            </form>
          )}
        </>)}
      </section>
    </div>
  )
}
