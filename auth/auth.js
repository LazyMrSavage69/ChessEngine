// auth/auth.js — user-facing login + access-code gate.
//
// SECURITY ORDER (critical, do NOT change):
//   1. Validate the access code FIRST against the `access_codes` table.
//   2. ONLY if the code is valid, attempt signIn / signUp.
//   3. ONLY on successful auth, mark the access code as activated (used=true).
//
// Rationale: creating a Supabase auth account is irreversible from the
// client. By checking the code BEFORE touching auth, we avoid creating
// orphan auth users for people who never had a valid invitation.

import { supabase } from '/supabaseClient.js'

const $ = (id) => document.getElementById(id)

const ACCESS_CODE_TTL_DAYS = 30

function accessCodeCutoffIso() {
  return new Date(Date.now() - ACCESS_CODE_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

/** Show the login form, hide the app. */
function showLogin() {
  const login = $('login-screen')
  const app   = $('app-screen')
  if (login) login.classList.remove('hidden')
  if (app)   app.classList.add('hidden')
}

/** Hide the login form, show the app. */
function showApp() {
  const login = $('login-screen')
  const app   = $('app-screen')
  if (login) login.classList.add('hidden')
  if (app)   app.classList.remove('hidden')
}

function setError(msg) {
  const el = $('login-error')
  if (!el) return
  el.textContent = msg || ''
  el.classList.toggle('visible', !!msg)
}

function setBusy(busy) {
  const btn = $('login-submit')
  if (!btn) return
  btn.disabled = !!busy
  btn.textContent = busy ? 'Signing in…' : 'Sign In'
}

/**
 * Look up a non-expired access code matching (email, code). Returns the row
 * or null + a reason. IMPORTANT: this runs BEFORE any signIn / signUp so we
 * never create a Supabase auth record for an invalid invitation.
 */
async function findValidAccessCode(email, code) {
  const cutoffIso = accessCodeCutoffIso()
  const { data, error } = await supabase
    .from('access_codes')
    .select('id, email, code, used, created_at')
    .eq('email', email)
    .eq('code', code)
    .gte('created_at', cutoffIso)
    .limit(1)
    .maybeSingle()

  if (error) {
    // Surface the error in console but treat as "not found" for the user.
    console.error('access_codes lookup failed:', error.message)
    return { row: null, reason: 'invalid' }
  }
  if (data) return { row: data, reason: null }

  // If the code exists but is older than the TTL, report as expired.
  const { data: expiredRow } = await supabase
    .from('access_codes')
    .select('id, created_at')
    .eq('email', email)
    .eq('code', code)
    .limit(1)
    .maybeSingle()

  if (expiredRow) return { row: null, reason: 'expired' }
  return { row: null, reason: 'invalid' }
}

/** Mark an access code as activated. Called after successful auth only. */
async function markCodeUsed(codeId) {
  const { error } = await supabase
    .from('access_codes')
    .update({ used: true })
    .eq('id', codeId)
  if (error) console.error('Failed to mark code as used:', error.message)
}

/**
 * Verify that the currently-signed-in user has at least one active (non-expired)
 * code for their email. This catches edge cases like manual DB edits where the
 * auth user still exists but their invitation has expired.
 */
async function userHasActiveCode(email) {
  const cutoffIso = accessCodeCutoffIso()
  const { data, error } = await supabase
    .from('access_codes')
    .select('id')
    .eq('email', email)
    .gte('created_at', cutoffIso)
    .limit(1)
  if (error) {
    console.error('access_codes verify failed:', error.message)
    return false
  }
  return Array.isArray(data) && data.length > 0
}

/** Main login submit handler. */
async function handleSubmit(ev) {
  ev.preventDefault()
  setError('')
  setBusy(true)

  const email = $('login-email').value.trim().toLowerCase()
  const password = $('login-password').value
  const code = $('login-code').value.trim()

  if (!email || !password || !code) {
    setError('Please fill in all three fields.')
    setBusy(false)
    return
  }

  try {
    // ─── Step 1: validate access code FIRST ───────────────────
    const { row: codeRow, reason } = await findValidAccessCode(email, code)
    if (!codeRow) {
      setError(reason === 'expired'
        ? 'Access code expired. Ask an admin for a fresh one.'
        : 'Invalid access code.')
      setBusy(false)
      return
    }

    // ─── Step 2: attempt signIn, fall back to signUp ──────────
    let { data: signInData, error: signInErr } =
      await supabase.auth.signInWithPassword({ email, password })

    if (signInErr) {
      const msg = (signInErr.message || '').toLowerCase()
      const looksLikeMissingUser =
        msg.includes('invalid login credentials') ||
        msg.includes('email not confirmed') ||
        msg.includes('user not found')

      if (looksLikeMissingUser) {
        // No account yet → create one. The code row exists & is unused, so
        // this is a legitimate first-time activation.
        const { data: signUpData, error: signUpErr } =
          await supabase.auth.signUp({ email, password })
        if (signUpErr) {
          setError(signUpErr.message || 'Sign-up failed.')
          setBusy(false)
          return
        }
        signInData = signUpData
      } else {
        setError(signInErr.message || 'Sign-in failed.')
        setBusy(false)
        return
      }
    }

    // ─── Step 3: mark code used + reveal app ─────────────────
    await markCodeUsed(codeRow.id)
    setBusy(false)
    showApp()

    // Dispatch a custom event so main.js can re-render with the new session.
    window.dispatchEvent(new CustomEvent('auth:ready', { detail: signInData }))
  } catch (err) {
    console.error('Login flow error:', err)
    setError(err.message || 'Unexpected error during sign-in.')
    setBusy(false)
  }
}

/** Logout handler — signs out and reloads. */
async function handleLogout() {
  await supabase.auth.signOut()
  window.location.reload()
}

/**
 * On page load: check for an existing session AND that the user has at least
 * one used=true code for their email. Both conditions must hold; otherwise we
 * sign out and show the login form.
 */
export async function initAuth() {
  // If the Supabase client failed to initialize (placeholder config etc.),
  // supabaseClient.js has already rendered an error banner. Bail without
  // touching the rest of the UI to avoid a confusing "Cannot read .auth"
  // crash on top of the visible banner.
  if (!supabase) return null

  // Wire up form submit + logout button.
  const form = $('login-form')
  if (form) form.addEventListener('submit', handleSubmit)
  const logoutBtn = $('btn-logout')
  if (logoutBtn) logoutBtn.addEventListener('click', handleLogout)

  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    showLogin()
    return null
  }

  const email = session.user?.email?.toLowerCase()
  if (!email) {
    await supabase.auth.signOut()
    showLogin()
    return null
  }

    const consumed = await userHasActiveCode(email)
  if (!consumed) {
    // Session exists but no code was ever used — treat as not authorized.
    await supabase.auth.signOut()
    showLogin()
    return null
  }

  showApp()
  return session
}
