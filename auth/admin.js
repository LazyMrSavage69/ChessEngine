// auth/admin.js — admin code generator UI.
//
// Page-load protection:
//   • Must be signed in.
//   • Must have profiles.role = 'admin'.
// Anything less → render an access-denied page and stop.
//
// IMPORTANT: the role check is enforced server-side by Supabase RLS policies
// on the `access_codes` and `profiles` tables. The client-side check here is
// for UX only — it hides the admin UI from non-admins, but the real
// authorization lives in the database.

import { supabase } from '/supabaseClient.js'

const $ = (id) => document.getElementById(id)
const ACCESS_CODE_TTL_DAYS = 30

function denyAccess(reason = 'Access denied.') {
  document.body.innerHTML =
    `<main style="max-width:600px;margin:80px auto;padding:24px;
                   font-family:system-ui,sans-serif;color:#e8e8f0;">
       <h1 style="margin-bottom:12px">${reason}</h1>
       <p><a href="/" style="color:#4a9eff">← Back to home</a></p>
     </main>`
}

/** Generate a fresh code and insert a row into access_codes. */
async function generateCode(email) {
  const code = crypto.randomUUID()
  const { error } = await supabase
    .from('access_codes')
    .insert({ email, code, used: false })
  if (error) throw error
  return code
}

/** Fetch all codes for the table (most recent first). */
async function fetchAllCodes() {
  const { data, error } = await supabase
    .from('access_codes')
    .select('email, code, used, created_at')
    .order('created_at', { ascending: false })
  if (error) {
    console.error('Failed to fetch access_codes:', error.message)
    return []
  }
  return data || []
}

/** Render the table of existing codes. */
function renderTable(rows) {
  const tbody = $('codes-tbody')
  if (!tbody) return
  tbody.innerHTML = ''
  if (rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="muted">No codes yet.</td></tr>`
    return
  }
  for (const r of rows) {
    const tr = document.createElement('tr')
    const createdAt = r.created_at ? new Date(r.created_at) : null
    const createdLabel = createdAt ? createdAt.toLocaleString() : '—'
    const expiresAt = createdAt
      ? new Date(createdAt.getTime() + ACCESS_CODE_TTL_DAYS * 24 * 60 * 60 * 1000)
      : null
    const expired = expiresAt ? Date.now() > expiresAt.getTime() : false
    const status = expired
      ? 'expired'
      : (r.used ? 'active (activated)' : 'active (unused)')
    const expiresLabel = expiresAt ? expiresAt.toLocaleString() : '—'
    tr.innerHTML = `
      <td>${escapeHtml(r.email)}</td>
      <td><code>${escapeHtml(r.code)}</code></td>
      <td>${escapeHtml(status)}</td>
      <td>${escapeHtml(createdLabel)}</td>
      <td>${escapeHtml(expiresLabel)}</td>
    `
    tbody.appendChild(tr)
  }
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

async function handleGenerate(ev) {
  ev.preventDefault()
  const emailInput = $('admin-email')
  const status     = $('admin-status')
  const display    = $('generated-code')
  const email = emailInput.value.trim().toLowerCase()
  if (!email) {
    status.textContent = 'Email is required.'
    status.className = 'admin-status error'
    return
  }
  status.textContent = 'Generating…'
  status.className = 'admin-status'
  try {
    const code = await generateCode(email)
    display.value = code
    document.getElementById('generated-row').classList.remove('hidden')
    status.textContent = `Code generated for ${email}. It’s reusable for 30 days and locked to that email.`
    status.className = 'admin-status success'
    emailInput.value = ''
    renderTable(await fetchAllCodes())
  } catch (err) {
    console.error('generateCode failed:', err)
    status.textContent = err.message || 'Failed to generate code.'
    status.className = 'admin-status error'
  }
}

async function handleCopy() {
  const display = $('generated-code')
  if (!display || !display.value) return
  try {
    await navigator.clipboard.writeText(display.value)
    const status = $('admin-status')
    status.textContent = 'Copied to clipboard.'
    status.className = 'admin-status success'
  } catch (err) {
    console.error('Clipboard write failed:', err)
  }
}

/**
 * Bootstraps the admin page. Runs role check BEFORE rendering any UI so a
 * non-admin never sees the form / code table.
 */
async function init() {
  // 1. Must be signed in.
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    window.location.href = '/index.html'
    return
  }

  // 2. Must have profiles.role = 'admin'. RLS on the profiles table should
  //    only allow the user to read their own row.
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (error || !profile || profile.role !== 'admin') {
    denyAccess('Access denied.')
    return
  }

  // 3. Wire up UI now that we've passed the role check.
  const adminRoot = $('admin-root')
  if (adminRoot) adminRoot.classList.remove('hidden')

  const form = $('admin-form')
  if (form) form.addEventListener('submit', handleGenerate)

  const copyBtn = $('btn-copy-code')
  if (copyBtn) copyBtn.addEventListener('click', handleCopy)

  // Initial table render.
  renderTable(await fetchAllCodes())
}

document.addEventListener('DOMContentLoaded', init)
