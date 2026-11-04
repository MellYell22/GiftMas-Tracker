import { useEffect, useMemo, useState } from 'react'

const PAYMENT_LINK = 'https://buy.stripe.com/6oU6oIgB9dCm8Sy7BY4sE00'
const OWNER_EMAIL = 'contact@aa-designs.com'
const unlockedKey = (email) => `christmas-app-unlocked-${email}`
const ACCOUNTS_KEY = 'christmas-app-accounts'
const SESSION_KEY = 'christmas-app-session'
const dataKey = (email) => `christmas-app-data-${email}`

// NOTE: client-side demo accounts only. Passwords are kept in this device's
// local storage (lightly obfuscated) and are NOT secure cloud accounts.
// Real cloud accounts come with a backend later — see README.md.
function obfuscate(text) {
  let h = 0
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0
  return `h${h}`
}

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function daysUntilChristmas(now = new Date()) {
  const year = now.getFullYear()
  let christmas = new Date(year, 11, 25)
  if (now > new Date(year, 11, 26)) christmas = new Date(year + 1, 11, 25)
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((christmas - startOfDay) / 86400000)
}

function BackgroundMotif() {
  return (
    <div className="bg-motif" aria-hidden="true">
      <svg viewBox="0 0 800 600" preserveAspectRatio="xMidYMid slice">
        <rect x="90" y="120" width="220" height="380" rx="10" />
        <circle cx="200" cy="270" r="52" fill="none" strokeWidth="16" />
        <circle cx="200" cy="216" r="9" />
        <circle cx="248" cy="250" r="8" />
        <circle cx="152" cy="250" r="8" />
        <polygon points="560,110 660,300 460,300" />
        <polygon points="560,210 690,410 430,410" />
        <rect x="540" y="410" width="40" height="60" />
        <circle cx="560" cy="95" r="12" />
      </svg>
    </div>
  )
}

function OptionalLabel() {
  return <span className="optional-label">optional</span>
}

