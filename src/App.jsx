import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Analytics } from '@vercel/analytics/react'

import ShopperHelper from './ShopperHelper'
import { supabase } from './supabase'

// Stripe mode. The real site (giftmastracker.com) is always live. Every other
// address, such as a Vercel preview or a local dev server, uses the Stripe
// sandbox: checkout, the access check and the saved list all point at the
// sandbox copies, so a test payment can never charge a real card or unlock or
// alter a real account. VITE_GIFTMAS_STRIPE_MODE=live or =test overrides this.
const LIVE_HOSTS = ['giftmastracker.com', 'www.giftmastracker.com', 'giftmastracker.vercel.app']
const STRIPE_MODE = import.meta.env.VITE_GIFTMAS_STRIPE_MODE
  || (LIVE_HOSTS.includes(window.location.hostname) ? 'live' : 'test')
const SANDBOX = STRIPE_MODE === 'test'
const CHECKOUT_FUNCTION = SANDBOX ? 'giftmas-test-create-checkout' : 'giftmas-create-checkout'
const ACCESS_RPC = SANDBOX ? 'giftmas_test_has_access' : 'giftmas_has_access'
const LIST_TABLE = SANDBOX ? 'giftmas_test_lists' : 'gift_lists'
const ADMIN_EMAILS = ['contact@aa-designs.com', 'info@aa-designs.com', 's4smith528@gmail.com']
// The free plan: this many people without paying. The database enforces the
// same number (the gift_lists and giftmas_test_lists policies), so a change
// here must be made there too. Owner accounts and subscribers are unlimited.
const FREE_PEOPLE_LIMIT = 2
const MSG_CHECKING = 'Checking subscription…'
const MSG_OPENING = 'Opening secure checkout…'
const MSG_VERIFY_FAILED = 'Could not verify your subscription. Please retry.'
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
  const [accessMessage, setAccessMessage] = useState('')
  const [accessRetry, setAccessRetry] = useState(0)
  const [paywallOpen, setPaywallOpen] = useState(false)
  const [planNote, setPlanNote] = useState('')
  const manualCheck = useRef(false)
  const planAnswered = useRef(false)
  const paywallRef = useRef(null)
  const [openPerson, setOpenPerson] = useState(null)
  const [addingPerson, setAddingPerson] = useState(false)
  const [personDetails, setPersonDetails] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personBudget, setPersonBudget] = useState('')
  const [personNotes, setPersonNotes] = useState('')
  const [personLink, setPersonLink] = useState('')
  const [helperOpen, setHelperOpen] = useState(false)
  const [helperPerson, setHelperPerson] = useState(null)
  const [helperChats, setHelperChats] = useState({})

  const account = user ? { email: user.email, name: user.user_metadata?.name || user.email } : null
  const isOwner = !!account && ADMIN_EMAILS.includes((account.email || '').toLowerCase())
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  // Just back from Stripe: check access every couple of seconds until it opens.
  const [justPaid, setJustPaid] = useState(() => new URLSearchParams(window.location.search).get('checkout') === 'success')
  const justPaidRef = useRef(justPaid)
  // Everyone signed in can use the tracker. Without a subscription it holds up
  // to FREE_PEOPLE_LIMIT people; the paywall appears when they ask for more.
  const planKnown = !!account && accessUser === user.id
  const freePlan = planKnown && !subscribed
  const atFreeLimit = freePlan && people.length >= FREE_PEOPLE_LIMIT
  // A lapsed subscriber can still see a longer list, but it will not save.
  const overFreeLimit = freePlan && people.length > FREE_PEOPLE_LIMIT
  const showPaywall = freePlan && (paywallOpen || justPaid || overFreeLimit)
  const days = daysUntilChristmas()
  const saveTone = /not saved|could not/i.test(cloudMessage)
    ? ' is-error'
    : /saving|loading/i.test(cloudMessage)
      ? ' is-busy'
      : ''

  // A different account, or signing out, starts again from "plan not known yet".
  useEffect(() => {
    planAnswered.current = false
    manualCheck.current = false
    setSubscribed(false)
    setAccessUser('')
    setAccessMessage('')
    setPaywallOpen(false)
    setPlanNote('')
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    let inFlight = false
    const uid = user.id
    // A check that fails (no signal, say) is not a "no": once the plan has been
    // confirmed in this visit, a failed re-check leaves it as it was.
    const failed = () => {
      setAccessUser(uid)
      if (!planAnswered.current) setSubscribed(false)
      setAccessMessage(MSG_VERIFY_FAILED)
    }
    async function checkAccess() {
      if (inFlight) return
      inFlight = true
      try {
        const { data, error } = await supabase.rpc(ACCESS_RPC, { p_user_id: uid })
        if (cancelled) return
        if (error) { failed(); return }
        planAnswered.current = true
        setAccessUser(uid)
        setSubscribed(data === true)
        if (data === true) { setAccessMessage(''); manualCheck.current = false }
        else if (justPaidRef.current) setAccessMessage('Thank you! Your payment went through. Unlocking your yearly plan now…')
        else if (manualCheck.current) {
          manualCheck.current = false
          setAccessMessage('No payment found on this account yet. If you just paid, give it a few seconds and check again.')
        } else setAccessMessage((m) => (m === MSG_CHECKING || m === MSG_OPENING || m === MSG_VERIFY_FAILED ? '' : m))
      } catch {
        if (!cancelled) failed()
      } finally { inFlight = false }
    }
    checkAccess()
    let timer = 0
    const tick = () => { timer = window.setTimeout(() => { checkAccess(); tick() }, justPaidRef.current ? 2500 : 10000) }
    tick()
    window.addEventListener('focus', checkAccess)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('focus', checkAccess)
    }
  }, [user?.id, accessRetry])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (!params.has('checkout')) return
    params.delete('checkout')
    const rest = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (rest ? `?${rest}` : '') + window.location.hash)
  }, [])

  useEffect(() => {
    justPaidRef.current = justPaid
    if (!justPaid) return
    if (subscribed) {
      setJustPaid(false)
      setPlanNote('Thank you! Your yearly plan is active. Add as many people as you like.')
      return
    }
    // Two minutes with no word from Stripe: stop the fast checks, but keep the
    // payment box open so a paid customer is never left with nothing to tap.
    const t = window.setTimeout(() => {
      setJustPaid(false)
      setPaywallOpen(true)
      setAccessMessage('We have not seen your payment yet. Tap “Check payment status” in a minute. If your plan still does not unlock, contact us and we will put it right.')
    }, 120000)
    return () => window.clearTimeout(t)
  }, [justPaid, subscribed])

  // The plan is active (paid here, or in another tab): put the paywall away.
  useEffect(() => { if (subscribed) setPaywallOpen(false) }, [subscribed])

  // Bring the paywall into view when it opens; it sits below the list.
  useEffect(() => {
    if (showPaywall) paywallRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [showPaywall])

  // The checkout page is created on the server for the signed-in account, so the
  // payment is tied to this account before Stripe ever sees it.
  async function handleSubscribe(e) {
    e.preventDefault()
    if (checkoutBusy) return
    setCheckoutBusy(true)
    setAccessMessage(MSG_OPENING)
    try {
      const { data, error } = await supabase.functions.invoke(CHECKOUT_FUNCTION, { body: {} })
      if (error) {
        let message = ''
        try { message = (await error.context?.json())?.error || '' } catch { /* keep the default below */ }
        throw new Error(message)
      }
      if (data?.alreadySubscribed) { handleUnlock(); return }
      if (!data?.url) throw new Error('')
      window.location.assign(data.url)
    } catch (error) {
      setAccessMessage(error?.message || 'Could not start checkout. Please try again.')
    } finally { setCheckoutBusy(false) }
  }

  function handleUnlock() {
    manualCheck.current = true
    setAccessMessage(MSG_CHECKING)
    setAccessRetry((n) => n + 1)
  }

  function openPaywall() {
    setAddingPerson(false)
    setPersonDetails(false)
    setPaywallOpen(true)
  }

  // The Gift Shopper Helper opens on the chosen person, or on the only person.
  function openHelper(personId) {
    setHelperPerson(personId || (people.length === 1 ? people[0].id : helperPerson))
    setHelperOpen(true)
  }
  const closeHelper = useCallback(() => setHelperOpen(false), [])

  function startAddingPerson() {
    if (atFreeLimit) openPaywall()
    else setAddingPerson(true)
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
    setHelperChats({})
    if (!user?.id) return
    setCloudMessage('Loading your saved list…')
    async function load() {
      await saveQueue.current
      const { data, error } = await supabase.from(LIST_TABLE).select('people').eq('user_id', user.id).maybeSingle()
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
  }, [user?.id, retry])

  useEffect(() => {
    if (!user?.id || loadedUser !== user.id) return
    const serialized = JSON.stringify(people)
    if (serialized === lastSaved.current) return
    let cancelled = false
    setCloudMessage('Saving…')
    saveQueue.current = saveQueue.current.catch(() => {}).then(async () => {
      const { error } = await supabase.from(LIST_TABLE).upsert({ user_id: user.id, people })
      if (cancelled) return
      if (error) {
        // 42501 is the database refusing a list longer than the free plan allows.
        const overPlan = error.code === '42501'
        setCloudMessage(overPlan
          ? `Not saved — the free plan saves up to ${FREE_PEOPLE_LIMIT} people. Subscribe to save everyone.`
          : 'Not saved yet — keep this page open and retry.')
        if (overPlan) setPaywallOpen(true)
        return
      }
      lastSaved.current = serialized
      setCloudMessage('Saved to your account')
    }).catch(() => { if (!cancelled) setCloudMessage('Not saved yet — keep this page open and retry.') })
    return () => { cancelled = true }
  }, [people, loadedUser, user?.id])

  function importDeviceList() {
    const legacy = loadJSON(dataKey(sessionEmail), [])
    if (!Array.isArray(legacy) || !legacy.length) { setCloudMessage('No older list found on this device.'); return }
    const fresh = legacy.filter((p) => !people.some((item) => item.id === p.id))
    if (!fresh.length) { setCloudMessage('That older list is already here.'); return }
    if (freePlan && people.length + fresh.length > FREE_PEOPLE_LIMIT) { openPaywall(); return }
    setPeople((current) => [...current, ...fresh.filter((p) => !current.some((item) => item.id === p.id))])
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
    if (atFreeLimit) { openPaywall(); return }
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
        <main className="welcome-layout">
          <section className="welcome-intro">
            <h1>Giftmas <br />Tracker</h1>
            <div className="welcome-divider" aria-hidden="true" />
            <p className="welcome-subtitle">with <span className="helper-highlight">✨ AI Gift Shopper Helper</span></p>
            <p className="welcome-description">Set a budget for everyone on your list and track each gift from bought to wrapped. Your AI Gift Shopper Helper suggests thoughtful gifts based on your loved ones’ interests, wishes, and your remaining budget.</p>
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
              <p className="welcome-fine-print">Start free with {FREE_PEOPLE_LIMIT} people. Unlimited people is $19.99 a year.</p>
            </div>
          </section>
          <img className="welcome-tree" src="/christmas-tree.png" alt="" aria-hidden="true" />
          <footer className="welcome-footer">Created by AA Designs<br /><span className="feedback-line">Questions or feedback? Contact us at <a href="mailto:contact@aa-designs.com">contact@aa-designs.com</a></span></footer>
        </main>
      </div>
    )
  }

  return (
    <div className="page">
      <BackgroundMotif />
      <main className="wrap">
        <header className="topbar">
          <span>Signed in as {account.name}<em className="topbar-email"> · {account.email}</em> · {isOwner ? 'Owner account' : subscribed ? 'Yearly plan' : planKnown ? 'Free plan' : 'Checking plan…'}</span>
          <button type="button" className="small-btn" onClick={handleSignOut}>Sign out</button>
        </header>
        {SANDBOX && <p className="sandbox-note">Test mode: payments here use Stripe's sandbox. No real card is charged.</p>}
        <h1>Giftmas Tracker</h1>
        <p className="tagline">with <span className="helper-highlight">✨ AI Gift Shopper Helper</span></p>
        <div className="masthead-rule" aria-hidden="true" />
        <p className="countdown-ribbon"><b>{days}</b> days until Christmas</p>
        {planKnown && loadedUser === user.id && (
          <button type="button" className="shopper-launch" onClick={() => openHelper(null)}>
            <span aria-hidden="true">✨</span> Ask the AI Gift Shopper Helper
          </button>
        )}
        {planNote && <p className="plan-note" role="status">{planNote}</p>}
        {!planKnown && <p className="hint center" role="status">Checking your plan…</p>}
        {planKnown && (
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
        {planKnown && loadedUser === user.id && (<>
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
                onOpenHelper={() => openHelper(person.id)}
              />
            ))}
            {!addingPerson && (
              <button type="button" className="new-row" onClick={startAddingPerson}>
                <span className="plus" aria-hidden="true">+</span> New Person
              </button>
            )}
          </section>
        )}

        {showPaywall ? (
          <section className="card paywall" ref={paywallRef}>
            <h2>{justPaid ? 'Unlocking your yearly plan' : overFreeLimit ? 'Subscribe to keep everyone on your list' : 'Subscribe to add more people'}</h2>
            {!justPaid && (
              <p className="hint">
                {overFreeLimit
                  ? `Your list has ${people.length} people and the free plan saves ${FREE_PEOPLE_LIMIT}. Changes will not save until you subscribe, or until the list is back to ${FREE_PEOPLE_LIMIT} people.`
                  : `The free plan covers ${FREE_PEOPLE_LIMIT} people. Subscribe for $19.99 a year and add as many people as you like. Your plan unlocks on this account as soon as payment is verified.`}
              </p>
            )}
            {accessMessage && <p role="status">{accessMessage}</p>}
            {!justPaid && <a className="subscribe-btn" href="#subscribe" role="button" aria-busy={checkoutBusy} onClick={handleSubscribe}>Subscribe — $19.99/year</a>}
            <div className="form-actions">
              <button type="button" className="small-btn" onClick={handleUnlock}>Check payment status</button>
              {!justPaid && !overFreeLimit && <button type="button" className="small-btn" onClick={() => setPaywallOpen(false)}>Not now</button>}
            </div>
          </section>
        ) : addingPerson || people.length === 0 ? (
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

        {freePlan && !showPaywall && (
          <p className="plan-line">
            Free plan: {people.length} of {FREE_PEOPLE_LIMIT} people.{' '}
            <button type="button" className="ghost-link" onClick={openPaywall}>Unlimited people for $19.99 a year</button>
          </p>
        )}

        {people.length > 0 && loadedUser === user.id && (
          <p className="tucked-away">
            <button type="button" className="ghost-link" onClick={importDeviceList}>Import an older list from this device</button>
          </p>
        )}
        </>)}
        {helperOpen && (
          <ShopperHelper
            people={people}
            personId={helperPerson}
            onPickPerson={setHelperPerson}
            chats={helperChats}
            setChats={setHelperChats}
            onClose={closeHelper}
            onAddGift={addGift}
            sandbox={SANDBOX}
            unlimitedPlan={isOwner || subscribed}
            onSubscribe={handleSubscribe}
            checkoutBusy={checkoutBusy}
            checkoutMessage={accessMessage === MSG_CHECKING ? '' : accessMessage}
          />
        )}
        <footer className="app-footer">Created by AA Designs<br /><span className="feedback-line">Questions or feedback? Contact us at <a href="mailto:contact@aa-designs.com">contact@aa-designs.com</a></span></footer>
      </main>
      <Analytics />
    </div>
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

function PersonCard({ person, open, onToggle, onDelete, onUpdatePerson, onAddGift, onUpdateGift, onDeleteGift, onOpenHelper }) {
  const [editing, setEditing] = useState(false)
  const [showOptions, setShowOptions] = useState(false)
  const [editName, setEditName] = useState(person.name)
  const [editBudget, setEditBudget] = useState(person.budget ?? '')
  const [editNotes, setEditNotes] = useState(person.notes || '')
  const [editLink, setEditLink] = useState(person.link || '')
  const [giftName, setGiftName] = useState('')
  const [giftPrice, setGiftPrice] = useState('')
  const giftNameRef = useRef(null)
  // The small budget box that opens in the person's row.
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [budgetDraft, setBudgetDraft] = useState('')

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

  function openBudget() {
    setBudgetDraft(person.budget === '' || person.budget == null ? '' : String(person.budget))
    setBudgetOpen(true)
  }

  // Saves from the row. The "Edit name, budget & notes" form reads person.budget
  // when it opens, so both ways always show the same number.
  function saveBudget(e) {
    e.preventDefault()
    const value = budgetDraft.trim()
    if (value !== '') {
      const amount = Math.round(Number(value) * 100) / 100
      if (!Number.isFinite(amount) || amount < 0) return
      onUpdatePerson({ budget: amount })
      setEditBudget(amount)
    }
    setBudgetOpen(false)
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
    giftNameRef.current?.focus()
  }

  return (
    <div className={open ? 'person-block is-open' : 'person-block'} id={`person-${person.id}`}>
      <div className="person-row">
        <button type="button" className="person-row-toggle" aria-expanded={open} onClick={onToggle}>
          <Chevron open={open} />
          <span className="person-row-name">{person.name}</span>
        </button>
        {budgetOpen ? (
          <form className="budget-inline" onSubmit={saveBudget}>
            <span className="budget-inline-dollar" aria-hidden="true">$</span>
            <input
              autoFocus
              type="number" min="0" step="0.01" inputMode="decimal" enterKeyHint="done"
              value={budgetDraft}
              onChange={(e) => setBudgetDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setBudgetOpen(false) }}
              placeholder="Budget"
              aria-label={`Budget for ${person.name}`}
            />
            <button type="submit" className="row-add">Save</button>
          </form>
        ) : (
          <button
            type="button"
            className={over > 0 ? 'person-row-money is-over' : budget ? 'person-row-money' : 'person-row-money is-unset'}
            onClick={openBudget}
            aria-label={budget ? `${person.name}: $${spent} spent of $${budget} budget. Change budget` : `Set a budget for ${person.name}`}
          >
            {budget ? <>${spent} <i>/</i> ${budget}</> : 'Set a budget'}
          </button>
        )}
      </div>
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
                  ref={giftNameRef}
                  className="new-gift-name"
                  value={giftName}
                  onChange={(e) => setGiftName(e.target.value)}
                  placeholder="Gift name"
                  aria-label={`New gift for ${person.name}`}
                />
                <input
                  className="new-gift-price"
                  type="number" min="0" step="0.01"
                  value={giftPrice}
                  onChange={(e) => setGiftPrice(e.target.value)}
                  placeholder="Price"
                  aria-label={`Gift price for ${person.name}`}
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
                  <button type="button" className="helper-tab" onClick={onOpenHelper}>✨ Ask the AI Gift Helper</button>
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
