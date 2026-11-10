import { useEffect, useMemo, useRef, useState } from 'react'

import { supabase } from './supabase'

const PAYMENT_LINK = 'https://buy.stripe.com/6oU6oIgB9dCm8Sy7BY4sE00'
const ADMIN_EMAILS = ['contact@aa-designs.com', 's4smith528@gmail.com']
const WELCOME_LAYOUT_CSS = `
/* Welcome screen layout cleanup — sign-up box up top on phones, tidy columns on computers. */
.welcome-layout { align-items:center; }
.welcome-account { padding-top:0; align-self:center; }
.welcome-footer { margin-top:28px; display:block; text-align:center; white-space:normal; line-height:1.5; padding:0 0 24px; }
.welcome-footer::before, .welcome-footer::after { display:none; }
.check-email h2 { font:normal 30px/1.1 "Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif; color:#e4cb8c; }
.check-email p, .check-email li { color:#f6e9d7; font-size:17px; line-height:1.45; }
.check-email strong { color:#f2e3bd; }
.check-email .forgot-link { display:block; margin:14px auto 0; }
.welcome-submit:disabled, .check-email .forgot-link:disabled { opacity:.6; cursor:default; }
@media (min-width:1051px) {
  .welcome-layout { padding-top:28px; padding-bottom:28px; }
  .welcome-tree { height:clamp(300px,44vh,480px); }
}
@media (max-width:700px) {
  .welcome-layout { display:flex; flex-direction:column; align-items:stretch; gap:18px; padding:22px 18px 0; max-width:480px; margin:0 auto; min-height:0; }
  .welcome-intro { order:1; padding-right:0; min-height:0; display:grid; grid-template-columns:minmax(0,1fr) 92px; column-gap:12px; align-items:center; }
  .welcome-intro h1 { grid-column:1; font-size:46px; margin:0 0 10px; }
  .welcome-divider { grid-column:1; width:100%; margin:0 0 10px; }
  .welcome-subtitle { grid-column:1; font-size:16px; margin:0; }
  .welcome-tree { grid-column:2; grid-row:1 / span 3; position:static; width:92px; height:auto; margin:0; align-self:end; }
  .welcome-description { grid-column:1 / -1; font-size:14.5px; margin-top:12px; text-align:center; }
  .welcome-account { display:contents; }
  .welcome-form-panel { order:2; padding:18px 18px 20px; }
  .welcome-form-panel .auth-tabs { margin-bottom:18px; }
  .welcome-form-panel label { margin-bottom:12px; font-size:17px; }
  .welcome-form-panel input { min-height:46px; padding:10px 14px; font-size:16px; }
  .welcome-submit { margin-top:16px; font-size:20px; }
  .welcome-fine-print { font-size:15px; margin:14px 0 0; }
  .welcome-offer { order:3; width:min(100%,280px); align-self:center; margin:0; }
  .welcome-price strong { font-size:46px; }
  .welcome-price span { font-size:19px; }
  .welcome-subscribe { font-size:17px; padding:7px 22px; margin-top:10px; }
  .welcome-footer { order:4; margin-top:0; padding:8px 0 24px; font-size:14px; }
}
`

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
  const [awaitingEmail, setAwaitingEmail] = useState('')
  const [awaitingNote, setAwaitingNote] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [subscribed, setSubscribed] = useState(false)
  const [accessUser, setAccessUser] = useState('')
  const [accessMessage, setAccessMessage] = useState('Checking subscription…')
  const [accessRetry, setAccessRetry] = useState(0)
  const [openPerson, setOpenPerson] = useState(null)
  const [addingPerson, setAddingPerson] = useState(false)
  const [personDetails, setPersonDetails] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personBudget, setPersonBudget] = useState('')
  const [personNotes, setPersonNotes] = useState('')
  const [personLink, setPersonLink] = useState('')

  const account = user ? { email: user.email, name: user.user_metadata?.name || user.email } : null
  const isOwner = !!account && ADMIN_EMAILS.includes((account.email || '').toLowerCase())
  const locked = !!account && (accessUser !== user.id || !subscribed)
  const checkoutUrl = user ? `${PAYMENT_LINK}?client_reference_id=${encodeURIComponent(user.id)}&locked_prefilled_email=${encodeURIComponent(user.email || '')}` : PAYMENT_LINK
  const days = daysUntilChristmas()
  const saveTone = /not saved|could not/i.test(cloudMessage)
    ? ' is-error'
    : /saving|loading/i.test(cloudMessage)
      ? ' is-busy'
      : ''

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
        const { data, error } = await supabase.rpc('giftmas_has_access', { p_user_id: uid })
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
    if (resendCooldown <= 0) return
    const t = window.setTimeout(() => setResendCooldown((n) => n - 1), 1000)
    return () => window.clearTimeout(t)
  }, [resendCooldown])

  // When a confirmation link is old or already used, Supabase sends people back with an error in the URL.
  // Show a clear message + a resend button instead of silently dropping them on the sign-up form.
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, '') || window.location.search.replace(/^\?/, ''))
    const code = params.get('error_code') || params.get('error')
    if (!code) return
    const expired = /otp_expired|expired|invalid/i.test(code + ' ' + (params.get('error_description') || ''))
    setAuthMode('signin')
    setAwaitingEmail(' ')
    setAwaitingNote(expired
      ? 'That confirmation link expired or was already used. This usually happens when you create the account more than once — only the newest email works. Try signing in first; if it says your email isn\'t confirmed, tap “Resend confirmation email.”'
      : 'Something went wrong with that email link. Try signing in, or resend the confirmation email.')
    window.history.replaceState(null, '', window.location.pathname)
  }, [])

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
      const { data, error } = await supabase.from('gift_lists').select('people').eq('user_id', user.id).maybeSingle()
      if (cancelled) return
      if (error) { setCloudMessage('Could not load your list — please retry.'); return }
      const existing = data?.people || []
      lastSaved.current = JSON.stringify(existing)
      setPeople(existing)
      setLoadedUser(user.id)
      setCloudMessage('Your list is up to date')
    }
    load().catch(() => { if (!cancelled) setCloudMessage('Could not load your list — please retry.') })
    return () => { cancelled = true }
  }, [user?.id, retry, locked])

  useEffect(() => {
    if (!user?.id || locked || loadedUser !== user.id) return
    const serialized = JSON.stringify(people)
    if (serialized === lastSaved.current) return
    let cancelled = false
    setCloudMessage('Saving…')
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const { error } = await supabase.from('gift_lists').upsert({ user_id: user.id, people })
      if (cancelled) return
      if (error) { setCloudMessage('Not saved yet — keep this page open and retry.'); return }
      lastSaved.current = serialized
      setCloudMessage('Saved to your account')
    }).catch(() => { if (!cancelled) setCloudMessage('Not saved yet — keep this page open and retry.') })
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
    setOpenPerson(id)
    window.setTimeout(() => {
      document.getElementById(`person-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
  }

  function friendlyAuthError(error) {
    const msg = error?.message || 'Something went wrong. Please try again.'
    if (/rate limit|only request this after/i.test(msg)) return 'We just sent you an email. Please wait a minute, check your inbox (and spam), then try again.'
    if (/email not confirmed/i.test(msg)) return 'Your email isn\'t confirmed yet. Open the confirmation email we sent you, tap the link, then sign in.'
    if (/invalid login credentials/i.test(msg)) return 'That email and password don\'t match. Double-check them, or tap “Forgot password?”.'
    if (/already registered/i.test(msg)) return 'This email already has an account. Tap “Sign in” instead.'
    return msg
  }

  async function handleCreateAccount(e) {
    e.preventDefault()
    if (authBusy) return
    setAuthError('')
    if (!authName.trim()) return setAuthError('Enter your name.')
    const email = authEmail.trim().toLowerCase()
    setAuthBusy(true)
    try {
      const { error } = await supabase.auth.signUp({ email, password: authPassword, options: { data: { name: authName.trim() }, emailRedirectTo: window.location.origin } })
      if (error) throw error
      setAuthPassword('')
      setResetMessage('')
      setAuthMode('signin')
      setAwaitingEmail(email)
      setAwaitingNote('')
      setResendCooldown(60)
    } catch (error) {
      if (/rate limit|only request this after/i.test(error?.message || '')) {
        setAuthMode('signin')
        setAwaitingEmail(email)
        setAwaitingNote('We already sent you a confirmation email. Please use the newest one.')
        setResendCooldown(60)
      } else setAuthError(friendlyAuthError(error))
    } finally { setAuthBusy(false) }
  }

  async function handleSignIn(e) {
    e.preventDefault()
    if (authBusy) return
    setAuthError('')
    const email = authEmail.trim().toLowerCase()
    setAuthBusy(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password: authPassword })
      if (error) throw error
      setAuthPassword('')
      setAwaitingEmail('')
      setAwaitingNote('')
    } catch (error) {
      if (/email not confirmed/i.test(error?.message || '')) {
        setAwaitingEmail(email)
        setAwaitingNote('Your email isn\'t confirmed yet. Tap the link in the confirmation email, then sign in.')
      } else setAuthError(friendlyAuthError(error))
    } finally { setAuthBusy(false) }
  }

  async function handleResendConfirmation() {
    const email = (awaitingEmail.trim() || authEmail.trim()).toLowerCase()
    if (!email) { setAwaitingEmail(''); setAuthError('Enter your email, then tap Sign in.'); return }
    if (resendCooldown > 0 || authBusy) return
    setAuthBusy(true)
    setAuthError('')
    try {
      const { error } = await supabase.auth.resend({ type: 'signup', email, options: { emailRedirectTo: window.location.origin } })
      if (error) throw error
      setAwaitingEmail(email)
      setAwaitingNote('New email sent! Only the newest link works — open that one.')
      setResendCooldown(60)
    } catch (error) {
      setAuthError(friendlyAuthError(error))
      setResendCooldown(60)
    } finally { setAuthBusy(false) }
  }

  async function handleSignOut() {
    await saveQueue.current
    if (loadedUser === user?.id && JSON.stringify(people) !== lastSaved.current) {
      setCloudMessage('Your latest changes are not saved yet — retry saving before signing out.')
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
    const id = crypto.randomUUID()
    setPeople((prev) => [
      ...prev,
      {
        id,
        name: personName.trim(),
        budget: personBudget === '' ? '' : Number(personBudget),
        notes: personNotes.trim(),
        link: personLink.trim(),
        gifts: [],
      },
    ])
    setOpenPerson(id)
    setAddingPerson(false)
    setPersonDetails(false)
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

  function updatePerson(personId, patch) {
    setPeople((prev) => prev.map((p) => (p.id === personId ? { ...p, ...patch } : p)))
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
        <style>{WELCOME_LAYOUT_CSS}</style>
        <main className="welcome-layout">
          <section className="welcome-intro">
            <h1>Giftmas<br />Tracker</h1>
            <div className="welcome-divider" aria-hidden="true" />
            <p className="welcome-subtitle">with <span className="helper-highlight">✨ AI Gift Shopper Helper</span></p>
            <p className="welcome-description">Set a budget for everyone on your list and track each gift from bought to wrapped. Your AI Gift Shopper Helper suggests thoughtful gifts based on your loved ones’ interests, wishes, and your remaining budget.</p>
            <img className="welcome-tree" src="/christmas-tree.png" alt="Christmas tree decorated with red bows, golden ornaments and warm lights, surrounded by wrapped presents" />
          </section>
          <section className="welcome-offer" aria-label="Yearly subscription">
            <img className="welcome-wreath" src="/christmas-wreath.png" alt="" />
            <div className="welcome-price"><strong>$19.99</strong><span>per year</span><button type="button" className="welcome-subscribe" onClick={() => { setAuthMode('create'); document.querySelector('input[autocomplete="name"]')?.focus(); setResetMessage('Create and verify your account, then sign in to subscribe securely.') }}>Subscribe</button></div>
          </section>
          <section className="welcome-account">
            <div className="welcome-form-panel">
              {awaitingEmail ? (
                <div className="check-email" role="status" aria-live="polite" style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '2.6rem', lineHeight: 1 }} aria-hidden="true">📬</div>
                  <h2 style={{ margin: '0.4rem 0' }}>Check your email</h2>
                  {awaitingEmail.trim() ? (
                    <p>We sent a confirmation link to<br /><strong>{awaitingEmail.trim()}</strong></p>
                  ) : null}
                  {awaitingNote && <p className="hint">{awaitingNote}</p>}
                  <ol style={{ textAlign: 'left', margin: '0.6rem auto', paddingLeft: '1.2rem', maxWidth: '22rem' }}>
                    <li>Open the email from Giftmas Tracker (it may be in <strong>Spam</strong> or <strong>Promotions</strong>).</li>
                    <li>Tap <strong>Confirm your email</strong>.</li>
                    <li>Come back here and sign in.</li>
                  </ol>
                  <p className="hint">Please don’t create the account again — that cancels the first link.</p>
                  {authError && <p className="error" role="alert">{authError}</p>}
                  <button className="welcome-submit" type="button" onClick={() => { setAuthEmail(awaitingEmail.trim() || authEmail); setAwaitingEmail(''); setAwaitingNote(''); setAuthMode('signin'); setAuthError('') }}>I confirmed — sign me in</button>
                  <button type="button" className="forgot-link" disabled={resendCooldown > 0 || authBusy} onClick={handleResendConfirmation}>
                    {resendCooldown > 0 ? `Resend confirmation email (${resendCooldown}s)` : 'Resend confirmation email'}
                  </button>
                </div>
              ) : (<>
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
                  <button className="welcome-submit" type="submit" disabled={authBusy}>{authBusy ? 'One moment…' : authMode === 'create' ? 'Create my account' : 'Sign in'}</button>
                  {authMode === 'signin' && (
                    <button type="button" className="forgot-link" onClick={() => { setShowReset(true); setAuthError(''); setResetMessage('') }}>Forgot password?</button>
                  )}
                </form>
              )}
              </>)}
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
      <main className="wrap">
        <header className="topbar">
          <span>Signed in as {account.name}<em className="topbar-email"> · {account.email}</em> · {isOwner ? 'Owner account' : subscribed ? 'Yearly plan' : 'Not subscribed yet'}</span>
          <button type="button" className="small-btn" onClick={handleSignOut}>Sign out</button>
        </header>
        <h1>Giftmas Tracker</h1>
        <p className="tagline">with <span className="helper-highlight">✨ AI Gift Shopper Helper</span></p>
        <div className="masthead-rule" aria-hidden="true" />
        <p className="countdown-ribbon"><b>{days}</b> days until Christmas</p>
        {locked && <a className="subscribe-btn" href={checkoutUrl} target="_blank" rel="noreferrer">Subscribe — $19.99/year</a>}

        {locked && (
          <section className="card">
            <h2>Subscribe to open your tracker</h2>
            <p className="hint">Giftmas Tracker is $19.99 a year. Subscribe using your account email. Your tracker opens after payment is verified.</p>
            <p role="status">{accessMessage}</p>
            <button type="button" className="primary-btn" onClick={handleUnlock}>Check payment status</button>
          </section>
        )}
        {!locked && (
          <div className={`status-line${saveTone}`}>
            <span className="dot" aria-hidden="true" />
            <span role="status">{cloudMessage}</span>
            {loadedUser !== user.id ? (
              <button type="button" className="ghost-link" onClick={() => setRetry((n) => n + 1)}>Retry loading</button>
            ) : saveTone === ' is-error' ? (
              <button type="button" className="ghost-link" onClick={() => setPeople((current) => [...current])}>Retry saving</button>
            ) : null}
          </div>
        )}
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
            <strong>Over budget</strong>
            {overBudget.map(({ person, over }) => (
              <button key={person.id} type="button" className="over-budget-link" onClick={() => jumpToPerson(person.id)}>
                {person.name} is ${over} over their ${Number(person.budget) || 0} budget — tap to see their list
              </button>
            ))}
          </section>
        )}

        {people.length > 0 && (
          <section className="list-panel">
            {people.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                open={openPerson === person.id}
                onToggle={() => setOpenPerson((id) => (id === person.id ? null : person.id))}
                onDelete={() => deletePerson(person.id)}
                onAddGift={(gift) => addGift(person.id, gift)}
                onUpdatePerson={(patch) => updatePerson(person.id, patch)}
                onUpdateGift={(giftId, patch) => updateGift(person.id, giftId, patch)}
                onDeleteGift={(giftId) => deleteGift(person.id, giftId)}
              />
            ))}
            {!addingPerson && (
              <button type="button" className="new-row" onClick={() => setAddingPerson(true)}>
                <span className="plus" aria-hidden="true">+</span> New Person
              </button>
            )}
          </section>
        )}

        {addingPerson || people.length === 0 ? (
          <section className="card">
            <h2>{people.length === 0 ? 'Who are you shopping for?' : 'Add a person'}</h2>
            <p className="hint">Just a name and a budget. Gifts can come later.</p>
            <form onSubmit={handleAddPerson} className="person-form">
              <label>Name
                <input autoFocus={people.length > 0} value={personName} onChange={(e) => setPersonName(e.target.value)} placeholder="Person's name" />
              </label>
              <label>Budget
                <input type="number" min="0" step="0.01" value={personBudget} onChange={(e) => setPersonBudget(e.target.value)} placeholder="300" />
              </label>
              {personDetails && (
                <>
                  <label>Notes, sizes, wishes &amp; ideas <OptionalLabel />
                    <input value={personNotes} onChange={(e) => setPersonNotes(e.target.value)} placeholder="Loves gardening, size medium…" />
                  </label>
                  <label>Link <OptionalLabel />
                    <input value={personLink} onChange={(e) => setPersonLink(e.target.value)} placeholder="https://…" />
                  </label>
                </>
              )}
              <div className="form-actions">
                {!personDetails && (
                  <button type="button" className="small-btn" onClick={() => setPersonDetails(true)}>+ Notes &amp; link</button>
                )}
                {people.length > 0 && (
                  <button type="button" className="small-btn" onClick={() => { setAddingPerson(false); setPersonDetails(false) }}>Cancel</button>
                )}
              </div>
              <button className="add-person-btn" type="submit">Add person</button>
            </form>
          </section>
        ) : null}

        {people.length > 0 && loadedUser === user.id && (
          <p className="tucked-away">
            <button type="button" className="ghost-link" onClick={importDeviceList}>Import an older list from this device</button>
          </p>
        )}
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
        ✨ {open ? 'Hide the AI Gift Helper' : 'Ask the AI Gift Helper'}
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

const STAGE_LABEL = { toBuy: 'To buy', bought: 'Bought', wrapped: 'Wrapped', given: 'Given' }

function StageIcon({ stage }) {
  if (stage === 'bought') {
    return (
      <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <path d="M4 10.5l4 4 8-9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (stage === 'wrapped') {
    return (
      <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
        <rect x="2.6" y="8" width="14.8" height="9.4" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path d="M2.6 12.2h14.8M10 8v9.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M10 8C8.2 8 6.6 6.9 6.6 5.4S7.8 3 9 3.6 10 8 10 8zm0 0c1.8 0 3.4-1.1 3.4-2.6S12.2 3 11 3.6 10 8 10 8z"
          fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
      <circle cx="10" cy="10" r="6.4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeDasharray="2.6 2.4" />
    </svg>
  )
}

const GIFT_STEPS = [
  { key: 'bought', label: 'Bought' },
  { key: 'wrapped', label: 'Wrapped' },
  { key: 'given', label: 'Given' },
]

// Wrapped and Given both mean it's paid for, so Bought comes along.
// Unticking Bought clears the rest, so nothing claims to be wrapped but unbought.
function toggleStep(checks, key, on) {
  const next = { ...checks, [key]: on }
  if (on && (key === 'wrapped' || key === 'given')) next.bought = true
  if (!on && key === 'bought') { next.wrapped = false; next.given = false }
  next.toBuy = !next.bought
  if (!next.bought) next.needReturn = false
  return next
}

function stageOf(checks) {
  if (checks.given) return 'given'
  if (checks.wrapped) return 'wrapped'
  if (checks.bought) return 'bought'
  return 'toBuy'
}

function nextStage(stage) {
  return stage === 'toBuy' ? 'bought' : stage === 'bought' ? 'wrapped' : 'toBuy'
}

// Wrapped implies bought, so the budget maths stays honest however they tap.
function checksForStage(checks, stage) {
  return {
    ...checks,
    toBuy: stage === 'toBuy',
    bought: stage === 'bought' || stage === 'wrapped',
    wrapped: stage === 'wrapped',
    needReturn: stage === 'toBuy' ? false : checks.needReturn,
  }
}

function Chevron({ open }) {
  return (
    <svg className={open ? 'chevron is-open' : 'chevron'} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PersonCard({ person, open, onToggle, onDelete, onUpdatePerson, onAddGift, onUpdateGift, onDeleteGift }) {
  const [editing, setEditing] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [editName, setEditName] = useState(person.name)
  const [editBudget, setEditBudget] = useState(person.budget ?? '')
  const [editNotes, setEditNotes] = useState(person.notes || '')
  const [editLink, setEditLink] = useState(person.link || '')
  const [giftName, setGiftName] = useState('')
  const [giftPrice, setGiftPrice] = useState('')

  const budget = Number(person.budget) || 0
  const spent = person.gifts.filter((g) => g.checks.bought).reduce((s, g) => s + (Number(g.price) || 0), 0)
  const over = spent - budget

  function startEditing() {
    setEditName(person.name)
    setEditBudget(person.budget ?? '')
    setEditNotes(person.notes || '')
    setEditLink(person.link || '')
    setEditing(true)
    setShowOptions(false)
  }

  function saveDetails(e) {
    e.preventDefault()
    if (!editName.trim()) return
    onUpdatePerson({
      name: editName.trim(),
      budget: editBudget === '' ? '' : Number(editBudget),
      notes: editNotes.trim(),
      link: editLink.trim(),
    })
    setEditing(false)
  }

  function submitGift(e) {
    e.preventDefault()
    if (!giftName.trim()) return
    onAddGift({
      id: crypto.randomUUID(),
      name: giftName.trim(),
      price: giftPrice === '' ? '' : Number(giftPrice),
      store: '', link: '', barcode: '', photo: '',
      checks: { toBuy: true, bought: false, wrapped: false, needReturn: false },
    })
    setGiftName('')
    setGiftPrice('')
  }

  return (
    <div className={open ? 'person-block is-open' : 'person-block'} id={`person-${person.id}`}>
      <button type="button" className="person-row" aria-expanded={open} onClick={onToggle}>
        <Chevron open={open} />
        <span className="person-row-name">{person.name}</span>
        <span className={over > 0 ? 'person-row-money is-over' : budget ? 'person-row-money' : 'person-row-money is-unset'}>
          {budget ? <>${spent} <i>/</i> ${budget}</> : 'Set a budget'}
        </span>
      </button>
      <div
        className={over > 0 ? 'person-meter is-over' : budget ? 'person-meter' : 'person-meter is-unset'}
        aria-hidden="true"
      >
        <i style={{ width: budget ? `${Math.min(100, Math.round((spent / budget) * 100))}%` : '0%' }} />
      </div>

      {open && (
        <div className="person-body">
          {editing ? (
            <form onSubmit={saveDetails} className="person-edit">
              <label>Name
                <input autoFocus value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Person's name" />
              </label>
              <label>Budget
                <input type="number" min="0" step="0.01" value={editBudget} onChange={(e) => setEditBudget(e.target.value)} placeholder="300" />
              </label>
              <label>Notes, sizes, wishes &amp; ideas <OptionalLabel />
                <input value={editNotes} onChange={(e) => setEditNotes(e.target.value)} placeholder="Loves gardening, size medium…" />
              </label>
              <label>Link <OptionalLabel />
                <input value={editLink} onChange={(e) => setEditLink(e.target.value)} placeholder="https://…" />
              </label>
              <div className="form-actions">
                <button type="button" className="small-btn" onClick={() => setEditing(false)}>Cancel</button>
                <button className="small-btn save" type="submit">Save changes</button>
              </div>
            </form>
          ) : (
            <>
              {person.notes && <p className="person-notes">{person.notes}</p>}
              {person.link && <p className="person-notes"><a href={person.link} target="_blank" rel="noreferrer">View link</a></p>}

              <ul className="gift-list">
                {person.gifts.map((gift) => {
                  const stage = stageOf(gift.checks)
                  return (
                    <li key={gift.id} className="gift-row" data-stage={stage}>
                      <span className="gift-name">
                        {gift.name || 'Gift'}
                        {gift.store && <small>{gift.store}</small>}
                      </span>
                      <span className="gift-price">{gift.price === '' ? '' : `$${gift.price}`}</span>
                      <button type="button" className="row-x" aria-label={`Delete ${gift.name || 'gift'}`} onClick={() => onDeleteGift(gift.id)}>✕</button>
                      <div className="gift-checks">
                        {stage === 'toBuy' && <span className="need-tag">Need to buy</span>}
                        {GIFT_STEPS.map(({ key, label }) => (
                          <label key={key} className={gift.checks[key] ? 'gift-check is-on' : 'gift-check'}>
                            <input
                              type="checkbox"
                              checked={!!gift.checks[key]}
                              onChange={(e) => onUpdateGift(gift.id, { checks: toggleStep(gift.checks, key, e.target.checked) })}
                            />
                            <span>{label}</span>
                          </label>
                        ))}
                      </div>
                    </li>
                  )
                })}
              </ul>

              <form className="new-gift-row" onSubmit={submitGift}>
                <span className="plus" aria-hidden="true">+</span>
                <input
                  className="new-gift-name"
                  value={giftName}
                  onChange={(e) => setGiftName(e.target.value)}
                  placeholder="New Gift"
                  aria-label={`New gift for ${person.name}`}
                />
                <input
                  className="new-gift-price"
                  type="number" min="0" step="0.01"
                  value={giftPrice}
                  onChange={(e) => setGiftPrice(e.target.value)}
                  placeholder="$"
                  aria-label="Price"
                />
                {(giftName.trim() || giftPrice !== '') && <button type="submit" className="row-add">Add</button>}
                <button
                  type="button"
                  className={showOptions ? 'row-gear is-on' : 'row-gear'}
                  aria-expanded={showOptions}
                  aria-label={`Options for ${person.name}`}
                  onClick={() => setShowOptions((v) => !v)}
                >⚙</button>
              </form>

              {showOptions && (
                <div className="person-options">
                  <button type="button" className="small-btn" onClick={startEditing}>Edit name, budget &amp; notes</button>
                  <GiftHelper person={person} spent={spent} onAddGift={onAddGift} />
                  <button type="button" className="small-btn danger" onClick={onDelete}>Delete {person.name}</button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