export default function App() {
  const [accounts, setAccounts] = useState(() => loadJSON(ACCOUNTS_KEY, {}))
  const [sessionEmail, setSessionEmail] = useState(() => localStorage.getItem(SESSION_KEY) || '')
  const [people, setPeople] = useState([])
  const [authMode, setAuthMode] = useState('create')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personBudget, setPersonBudget] = useState('')
  const [personNotes, setPersonNotes] = useState('')
  const [personLink, setPersonLink] = useState('')

  const account = sessionEmail ? accounts[sessionEmail] : null
  const isOwner = !!account && account.email === OWNER_EMAIL
  const locked = !!account && !isOwner && !subscribed
  const days = daysUntilChristmas()

  useEffect(() => {
    if (!sessionEmail) { setSubscribed(false); return }
    const params = new URLSearchParams(window.location.search)
    if (params.get('subscribed') === '1') {
      localStorage.setItem(unlockedKey(sessionEmail), '1')
      params.delete('subscribed')
      const q = params.toString()
      window.history.replaceState({}, '', window.location.pathname + (q ? `?${q}` : ''))
    }
    setSubscribed(localStorage.getItem(unlockedKey(sessionEmail)) === '1')
  }, [sessionEmail])

  function handleUnlock() {
    if (!sessionEmail) return
    localStorage.setItem(unlockedKey(sessionEmail), '1')
    setSubscribed(true)
  }

  useEffect(() => {
    if (sessionEmail) setPeople(loadJSON(dataKey(sessionEmail), []))
    else setPeople([])
  }, [sessionEmail])

  useEffect(() => {
    if (sessionEmail) localStorage.setItem(dataKey(sessionEmail), JSON.stringify(people))
  }, [people, sessionEmail])

  const totals = useMemo(() => {
    const budget = people.reduce((sum, p) => sum + (Number(p.budget) || 0), 0)
    const spent = people.reduce(
      (sum, p) => sum + p.gifts.filter((g) => g.checks.bought).reduce((s, g) => s + (Number(g.price) || 0), 0),
      0,
    )
    return { budget, spent, left: budget - spent }
  }, [people])

  const overBudget = useMemo(
    () =>
      people
        .map((person) => {
          const spent = person.gifts.filter((g) => g.checks.bought).reduce((s, g) => s + (Number(g.price) || 0), 0)
          return { person, spent, over: spent - (Number(person.budget) || 0) }
        })
        .filter((x) => x.over > 0),
    [people],
  )

  function jumpToPerson(id) {
    document.getElementById(`person-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleCreateAccount(e) {
    e.preventDefault()
    const email = authEmail.trim().toLowerCase()
    if (!authName.trim() || !email || !authPassword) return setAuthError('Fill in name, email, and password.')
    if (accounts[email]) return setAuthError('That email already has an account — sign in instead.')
    const next = { ...accounts, [email]: { name: authName.trim(), email, pass: obfuscate(authPassword) } }
    setAccounts(next)
    localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(next))
    setSessionEmail(email)
    localStorage.setItem(SESSION_KEY, email)
    setAuthError('')
  }

  function handleSignIn(e) {
    e.preventDefault()
    const email = authEmail.trim().toLowerCase()
    const found = accounts[email]
    if (!found || found.pass !== obfuscate(authPassword)) return setAuthError('Email or password did not match.')
    setSessionEmail(email)
    localStorage.setItem(SESSION_KEY, email)
    setAuthError('')
  }

  function handleSignOut() {
    setSessionEmail('')
    localStorage.removeItem(SESSION_KEY)
  }

  function handleAddPerson(e) {
    e.preventDefault()
    if (!personName.trim()) return
    setPeople((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: personName.trim(),
        budget: personBudget === '' ? '' : Number(personBudget),
        notes: personNotes.trim(),
        link: personLink.trim(),
        gifts: [],
      },
    ])
    setPersonName('')
    setPersonBudget('')
    setPersonNotes('')
    setPersonLink('')
  }

  function updatePerson(id, patch) {
    setPeople((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  }

  function deletePerson(id) {
    setPeople((prev) => prev.filter((p) => p.id !== id))
  }

  function addGift(personId, gift) {
    setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, gifts: [...p.gifts, gift] } : p)))
  }

  function updateGift(personId, giftId, patch) {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId ? { ...p, gifts: p.gifts.map((g) => (g.id === giftId ? { ...g, ...patch } : g)) } : p,
      ),
    )
  }

  function deleteGift(personId, giftId) {
    setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, gifts: p.gifts.filter((g) => g.id !== giftId) } : p)))
  }

  function listAsText() {
    const lines = [`Christmas list — ${account?.name || ''}`]
    for (const p of people) {
      lines.push(`\n${p.name} (budget $${Number(p.budget) || 0})`)
      for (const g of p.gifts) {
        const status = [g.checks.toBuy && 'to buy', g.checks.bought && 'bought', g.checks.wrapped && 'wrapped', g.checks.needReturn && 'need to return'].filter(Boolean).join(', ')
        lines.push(`- ${g.name || 'Gift'} — $${Number(g.price) || 0}${g.store ? ` from ${g.store}` : ''} [${status}]${g.link ? ` ${g.link}` : ''}`)
      }
    }
    return lines.join('\n')
  }

  async function handleShare() {
    const text = listAsText()
    if (navigator.share) {
      try { await navigator.share({ title: 'My Christmas list', text }) } catch { /* user cancelled */ }
    } else if (navigator.clipboard) {
      await navigator.clipboard.writeText(text)
      alert('List copied — paste it anywhere to share.')
    }
  }

  if (!account) {
    return (
      <div className="page">
        <BackgroundMotif />
        <main className="auth-wrap">
          <h1>Christmas App</h1>
          <p className="countdown">{days} days until Christmas</p>
          <p className="tagline">Budgets for everyone you shop for, and every gift checked off — bought and wrapped, so nothing is forgotten.</p>
          <a className="subscribe-btn" href={PAYMENT_LINK} target="_blank" rel="noreferrer">Subscribe — $19.99/year</a>
          <section className="card">
            <div className="auth-tabs">
              <button type="button" className={authMode === 'create' ? 'tab active' : 'tab'} onClick={() => setAuthMode('create')}>Create account</button>
              <button type="button" className={authMode === 'signin' ? 'tab active' : 'tab'} onClick={() => setAuthMode('signin')}>Sign in</button>
            </div>
            <form onSubmit={authMode === 'create' ? handleCreateAccount : handleSignIn}>
              {authMode === 'create' && (
                <label>Name
                  <input value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="Your name" />
                </label>
              )}
              <label>Email
                <input type="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" />
              </label>
              <label>Password
                <input type="password" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" />
              </label>
              {authError && <p className="error">{authError}</p>}
              <button className="primary-btn" type="submit">{authMode === 'create' ? 'Create my account' : 'Sign in'}</button>
            </form>
            <p className="fine-print">Yearly plan · $19.99/year — create your account, then subscribe through Stripe to open your tracker. Accounts on this web version live on this device for now (see README).</p>
          </section>
          <footer className="app-footer">Created by AA Designs</footer>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <BackgroundMotif />
      <main className="wrap">
        <header className="topbar">
          <span>Signed in as {account.name} · {account.email} · {isOwner ? 'Owner account' : subscribed ? 'Yearly plan' : 'Not subscribed yet'}</span>
          <button type="button" className="small-btn" onClick={handleSignOut}>Sign out</button>
        </header>
        <h1>Christmas App</h1>
        <p className="countdown">{days} days until Christmas</p>
        <a className="subscribe-btn" href={PAYMENT_LINK} target="_blank" rel="noreferrer">Subscribe — $19.99/year</a>

        {locked && (
          <section className="card">
            <h2>Subscribe to open your tracker</h2>
            <p className="hint">Giftmas Tracker is $19.99 a year. Tap Subscribe to pay securely through Stripe, then come back here and tap the button below to open your list.</p>
            <button type="button" className="primary-btn" onClick={handleUnlock}>I've subscribed — open my tracker</button>
          </section>
        )}
        {!locked && (<>
        <section className="summary card">
          <div><strong>${totals.budget}</strong><span>Total budget</span></div>
          <div><strong>${totals.spent}</strong><span>Spent (bought)</span></div>
          <div><strong>${totals.left}</strong><span>Left</span></div>
          <div className="summary-actions">
            <button type="button" className="small-btn" onClick={() => window.print()}>Export PDF / Print</button>
            <button type="button" className="small-btn" onClick={handleShare}>Share list</button>
          </div>
        </section>

        {overBudget.length > 0 && (
          <section className="over-budget-alert" role="alert">
            <strong>⚠️ Over budget</strong>
            {overBudget.map(({ person, over }) => (
              <button key={person.id} type="button" className="over-budget-link" onClick={() => jumpToPerson(person.id)}>
                {person.name} is ${over} over their ${Number(person.budget) || 0} budget — tap to see their list
              </button>
            ))}
          </section>
        )}

        <section className="card">
          <h2>Start with your people</h2>
          <p className="hint">Add everyone first — just a name and a budget. Gifts can come later.</p>
          <form onSubmit={handleAddPerson} className="person-form">
            <label>Name
              <input value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Person's name" />
            </label>
            <label>Budget
              <input type="number" min="0" step="0.01" value={personBudget} onChange={(e) => setPersonBudget(e.target.value)} placeholder="300" />
            </label>
            <label>Notes, sizes, wishes &amp; ideas <OptionalLabel />
              <input value={personNotes} onChange={(e) => setPersonNotes(e.target.value)} placeholder="Notes" />
            </label>
            <label>Link <OptionalLabel />
              <input value={personLink} onChange={(e) => setPersonLink(e.target.value)} placeholder="https://…" />
            </label>
            <button className="add-person-btn" type="submit">Add another person</button>
          </form>
        </section>

        {people.map((person) => (
          <PersonCard
            key={person.id}
            person={person}
            onDelete={() => deletePerson(person.id)}
            onAddGift={(gift) => addGift(person.id, gift)}
            onUpdateGift={(giftId, patch) => updateGift(person.id, giftId, patch)}
            onDeleteGift={(giftId) => deleteGift(person.id, giftId)}
          />
        ))}
        {people.length === 0 && <p className="hint center">No people yet — add your first person above.</p>}
        </>)}
        <footer className="app-footer">Created by AA Designs</footer>
      </main>
    </div>
  )
}

const HELPER_ERROR = "The gift helper couldn't answer just now — please try again in a moment."

// Local, on-device helper for this web version: it runs entirely in the
// browser (no external AI API key, no live model calls), using the person's
// notes, budget and what's left to pick ideas that fit.
const HELPER_IDEAS = [
  { keys: ['fish'], name: 'Fishing lure gift set', price: 25, reason: 'fits the fishing notes' },
  { keys: ['fish'], name: 'Tackle box organizer', price: 24, reason: 'keeps fishing gear tidy' },
  { keys: ['fish'], name: 'Fishing hat', price: 18, reason: 'a small fishing extra' },
  { keys: ['music', 'sing', 'song'], name: 'Bluetooth speaker', price: 35, reason: 'for a music lover' },
  { keys: ['music', 'sing', 'song'], name: 'Vinyl record by a favorite artist', price: 28, reason: 'for a music lover' },
  { keys: ['book', 'read'], name: 'Bestselling novel', price: 17, reason: 'for a reader' },
  { keys: ['book', 'read'], name: 'Reading light and bookmark set', price: 21, reason: 'for a reader' },
  { keys: ['cook', 'bake', 'kitchen', 'food'], name: 'Recipe journal', price: 16, reason: 'for someone who cooks' },
  { keys: ['cook', 'bake', 'kitchen', 'food'], name: 'Spice sampler set', price: 24, reason: 'for someone who cooks' },
  { keys: ['sport', 'football', 'basketball', 'baseball'], name: 'Team cap', price: 22, reason: 'for a sports fan' },
  { keys: ['sport', 'football', 'basketball', 'baseball'], name: 'Sports towel and bottle set', price: 20, reason: 'for a sports fan' },
  { keys: ['art', 'draw', 'paint', 'craft'], name: 'Sketchbook and pencil set', price: 19, reason: 'for someone arty' },
  { keys: ['art', 'draw', 'paint', 'craft'], name: 'Watercolor paint set', price: 23, reason: 'for someone arty' },
  { keys: ['garden', 'plant', 'flower'], name: 'Herb garden starter kit', price: 21, reason: 'for a gardener' },
  { keys: ['garden', 'plant', 'flower'], name: 'Garden gloves and tool set', price: 26, reason: 'for a gardener' },
  { keys: ['coffee'], name: 'Gourmet coffee sampler', price: 20, reason: 'for a coffee drinker' },
  { keys: ['tea'], name: 'Loose-leaf tea sampler', price: 18, reason: 'for a tea drinker' },
  { keys: ['game'], name: 'Card game for family night', price: 15, reason: 'fun for game night' },
  { keys: [], name: 'Cozy Christmas socks', price: 12, reason: 'a cozy classic' },
  { keys: [], name: 'Hot cocoa and mug gift set', price: 18, reason: 'a cozy classic' },
  { keys: [], name: 'Scented candle', price: 16, reason: 'a simple favorite' },
  { keys: [], name: 'Puzzle book collection', price: 14, reason: 'a simple favorite' },
  { keys: [], name: 'Warm winter gloves', price: 20, reason: 'useful all winter' },
  { keys: [], name: 'Picture frame for a family photo', price: 15, reason: 'a personal touch' },
  { keys: [], name: 'Snack gift basket', price: 28, reason: 'easy to share' },
  { keys: [], name: 'Board game for family night', price: 30, reason: 'fun for everyone' },
]

function helperSuggestions(person, left) {
  const text = `${person.notes || ''}`.toLowerCase()
  const matched = HELPER_IDEAS.filter((i) => i.keys.length > 0 && i.keys.some((k) => text.includes(k)))
  const pool = [...matched, ...HELPER_IDEAS.filter((i) => i.keys.length === 0)]
  const already = new Set(person.gifts.map((g) => (g.name || '').toLowerCase()))
  return pool.filter((i) => i.price <= left && !already.has(i.name.toLowerCase())).slice(0, 4)
}

function GiftHelper({ person, spent, onAddGift }) {
  const left = (Number(person.budget) || 0) - spent
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [ideas, setIdeas] = useState([])
  const [error, setError] = useState('')

  function ask(e) {
    if (e) e.preventDefault()
    const q = input.trim()
    try {
      if (left <= 0) {
        setIdeas([])
        setError('')
        setMessages((m) => [
          ...m,
          ...(q ? [{ from: 'you', text: q }] : []),
          { from: 'helper', text: `There's no money left in ${person.name}'s budget, so I can't suggest anything that fits right now.` },
        ])
        setInput('')
        return
      }
      const found = helperSuggestions(person, left)
      if (!found.length) throw new Error('no ideas')
      setIdeas(found)
      setError('')
      setMessages((m) => [
        ...m,
        ...(q ? [{ from: 'you', text: q }] : []),
        { from: 'helper', text: `Here are ${found.length} ideas for ${person.name} that fit the $${left} left in their budget:` },
      ])
    } catch {
      setError(HELPER_ERROR)
    }
    setInput('')
  }

  function addIdea(idea) {
    onAddGift({
      id: crypto.randomUUID(),
      name: idea.name,
      price: idea.price,
      store: '',
      link: '',
      barcode: '',
      photo: '',
      checks: { toBuy: true, bought: false, wrapped: false, needReturn: false },
    })
    setIdeas((prev) => prev.filter((i) => i.name !== idea.name))
  }

  return (
    <>
      <button type="button" className="helper-tab" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        ✨ AI Gift Helper
      </button>
      {open && (
        <div className="helper-panel">
          <p className="helper-greeting">Hi! I suggest gift ideas for {person.name} that fit the ${left} left in their budget. Ask me, or tap “Suggest ideas”.</p>
          {messages.map((m, idx) => (
            <p key={idx} className={m.from === 'you' ? 'helper-msg you' : 'helper-msg'}>{m.text}</p>
          ))}
          {ideas.length > 0 && (
            <ul className="helper-ideas">
              {ideas.map((idea) => (
                <li key={idea.name}>
                  <span>{idea.name} — ${idea.price} · {idea.reason}</span>
                  <button type="button" className="small-btn" onClick={() => addIdea(idea)}>+ Add to their list</button>
                </li>
              ))}
            </ul>
          )}
          {error && <p className="error">{error}</p>}
          <form className="helper-form" onSubmit={ask}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask for gift ideas…" aria-label="Ask the gift helper" maxLength={600} />
            <button type="submit" className="small-btn">Ask</button>
            <button type="button" className="small-btn" onClick={() => ask()}>Suggest ideas</button>
          </form>
        </div>
      )}
    </>
  )
}

