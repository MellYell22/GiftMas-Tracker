import { useEffect, useMemo, useRef, useState } from 'react'

import { supabase } from './supabase'

const PAYMENT_LINK = 'https://buy.stripe.com/test_5kQ3cx7Uy7Pc0qj2YxeIw00'
const dataKey = (email) => `christmas-app-data-${email}`

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
  const [user, setUser] = useState(null)
  const [authReady, setAuthReady] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const [loadedUser, setLoadedUser] = useState('')
  const [cloudMessage, setCloudMessage] = useState('')
  const [retry, setRetry] = useState(0)
  const lastSaved = useRef('')
  const saveQueue = useRef(Promise.resolve())
  const sessionEmail = user?.email || ''
  const [people, setPeople] = useState([])
  const [authMode, setAuthMode] = useState('create')
  const [authName, setAuthName] = useState('')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState('')
  const [showReset, setShowReset] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [resetMessage, setResetMessage] = useState('')
  const [subscribed, setSubscribed] = useState(false)
  const [accessUser, setAccessUser] = useState('')
  const [accessMessage, setAccessMessage] = useState('Checking subscription…')
  const [accessRetry, setAccessRetry] = useState(0)
  const [personName, setPersonName] = useState('')
  const [personBudget, setPersonBudget] = useState('')
  const [personNotes, setPersonNotes] = useState('')
  const [personLink, setPersonLink] = useState('')

  const account = user ? { email: user.email, name: user.user_metadata?.name || user.email } : null
  const isOwner = false
  const locked = !!account && (accessUser !== user.id || !subscribed)
  const checkoutUrl = user ? `${PAYMENT_LINK}?client_reference_id=${encodeURIComponent(user.id)}&locked_prefilled_email=${encodeURIComponent(user.email || '')}` : PAYMENT_LINK
  const days = daysUntilChristmas()

  useEffect(() => {
    let cancelled = false
    let inFlight = false
    setSubscribed(false)
    setAccessUser('')
    if (!user?.id) return
    const uid = user.id
    async function checkAccess() {
      if (inFlight) return
      inFlight = true
      try {
        const { data, error } = await supabase.rpc('giftmas_test_has_access', { p_user_id: uid })
        if (cancelled) return
        setAccessUser(uid)
        setSubscribed(!error && data === true)
        setAccessMessage(error ? 'Could not verify your subscription. Please retry.' : data === true ? 'Subscription verified.' : 'No active subscription confirmed yet. After paying, access updates automatically. Use your account email at checkout.')
      } catch {
        if (!cancelled) {
          setAccessUser(uid)
          setSubscribed(false)
          setAccessMessage('Could not verify your subscription. Please retry.')
        }
      } finally { inFlight = false }
    }
    checkAccess()
    const timer = window.setInterval(checkAccess, 10000)
    window.addEventListener('focus', checkAccess)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('focus', checkAccess)
    }
  }, [user?.id, accessRetry])

  function handleUnlock() {
    setAccessMessage('Checking subscription…')
    setAccessRetry((n) => n + 1)
  }

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user || null)
      setAuthReady(true)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoadedUser('')
    setPeople([])
    if (!user?.id || locked) return
    setCloudMessage('Loading your saved list…')
    async function load() {
      await saveQueue.current
      const { data, error } = await supabase.from('giftmas_test_lists').select('people').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      if (error) { setCloudMessage('Could not load your cloud list. Please retry.'); return }
      const existing = data?.people || []
      lastSaved.current = JSON.stringify(existing)
      setPeople(existing)
      setLoadedUser(user.id)
      setCloudMessage('Cloud list loaded')
    }
    load().catch(() => { if (!cancelled) setCloudMessage('Could not load your cloud list. Please retry.') })
    return () => { cancelled = true }
  }, [user?.id, retry, locked])

  useEffect(() => {
    if (!user?.id || locked || loadedUser !== user.id) return
    const serialized = JSON.stringify(people)
    if (serialized === lastSaved.current) return
    let cancelled = false
    setCloudMessage('Saving…')
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const { error } = await supabase.from('giftmas_test_lists').upsert({ user_id: user.id, people })
      if (cancelled) return
      if (error) { setCloudMessage('Cloud save failed. Keep this page open and retry saving.'); return }
      lastSaved.current = serialized
      setCloudMessage('Saved to your account')
    }).catch(() => { if (!cancelled) setCloudMessage('Cloud save failed. Keep this page open and retry saving.') })
    return () => { cancelled = true }
  }, [people, loadedUser, user?.id, locked])

  function importDeviceList() {
    const legacy = loadJSON(dataKey(sessionEmail), [])
    if (!Array.isArray(legacy) || !legacy.length) { setCloudMessage('No older list found on this device.'); return }
    setPeople((current) => [...current, ...legacy.filter((p) => !current.some((item) => item.id === p.id))])
  }

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

  async function handleCreateAccount(e) {
    e.preventDefault()
    setAuthError('')
    if (!authName.trim()) return setAuthError('Enter your name.')
    try {
      const { error } = await supabase.auth.signUp({ email: authEmail.trim().toLowerCase(), password: authPassword, options: { data: { name: authName.trim() }, emailRedirectTo: window.location.origin } })
      if (error) throw error
      setResetMessage('Check your email to confirm your account, then sign in.')
      setAuthPassword('')
    } catch (error) { setAuthError(error.message) }
  }

  async function handleSignIn(e) {
    e.preventDefault()
    setAuthError('')
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: authEmail.trim().toLowerCase(), password: authPassword })
      if (error) throw error
      setAuthPassword('')
    } catch (error) { setAuthError(error.message) }
  }

  async function handleSignOut() {
    await saveQueue.current
    if (loadedUser === user?.id && JSON.stringify(people) !== lastSaved.current) {
      setCloudMessage('Your latest changes are not saved yet. Retry saving before signing out.')
      return
    }
    const { error } = await supabase.auth.signOut()
    if (error) setCloudMessage(error.message)
  }

  async function handleResetPassword(e) {
    e.preventDefault()
    setAuthError('')
    try {
      const { error } = recovery
        ? await supabase.auth.updateUser({ password: newPassword })
        : await supabase.auth.resetPasswordForEmail(authEmail.trim().toLowerCase(), { redirectTo: window.location.origin })
      if (error) throw error
      setNewPassword('')
      setRecovery(false)
      setShowReset(false)
      setResetMessage(recovery ? 'Password updated.' : 'Check your email for a secure password-reset link.')
    } catch (error) { setAuthError(error.message) }
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

  if (!authReady) return <main className="page"><p role="status">Loading your account…</p></main>
  if (recovery) return <main className="page"><form className="card" onSubmit={handleResetPassword}>
    <h2>Choose a new password</h2>
    <label>New password<input type="password" minLength={8} required autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} /></label>
    {authError && <p role="alert">{authError}</p>}
    <button type="submit">Save password</button>
  </form></main>
  if (!account) {
    return (
      <div className="page welcome-page">
        <p role="status" style={{background:"#fff3cd",padding:"16px",color:"#332701"}}>TEST MODE — no real charges. Use card 4242 4242 4242 4242, expiry 12/34, CVC 123. Sign in with your existing Giftmas account. Test gifts stay separate.</p><main className="welcome-layout">
          <section className="welcome-intro">
            <h1>Giftmas<br />Tracker</h1>
            <div className="welcome-divider" aria-hidden="true" />
            <p className="welcome-subtitle">with AI Gift Shopper Helper</p>
            <p className="welcome-description">Set a budget for everyone on your list and track each gift from bought to wrapped. Your AI Gift Shopper Helper suggests thoughtful gifts based on your loved ones’ interests, wishes, and your remaining budget.</p>
            <img className="welcome-tree" src="/christmas-tree.png" alt="Christmas tree decorated with red bows, golden ornaments and warm lights, surrounded by wrapped presents" />
          </section>
          <section className="welcome-offer" aria-label="Yearly subscription">
            <img className="welcome-wreath" src="/christmas-wreath.png" alt="" />
            <div className="welcome-price"><strong>$19.99</strong><span>per year</span><button type="button" className="welcome-subscribe" onClick={() => { setAuthMode('create'); document.querySelector('input[autocomplete="name"]')?.focus(); setResetMessage('Create and verify your account, then sign in to subscribe securely.') }}>Subscribe</button></div>
          </section>
          <section className="welcome-account">
            <div className="welcome-form-panel">
              <div className="auth-tabs">
                <button type="button" className={authMode === 'create' ? 'tab active' : 'tab'} onClick={() => { setAuthMode('create'); setShowReset(false); setAuthError('') }}>Create account</button>
                <button type="button" className={authMode === 'signin' ? 'tab active' : 'tab'} onClick={() => { setAuthMode('signin'); setShowReset(false); setAuthError('') }}>Sign in</button>
              </div>
              {showReset ? (
                <form onSubmit={handleResetPassword}>
                  <label>Email<input type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" /></label>
                  {authError && <p className="error" role="alert">{authError}</p>}
                  <button className="welcome-submit" type="submit">Send password reset link</button>
                  <button type="button" className="forgot-link" onClick={() => { setShowReset(false); setAuthError('') }}>Back to sign in</button>
                </form>
              ) : (
                <form onSubmit={authMode === 'create' ? handleCreateAccount : handleSignIn}>
                  {authMode === 'create' && <label>Name<input autoComplete="name" value={authName} onChange={(e) => setAuthName(e.target.value)} placeholder="Your name" /></label>}
                  <label>Email<input type="email" autoComplete="email" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@example.com" /></label>
                  <label>Password<input type="password" autoComplete={authMode === 'create' ? 'new-password' : 'current-password'} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} placeholder="Password" /></label>
                  {authError && <p className="error" role="alert">{authError}</p>}
                  {resetMessage && <p className="hint" role="status">{resetMessage}</p>}
                  <button className="welcome-submit" type="submit">{authMode === 'create' ? 'Create my account' : 'Sign in'}</button>
                  {authMode === 'signin' && (
                    <button type="button" className="forgot-link" onClick={() => { setShowReset(true); setAuthError(''); setResetMessage('') }}>Forgot password?</button>
                  )}
                </form>
              )}
              <p className="welcome-fine-print">Create your account, then subscribe to open your tracker.</p>
            </div>
            <footer className="welcome-footer">Created by AA Designs<br /><span className="feedback-line">Questions or feedback? Contact us at <a href="mailto:contact@aa-designs.com">contact@aa-designs.com</a></span></footer>
          </section>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <BackgroundMotif />
      <main className="wrap"><p role="status" style={{background:"#fff3cd",padding:"16px",color:"#332701"}}>TEST MODE — no real charges. Use card 4242 4242 4242 4242, expiry 12/34, CVC 123. After checkout, return to this tab; your test tracker should unlock automatically.</p>
        <header className="topbar">
          <span>Signed in as {account.name} · {account.email} · {isOwner ? 'Owner account' : subscribed ? 'Yearly plan' : 'Not subscribed yet'}</span>
          <button type="button" className="small-btn" onClick={handleSignOut}>Sign out</button>
        </header>
        <h1>Giftmas Tracker</h1>
        <p className="tagline">with AI Gift Shopper Helper</p>
        <p className="countdown">{days} days until Christmas</p>
        <a className="subscribe-btn" href={checkoutUrl} target="_blank" rel="noreferrer">Subscribe — $19.99/year</a>

        {locked && (
          <section className="card">
            <h2>Subscribe to open your tracker</h2>
            <p className="hint">Giftmas Tracker is $19.99 a year. Subscribe using your account email. Your tracker opens after payment is verified.</p>
            <p role="status">{accessMessage}</p>
            <button type="button" className="primary-btn" onClick={handleUnlock}>Check payment status</button>
          </section>
        )}
        {!locked && <section className="card">
          <p role="status">{cloudMessage}</p>
          {loadedUser !== user.id ? <button type="button" onClick={() => setRetry((n) => n + 1)}>Retry loading</button> : <>
            <button type="button" className="small-btn" onClick={() => setPeople((current) => [...current])}>Retry saving</button>
            <button type="button" className="small-btn" onClick={importDeviceList}>Import my older list from this device</button>
          </>}
        </section>}
        {!locked && loadedUser === user.id && (<>
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
        <footer className="app-footer">Created by AA Designs<br /><span className="feedback-line">Questions or feedback? Contact us at <a href="mailto:contact@aa-designs.com">contact@aa-designs.com</a></span></footer>
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
