import { useEffect, useMemo, useState } from 'react'

const PAYMENT_LINK = 'https://buy.stripe.com/6oU6oIgB9dCm8Sy7BY4sE00'
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
  const [personName, setPersonName] = useState('')
  const [personBudget, setPersonBudget] = useState('')
  const [personNotes, setPersonNotes] = useState('')
  const [personLink, setPersonLink] = useState('')

  const account = sessionEmail ? accounts[sessionEmail] : null
  const days = daysUntilChristmas()

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
            <p className="fine-print">Yearly plan · $19.99/year — creating an account is free today, no payment is taken in the app. Subscribe through the button above. Accounts on this web version live on this device for now (see README).</p>
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
          <span>Signed in as {account.name} · {account.email} · Yearly plan</span>
          <button type="button" className="small-btn" onClick={handleSignOut}>Sign out</button>
        </header>
        <h1>Christmas App</h1>
        <p className="countdown">{days} days until Christmas</p>
        <a className="subscribe-btn" href={PAYMENT_LINK} target="_blank" rel="noreferrer">Subscribe — $19.99/year</a>

        <section className="summary card">
          <div><strong>${totals.budget}</strong><span>Total budget</span></div>
          <div><strong>${totals.spent}</strong><span>Spent (bought)</span></div>
          <div><strong>${totals.left}</strong><span>Left</span></div>
          <div className="summary-actions">
            <button type="button" className="small-btn" onClick={() => window.print()}>Export PDF / Print</button>
            <button type="button" className="small-btn" onClick={handleShare}>Share list</button>
          </div>
        </section>

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
        <footer className="app-footer">Created by AA Designs</footer>
      </main>
    </div>
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

  return (
    <section className="card person-card">
      <div className="person-head">
        <h2>{person.name}</h2>
        <button type="button" className="small-btn danger" onClick={onDelete}>Delete person</button>
      </div>
      <p className="person-meta">Budget ${Number(person.budget) || 0} · Spent ${spent} · Left ${(Number(person.budget) || 0) - spent}</p>
      {person.notes && <p className="person-notes">{person.notes}</p>}
      {person.link && <p><a href={person.link} target="_blank" rel="noreferrer">View link</a></p>}

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