function PersonCard({ person, onDelete, onAddGift, onUpdateGift, onDeleteGift }) {
  const [giftName, setGiftName] = useState('')
  const [giftPrice, setGiftPrice] = useState('')
  const [giftStore, setGiftStore] = useState('')
  const [giftLink, setGiftLink] = useState('')
  const [giftBarcode, setGiftBarcode] = useState('')
  const [giftPhoto, setGiftPhoto] = useState('')
  const [showDetails, setShowDetails] = useState(false)

  const spent = person.gifts.filter((g) => g.checks.bought).reduce((s, g) => s + (Number(g.price) || 0), 0)

  function handlePhoto(e) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setGiftPhoto(String(reader.result || ''))
    reader.readAsDataURL(file)
  }

  function submitGift(e) {
    e.preventDefault()
    if (!giftName.trim() && !giftPhoto) return
    onAddGift({
      id: crypto.randomUUID(),
      name: giftName.trim(),
      price: giftPrice === '' ? '' : Number(giftPrice),
      store: giftStore.trim(),
      link: giftLink.trim(),
      barcode: giftBarcode.trim(),
      photo: giftPhoto,
      checks: { toBuy: true, bought: false, wrapped: false, needReturn: false },
    })
    setGiftName('')
    setGiftPrice('')
    setGiftStore('')
    setGiftLink('')
    setGiftBarcode('')
    setGiftPhoto('')
  }

  function toggleCheck(gift, key) {
    onUpdateGift(gift.id, { checks: { ...gift.checks, [key]: !gift.checks[key] } })
  }

  const over = spent - (Number(person.budget) || 0)

  return (
    <section className="card person-card" id={`person-${person.id}`}>
      <div className="person-head">
        <h2>{person.name}</h2>
        <button type="button" className="small-btn danger" onClick={onDelete}>Delete person</button>
      </div>
      <p className="person-meta">Budget ${Number(person.budget) || 0} · Spent ${spent} · Left ${(Number(person.budget) || 0) - spent}</p>
      {over > 0 && <p className="over-budget-note">⚠️ Over budget by ${over}</p>}
      {person.notes && <p className="person-notes">{person.notes}</p>}
      {person.link && <p><a href={person.link} target="_blank" rel="noreferrer">View link</a></p>}
      <GiftHelper person={person} spent={spent} onAddGift={onAddGift} />

      <ul className="gift-list">
        {person.gifts.map((gift) => (
          <li key={gift.id} className="gift-line">
            {gift.photo && <img className="gift-photo" src={gift.photo} alt={gift.name || 'Gift photo'} />}
            <span className="gift-main">
              <strong>{gift.name || 'Gift (photo)'}</strong>
              {gift.price !== '' && <> · ${gift.price}</>}
              {gift.store && <> · {gift.store}</>}
              {gift.barcode && <> · Barcode {gift.barcode}</>}
              {gift.link && <> · <a href={gift.link} target="_blank" rel="noreferrer">View product</a></>}
            </span>
            <span className="checks">
              <label><input type="checkbox" checked={gift.checks.toBuy} onChange={() => toggleCheck(gift, 'toBuy')} /> To buy</label>
              <label><input type="checkbox" checked={gift.checks.bought} onChange={() => toggleCheck(gift, 'bought')} /> Bought</label>
              <label><input type="checkbox" checked={gift.checks.wrapped} onChange={() => toggleCheck(gift, 'wrapped')} /> Wrapped</label>
              <label><input type="checkbox" checked={gift.checks.needReturn} onChange={() => toggleCheck(gift, 'needReturn')} /> Return</label>
            </span>
            <button type="button" className="small-btn danger" onClick={() => onDeleteGift(gift.id)}>Delete</button>
          </li>
        ))}
      </ul>

      <form onSubmit={submitGift} className="gift-form">
        <input value={giftName} onChange={(e) => setGiftName(e.target.value)} placeholder="Gift name" aria-label="Gift name" />
        <input type="number" min="0" step="0.01" value={giftPrice} onChange={(e) => setGiftPrice(e.target.value)} placeholder="Price" aria-label="Price" />
        <input value={giftStore} onChange={(e) => setGiftStore(e.target.value)} placeholder="Where bought from" aria-label="Where bought from" />
        <label className="file-label">Photo <OptionalLabel />
          <input type="file" accept="image/*" onChange={handlePhoto} />
        </label>
        {giftPhoto && <img className="gift-photo preview" src={giftPhoto} alt="New gift preview" />}
        <button type="button" className="small-btn" onClick={() => setShowDetails((v) => !v)}>More details — all optional</button>
        {showDetails && (
          <>
            <label>Product link <OptionalLabel />
              <input value={giftLink} onChange={(e) => setGiftLink(e.target.value)} placeholder="https://…" />
            </label>
            <label>Barcode number — type or paste it <OptionalLabel />
              <input value={giftBarcode} onChange={(e) => setGiftBarcode(e.target.value)} placeholder="Barcode number" inputMode="numeric" />
            </label>
          </>
        )}
        <button className="primary-btn" type="submit">Add gift</button>
      </form>
    </section>
  )
}
